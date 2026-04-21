/**
 * Layer 56 — Badge System
 *
 * Deterministic, retroactive. We don't write "badge unlock" events
 * into localStorage — we compute the full badge list from the signals
 * that already exist (immunity, streak, receipts, bypass feed, custom
 * rules). That way badges are always in sync with the user's real
 * state and can't drift.
 */

import { getImmunityState } from './immunityScore';
import { getStreak } from './dailyChallenge';
import { recentReceipts } from './receipt';
import { getCustomRules } from './customRules';

export const BADGE_CATALOG = [
  { id: 'first-scan', tier: 'bronze', label: 'First Scan', desc: 'Scan your first piece of content.' },
  { id: 'ten-scans', tier: 'silver', label: 'Ten Scans', desc: 'Reach 10 firewall scans.' },
  { id: 'hundred-scans', tier: 'gold', label: 'Hundred Scans', desc: 'Reach 100 firewall scans.' },
  { id: 'streak-3', tier: 'bronze', label: 'Warming Up', desc: 'Play the daily challenge 3 days in a row.' },
  { id: 'streak-7', tier: 'silver', label: 'One Week', desc: 'Play the daily challenge 7 days in a row.' },
  { id: 'streak-30', tier: 'gold', label: 'Thirty-Day Brain', desc: 'Play the daily challenge 30 days in a row.' },
  { id: 'immunity-55', tier: 'bronze', label: 'Steady', desc: 'Reach immunity score 55.' },
  { id: 'immunity-70', tier: 'silver', label: 'Resilient', desc: 'Reach immunity score 70.' },
  { id: 'immunity-85', tier: 'gold', label: 'Fortified', desc: 'Reach immunity score 85.' },
  { id: 'high-pressure', tier: 'silver', label: 'Caught One', desc: 'Scan something above 80% pressure.' },
  { id: 'custom-rule', tier: 'silver', label: 'Rule Writer', desc: 'Add your first custom firewall rule.' },
  { id: 'polyglot', tier: 'silver', label: 'Polyglot', desc: 'Scan content in a non-English language pack.' },
  { id: 'red-team', tier: 'gold', label: 'Red Team', desc: 'Submit a bypass to the weekly feed.' },
];

/**
 * Return { earned: [badge], locked: [badge], progress: {byId} }.
 */
export function computeBadges() {
  const immunity = getImmunityState();
  const streak = getStreak();
  const receipts = recentReceipts();
  const customRules = getCustomRules();

  const scanCount = (immunity.events || []).filter((e) => e.type === 'firewall_scan').length;
  const peakPressure = receipts.reduce((m, r) => Math.max(m, r.pressure || 0), 0);
  const streakDays = streak.streak || 0;
  const immunityScore = immunity.score || 0;
  const bypassSubmitted = (() => {
    try { return (localStorage.getItem('brainsnn_bypass_submitted_v1') || '') === 'true'; } catch { return false; }
  })();
  const polyglotSeen = (() => {
    try { return (localStorage.getItem('brainsnn_polyglot_seen_v1') || '') === 'true'; } catch { return false; }
  })();

  const checks = {
    'first-scan': scanCount >= 1,
    'ten-scans': scanCount >= 10,
    'hundred-scans': scanCount >= 100,
    'streak-3': streakDays >= 3,
    'streak-7': streakDays >= 7,
    'streak-30': streakDays >= 30,
    'immunity-55': immunityScore >= 55,
    'immunity-70': immunityScore >= 70,
    'immunity-85': immunityScore >= 85,
    'high-pressure': peakPressure >= 0.80,
    'custom-rule': customRules.length >= 1,
    'polyglot': polyglotSeen,
    'red-team': bypassSubmitted,
  };

  const progress = {
    'ten-scans': { have: scanCount, need: 10 },
    'hundred-scans': { have: scanCount, need: 100 },
    'streak-3': { have: streakDays, need: 3 },
    'streak-7': { have: streakDays, need: 7 },
    'streak-30': { have: streakDays, need: 30 },
    'immunity-55': { have: immunityScore, need: 55 },
    'immunity-70': { have: immunityScore, need: 70 },
    'immunity-85': { have: immunityScore, need: 85 },
  };

  const earned = [];
  const locked = [];
  for (const badge of BADGE_CATALOG) {
    (checks[badge.id] ? earned : locked).push(badge);
  }
  return { earned, locked, progress, scanCount, peakPressure, streakDays, immunityScore };
}

// One-shot setters for signals the badges rely on
export function markPolyglotSeen() {
  try { localStorage.setItem('brainsnn_polyglot_seen_v1', 'true'); } catch { /* noop */ }
}
export function markBypassSubmitted() {
  try { localStorage.setItem('brainsnn_bypass_submitted_v1', 'true'); } catch { /* noop */ }
}

// ---------- share (/b/<hash>) ----------

function b64urlEncode(str) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(str, 'utf-8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') return window.atob(base);
  return Buffer.from(base, 'base64').toString('utf-8');
}

const MAX_HANDLE = 24;
export function sanitizeHandle(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '').slice(0, MAX_HANDLE) || 'anon';
}

export function buildBadgePayload({ handle, rollup }) {
  return {
    n: sanitizeHandle(handle),
    e: (rollup.earned || []).map((b) => b.id),
    total: BADGE_CATALOG.length,
    sc: rollup.scanCount || 0,
    im: rollup.immunityScore || 0,
    st: rollup.streakDays || 0,
    ts: Date.now(),
  };
}
export function encodeBadges(p) { try { return b64urlEncode(JSON.stringify(p)); } catch { return ''; } }
export function decodeBadges(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      handle: p.n || 'anon',
      earnedIds: Array.isArray(p.e) ? p.e : [],
      total: p.total || BADGE_CATALOG.length,
      scans: p.sc || 0,
      immunity: p.im || 0,
      streak: p.st || 0,
      ts: p.ts || 0,
    };
  } catch { return null; }
}
export function badgesUrl(origin, payload) { return `${origin}/b/${encodeBadges(payload)}`; }
