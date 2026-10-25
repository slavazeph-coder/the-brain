export const LIMITS = Object.freeze({
  analyze: { limit: 15, windowMs: 60_000, sweepAfterMs: 300_000 },
  neural: { limit: 24, windowMs: 60_000, sweepAfterMs: 300_000 },
  magicLink: { limit: 5, windowMs: 60 * 60_000, sweepAfterMs: 2 * 60 * 60_000 },
  general: { limit: 120, windowMs: 60_000, sweepAfterMs: 300_000 },
  events: { limit: 240, windowMs: 60_000, sweepAfterMs: 300_000 },
});

export const BODY_LIMITS = Object.freeze({
  analyze: '64kb',
  neural: '256kb',
  events: '16kb',
  general: '64kb',
});

export const GEMINI_CEILING = Object.freeze({
  limit: 120,
  windowMs: 60 * 60_000,
});

export const DEDICATED_ROUTES = Object.freeze({
  '/api/events': 'events',
  '/api/analyze': 'analyze',
  '/api/v1/multimodal/ingest': 'neural',
  '/api/v1/neural/predict': 'neural',
  '/api/neural/decode': 'neural',
  '/api/auth/magic-link': 'magicLink',
});

export function routeTier(pathname = '') {
  const clean = String(pathname).split('?')[0].replace(/\/+$/, '') || '/';
  return DEDICATED_ROUTES[clean] || 'general';
}

export function resolveGeminiCeiling(env = {}) {
  const raw = env?.GEMINI_HOURLY_CEILING;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ...GEMINI_CEILING };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return { ...GEMINI_CEILING };
  }
  return { limit: parsed, windowMs: GEMINI_CEILING.windowMs };
}

export class RateLimiter {
  constructor({ limit = 60, windowMs = 60_000, sweepAfterMs = windowMs * 4 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.sweepAfterMs = sweepAfterMs;
    this.buckets = new Map();
  }

  get size() {
    return this.buckets.size;
  }

  consume(key = 'anon', now = Date.now()) {
    const id = String(key);
    let entry = this.buckets.get(id);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { windowStart: now, count: 0, lastSeen: now };
      this.buckets.set(id, entry);
    }
    entry.lastSeen = now;
    if (entry.count < this.limit) {
      entry.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, this.limit - entry.count),
        retryAfterSeconds: 0,
      };
    }
    const elapsed = now - entry.windowStart;
    const retryAfterSeconds = Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  sweep(now = Date.now()) {
    let removed = 0;
    for (const [key, entry] of this.buckets.entries()) {
      if (now - entry.windowStart >= this.sweepAfterMs || (now - entry.windowStart >= this.windowMs && now - entry.lastSeen >= this.sweepAfterMs)) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export class SpendCeiling {
  constructor({ limit = Number(GEMINI_CEILING.limit), windowMs = Number(GEMINI_CEILING.windowMs) } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windowStart = null;
    this.used = 0;
  }

  _sync(now) {
    if (this.windowStart === null || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.used = 0;
    }
  }

  tryConsume(now = Date.now()) {
    this._sync(now);
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }

  remaining(now = Date.now()) {
    this._sync(now);
    return Math.max(0, this.limit - this.used);
  }
}
