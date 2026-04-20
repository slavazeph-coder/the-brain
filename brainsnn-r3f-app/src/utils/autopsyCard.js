/**
 * Autopsy share card — encodes a transcript autopsy summary into a
 * compact base64url payload that travels as /a/<hash> and renders as
 * a 1200×630 OG image.
 *
 * Dependency-free — imported from both the SPA and the Express
 * server handlers.
 */

export const AUTOPSY_LEVELS = [
  { min: 0.65, label: 'Hostile', color: '#dd6974' },
  { min: 0.45, label: 'Heavy', color: '#e57b40' },
  { min: 0.28, label: 'Tilted', color: '#fdab43' },
  { min: 0.0, label: 'Steady', color: '#6daa45' },
];

export function autopsyLevelFor(pressure) {
  return AUTOPSY_LEVELS.find((l) => pressure >= l.min) || AUTOPSY_LEVELS[AUTOPSY_LEVELS.length - 1];
}

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

const MAX_TITLE = 48;

function sanitizeTitle(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}

export function buildAutopsyPayload({ title, summary }) {
  return {
    ttl: sanitizeTitle(title || 'Chat autopsy'),
    t: Math.max(0, Math.round(summary.turns || 0)),
    p: Math.max(0, Math.min(1, summary.pressure || 0)),
    s: (summary.speakers || []).slice(0, 6).map((s) => ({
      n: String(s.n || s.name || '?').slice(0, 20),
      t: Math.max(0, Math.round(s.t || s.turns || 0)),
      p: Math.max(0, Math.min(1, s.p || s.avgPressure || 0)),
      pk: Math.max(0, Math.min(1, s.pk || s.peakPressure || 0)),
      a: s.a || s.dominantAffect || 'neutral',
    })),
    ts: Date.now(),
  };
}

export function encodeAutopsy(payload) {
  try {
    return b64urlEncode(JSON.stringify(payload));
  } catch {
    return '';
  }
}

export function decodeAutopsy(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      title: p.ttl || 'Chat autopsy',
      turns: p.t || 0,
      pressure: p.p || 0,
      speakers: (p.s || []).map((s) => ({
        name: s.n || '?',
        turns: s.t || 0,
        avgPressure: s.p || 0,
        peakPressure: s.pk || 0,
        dominantAffect: s.a || 'neutral',
      })),
      ts: p.ts || 0,
    };
  } catch {
    return null;
  }
}

export function autopsyUrl(origin, payload) {
  return `${origin}/a/${encodeAutopsy(payload)}`;
}
