/**
 * Layer 21 — Brain Steward (Agent Autopilot)
 *
 * Autonomous control loop that exercises the MCP tool catalog (Layer 19).
 * Every tick, the steward evaluates the brain state against a rule set
 * and takes actions: auto-snapshot on anomaly, narrate, alert.
 *
 * Closes the feedback loop — brain watches itself using its own tools.
 */

import { handleToolCall } from './mcpBridge';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from './immunityScore';

export const DEFAULT_RULES = {
  checkIntervalMs: 4000,
  autoSnapshotOnAnomaly: true,
  narrateOnChange: true,
  speakNarration: false,
  anomalyThreshold: 2.0,
  maxActionsPerRun: 20
};

export const ACTION_TYPES = {
  ANOMALY_DETECTED: 'anomaly',
  SNAPSHOT_SAVED: 'snapshot',
  NARRATION: 'narration',
  SCENARIO_DETECTED: 'scenario',
  CORRELATION_SHIFT: 'correlation'
};

// ---------- Steward state ----------

let stewardState = {
  running: false,
  intervalId: null,
  rules: { ...DEFAULT_RULES },
  log: [],
  lastAnomalies: [],
  lastNarration: null,
  lastScenario: null,
  runCount: 0,
  subscribers: new Set()
};

function emit() {
  for (const cb of stewardState.subscribers) {
    try { cb(getStatus()); } catch { /* ignore */ }
  }
}

function pushAction(type, summary, details = {}) {
  stewardState.log.unshift({
    type,
    summary,
    details,
    timestamp: Date.now()
  });
  if (stewardState.log.length > stewardState.rules.maxActionsPerRun) {
    stewardState.log.length = stewardState.rules.maxActionsPerRun;
  }
}

// ---------- Public API ----------

export function subscribe(callback) {
  stewardState.subscribers.add(callback);
  return () => stewardState.subscribers.delete(callback);
}

export function getStatus() {
  return {
    running: stewardState.running,
    rules: { ...stewardState.rules },
    log: stewardState.log.slice(),
    runCount: stewardState.runCount,
    lastAnomalies: stewardState.lastAnomalies.slice(),
    lastNarration: stewardState.lastNarration,
    lastScenario: stewardState.lastScenario
  };
}

export function updateRules(partial) {
  stewardState.rules = { ...stewardState.rules, ...partial };
  if (stewardState.running && partial.checkIntervalMs) {
    // Restart with new interval
    stop();
    start();
  }
  emit();
}

export function start() {
  if (stewardState.running) return;
  stewardState.running = true;
  stewardState.intervalId = setInterval(runTick, stewardState.rules.checkIntervalMs);
  pushAction('lifecycle', `Steward started (interval ${stewardState.rules.checkIntervalMs}ms)`);
  emit();
  // Kick one immediately
  runTick();
}

export function stop() {
  if (!stewardState.running) return;
  clearInterval(stewardState.intervalId);
  stewardState.intervalId = null;
  stewardState.running = false;
  pushAction('lifecycle', 'Steward stopped');
  emit();
}

export function clearLog() {
  stewardState.log = [];
  emit();
}

// ---------- Control loop ----------

async function runTick() {
  stewardState.runCount++;
  const rules = stewardState.rules;

  // 1. Check anomalies
  try {
    const anomalyRes = await handleToolCall('detect_anomaly');
    if (anomalyRes.ok && anomalyRes.result?.anomalies?.length) {
      const anomalies = anomalyRes.result.anomalies;
      stewardState.lastAnomalies = anomalies;
      const high = anomalies.filter((a) => Math.abs(a.zScore ?? 0) >= rules.anomalyThreshold);
      if (high.length) {
        pushAction(
          ACTION_TYPES.ANOMALY_DETECTED,
          `${high.length} region${high.length > 1 ? 's' : ''} firing >${rules.anomalyThreshold}σ`,
          { anomalies: high }
        );
        recordImmunity(IMMUNITY_EVENTS.ANOMALY_DETECTED, { anomalyCount: high.length });

        if (rules.autoSnapshotOnAnomaly) {
          const snapRes = await handleToolCall('save_snapshot', {
            name: `Auto: anomaly ${high.map((a) => a.region).join(', ')} @${new Date().toLocaleTimeString()}`
          });
          if (snapRes.ok) {
            pushAction(
              ACTION_TYPES.SNAPSHOT_SAVED,
              `Snapshot saved: ${snapRes.result.name}`,
              { id: snapRes.result.id }
            );
          }
        }
      }
    }
  } catch (err) {
    pushAction('error', `Anomaly check failed: ${err.message}`);
  }

  // 2. Narrate + detect scenario change
  if (rules.narrateOnChange) {
    try {
      const narrRes = await handleToolCall('narrate_state');
      if (narrRes.ok && narrRes.result?.narrative) {
        const text = narrRes.result.narrative;
        if (text !== stewardState.lastNarration) {
          stewardState.lastNarration = text;
          pushAction(ACTION_TYPES.NARRATION, text.slice(0, 90));

          if (rules.speakNarration && typeof window !== 'undefined' && window.speechSynthesis) {
            try {
              const utter = new SpeechSynthesisUtterance(text.slice(0, 180));
              utter.rate = 1.05;
              utter.volume = 0.7;
              window.speechSynthesis.speak(utter);
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err) {
      pushAction('error', `Narration failed: ${err.message}`);
    }
  }

  // 3. Scenario detection — watch for scenario change in state
  try {
    const stateRes = await handleToolCall('get_brain_state');
    if (stateRes.ok && stateRes.result?.scenario) {
      if (stateRes.result.scenario !== stewardState.lastScenario) {
        if (stewardState.lastScenario !== null) {
          pushAction(
            ACTION_TYPES.SCENARIO_DETECTED,
            `Scenario shift: ${stewardState.lastScenario} → ${stateRes.result.scenario}`
          );
        }
        stewardState.lastScenario = stateRes.result.scenario;
      }
    }
  } catch { /* ignore */ }

  emit();
}
