/**
 * Layer 23 — Cognitive Immunity Score
 *
 * Persistent resilience metric rolled up from all protective actions:
 * firewall scans, conversation analyses, steward anomalies, snapshots,
 * time in calm states. Scored 0–100 with daily streaks, trend sparkline,
 * and per-dimension breakdown.
 *
 * Four dimensions:
 *  - awareness: did you scan content today? (scans per day)
 *  - resilience: low manipulation pressure across scans
 *  - depth: used Gemma, code brain, conversation brain, knowledge brain
 *  - consistency: used daily (streak multiplier)
 */

const STORAGE_KEY = 'brainsnn_immunity_v1';
const MAX_EVENTS = 200;
const MAX_HISTORY = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- event types ----------

export const IMMUNITY_EVENTS = {
  FIREWALL_SCAN: 'firewall_scan',
  CONVERSATION_ANALYZED: 'conversation_analyzed',
  ANOMALY_DETECTED: 'anomaly_detected',
  SNAPSHOT_SAVED: 'snapshot_saved',
  STEWARD_RUN: 'steward_run',
  GEMMA_SCAN: 'gemma_scan',
  CODE_ANALYZED: 'code_analyzed',
  KNOWLEDGE_SCANNED: 'knowledge_scanned'
};

// ---------- storage ----------

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStore(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota — swallow */ }
}

function createDefault() {
  return {
    score: 50,
    baseline: 50,
    history: [],
    events: [],
    streak: 0,
    lastActiveDate: null,
    createdAt: Date.now()
  };
}

// ---------- subscribers ----------

const subscribers = new Set();
function emit() {
  const snap = getImmunityState();
  for (const cb of subscribers) {
    try { cb(snap); } catch { /* ignore */ }
  }
}
export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// ---------- public API ----------

export function getImmunityState() {
  const data = readStore() || createDefault();
  return { ...data };
}

export function resetImmunity() {
  writeStore(createDefault());
  emit();
}

/**
 * Record an event and recompute the score.
 * meta may include { pressure, pressureAvg, anomalyCount, name }.
 */
export function recordEvent(type, meta = {}) {
  const data = readStore() || createDefault();
  const now = Date.now();

  data.events.unshift({ type, meta, timestamp: now });
  if (data.events.length > MAX_EVENTS) data.events.length = MAX_EVENTS;

  // Streak accounting — date by day boundary
  const today = new Date(now).toISOString().slice(0, 10);
  const last = data.lastActiveDate;
  if (last !== today) {
    if (last) {
      const lastMs = new Date(last).getTime();
      const diffDays = Math.round((now - lastMs) / DAY_MS);
      if (diffDays === 1) data.streak += 1;
      else if (diffDays > 1) data.streak = 1;
    } else {
      data.streak = 1;
    }
    data.lastActiveDate = today;
  }

  const { score, breakdown } = computeScore(data);
  data.score = score;

  data.history.unshift({ timestamp: now, score, breakdown });
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;

  writeStore(data);
  emit();
  return { score, breakdown };
}

// ---------- scoring ----------

/**
 * Compute a 0–100 score from recent events.
 * Weights events within last 24h at 1.0, older decays linearly to 0 over 14 days.
 */
export function computeScore(data) {
  const now = Date.now();
  const recent = data.events.filter((e) => now - e.timestamp < 14 * DAY_MS);

  // Awareness: count of scan events in last 24h, capped at 10
  const todayEvents = recent.filter((e) => now - e.timestamp < DAY_MS);
  const scanEvents = todayEvents.filter((e) =>
    e.type === IMMUNITY_EVENTS.FIREWALL_SCAN ||
    e.type === IMMUNITY_EVENTS.GEMMA_SCAN ||
    e.type === IMMUNITY_EVENTS.CONVERSATION_ANALYZED
  );
  const awareness = Math.min(1, scanEvents.length / 5);

  // Resilience: inverse of average pressure across recent firewall + convo events
  const pressureSamples = recent
    .filter((e) => typeof e.meta?.pressure === 'number' || typeof e.meta?.pressureAvg === 'number')
    .map((e) => e.meta.pressure ?? e.meta.pressureAvg);
  const avgPressure = pressureSamples.length
    ? pressureSamples.reduce((a, v) => a + v, 0) / pressureSamples.length
    : 0.2;
  const resilience = Math.max(0, 1 - avgPressure);

  // Depth: variety of protective layers used in last 7 days
  const DEPTH_TYPES = [
    IMMUNITY_EVENTS.FIREWALL_SCAN,
    IMMUNITY_EVENTS.CONVERSATION_ANALYZED,
    IMMUNITY_EVENTS.GEMMA_SCAN,
    IMMUNITY_EVENTS.CODE_ANALYZED,
    IMMUNITY_EVENTS.KNOWLEDGE_SCANNED,
    IMMUNITY_EVENTS.SNAPSHOT_SAVED
  ];
  const weekRecent = recent.filter((e) => now - e.timestamp < 7 * DAY_MS);
  const usedTypes = new Set(weekRecent.map((e) => e.type).filter((t) => DEPTH_TYPES.includes(t)));
  const depth = usedTypes.size / DEPTH_TYPES.length;

  // Consistency: streak-driven multiplier (asymptote at 14 days)
  const consistency = Math.min(1, data.streak / 14);

  // Weight blend
  const blend =
    awareness * 0.30 +
    resilience * 0.30 +
    depth * 0.25 +
    consistency * 0.15;

  // Map to 0–100 around baseline 50
  const score = Math.round(20 + blend * 75); // 20..95
  const breakdown = {
    awareness: Math.round(awareness * 100),
    resilience: Math.round(resilience * 100),
    depth: Math.round(depth * 100),
    consistency: Math.round(consistency * 100)
  };
  return { score, breakdown };
}

// ---------- helpers ----------

export function immunityLevel(score) {
  if (score >= 85) return { label: 'Fortified', color: '#7dd87f' };
  if (score >= 70) return { label: 'Resilient', color: '#a3d9a5' };
  if (score >= 55) return { label: 'Stable', color: '#f5c888' };
  if (score >= 40) return { label: 'Exposed', color: '#ffb067' };
  return { label: 'Vulnerable', color: '#ff8090' };
}

export function clearEvents() {
  const data = readStore() || createDefault();
  data.events = [];
  writeStore(data);
  emit();
}
