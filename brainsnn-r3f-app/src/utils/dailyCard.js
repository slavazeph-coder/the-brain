/**
 * Daily Firewall Challenge share card — /d/<hash>.
 * Payload is compact: handle, accuracy, correct, streak, date.
 */

function b64urlEncode(str) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return window.atob(base);
  }
  return Buffer.from(base, 'base64').toString('utf-8');
}

const MAX_HANDLE = 24;

export function sanitizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-\. ]/g, '')
    .slice(0, MAX_HANDLE) || 'anon';
}

export function dailyLevelFor(accuracy) {
  if (accuracy >= 90) return { label: 'Clean sweep', color: '#5ee69a' };
  if (accuracy >= 75) return { label: 'Sharp eye', color: '#77dbe4' };
  if (accuracy >= 55) return { label: 'Solid', color: '#fdab43' };
  if (accuracy >= 30) return { label: 'Warm-up', color: '#e57b40' };
  return { label: 'Off day', color: '#dd6974' };
}

export function buildDailyPayload({ handle, date, accuracy, correct, streak }) {
  return {
    n: sanitizeHandle(handle),
    d: String(date || '').slice(0, 10),
    a: Math.max(0, Math.min(100, Math.round(accuracy || 0))),
    k: Math.max(0, Math.round(correct || 0)),
    st: Math.max(0, Math.round(streak || 0)),
    ts: Date.now(),
  };
}

export function encodeDaily(p) {
  try { return b64urlEncode(JSON.stringify(p)); } catch { return ''; }
}

export function decodeDaily(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      handle: p.n || 'anon',
      date: p.d || '',
      accuracy: p.a || 0,
      correct: p.k || 0,
      streak: p.st || 0,
      ts: p.ts || 0,
    };
  } catch { return null; }
}

export function dailyUrl(origin, payload) {
  return `${origin}/d/${encodeDaily(payload)}`;
}
