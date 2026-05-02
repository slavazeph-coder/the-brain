import React, { useEffect, useState } from 'react';
import {
  loadConfig, saveConfig, start, stop, isActive, timeline, clearTimeline, pruneAuto,
} from '../utils/diagnosticSnapshots';

/**
 * Layer 113 — Diagnostic Snapshots panel.
 */
export default function DiagnosticSnapshotsPanel() {
  const [cfg, setCfg] = useState(() => loadConfig());
  const [running, setRunning] = useState(() => isActive());
  const [tl, setTl] = useState(() => timeline());

  useEffect(() => {
    const id = setInterval(() => {
      setRunning(isActive());
      setTl(timeline());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  function update(partial) {
    setCfg(saveConfig(partial));
    if (partial.enabled === false && running) stop();
    if (partial.enabled === true && !running) start();
    setRunning(isActive());
  }
  function arm() { start(); setRunning(isActive()); }
  function disarm() { stop(); setRunning(isActive()); }
  function clearAll() {
    if (!window.confirm('Clear timeline + delete auto-snapshots?')) return;
    pruneAuto();
    setTl([]);
  }

  return (
    <section className="panel panel-pad diagnostic-snapshots-panel">
      <div className="eyebrow">Layer 113 · diagnostic snapshots</div>
      <h2>Auto-snap on tier shifts</h2>
      <p className="muted">
        Watches the live span buffer and saves a Layer 104 snapshot
        every time the harness tier changes. Builds a longitudinal
        timeline so "when did we go critical?" has a real answer.
        Manual Layer 104 snapshots are untouched.
      </p>

      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: running ? 'rgba(94,230,154,0.08)' : 'rgba(255,255,255,0.03)',
          borderLeft: `3px solid ${running ? '#5ee69a' : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        <strong>{running ? 'WATCHING' : 'IDLE'}</strong>
        <span className="muted small-note" style={{ marginLeft: 8 }}>
          timeline · {tl.length} entries
        </span>
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        {running ? (
          <button className="btn-sm" onClick={disarm}>Stop watching</button>
        ) : (
          <button className="btn" onClick={arm}>Start watching</button>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="muted small-note">enabled</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="muted small-note">debounce ms</span>
          <input
            className="share-input"
            type="number"
            min={1000}
            step={1000}
            value={cfg.debounceMs}
            onChange={(e) => update({ debounceMs: Number(e.target.value) })}
            style={{ width: 100 }}
          />
        </label>
        {tl.length > 0 && (
          <button className="ghost small" onClick={clearAll} style={{ color: '#dd6974' }}>
            Prune auto
          </button>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="eyebrow">Tier-shift timeline</div>
        {tl.length === 0 ? (
          <p className="muted small-note">No shifts yet.</p>
        ) : tl.map((e) => (
          <div
            key={e.snapshotId}
            style={{
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 6,
              marginTop: 2,
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            <div>
              <strong>{e.fromTier} → {e.toTier}</strong>
              <span className="muted small-note" style={{ marginLeft: 8 }}>
                {new Date(e.ts).toLocaleString()}
              </span>
            </div>
            {e.findingIds.length > 0 && (
              <div className="muted small-note">{e.findingIds.join(', ')}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
