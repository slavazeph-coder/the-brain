import React, { useEffect, useState } from 'react';
import {
  start, stop, updateRules, clearLog, subscribe, getStatus, ACTION_TYPES
} from '../utils/brainSteward';

/**
 * Layer 21 — Brain Steward (Agent Autopilot) Panel
 *
 * Turns on an autonomous loop that uses the Layer 19 MCP tool catalog.
 * Every N seconds: detect_anomaly → auto-save snapshot if triggered,
 * narrate_state → speak if changed, track scenario transitions.
 */
export default function BrainStewardPanel() {
  const [status, setStatus] = useState(getStatus());

  useEffect(() => subscribe(setStatus), []);

  const { running, rules, log, runCount } = status;

  return (
    <section className="panel panel-pad steward-panel">
      <div className="eyebrow">Layer 21</div>
      <h2>Brain Steward · Agent Autopilot</h2>
      <p className="muted">
        Autonomous loop using the Layer 19 MCP tool catalog. Detects anomalies,
        auto-snapshots, narrates, watches scenario shifts — brain observes itself.
      </p>

      <div className="steward-controls">
        <button
          className={running ? 'danger' : 'primary'}
          onClick={() => running ? stop() : start()}
        >
          {running ? 'Stop steward' : 'Start steward'}
        </button>

        <div className="steward-stat">
          <small>Ticks</small><strong>{runCount}</strong>
        </div>
        <div className="steward-stat">
          <small>Status</small>
          <strong className={running ? 'ok' : 'idle'}>{running ? 'LIVE' : 'IDLE'}</strong>
        </div>
      </div>

      <div className="steward-rules">
        <label className="steward-rule-row">
          <span>Check interval</span>
          <select
            value={rules.checkIntervalMs}
            onChange={(e) => updateRules({ checkIntervalMs: parseInt(e.target.value, 10) })}
          >
            <option value={2000}>2s</option>
            <option value={4000}>4s</option>
            <option value={8000}>8s</option>
            <option value={15000}>15s</option>
          </select>
        </label>

        <label className="steward-rule-row">
          <span>Anomaly threshold (σ)</span>
          <select
            value={rules.anomalyThreshold}
            onChange={(e) => updateRules({ anomalyThreshold: parseFloat(e.target.value) })}
          >
            <option value={1.5}>1.5σ</option>
            <option value={2.0}>2.0σ</option>
            <option value={2.5}>2.5σ</option>
            <option value={3.0}>3.0σ</option>
          </select>
        </label>

        <label className="steward-rule-row steward-toggle">
          <input
            type="checkbox"
            checked={rules.autoSnapshotOnAnomaly}
            onChange={(e) => updateRules({ autoSnapshotOnAnomaly: e.target.checked })}
          />
          <span>Auto-save snapshot on anomaly</span>
        </label>

        <label className="steward-rule-row steward-toggle">
          <input
            type="checkbox"
            checked={rules.narrateOnChange}
            onChange={(e) => updateRules({ narrateOnChange: e.target.checked })}
          />
          <span>Narrate on state change</span>
        </label>

        <label className="steward-rule-row steward-toggle">
          <input
            type="checkbox"
            checked={rules.speakNarration}
            onChange={(e) => updateRules({ speakNarration: e.target.checked })}
          />
          <span>Speak narration (TTS)</span>
        </label>
      </div>

      <div className="steward-log">
        <div className="steward-log-header">
          <strong>Activity feed</strong>
          <button className="ghost small" onClick={clearLog}>Clear</button>
        </div>
        {log.length === 0 && <p className="muted small-note">No autopilot actions yet. Start the steward.</p>}
        {log.map((entry, i) => (
          <div key={i} className={`steward-log-row kind-${entry.type}`}>
            <span className="steward-log-badge">{labelForType(entry.type)}</span>
            <span className="steward-log-summary">{entry.summary}</span>
            <span className="steward-log-time muted small-note">{formatTime(entry.timestamp)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function labelForType(type) {
  switch (type) {
    case ACTION_TYPES.ANOMALY_DETECTED: return 'ANOMALY';
    case ACTION_TYPES.SNAPSHOT_SAVED: return 'SNAPSHOT';
    case ACTION_TYPES.NARRATION: return 'NARRATE';
    case ACTION_TYPES.SCENARIO_DETECTED: return 'SCENARIO';
    case ACTION_TYPES.CORRELATION_SHIFT: return 'CORRELATE';
    case 'lifecycle': return 'LIFECYCLE';
    case 'error': return 'ERROR';
    default: return type.toUpperCase();
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}
