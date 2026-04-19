/**
 * Quiz share card — encodes a user's Spot-the-Manipulation quiz result
 * into a compact base64url payload that travels as /q/<hash> and
 * renders as a 1200×630 OG image.
 */

export const QUIZ_LEVELS = [
  { min: 90, label: 'Firewall-grade', color: '#5ee69a' },
  { min: 75, label: 'Sharp', color: '#77dbe4' },
  { min: 60, label: 'Reasonable', color: '#fdab43' },
  { min: 40, label: 'Susceptible', color: '#e57b40' },
  { min: 0, label: 'Vulnerable', color: '#dd6974' },
];

export function quizLevelFor(accuracy) {
  return QUIZ_LEVELS.find((l) => accuracy >= l.min) || QUIZ_LEVELS[QUIZ_LEVELS.length - 1];
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

export function buildQuizPayload({ handle, accuracy, correct, total, seconds }) {
  return {
    n: sanitizeHandle(handle),
    a: Math.max(0, Math.min(100, Math.round(accuracy || 0))),
    k: Math.max(0, Math.round(correct || 0)),
    t: Math.max(0, Math.round(total || 0)),
    s: Math.max(0, Math.round(seconds || 0)),
    ts: Date.now(),
  };
}

export function encodeQuiz(payload) {
  try {
    return b64urlEncode(JSON.stringify(payload));
  } catch {
    return '';
  }
}

export function decodeQuiz(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      handle: p.n || 'anon',
      accuracy: p.a || 0,
      correct: p.k || 0,
      total: p.t || 0,
      seconds: p.s || 0,
      ts: p.ts || 0,
    };
  } catch {
    return null;
  }
}

export function quizUrl(origin, payload) {
  return `${origin}/q/${encodeQuiz(payload)}`;
}
