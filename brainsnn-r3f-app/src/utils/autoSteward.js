/**
 * Layer 103 — Auto-Apply Rule Steward
 *
 * Self-driving variant of Layer 21. Each cycle:
 *   1. Pull a fresh harness report (Layer 102)
 *   2. Pull a candidate rule diff (harnessProposer)
 *   3. Filter additions to "low-risk" (≥ minLift, ≤ maxPerCycle, length floor)
 *   4. Apply via Layer 55 customRules.addCustomRule()
 *   5. Log the application to localStorage so reverts are possible
 *
 * Kill switches:
 *   - dryRun: true → log only, don't apply
 *   - paused: true → no-op every cycle
 *   - quotaPerHour: throttle so a runaway loop can't spam rules
 *
 * Followups[] from the proposer are surfaced as suggestions; this
 * layer never auto-pauses the Steward or auto-runs evolve. Those
 * are user calls.
 */

import { runDiagnostic } from './harnessFailureModes.js';
import { proposeRuleDiff } from './harnessProposer.js';
import { addCustomRule, removeCustomRule } from './customRules.js';
import { recordSpan } from './telemetry.js';

const APPLIED_KEY = 'brainsnn_auto_steward_applied_v1';
const CONFIG_KEY = 'brainsnn_auto_steward_config_v1';
const MAX_APPLIED = 80;

const DEFAULT_CONFIG = {
  enabled: false,
  dryRun: true,
  intervalMs: 60_000,
  minLift: 4,
  maxPerCycle: 2,
  quotaPerHour: 6,
  minPatternChars: 6,
};

let _state = {
  running: false,
  intervalId: null,
  config: loadConfig(),
  lastReport: null,
  lastDiff: null,
  cycleCount: 0,
  subscribers: new Set(),
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function persistConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* noop */ }
}

export function getAppliedLog() {
  try {
    return JSON.parse(localStorage.getItem(APPLIED_KEY) || '[]');
  } catch { return []; }
}

function pushApplied(entry) {
  try {
    const list = [entry, ...getAppliedLog()].slice(0, MAX_APPLIED);
    localStorage.setItem(APPLIED_KEY, JSON.stringify(list));
  } catch { /* noop */ }
}

function emit() {
  for (const fn of _state.subscribers) {
    try { fn(getStatus()); } catch { /* noop */ }
  }
}

export function subscribe(fn) {
  _state.subscribers.add(fn);
  return () => _state.subscribers.delete(fn);
}

export function getStatus() {
  return {
    running: _state.running,
    config: { ..._state.config },
    cycleCount: _state.cycleCount,
    appliedLog: getAppliedLog(),
    lastReportTier: _state.lastReport?.tier || 'unknown',
    lastDiffAdditions: _state.lastDiff?.additions?.length || 0,
    lastDiffFollowUps: _state.lastDiff?.followUps || [],
  };
}

export function updateConfig(partial) {
  _state.config = { ..._state.config, ...partial };
  persistConfig(_state.config);
  if (_state.running && partial.intervalMs) {
    stop();
    start();
  }
  emit();
}

function recentlyAppliedCount(windowMs = 3_600_000) {
  const cutoff = Date.now() - windowMs;
  return getAppliedLog().filter((e) => e.ts >= cutoff && !e.dryRun && !e.reverted).length;
}

function isLowRisk(addition, cfg) {
  if (!addition.pattern || addition.pattern.length < cfg.minPatternChars) return false;
  // Must come from error-lift sources with explicit lift number
  const m = /error-lift:([0-9.]+)/.exec(addition.source || '');
  if (!m) return false;
  const lift = Number(m[1]);
  if (!Number.isFinite(lift) || lift < cfg.minLift) return false;
  return true;
}

async function runCycle() {
  _state.cycleCount += 1;
  const cfg = _state.config;
  if (!cfg.enabled) {
    emit();
    return;
  }

  const cycleStart = Date.now();
  const report = runDiagnostic();
  const diff = proposeRuleDiff(report, { topK: cfg.maxPerCycle * 3 });
  _state.lastReport = report;
  _state.lastDiff = diff;

  const candidates = (diff.additions || []).filter((a) => isLowRisk(a, cfg));
  const headroom = Math.max(0, cfg.quotaPerHour - recentlyAppliedCount());
  const slice = candidates.slice(0, Math.min(cfg.maxPerCycle, headroom));

  const applied = [];
  for (const a of slice) {
    const entry = {
      ts: Date.now(),
      cycle: _state.cycleCount,
      category: a.category,
      pattern: a.pattern,
      label: a.label,
      source: a.source,
      dryRun: !!cfg.dryRun,
      reverted: false,
    };
    if (cfg.dryRun) {
      pushApplied(entry);
      applied.push(entry);
      continue;
    }
    try {
      const created = addCustomRule({
        category: a.category,
        pattern: a.pattern,
        flags: 'gi',
        label: a.label || `auto-${a.category}`,
      });
      entry.ruleId = created.id;
      pushApplied(entry);
      applied.push(entry);
    } catch (err) {
      pushApplied({ ...entry, error: err.message || String(err) });
    }
  }

  recordSpan({
    name: 'auto-steward.cycle',
    kind: 'internal',
    start_time: cycleStart,
    attributes: {
      cycle: _state.cycleCount,
      tier: report.tier,
      candidates: candidates.length,
      applied: applied.length,
      dryRun: !!cfg.dryRun,
    },
    status: { code: 'ok' },
  });

  emit();
}

export function start() {
  if (_state.running) return;
  _state.running = true;
  _state.intervalId = setInterval(runCycle, _state.config.intervalMs);
  runCycle();
  emit();
}

export function stop() {
  if (!_state.running) return;
  clearInterval(_state.intervalId);
  _state.intervalId = null;
  _state.running = false;
  emit();
}

export function revertApplied(ruleId) {
  if (!ruleId) return;
  removeCustomRule(ruleId);
  try {
    const list = getAppliedLog().map((e) => e.ruleId === ruleId ? { ...e, reverted: true } : e);
    localStorage.setItem(APPLIED_KEY, JSON.stringify(list));
  } catch { /* noop */ }
  emit();
}

export function clearAppliedLog() {
  try { localStorage.removeItem(APPLIED_KEY); } catch { /* noop */ }
  emit();
}

/** Manually run one cycle (without enabling the timer). */
export async function runOnce() {
  await runCycle();
}
