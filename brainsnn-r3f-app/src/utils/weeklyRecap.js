/**
 * Layer 50 — Weekly Recap
 *
 * Roll every local signal into a single shareable weekly card:
 *   - Immunity score delta over the last 7 days
 *   - Current streak (from Layer 38 Daily Challenge history)
 *   - Events in the last 7 days (firewall scans / conversations / ...)
 *   - Most common template detected this week (via receipts log)
 *   - Peak pressure scan of the week
 *
 * All data is already in localStorage from prior layers. No new
 * persistence — just a read + rollup + /w/<hash> card.
 */

import { getImmunityState } from './immunityScore';
import { getStreak } from './dailyChallenge';
import { recentReceipts } from './receipt';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeek(ts = Date.now()) {
  return ts - 7 * DAY_MS;
}

export function computeWeeklyRecap() {
  const immunity = getImmunityState();
  const streak = getStreak();
  const receipts = recentReceipts();
  const weekAgo = startOfWeek();

  // Immunity delta — compare current score vs the oldest history point
  // that still lies within the last 7 days
  const history = immunity.history || [];
  let immunityStart = immunity.baseline ?? 50;
  for (let i = history.length - 1; i >= 0; i--) {
    if ((history[i].ts || 0) <= weekAgo) break;
    immunityStart = history[i].score;
  }
  const immunityDelta = (immunity.score || 0) - immunityStart;

  // Events in the last 7 days
  const events = (immunity.events || []).filter((e) => (e.timestamp || 0) >= weekAgo);
  const eventsByKind = events.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});
  const topKind = Object.entries(eventsByKind).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Receipts within the last week — pressure summary
  const weekReceipts = receipts.filter((r) => (r.ts || 0) >= weekAgo);
  const peakReceipt = weekReceipts.reduce(
    (best, r) => (r.pressure > (best?.pressure || 0) ? r : best),
    null,
  );
  const meanPressure = weekReceipts.length
    ? weekReceipts.reduce((acc, r) => acc + (r.pressure || 0), 0) / weekReceipts.length
    : 0;

  // Daily challenge history for the week
  const dailyHistory = (streak.history || []).slice(0, 7);
  const dailyMean = dailyHistory.length
    ? dailyHistory.reduce((acc, h) => acc + (h.accuracy || 0), 0) / dailyHistory.length
    : 0;

  return {
    score: immunity.score || 0,
    immunityDelta,
    streak: streak.streak || 0,
    scansThisWeek: weekReceipts.length,
    eventsThisWeek: events.length,
    topEventKind: topKind,
    meanPressure,
    peakReceipt,
    dailyPlayed: dailyHistory.length,
    dailyMeanAccuracy: dailyMean,
  };
}

// ---------- share (Layer 50 /w/<hash>) ----------

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
function sanitizeHandle(raw) {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '').slice(0, MAX_HANDLE) || 'anon';
}

export function buildRecapPayload({ handle, recap }) {
  return {
    n: sanitizeHandle(handle),
    s: Math.round(recap.score || 0),
    d: Math.round(recap.immunityDelta || 0),
    st: recap.streak || 0,
    sc: recap.scansThisWeek || 0,
    ev: recap.eventsThisWeek || 0,
    mp: +(recap.meanPressure || 0).toFixed(3),
    pl: recap.dailyPlayed || 0,
    da: Math.round(recap.dailyMeanAccuracy || 0),
    ts: Date.now(),
  };
}

export function encodeRecap(p) { try { return b64urlEncode(JSON.stringify(p)); } catch { return ''; } }
export function decodeRecap(hash) {
  try {
    const p = JSON.parse(b64urlDecode(hash));
    if (!p || typeof p !== 'object') return null;
    return {
      handle: p.n || 'anon',
      score: p.s || 0,
      immunityDelta: p.d || 0,
      streak: p.st || 0,
      scansThisWeek: p.sc || 0,
      eventsThisWeek: p.ev || 0,
      meanPressure: p.mp || 0,
      dailyPlayed: p.pl || 0,
      dailyMeanAccuracy: p.da || 0,
      ts: p.ts || 0,
    };
  } catch { return null; }
}

export function recapUrl(origin, payload) { return `${origin}/w/${encodeRecap(payload)}`; }
