/**
 * Immunity Card — shareable payload for a user's Cognitive Immunity Score.
 * Mirrors reactionCard.js in shape so both URL schemas travel the same way.
 *
 * Dependency-free — imported from both the SPA and the Edge `/api/og` +
 * Node `/api/i` functions.
 */

export const IMMUNITY_LEVELS = [
  { min: 85, label: 'Fortified', color: '#5ee69a' },
  { min: 70, label: 'Resilient', color: '#77dbe4' },
  { min: 55, label: 'Steady', color: '#fdab43' },
  { min: 35, label: 'Exposed', color: '#e57b40' },
  { min: 0, label: 'At risk', color: '#dd6974' },
];

export function levelFor(score) {
  return IMMUNITY_LEVELS.find((l) => score >= l.min) || IMMUNITY_LEVELS[IMMUNITY_LEVELS.length - 1];
}

const MAX_HANDLE = 24;

export function sanitizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-\. ]/g, '')
    .slice(0, MAX_HANDLE) || 'anon';
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

export function buildImmunityPayload({ handle, score, breakdown, streak, events, rank, total, week }) {
  return {
    n: sanitizeHandle(handle),
    s: Math.max(0, Math.min(100, Math.round(score || 0))),
    a: Math.round(breakdown?.awareness || 0),
    r: Math.round(breakdown?.resilience || 0),
    d: Math.round(breakdown?.depth || 0),
    c: Math.round(breakdown?.consistency || 0),
    st: Math.max(0, Math.round(streak || 0)),
    ev: Math.max(0, Math.round(events || 0)),
    rk: rank || null,
    tt: total || null,
    wk: week || null,
    ts: Date.now(),
  };
}

export function encodeImmunity(payload) {
  try {
    return b64urlEncode(JSON.stringify(payload));
  } catch {
    return '';
  }
}

export function decodeImmunity(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      handle: p.n || 'anon',
      score: p.s || 0,
      breakdown: {
        awareness: p.a || 0,
        resilience: p.r || 0,
        depth: p.d || 0,
        consistency: p.c || 0,
      },
      streak: p.st || 0,
      events: p.ev || 0,
      rank: p.rk || null,
      total: p.tt || null,
      week: p.wk || null,
      ts: p.ts || 0,
    };
  } catch {
    return null;
  }
}

export function immunityUrl(origin, payload) {
  return `${origin}/i/${encodeImmunity(payload)}`;
}
