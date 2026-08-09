import { describe, expect, it } from '../test/tinyVitest.js';
import {
  BODY_LIMITS,
  DEDICATED_ROUTES,
  GEMINI_CEILING,
  LIMITS,
  RateLimiter,
  SpendCeiling,
  resolveGeminiCeiling,
  routeTier,
} from './rateLimit.js';

// An injected clock throughout: a limiter tested with real time is a limiter
// tested by waiting, which makes the suite slow and flaky.
describe('RateLimiter', () => {
  it('allows exactly the configured number of requests per window', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000 });
    const results = [0, 10, 20, 30].map((offset) => limiter.consume('ip', 1000 + offset));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it('reports how long to wait, never zero', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.consume('ip', 0);
    const blocked = limiter.consume('ip', 100);
    expect(blocked.allowed).toBe(false);
    // A Retry-After of 0 invites an instant retry, which is not a limit at all.
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThan(61);
  });

  it('reopens the window once it has elapsed', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.consume('ip', 0).allowed).toBe(true);
    expect(limiter.consume('ip', 500).allowed).toBe(false);
    expect(limiter.consume('ip', 1000).allowed).toBe(true);
  });

  it('keeps callers independent', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.consume('a', 0).allowed).toBe(true);
    expect(limiter.consume('a', 1).allowed).toBe(false);
    // One noisy caller must not lock everyone else out.
    expect(limiter.consume('b', 1).allowed).toBe(true);
  });

  it('counts down the remaining allowance', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.consume('ip', 0).remaining).toBe(2);
    expect(limiter.consume('ip', 1).remaining).toBe(1);
    expect(limiter.consume('ip', 2).remaining).toBe(0);
  });

  // An in-memory limiter that never forgets is a memory leak with a rate limit
  // bolted on, and the keys are attacker-supplied.
  it('sweeps idle keys so the map cannot grow without bound', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 1000, sweepAfterMs: 4000 });
    for (let i = 0; i < 500; i += 1) limiter.consume(`ip-${i}`, 0);
    expect(limiter.size).toBe(500);

    limiter.consume('recent', 4500);
    expect(limiter.sweep(5000)).toBe(500);
    expect(limiter.size).toBe(1);
  });

  it('does not sweep a key that is still inside its window', () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 1000, sweepAfterMs: 4000 });
    limiter.consume('ip', 0);
    expect(limiter.sweep(1000)).toBe(0);
    expect(limiter.size).toBe(1);
  });
});

describe('SpendCeiling', () => {
  // This is the backstop: the limiter caps one caller, the ceiling caps the
  // process. It has to hold even when the limiter is bypassed or the app runs
  // on more replicas than expected.
  it('stops paying once the ceiling is reached', () => {
    const ceiling = new SpendCeiling({ limit: 2, windowMs: 1000 });
    expect(ceiling.tryConsume(0)).toBe(true);
    expect(ceiling.tryConsume(1)).toBe(true);
    expect(ceiling.tryConsume(2)).toBe(false);
    expect(ceiling.tryConsume(3)).toBe(false);
  });

  it('refills on the next window', () => {
    const ceiling = new SpendCeiling({ limit: 1, windowMs: 1000 });
    expect(ceiling.tryConsume(0)).toBe(true);
    expect(ceiling.tryConsume(999)).toBe(false);
    expect(ceiling.tryConsume(1000)).toBe(true);
  });

  it('reports what is left without spending it', () => {
    const ceiling = new SpendCeiling({ limit: 3, windowMs: 1000 });
    expect(ceiling.remaining(0)).toBe(3);
    ceiling.tryConsume(0);
    expect(ceiling.remaining(0)).toBe(2);
    expect(ceiling.remaining(2000)).toBe(3);
  });
});

describe('the configured limits are the ones the risk calls for', () => {
  it('is strictest on the endpoint that spends money', () => {
    // /api/analyze can reach Gemini on every allowed request.
    expect(LIMITS.analyze.limit).toBeLessThan(LIMITS.general.limit);
    expect(LIMITS.analyze.windowMs).toBe(60_000);
  });

  it('treats magic-link as the mail relay it would become', () => {
    // Supabase unset today, but configured it sends to any address a caller
    // names, so the window is an hour rather than a minute.
    expect(LIMITS.magicLink.limit).toBeLessThan(LIMITS.analyze.limit);
    expect(LIMITS.magicLink.windowMs).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('caps bodies far below the 2 MB that made the prompt expensive', () => {
    // 2 MB was roughly 500,000 tokens of attacker text per request.
    const kb = (value) => Number(String(value).replace('kb', ''));
    expect(kb(BODY_LIMITS.analyze)).toBeLessThanOrEqual(64);
    expect(kb(BODY_LIMITS.events)).toBeLessThanOrEqual(kb(BODY_LIMITS.analyze));
  });

  it('bounds hourly Gemini spend', () => {
    expect(GEMINI_CEILING.windowMs).toBe(60 * 60_000);
    expect(GEMINI_CEILING.limit).toBeGreaterThan(0);
  });
});

describe('exactly one limiter governs each route', () => {
  // Found by measuring a real browsing session rather than by reading the code:
  // /api/events declares 240/min and was being held to 120 by the general floor
  // mounted across /api, so half its configured allowance was unreachable on the
  // busiest route on the site.
  it('routes a dedicated path to its own tier, not the floor', () => {
    expect(routeTier('/api/events')).toBe('events');
    expect(routeTier('/api/analyze')).toBe('analyze');
    expect(routeTier('/api/auth/magic-link')).toBe('magicLink');
  });

  it('sends everything else to the floor', () => {
    for (const path of ['/api/layers', '/api/firewall', '/api/leads', '/api/soliton/explore']) {
      expect(routeTier(path)).toBe('general');
    }
  });

  it('is not fooled by a query string or a trailing slash', () => {
    expect(routeTier('/api/events?v=2')).toBe('events');
    expect(routeTier('/api/events/')).toBe('events');
  });

  it('names only tiers that exist', () => {
    // A typo here would silently send a route to the floor.
    for (const tier of Object.values(DEDICATED_ROUTES)) {
      expect(Object.keys(LIMITS)).toContain(tier);
    }
  });

  it('gives every declared tier a route to govern', () => {
    // The mirror of the bug: a tier configured and never reachable is a number
    // that describes nothing, which is how the 240 came to be misleading.
    const governed = new Set([...Object.values(DEDICATED_ROUTES), 'general']);
    for (const tier of Object.keys(LIMITS)) {
      expect(governed.has(tier)).toBe(true);
    }
  });
});

describe('resolveGeminiCeiling', () => {
  it('defaults when the variable is unset', () => {
    expect(resolveGeminiCeiling({}).limit).toBe(GEMINI_CEILING.limit);
    expect(resolveGeminiCeiling({ GEMINI_HOURLY_CEILING: '' }).limit).toBe(GEMINI_CEILING.limit);
  });

  it('takes the operator value', () => {
    expect(resolveGeminiCeiling({ GEMINI_HOURLY_CEILING: '50' }).limit).toBe(50);
  });

  it('treats zero as "spend nothing" rather than as unset', () => {
    // The difference matters: falling back to the default here would keep
    // billing after someone had explicitly turned it off.
    expect(resolveGeminiCeiling({ GEMINI_HOURLY_CEILING: '0' }).limit).toBe(0);
    expect(new SpendCeiling(resolveGeminiCeiling({ GEMINI_HOURLY_CEILING: '0' })).tryConsume(0)).toBe(false);
  });

  it('falls back to the default on nonsense rather than to no limit', () => {
    // A typo in an env var must not silently uncap spending.
    for (const raw of ['abc', '-5', 'NaN']) {
      expect(resolveGeminiCeiling({ GEMINI_HOURLY_CEILING: raw }).limit).toBe(GEMINI_CEILING.limit);
    }
  });
});
