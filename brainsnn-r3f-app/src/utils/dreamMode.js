/**
 * Layer 26 — Dream Mode / Replay Consolidation
 *
 * When the brain has been idle (user not interacting) for N seconds,
 * it drifts into a "dream" state: recent snapshots are replayed in
 * slow cycles while STDP-style weight reinforcement nudges the
 * connection weights toward the average of recent states.
 *
 * Neuroscience analogy: hippocampal replay during sleep consolidates
 * daytime experiences into cortex. Here, snapshots are the experiences,
 * replay is the dream, and weight reinforcement is the consolidation.
 *
 * The loop is opt-in. Call startDreaming() to begin; the caller is
 * expected to pass a setState updater and a snapshot list provider.
 */

import { clamp } from './sim';

export const DEFAULT_DREAM_CONFIG = {
  idleTriggerMs: 30_000,       // how long before dreaming begins
  replayIntervalMs: 2400,      // one replay step every N ms (slow)
  maxSnapshotsToReplay: 6,     // most recent snapshots used
  consolidationStrength: 0.08, // how hard weights drift toward replay
  regionBlend: 0.35            // how much replayed regions drift into state
};

export const DREAM_STATE = {
  AWAKE: 'awake',
  DROWSY: 'drowsy',
  DREAMING: 'dreaming'
};

// ---------- internal state ----------

let dreamState = {
  phase: DREAM_STATE.AWAKE,
  config: { ...DEFAULT_DREAM_CONFIG },
  intervalId: null,
  drowsyTimeoutId: null,
  lastActivity: Date.now(),
  replayIndex: 0,
  replayedSnapshots: [],
  cycleCount: 0,
  dreamLog: [],
  subscribers: new Set(),
  providers: null // { getSnapshots, setState, narrate }
};

function emit() {
  const snap = getDreamStatus();
  for (const cb of dreamState.subscribers) {
    try { cb(snap); } catch { /* ignore */ }
  }
}

function pushLog(entry) {
  dreamState.dreamLog.unshift({ ...entry, timestamp: Date.now() });
  if (dreamState.dreamLog.length > 40) dreamState.dreamLog.length = 40;
}

// ---------- public API ----------

export function subscribeDream(cb) {
  dreamState.subscribers.add(cb);
  return () => dreamState.subscribers.delete(cb);
}

export function getDreamStatus() {
  return {
    phase: dreamState.phase,
    config: { ...dreamState.config },
    idleForMs: Date.now() - dreamState.lastActivity,
    replayIndex: dreamState.replayIndex,
    replayedSnapshots: dreamState.replayedSnapshots.slice(),
    cycleCount: dreamState.cycleCount,
    dreamLog: dreamState.dreamLog.slice(0, 20)
  };
}

export function updateDreamConfig(partial) {
  dreamState.config = { ...dreamState.config, ...partial };
  emit();
}

/**
 * Register providers from the React layer. Must be called once before
 * startDreaming. setState receives a (currentState) => newState updater.
 */
export function registerDreamProviders({ getSnapshots, setState, narrate }) {
  dreamState.providers = { getSnapshots, setState, narrate };
}

/**
 * Called from app activity handlers (button click, scan, etc) to reset
 * the idle timer. If currently dreaming, this wakes the brain up.
 */
export function markActivity() {
  dreamState.lastActivity = Date.now();
  if (dreamState.phase !== DREAM_STATE.AWAKE) {
    wakeUp('user activity');
  }
}

export function startDreamMonitor(partial = {}) {
  stopDreamMonitor();
  dreamState.config = { ...dreamState.config, ...partial };
  dreamState.lastActivity = Date.now();
  dreamState.phase = DREAM_STATE.AWAKE;
  pushLog({ kind: 'monitor', text: 'Dream monitor started.' });

  dreamState.drowsyTimeoutId = setInterval(() => {
    if (dreamState.phase !== DREAM_STATE.AWAKE) return;
    const idle = Date.now() - dreamState.lastActivity;
    if (idle >= dreamState.config.idleTriggerMs) {
      beginDreaming();
    }
  }, 2000);
  emit();
}

export function stopDreamMonitor() {
  if (dreamState.drowsyTimeoutId) clearInterval(dreamState.drowsyTimeoutId);
  if (dreamState.intervalId) clearInterval(dreamState.intervalId);
  dreamState.drowsyTimeoutId = null;
  dreamState.intervalId = null;
  dreamState.phase = DREAM_STATE.AWAKE;
  pushLog({ kind: 'monitor', text: 'Dream monitor stopped.' });
  emit();
}

export function forceDream() {
  dreamState.lastActivity = Date.now() - dreamState.config.idleTriggerMs - 100;
  beginDreaming();
}

export function wakeUp(reason = 'manual') {
  if (dreamState.intervalId) clearInterval(dreamState.intervalId);
  dreamState.intervalId = null;
  dreamState.phase = DREAM_STATE.AWAKE;
  dreamState.lastActivity = Date.now();
  pushLog({ kind: 'wake', text: `Woke up (${reason}). ${dreamState.cycleCount} replay cycles this session.` });
  emit();
}

// ---------- dream loop ----------

function beginDreaming() {
  if (!dreamState.providers) return;
  const { getSnapshots } = dreamState.providers;
  const snaps = (getSnapshots?.() || []).slice(0, dreamState.config.maxSnapshotsToReplay);

  if (!snaps.length) {
    pushLog({ kind: 'skip', text: 'No snapshots available to replay — dream skipped.' });
    emit();
    return;
  }

  dreamState.replayedSnapshots = snaps;
  dreamState.replayIndex = 0;
  dreamState.cycleCount = 0;
  dreamState.phase = DREAM_STATE.DREAMING;
  pushLog({
    kind: 'begin',
    text: `Entering dream state — replaying ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}.`
  });

  dreamState.intervalId = setInterval(replayStep, dreamState.config.replayIntervalMs);
  emit();
  replayStep(); // kick one immediately
}

function replayStep() {
  if (!dreamState.providers) return;
  const { setState, narrate } = dreamState.providers;
  const snaps = dreamState.replayedSnapshots;
  if (!snaps.length) return;

  const i = dreamState.replayIndex % snaps.length;
  const snap = snaps[i];

  setState?.((cur) => consolidate(cur, snap, dreamState.config));

  pushLog({
    kind: 'replay',
    text: `Replaying "${snap.name}" — lead region ${snap.summary?.leadRegion || '?'}`
  });

  if (narrate && (dreamState.cycleCount % 3 === 0)) {
    try {
      narrate(
        `Dreaming: replaying ${snap.scenario || snap.name}. Consolidating weights toward recent experience.`
      );
    } catch { /* ignore */ }
  }

  dreamState.replayIndex++;
  dreamState.cycleCount++;
  emit();
}

/**
 * Apply STDP-style consolidation: blend current state toward replay
 * snapshot, then reinforce weights that were active during replay.
 * Pure function — returns a new state object.
 */
export function consolidate(cur, snap, config = DEFAULT_DREAM_CONFIG) {
  if (!cur || !snap?.regions || !snap?.weights) return cur;
  const blend = config.regionBlend ?? 0.35;
  const strength = config.consolidationStrength ?? 0.08;

  const regions = { ...cur.regions };
  for (const k of Object.keys(regions)) {
    const target = snap.regions[k] ?? regions[k];
    // Slow drift toward the replayed state (dream bias)
    regions[k] = clamp(regions[k] + (target - regions[k]) * blend * 0.5, 0.02, 0.95);
  }

  // STDP reinforcement — if a connection's pre×post in the snapshot was
  // high, nudge the weight upward by `strength`. If low, decay gently.
  const weights = { ...cur.weights };
  for (const k of Object.keys(weights)) {
    const [pre, post] = k.split('\u2192');
    const preAct = snap.regions[pre] ?? 0;
    const postAct = snap.regions[post] ?? 0;
    const coactivation = preAct * postAct; // 0..~0.9
    const nudge = (coactivation - 0.25) * strength; // negative if coact low
    weights[k] = clamp(weights[k] + nudge, 0.08, 0.95);
  }

  return {
    ...cur,
    regions,
    weights,
    scenario: `Dream · ${snap.scenario || snap.name}`,
    burst: Math.max(cur.burst, 4) // soft pulse each replay
  };
}

// ---------- convenience ----------

export function phaseLabel(phase) {
  switch (phase) {
    case DREAM_STATE.AWAKE: return 'Awake';
    case DREAM_STATE.DROWSY: return 'Drowsy';
    case DREAM_STATE.DREAMING: return 'Dreaming';
    default: return phase;
  }
}

export function phaseColor(phase) {
  switch (phase) {
    case DREAM_STATE.AWAKE: return '#7dd87f';
    case DREAM_STATE.DROWSY: return '#f5c888';
    case DREAM_STATE.DREAMING: return '#a78bfa';
    default: return '#8a8f99';
  }
}
