// Rate limiting for the public API.
//
// WHY THIS EXISTS
//
// `POST /api/analyze` is public, unauthenticated and unmetered, and it embeds
// the caller's text directly into a Gemini prompt using the operator's API key.
// Three things compounded:
//
//   - express.json allowed 2 MB per request, so one call could carry roughly
//     500,000 tokens of attacker-chosen text into that prompt
//   - the handler loops over two models
//   - each attempt runs through callGeminiWithRetry with maxRetries = 2
//
// Worst case that is six billed calls and about three million input tokens from
// a single HTTP request. Six is not the typical case — the loop breaks on
// success and only transient errors retry — but oversized payloads are exactly
// what provoke the 429/503 conditions treated as retryable, so an attacker can
// reach it deliberately, at will, with no account.
//
// Two other endpoints share the shape: /api/auth/magic-link asks Supabase to
// send mail to an arbitrary address (an open relay the moment Supabase is
// configured), and /api/neural/decode proxies to an external decoder.
//
// DESIGN
//
// Hand-rolled rather than adding a dependency, matching the call made when the
// powder-lab share codec was written as RLE instead of pulling in lz-string.
//
// The logic lives here as a pure module with an injected clock, because
// server.ts has no tests at all — every /api route in the Playwright spec is
// mocked with page.route, so no test in this repo has ever executed real server
// code. Putting the one piece of logic that must be correct inside that file
// would leave it uncovered. This mirrors routeMeta.js: pure logic in a plain
// .js module, thin wiring in server.ts.
//
// LIMITATION, STATED RATHER THAN DISCOVERED LATER
//
// The counters are in memory, so a limit is per process. If Railway ever runs
// more than one replica the effective limit multiplies by the replica count.
// That is acceptable at this stage and far better than nothing, but it is the
// reason the Gemini spend ceiling below exists as a separate backstop: the
// ceiling bounds cost even when the limiter is bypassed or over-provisioned.

/** Fixed-window counters. Windows are cheap and adequate; a token bucket buys
 *  smoothness this does not need. */
export class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.limit      requests allowed per window
   * @param {number} options.windowMs   window length
   * @param {number} [options.sweepAfterMs] drop idle keys after this long
   */
  constructor({ limit, windowMs, sweepAfterMs = windowMs * 4 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.sweepAfterMs = sweepAfterMs;
    /** @type {Map<string, {count: number, windowStart: number}>} */
    this.hits = new Map();
  }

  /**
   * Records one request against `key`.
   * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
   */
  consume(key, now = Date.now()) {
    const entry = this.hits.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    entry.count += 1;
    if (entry.count > this.limit) {
      const msLeft = this.windowMs - (now - entry.windowStart);
      return {
        allowed: false,
        remaining: 0,
        // Always at least a second: a Retry-After of 0 invites an instant retry.
        retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
      };
    }
    return { allowed: true, remaining: this.limit - entry.count, retryAfterSeconds: 0 };
  }

  /** Drops keys idle longer than sweepAfterMs so the map cannot grow forever. */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart > this.sweepAfterMs) {
        this.hits.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size() {
    return this.hits.size;
  }
}

/**
 * Rolling ceiling on how many times a paid upstream may be called per window.
 *
 * This is the backstop. The rate limiter caps how often any one caller can ask;
 * this caps what the whole process can spend, whoever is asking. Past the
 * ceiling `/api/analyze` serves the deterministic local engine — which is
 * already what it does when no API key is set, so the degraded path is the
 * well-travelled one rather than an error nobody has seen.
 */
export class SpendCeiling {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.count = 0;
    this.windowStart = 0;
  }

  /** True when a paid call is still within budget; records it if so. */
  tryConsume(now = Date.now()) {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }

  remaining(now = Date.now()) {
    if (now - this.windowStart >= this.windowMs) return this.limit;
    return Math.max(0, this.limit - this.count);
  }
}

/**
 * Limits per risk class. The numbers are deliberately generous for humans and
 * hostile to scripts: a person exploring the site never approaches them.
 */
export const LIMITS = Object.freeze({
  // Billable: every allowed request can reach Gemini.
  analyze: { limit: 12, windowMs: 60_000 },
  // Sends mail to an address the caller chooses.
  magicLink: { limit: 3, windowMs: 60 * 60_000 },
  // Everything else: local computation only, but still worth bounding.
  general: { limit: 120, windowMs: 60_000 },
  // Easiest thing on the site to flood, and the cheapest to serve.
  events: { limit: 240, windowMs: 60_000 },
});

/**
 * Routes that carry their own tier, so the general floor must not also apply.
 *
 * Mounting `general` across `/api` and then a per-route tier on top looked like
 * defence in depth and was not: two counters both run, and the *stricter* one
 * decides. For `/api/analyze` (12/min) and `/api/auth/magic-link` (3/hour) the
 * dedicated tier is stricter, so `general` never bound and the stacking was
 * merely inert. For `/api/events` it was actively wrong — the endpoint declares
 * 240/min and `general` capped it at 120, making half the configured allowance
 * unreachable on the highest-volume route on the site.
 *
 * So: exactly one limiter per route. `routeTier()` is the single place that
 * decides which, and the coherence of the whole table is asserted in tests
 * rather than left to whoever next adds a route.
 */
export const DEDICATED_ROUTES = Object.freeze({
  '/api/analyze': 'analyze',
  '/api/auth/magic-link': 'magicLink',
  '/api/events': 'events',
});

/**
 * Which limiter governs a path.
 * @param {string} pathname a full request path, query already stripped
 * @returns {keyof LIMITS} the tier name, defaulting to `general`
 */
export function routeTier(pathname = '') {
  const clean = String(pathname).split('?')[0].replace(/\/+$/, '') || '/';
  return DEDICATED_ROUTES[clean] || 'general';
}

/** Gemini calls allowed per hour across the whole process. */
export const GEMINI_CEILING = Object.freeze({ limit: 240, windowMs: 60 * 60_000 });

/**
 * The ceiling, with `GEMINI_HOURLY_CEILING` allowed to override the limit.
 *
 * Tunable without a redeploy, because the right number depends on traffic and
 * on a bill nobody has seen yet. `0` disables paid calls entirely and serves the
 * local engine for everything, which is the fastest way to stop spending
 * without pulling the API key out and losing it.
 */
export function resolveGeminiCeiling(env = {}) {
  const raw = env.GEMINI_HOURLY_CEILING;
  if (raw === undefined || raw === '') return { ...GEMINI_CEILING };
  const limit = Number(raw);
  if (!Number.isFinite(limit) || limit < 0) return { ...GEMINI_CEILING };
  return { limit: Math.floor(limit), windowMs: GEMINI_CEILING.windowMs };
}

/**
 * Request body caps, in bytes.
 *
 * The old global cap was 2 MB. Corpus entries are a few hundred characters and
 * the longest realistic paste is an article, so 64 KB is roomy for analysis
 * while removing the 500,000-token prompt outright. This is the single largest
 * cost reduction available and the cheapest to make.
 */
export const BODY_LIMITS = Object.freeze({
  analyze: '64kb',
  events: '16kb',
  general: '256kb',
});
