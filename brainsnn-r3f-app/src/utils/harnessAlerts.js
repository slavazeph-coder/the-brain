/**
 * Layer 109 — Harness Alerts
 *
 * Subscribe to the live span buffer, run the diagnostic on every
 * burst of new activity, and toast when a finding fires that wasn't
 * present before — or when the tier shifts upward.
 *
 * Pure-side-effect layer: orchestrates Layer 102 + Layer 9 (toasts).
 * Operator-controlled — start() arms it, stop() disarms.
 */

import { subscribe as subSpans } from './telemetry.js';
import { runDiagnostic } from './harnessFailureModes.js';
import { toastWarning, toastError, toastInfo } from './toastStore.js';

const CONFIG_KEY = 'brainsnn_alerts_config_v1';
const DEFAULT_CONFIG = {
  enabled: false,
  debounceMs: 4000,
  toastOnNewFinding: true,
  toastOnTierShift: true,
};

const TIER_RANK = { healthy: 0, warn: 1, critical: 2 };

let _state = {
  active: false,
  unsub: null,
  pending: false,
  timer: null,
  lastTier: null,
  lastFindingIds: new Set(),
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

function check() {
  const report = runDiagnostic();
  const ids = new Set(report.findings.map((f) => f.id));
  const newIds = [...ids].filter((id) => !_state.lastFindingIds.has(id));

  if (_state.config.toastOnNewFinding) {
    for (const id of newIds) {
      const f = report.findings.find((x) => x.id === id);
      if (!f) continue;
      const msg = `[harness] ${f.label} ×${f.count}`;
      if (f.severity === 'critical') toastError(msg);
      else if (f.severity === 'warn') toastWarning(msg);
      else toastInfo(msg);
    }
  }

  if (_state.config.toastOnTierShift && _state.lastTier && _state.lastTier !== report.tier) {
    const fromR = TIER_RANK[_state.lastTier] ?? 0;
    const toR = TIER_RANK[report.tier] ?? 0;
    if (toR > fromR) {
      toastError(`Harness tier ${_state.lastTier} → ${report.tier}`);
    } else if (toR < fromR) {
      toastInfo(`Harness recovered: ${_state.lastTier} → ${report.tier}`);
    }
  }

  _state.lastTier = report.tier;
  _state.lastFindingIds = ids;
  return report;
}

function onSpanEvent() {
  if (!_state.active || !_state.config.enabled) return;
  if (_state.pending) return;
  _state.pending = true;
  _state.timer = setTimeout(() => {
    _state.pending = false;
    try { check(); } catch { /* noop */ }
  }, _state.config.debounceMs);
}

export function start() {
  if (_state.active) return;
  _state.active = true;
  // Prime baseline so the first toast doesn't fire on existing findings
  try { check(); } catch { /* noop */ }
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

export function getStatus() {
  return {
    active: _state.active,
    config: { ..._state.config },
    lastTier: _state.lastTier,
    lastFindings: [..._state.lastFindingIds],
  };
}
