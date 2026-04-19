/**
 * Red Team attack submissions.
 *
 * POST /api/attacks → submit a new attack string. Stored with the
 * firewall score so weekly "attacks that bypassed the firewall" is just
 * a filter by score < 0.4.
 * GET  /api/attacks → public feed: most-recent + top-bypass this week.
 *
 * Upstash Redis via REST when env is set; in-memory fallback otherwise
 * so dev and first-deploys still work.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 600;
const MAX_HANDLE = 24;
const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const mem = { entries: [], rate: new Map() };

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

function sanitizeText(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
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
  } catch {
    return null;
  }
}

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

async function rateLimited(key) {
  const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const rkey = `rl:atk:${key}:${bucket}`;
    const count = await upstash(['INCR', rkey]);
    if (count === 1) await upstash(['EXPIRE', rkey, 120]);
    return typeof count === 'number' && count > RATE_LIMIT_MAX;
  }
  const k = `${key}:${bucket}`;
  const n = (mem.rate.get(k) || 0) + 1;
  mem.rate.set(k, n);
  if (mem.rate.size > 1000) {
    for (const [rk] of mem.rate) {
      if (!rk.endsWith(`:${bucket}`)) mem.rate.delete(rk);
    }
  }
  return n > RATE_LIMIT_MAX;
}

async function storeEntry(entry) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const wk = weekKey(entry.ts);
    const key = `atk:${wk}`;
    const value = JSON.stringify(entry);
    // ZADD with timestamp as score so we can range by recency
    await upstash(['ZADD', key, entry.ts, value]);
    await upstash(['EXPIRE', key, 60 * 60 * 24 * 14]);
    return true;
  }
  mem.entries.push(entry);
  const cutoff = Date.now() - 2 * WEEK_MS;
  mem.entries = mem.entries.filter((e) => e.ts > cutoff).slice(-500);
  return true;
}

async function listWeek(wk, limit = 30) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const key = `atk:${wk}`;
    const res = await upstash(['ZREVRANGE', key, 0, limit - 1]);
    if (!Array.isArray(res)) return [];
    const out = [];
    for (const s of res) {
      try { out.push(JSON.parse(s)); } catch { /* skip */ }
    }
    return out;
  }
  const wkEntries = mem.entries.filter((e) => weekKey(e.ts) === wk);
  return wkEntries.slice().reverse().slice(0, limit);
}

// Minimal server-side Cognitive Firewall score — keep in sync with
// src/utils/cognitiveFirewall.js DEFAULT_RULES. We don't need Gemma here
// because submissions are adversarial and users want fast feedback.
const URGENCY = [/\bnow\b|\bimmediately\b|\burgent\b|\bbreaking\b|\balert\b/gi, /\blimited time\b|\bdon't miss\b|\blast chance\b|\bact(?:s)? fast\b/gi, /!{2,}|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b/gi];
const OUTRAGE = [/\boutrage\b|\bfurious\b|\bscandal\b|\bterrible\b|\bhorrible\b/gi, /\bunbelievable\b|\bdisgusting\b|\bshocking\b|\bbetray/gi, /\bthey don't want you to know\b|\bhidden\b|\bsecret\b|\bcovered up\b/gi];
const CERTAINTY = [/\b100%\b|\bproven\b|\bguaranteed\b|\bscientifically proven\b|\bfact\b/gi, /\beveryone knows\b|\bobviously\b|\bclearly\b|\bundeniably\b/gi];
const FEAR = [/\bdie\b|\bdeath\b|\bkill\b|\bdanger\b|\bthreat\b|\bsafe\b|\bunsafe\b/gi, /\bvirus\b|\bpandemic\b|\battack\b|\bwar\b|\bcrash\b|\bcollapse\b/gi];

function countMatches(text, patterns) {
  return patterns.reduce((t, re) => {
    const m = text.match(re);
    return t + (m ? m.length : 0);
  }, 0);
}

function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
function normalize(c, baseline = 3) { return clamp(c / baseline); }

function scoreFirewall(text) {
  const words = text.trim().split(/\s+/).length;
  if (words < 5) return { pressure: 0, bypass: true };
  const u = countMatches(text, URGENCY);
  const o = countMatches(text, OUTRAGE);
  const c = countMatches(text, CERTAINTY);
  const f = countMatches(text, FEAR);
  const emo = normalize(f + o, 4) * 0.85;
  const cog = normalize(u + c, 4) * 0.80;
  const pressure = (emo + cog + (emo * 0.55 + cog * 0.45)) / 3;
  return { pressure: Math.round(pressure * 1000) / 1000, bypass: pressure < 0.4 };
}

export async function handleAttackSubmit(req, res) {
  const body = req.body || {};
  const text = sanitizeText(body.text);
  const handle = sanitizeHandle(body.handle);
  const intent = sanitizeText(body.intent).slice(0, 80);

  if (text.length < 20) {
    res.status(400).json({ error: 'attack must be at least 20 chars' });
    return;
  }

  const ip = clientIp(req);
  if (await rateLimited(`atk:${ip}`)) {
    res.status(429).json({ error: 'rate limited — try again in a minute' });
    return;
  }

  const score = scoreFirewall(text);
  const entry = {
    handle,
    intent: intent || 'manipulate',
    text,
    pressure: score.pressure,
    bypass: score.bypass,
    ts: Date.now(),
  };
  await storeEntry(entry);

  res.json({
    ok: true,
    pressure: score.pressure,
    bypass: score.bypass,
    message: score.bypass
      ? 'Nice bypass — this one scored below 40% pressure. Added to the weekly feed.'
      : `Firewall caught it at ${(score.pressure * 100).toFixed(0)}% pressure. Still logged — try softer framing.`,
    backend: UPSTASH_URL ? 'upstash' : 'memory',
  });
}

export async function handleAttacksGet(req, res) {
  const week = weekKey();
  const all = await listWeek(week, 50);
  const bypassed = all.filter((e) => e.bypass).slice(0, 10);
  const recent = all.slice(0, 10);
  res.json({
    week,
    total: all.length,
    bypassed,
    recent,
    backend: UPSTASH_URL ? 'upstash' : 'memory',
  });
}
