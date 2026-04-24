/**
 * Layer 96 — Cross-device Sync
 *
 *   POST /api/sync         body: { code, bundle }
 *   GET  /api/sync/:code   → { bundle } | { error }
 *
 * Short-lived key-value handoff. Upstash SETEX with a 10-minute TTL
 * when env is configured; in-memory Map with the same TTL otherwise.
 * The bundle is opaque to the server — just the 'brainsnn-bundle-v1'
 * JSON from Layer 57.
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const TTL_SEC = 10 * 60;
const MAX_BUNDLE = 256 * 1024; // 256 KB
const RL_LIMIT = 6;
const RL_WINDOW = 60 * 1000;

const mem = { entries: new Map(), rate: new Map() };

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
function rateLimited(key) {
  const bucket = Math.floor(Date.now() / RL_WINDOW);
  const k = `${key}:${bucket}`;
  const n = (mem.rate.get(k) || 0) + 1;
  mem.rate.set(k, n);
  if (mem.rate.size > 2000) {
    for (const rk of mem.rate.keys()) if (!rk.endsWith(`:${bucket}`)) mem.rate.delete(rk);
  }
  return n > RL_LIMIT;
}

function sanitizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

async function upstash(cmd) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const r = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.result;
  } catch { return null; }
}

async function putBundle(code, bundle) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    await upstash(['SETEX', `sync:${code}`, TTL_SEC, bundle]);
    return;
  }
  mem.entries.set(code, { bundle, expires: Date.now() + TTL_SEC * 1000 });
  // Sweep expired
  const now = Date.now();
  for (const [k, v] of mem.entries) if (v.expires < now) mem.entries.delete(k);
}

async function getBundle(code) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const res = await upstash(['GET', `sync:${code}`]);
    return res || null;
  }
  const entry = mem.entries.get(code);
  if (!entry) return null;
  if (entry.expires < Date.now()) { mem.entries.delete(code); return null; }
  return entry.bundle;
}

export async function handleSyncPost(req, res) {
  if (rateLimited(`sync:${clientIp(req)}`)) {
    res.status(429).json({ error: 'rate limited' });
    return;
  }
  const body = req.body || {};
  const code = sanitizeCode(body.code);
  if (code.length < 4) { res.status(400).json({ error: 'code must be 4+ alphanumerics' }); return; }
  const bundle = typeof body.bundle === 'string' ? body.bundle : JSON.stringify(body.bundle || {});
  if (!bundle || bundle.length > MAX_BUNDLE) {
    res.status(400).json({ error: `bundle must be 1..${MAX_BUNDLE} bytes` });
    return;
  }
  await putBundle(code, bundle);
  res.json({ ok: true, code, bytes: bundle.length, ttlSec: TTL_SEC, backend: UPSTASH_URL ? 'upstash' : 'memory' });
}

export async function handleSyncGet(req, res) {
  if (rateLimited(`sync:${clientIp(req)}`)) {
    res.status(429).json({ error: 'rate limited' });
    return;
  }
  const code = sanitizeCode(req.params?.code);
  if (!code) { res.status(400).json({ error: 'invalid code' }); return; }
  const bundle = await getBundle(code);
  if (!bundle) { res.status(404).json({ error: 'not found or expired' }); return; }
  res.json({ ok: true, code, bundle, backend: UPSTASH_URL ? 'upstash' : 'memory' });
}
