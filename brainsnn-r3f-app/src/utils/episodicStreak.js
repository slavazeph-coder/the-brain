/**
 * Layer 101 — Capture Streak
 *
 * Daily-capture habit counter, modeled on Layer 38 (Daily Firewall
 * Challenge) but specific to the Episodic Cortex. UTC-day boundaries
 * so timezones don't break streaks.
 *
 * Pure derivation from the capture log (computeStreak) plus a
 * persisted `longest` so it survives wipes of the capture list.
 */

const KEY = 'brainsnn_episodic_streak_v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { longest: 0, totalDays: 0 };
    return JSON.parse(raw);
  } catch {
    return { longest: 0, totalDays: 0 };
  }
}

function saveState(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/**
 * Pure: derive the trailing streak (consecutive UTC days each
 * containing ≥1 capture, ending today or yesterday).
 *
 * Returns { current, longest, totalDays, todayCaptures }.
 */
export function computeStreak(captures = []) {
  if (!captures.length) {
    const persisted = loadState();
    return { current: 0, longest: persisted.longest || 0, totalDays: persisted.totalDays || 0, todayCaptures: 0 };
  }

  // Build a Set of UTC-day keys that have at least one capture.
  const days = new Set();
  for (const c of captures) {
    if (!c?.ts) continue;
    days.add(utcDayKey(c.ts));
  }
  const totalDays = days.size;

  const today = utcDayKey(Date.now());
  const yesterday = utcDayKey(Date.now() - DAY_MS);
  let current = 0;
  let cursor;
  if (days.has(today)) cursor = today;
  else if (days.has(yesterday)) cursor = yesterday;
  else {
    const persisted = loadState();
    return { current: 0, longest: persisted.longest || 0, totalDays, todayCaptures: 0 };
  }

  while (days.has(cursor)) {
    current += 1;
    const prev = new Date(cursor);
    prev.setUTCDate(prev.getUTCDate() - 1);
    cursor = prev.toISOString().slice(0, 10);
  }

  // Persist longest.
  const persisted = loadState();
  const longest = Math.max(current, persisted.longest || 0);
  if (longest !== persisted.longest || totalDays !== persisted.totalDays) {
    saveState({ longest, totalDays });
  }

  const todayCaptures = captures.filter((c) => utcDayKey(c.ts) === today).length;

  return { current, longest, totalDays, todayCaptures };
}

export function streakLabel(streak) {
  if (!streak || !streak.current) return 'no streak yet';
  if (streak.current === 1) return '1-day streak';
  if (streak.current < 7) return `${streak.current}-day streak`;
  if (streak.current < 30) return `🔥 ${streak.current}-day streak`;
  if (streak.current < 100) return `🔥🔥 ${streak.current}-day streak`;
  return `🔥🔥🔥 ${streak.current}-day streak`;
}

export function clearStreak() {
  saveState({ longest: 0, totalDays: 0 });
}
