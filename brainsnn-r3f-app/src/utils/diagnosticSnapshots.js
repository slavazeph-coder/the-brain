/**
 * Layer 113 — Diagnostic Snapshots
 *
 * Background watcher that auto-saves a Layer 104 snapshot whenever
 * the harness tier changes. Builds a longitudinal timeline of every
 * tier shift so you can answer "when did we go critical?" without
 * manual snapshotting.
 *
 * Stays separate from Layer 104's manual snapshots — auto-snaps are
 * tagged so they can be filtered or pruned independently.
 */

import { subscribe as subSpans } from './telemetry.js';
import { runDiagnostic } from './harnessFailureModes.js';
import { saveSnapshot, listSnapshots, deleteSnapshot } from './harnessComparator.js';

const CONFIG_KEY = 'brainsnn_diag_snapshots_config_v1';
const TIMELINE_KEY = 'brainsnn_diag_snapshots_timeline_v1';
const MAX_TIMELINE = 50;

const DEFAULT_CONFIG = {
  enabled: false,
  debounceMs: 5000,
};

let _state = {
  active: false,
  unsub: null,
  pending: false,
  timer: null,
  lastTier: null,
  config: loadConfig(),
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(partial) {
  _state.config = { ..._state.config, ...partial };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(_state.config)); } catch { /* noop */ }
  return _state.config;
}

export function timeline() {
  try { return JSON.parse(localStorage.getItem(TIMELINE_KEY) || '[]'); } catch { return []; }
}

function pushTimeline(entry) {
  try {
    const next = [entry, ...timeline()].slice(0, MAX_TIMELINE);
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}

export function clearTimeline() {
  try { localStorage.removeItem(TIMELINE_KEY); } catch { /* noop */ }
}

function maybeSnapshot() {
  const report = runDiagnostic();
  if (_state.lastTier === null) {
    _state.lastTier = report.tier;
    return;
  }
  if (report.tier === _state.lastTier) return;
  const entry = saveSnapshot({
    label: `auto · ${_state.lastTier}→${report.tier}`,
    report,
  });
  pushTimeline({
    ts: Date.now(),
    snapshotId: entry.id,
    fromTier: _state.lastTier,
    toTier: report.tier,
    findingIds: report.findings.map((f) => f.id),
  });
  _state.lastTier = report.tier;
}

function onSpanEvent() {
  if (!_state.active || !_state.config.enabled) return;
  if (_state.pending) return;
  _state.pending = true;
  _state.timer = setTimeout(() => {
    _state.pending = false;
    try { maybeSnapshot(); } catch { /* noop */ }
  }, _state.config.debounceMs);
}

export function start() {
  if (_state.active) return;
  _state.active = true;
  // Prime baseline
  try { _state.lastTier = runDiagnostic().tier; } catch { _state.lastTier = null; }
  _state.unsub = subSpans(onSpanEvent);
}

export function stop() {
  if (!_state.active) return;
  if (_state.unsub) _state.unsub();
  _state.unsub = null;
  if (_state.timer) clearTimeout(_state.timer);
  _state.timer = null;
  _state.pending = false;
  _state.active = false;
}

export function isActive() {
  return _state.active;
}

/**
 * Prune auto-tagged snapshots only, leave manual snapshots intact.
 */
export function pruneAuto() {
  const ids = new Set(timeline().map((t) => t.snapshotId));
  const remaining = listSnapshots().filter((s) => !ids.has(s.id) || !/^auto · /.test(s.label));
  for (const s of listSnapshots()) {
    if (ids.has(s.id) && /^auto · /.test(s.label)) {
      deleteSnapshot(s.id);
    }
  }
  clearTimeline();
  return remaining;
}
