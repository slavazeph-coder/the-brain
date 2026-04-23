/**
 * Layer 77 — Session Rooms
 *
 * Private head-to-head challenge rooms. A room is just a key in
 * Upstash (or in-memory fallback) that collects submitted scores
 * under a room ID.
 *
 *   POST /api/rooms  { room, handle, source, score, streak?, meta? }
 *   GET  /api/rooms/:room → { room, entries: [{handle, source, score, ts}] }
 *
 * No auth. Room IDs are 8-char base36 created client-side — collision
 * risk is acceptable for a private sharing URL.
 */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const WINDOW = 60 * 1000;
const LIMIT = 12;
const ROOM_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const MAX_ROOM_ENTRIES = 20;

const mem = { rooms: new Map(), rate: new Map() };

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function rateLimited(key) {
  const bucket = Math.floor(Date.now() / WINDOW);
  const k = `${key}:${bucket}`;
  const n = (mem.rate.get(k) || 0) + 1;
  mem.rate.set(k, n);
  if (mem.rate.size > 2000) {
    for (const rk of mem.rate.keys()) if (!rk.endsWith(`:${bucket}`)) mem.rate.delete(rk);
  }
  return n > LIMIT;
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

function sanitizeRoom(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}
function sanitizeHandle(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '').slice(0, 24) || 'anon';
}

async function listRoom(room) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const res = await upstash(['LRANGE', `room:${room}`, 0, MAX_ROOM_ENTRIES - 1]);
    if (!Array.isArray(res)) return [];
    const entries = [];
    for (const s of res) { try { entries.push(JSON.parse(s)); } catch { /* skip */ } }
    return entries;
  }
  return (mem.rooms.get(room) || []).slice(-MAX_ROOM_ENTRIES);
}

async function addEntry(room, entry) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const key = `room:${room}`;
    await upstash(['LPUSH', key, JSON.stringify(entry)]);
    await upstash(['LTRIM', key, 0, MAX_ROOM_ENTRIES - 1]);
    await upstash(['EXPIRE', key, ROOM_TTL_SEC]);
    return;
  }
  const list = mem.rooms.get(room) || [];
  list.push(entry);
  mem.rooms.set(room, list.slice(-MAX_ROOM_ENTRIES));
}

export async function handleRoomPost(req, res) {
  if (rateLimited(`rooms:${clientIp(req)}`)) {
    res.status(429).json({ error: 'rate limited' });
    return;
  }
  const body = req.body || {};
  const room = sanitizeRoom(body.room);
  const handle = sanitizeHandle(body.handle);
  const source = String(body.source || 'daily').slice(0, 16);
  const score = Math.max(0, Math.min(100, Math.round(Number(body.score) || 0)));
  const streak = Math.max(0, Math.round(Number(body.streak) || 0));
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : null;

  if (!room || room.length < 4) {
    res.status(400).json({ error: 'room id must be >= 4 alphanumerics' });
    return;
  }
  if (score < 0) {
    res.status(400).json({ error: 'invalid score' });
    return;
  }

  const entry = { handle, source, score, streak, ts: Date.now() };
  if (meta) entry.meta = meta;
  await addEntry(room, entry);
  const entries = await listRoom(room);
  res.json({ ok: true, room, entries, backend: UPSTASH_URL ? 'upstash' : 'memory' });
}

export async function handleRoomGet(req, res) {
  const room = sanitizeRoom(req.params?.room || '');
  if (!room) {
    res.status(400).json({ error: 'invalid room id' });
    return;
  }
  const entries = await listRoom(room);
  res.json({ room, entries, backend: UPSTASH_URL ? 'upstash' : 'memory' });
}
