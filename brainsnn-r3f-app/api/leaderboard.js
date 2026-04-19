/**
 * /api/leaderboard
 *
 * GET  → { top: [{handle, score, ts}], total, week, yourRank? }
 * POST → { ok, rank, total, week }
 *
 * Storage: Upstash Redis via REST API (env: UPSTASH_REDIS_REST_URL,
 * UPSTASH_REDIS_REST_TOKEN). No env = graceful fallback: in-memory,
 * per-lambda-instance, non-persistent — still useful for local dev and
 * degrades loudly but doesn't 500 the UI.
 *
 * Fraud-tolerant by design: scores are self-reported for a viral share
 * loop, not a competitive game. Rate-limit by IP + handle hash on write
 * to stop the most obvious abuse.
 */

export const config = { runtime: 'edge' };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HANDLE = 24;
const MAX_ENTRIES = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 min
const RATE_LIMIT_MAX = 6;

const UPSTASH_URL = (typeof process !== 'undefined' && process.env && process.env.UPSTASH_REDIS_REST_URL) || '';
const UPSTASH_TOKEN = (typeof process !== 'undefined' && process.env && process.env.UPSTASH_REDIS_REST_TOKEN) || '';

// Global in-memory fallback so dev + no-upstash deploys still work.
const mem = globalThis.__brainsnn_leaderboard__ || (globalThis.__brainsnn_leaderboard__ = { entries: [], rate: new Map() });

function weekKey(ts = Date.now()) {
  const d = new Date(ts);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((ts - start) / 86400000);
  return `${d.getUTCFullYear()}-W${Math.floor(dayOfYear / 7)}`;
}

function sanitizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-\. ]/g, '')
    .slice(0, MAX_HANDLE) || 'anon';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function upstash(cmd) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const r = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.result;
  } catch {
    return null;
  }
}

function memAdd(entry) {
  mem.entries.push(entry);
  // cap + drop entries older than 2 weeks
  const cutoff = Date.now() - 2 * WEEK_MS;
  mem.entries = mem.entries.filter((e) => e.ts > cutoff).slice(-1000);
}

function memThisWeek() {
  const wk = weekKey();
  return mem.entries.filter((e) => weekKey(e.ts) === wk);
}

async function rateLimited(key) {
  const now = Date.now();
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const rkey = `rl:${key}:${Math.floor(now / RATE_LIMIT_WINDOW_MS)}`;
    const count = await upstash(['INCR', rkey]);
    if (count === 1) await upstash(['EXPIRE', rkey, 120]);
    return typeof count === 'number' && count > RATE_LIMIT_MAX;
  }
  // in-memory fallback
  const bucket = Math.floor(now / RATE_LIMIT_WINDOW_MS);
  const k = `${key}:${bucket}`;
  const n = (mem.rate.get(k) || 0) + 1;
  mem.rate.set(k, n);
  // prune
  if (mem.rate.size > 1000) {
    for (const [rk] of mem.rate) {
      if (!rk.endsWith(`:${bucket}`)) mem.rate.delete(rk);
    }
  }
  return n > RATE_LIMIT_MAX;
}

async function listWeek(wk) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const key = `lb:${wk}`;
    const res = await upstash(['ZREVRANGE', key, 0, MAX_ENTRIES - 1, 'WITHSCORES']);
    if (!Array.isArray(res)) return [];
    const entries = [];
    for (let i = 0; i < res.length; i += 2) {
      try {
        const parsed = JSON.parse(res[i]);
        entries.push({ handle: parsed.handle, ts: parsed.ts, score: Number(res[i + 1]) });
      } catch {
        // skip malformed
      }
    }
    return entries;
  }
  return memThisWeek().sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
}

async function countWeek(wk) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const n = await upstash(['ZCARD', `lb:${wk}`]);
    return typeof n === 'number' ? n : 0;
  }
  return memThisWeek().length;
}

async function addEntry(entry) {
  const wk = weekKey(entry.ts);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const key = `lb:${wk}`;
    const member = JSON.stringify({ handle: entry.handle, ts: entry.ts });
    await upstash(['ZADD', key, entry.score, member]);
    await upstash(['EXPIRE', key, 60 * 60 * 24 * 14]); // 2 weeks
    const total = (await upstash(['ZCARD', key])) || 0;
    const rank = await upstash(['ZREVRANK', key, member]);
    return { rank: typeof rank === 'number' ? rank + 1 : null, total };
  }
  memAdd(entry);
  const sorted = memThisWeek().sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex((e) => e.ts === entry.ts && e.handle === entry.handle) + 1;
  return { rank: rank || null, total: sorted.length };
}

function clientIp(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const url = new URL(req.url);
  const week = weekKey();

  if (req.method === 'GET') {
    const top = await listWeek(week);
    const total = await countWeek(week);
    return json({
      week,
      total,
      top: top.map((e) => ({ handle: e.handle, score: e.score, ts: e.ts })),
      backend: UPSTASH_URL ? 'upstash' : 'memory',
    });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const handle = sanitizeHandle(body.handle);
    const score = Math.max(0, Math.min(100, Math.round(Number(body.score) || 0)));
    const streak = Math.max(0, Math.round(Number(body.streak) || 0));
    const events = Math.max(0, Math.round(Number(body.events) || 0));

    if (score < 1) return json({ error: 'score must be >= 1' }, 400);
    if (events < 1) return json({ error: 'no events — score with content first' }, 400);

    const ip = clientIp(req);
    const limited = await rateLimited(`lb:${ip}`);
    if (limited) return json({ error: 'rate limited — try again in a minute' }, 429);

    const entry = { handle, score, streak, events, ts: Date.now() };
    const { rank, total } = await addEntry(entry);

    return json({ ok: true, rank, total, week, backend: UPSTASH_URL ? 'upstash' : 'memory' });
  }

  return json({ error: 'method not allowed' }, 405);
}
