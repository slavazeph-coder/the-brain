/**
 * Layer 46 — Firewall Receipts
 *
 * Deterministic, verifiable record for every scan. Given the same
 * (text, templates, scores, UTC-day-bucketed timestamp) you always
 * produce the same short receipt hash, so:
 *
 *   - Anyone can paste a receipt + the original text into the app
 *     and confirm the score matches (receipt verification)
 *   - You can reference a specific scan result without revealing the
 *     full payload ("here's receipt R-7XQ2-F9A8" — recipient can
 *     verify it if you share the text later)
 *   - Light "paper trail" for serious manipulation exposure without
 *     a blockchain
 *
 * Uses SubtleCrypto (sha-256) when available, falls back to a small
 * deterministic string hash so the feature works in older browsers or
 * non-HTTPS local dev.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayBucket(ts = Date.now()) {
  return Math.floor(ts / DAY_MS);
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function receiptCanonical({ text, score, ts }) {
  const bucket = utcDayBucket(ts);
  const norm = normalizeText(text).slice(0, 4000);
  const e = Math.round((score?.emotionalActivation || 0) * 1000);
  const c = Math.round((score?.cognitiveSuppression || 0) * 1000);
  const m = Math.round((score?.manipulationPressure || 0) * 1000);
  const u = Math.round((score?.trustErosion || 0) * 1000);
  const tpls = (score?.templates || [])
    .map((t) => t.id)
    .sort()
    .join(',');
  return `brainsnn/v1|${bucket}|e=${e}|c=${c}|m=${m}|u=${u}|t=${tpls}|txt=${norm}`;
}

function fallbackHash(str) {
  // FNV-1a 64-bit fallback → 12-hex-char digest (good enough for display)
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

async function sha256Hex(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const buf = new TextEncoder().encode(str);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      /* fall through to fallback */
    }
  }
  return fallbackHash(str);
}

function formatReceipt(hex, bucket) {
  // R-<day4><hex4>-<hex4> — 15 chars, easy to paste
  const day = bucket.toString(36).toUpperCase().padStart(4, '0').slice(-4);
  const left = hex.slice(0, 4).toUpperCase();
  const right = hex.slice(4, 8).toUpperCase();
  return `R-${day}${left}-${right}`;
}

/**
 * Generate a receipt for a scan. Always resolves.
 * Returns { id, hex, canonical, ts, bucket }.
 */
export async function issueReceipt({ text, score, ts = Date.now() }) {
  const canonical = receiptCanonical({ text, score, ts });
  const hex = await sha256Hex(canonical);
  const bucket = utcDayBucket(ts);
  return {
    id: formatReceipt(hex, bucket),
    hex,
    canonical,
    ts,
    bucket,
    dayStart: new Date(bucket * DAY_MS).toISOString().slice(0, 10),
  };
}

/**
 * Verify that a text + score pair hashes to a given receipt ID.
 * Returns { ok, expected, got }.
 */
export async function verifyReceipt({ text, score, ts, receiptId }) {
  const r = await issueReceipt({ text, score, ts });
  return { ok: r.id === receiptId, expected: r.id, got: receiptId };
}

/**
 * Persist the most recent receipts so the user sees a rolling log
 * (local only, capped). Returns the updated log.
 */
const STORAGE_KEY = 'brainsnn_receipts_v1';
const MAX_STORED = 20;

export function recentReceipts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function storeReceipt(entry) {
  try {
    const list = recentReceipts();
    const slim = {
      id: entry.id,
      ts: entry.ts,
      pressure: entry.pressure,
      excerpt: (entry.excerpt || '').slice(0, 80),
    };
    const next = [slim, ...list.filter((x) => x.id !== entry.id)].slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch { return recentReceipts(); }
}

export function clearReceipts() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
