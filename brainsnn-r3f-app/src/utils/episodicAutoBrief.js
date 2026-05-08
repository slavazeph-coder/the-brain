/**
 * Layer 101 — Auto-Brief Scheduler
 *
 * Background scheduler that runs the Daily Brief / Weekly Synthesis
 * automatically when conditions are met. Persisted to localStorage
 * (`brainsnn_episodic_auto_v1`) so the brief schedule survives page
 * reloads and timezone changes.
 *
 * Trigger rules:
 *   Brief — fires when ≥20h have elapsed since the last brief AND
 *     at least 3 captures have landed since.
 *   Synthesis — fires every 6.5 days IF there are ≥4 captures in
 *     the trailing 7-day window.
 *
 * The scheduler does not run the LLM call itself — the panel calls
 * `dailyBrief()` / `weeklySynthesis()` and reports the result back
 * via `recordBrief / recordSynthesis`. This keeps the scheduler pure
 * and lets the panel decide whether to defer (e.g. user is mid-typing).
 */

const KEY = 'brainsnn_episodic_auto_v1';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BRIEF_INTERVAL_MS = 20 * HOUR;
const SYNTH_INTERVAL_MS = 6.5 * DAY;
const MIN_CAPTURES_FOR_BRIEF = 3;
const MIN_CAPTURES_FOR_SYNTH = 4;
const HISTORY_CAP = 12;

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    lastBriefAt: 0,
    lastSynthAt: 0,
    seenCapturesAtLastBrief: 0,
    briefHistory: [],   // [{ ts, count, pattern, question }]
    synthHistory: []    // [{ ts, count, thesis, oneAction }]
  };
}

function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* quota — ignore */ }
}

export function getAutoBriefState() {
  return loadState();
}

export function shouldRunBrief(captures) {
  const s = loadState();
  const now = Date.now();
  if (now - s.lastBriefAt < BRIEF_INTERVAL_MS) return { ok: false, reason: 'too-soon', nextEligibleAt: s.lastBriefAt + BRIEF_INTERVAL_MS };
  const eligible = (captures || []).filter((c) => now - c.ts <= 24 * HOUR);
  if (eligible.length < MIN_CAPTURES_FOR_BRIEF) {
    return { ok: false, reason: 'too-few-captures', need: MIN_CAPTURES_FOR_BRIEF, have: eligible.length };
  }
  // require at least 1 NEW capture since last brief
  const fresh = eligible.filter((c) => c.ts > s.lastBriefAt);
  if (!fresh.length) return { ok: false, reason: 'no-fresh-captures' };
  return { ok: true, freshCount: fresh.length };
}

export function shouldRunSynthesis(captures) {
  const s = loadState();
  const now = Date.now();
  if (now - s.lastSynthAt < SYNTH_INTERVAL_MS) {
    return { ok: false, reason: 'too-soon', nextEligibleAt: s.lastSynthAt + SYNTH_INTERVAL_MS };
  }
  const weekly = (captures || []).filter((c) => now - c.ts <= 7 * DAY);
  if (weekly.length < MIN_CAPTURES_FOR_SYNTH) {
    return { ok: false, reason: 'too-few-captures', need: MIN_CAPTURES_FOR_SYNTH, have: weekly.length };
  }
  return { ok: true, weeklyCount: weekly.length };
}

export function recordBrief(brief, captureCount) {
  const s = loadState();
  s.lastBriefAt = Date.now();
  s.seenCapturesAtLastBrief = captureCount;
  s.briefHistory.unshift({
    ts: s.lastBriefAt,
    count: brief?.count ?? 0,
    source: brief?.source || 'local',
    pattern: brief?.pattern || '',
    question: brief?.question || ''
  });
  if (s.briefHistory.length > HISTORY_CAP) s.briefHistory.length = HISTORY_CAP;
  saveState(s);
  return s;
}

export function recordSynthesis(synth) {
  const s = loadState();
  s.lastSynthAt = Date.now();
  s.synthHistory.unshift({
    ts: s.lastSynthAt,
    count: synth?.count ?? 0,
    source: synth?.source || 'local',
    thesis: synth?.emergingThesis || '',
    oneAction: synth?.oneAction || ''
  });
  if (s.synthHistory.length > HISTORY_CAP) s.synthHistory.length = HISTORY_CAP;
  saveState(s);
  return s;
}

export function clearAutoBrief() {
  saveState(defaultState());
}

export function nextBriefRelative() {
  const s = loadState();
  if (!s.lastBriefAt) return 'never run';
  const ms = (s.lastBriefAt + BRIEF_INTERVAL_MS) - Date.now();
  if (ms <= 0) return 'ready now';
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / (60 * 1000));
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function nextSynthesisRelative() {
  const s = loadState();
  if (!s.lastSynthAt) return 'never run';
  const ms = (s.lastSynthAt + SYNTH_INTERVAL_MS) - Date.now();
  if (ms <= 0) return 'ready now';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
