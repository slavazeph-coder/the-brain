import React, { useEffect, useState } from 'react';
import {
  loadConfig, saveConfig, start, stop, isActive, getStatus,
} from '../utils/harnessAlerts';

/**
 * Layer 109 — Harness Alerts panel.
 *
 * Subscribe to span activity, run the diagnostic, toast on tier shift
 * or new findings. Off by default. Pairs with Layer 9 (Toast).
 */
export default function HarnessAlertsPanel() {
  const [cfg, setCfg] = useState(() => loadConfig());
  const [running, setRunning] = useState(() => isActive());
  const [status, setStatus] = useState(() => getStatus());

  useEffect(() => {
    const id = setInterval(() => {
      setRunning(isActive());
      setStatus(getStatus());
    }, 2000);
    return () => clearInterval(id);
  }, []);

  function update(partial) {
    const next = saveConfig(partial);
    setCfg(next);
    if (running && partial.enabled === false) stop();
    if (!running && partial.enabled === true) start();
    setRunning(isActive());
  }
  function arm() { start(); setRunning(isActive()); }
  function disarm() { stop(); setRunning(isActive()); }

  return (
    <section className="panel panel-pad harness-alerts-panel">
      <div className="eyebrow">Layer 109 · harness alerts</div>
      <h2>Toast on tier shifts</h2>
      <p className="muted">
        Watch the live span buffer (Layer 102) and raise a toast
        whenever a new finding fires or the harness tier shifts upward.
        Debounced so a burst of spans only triggers one check.
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
        <strong>{running ? 'ARMED' : 'IDLE'}</strong>
        {status.lastTier && (
          <span className="muted small-note" style={{ marginLeft: 8 }}>
            last tier: {status.lastTier} · findings: {status.lastFindings.join(', ') || 'none'}
          </span>
        )}
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        {running ? (
          <button className="btn-sm" onClick={disarm}>Disarm</button>
        ) : (
          <button className="btn" onClick={arm}>Arm</button>
        )}
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.toastOnNewFinding}
            onChange={(e) => update({ toastOnNewFinding: e.target.checked })}
          />
          <span className="muted small-note">toast on new finding</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.toastOnTierShift}
            onChange={(e) => update({ toastOnTierShift: e.target.checked })}
          />
          <span className="muted small-note">toast on tier shift</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="muted small-note">debounce ms</span>
          <input
            className="share-input"
            type="number"
            min={500}
            step={500}
            value={cfg.debounceMs}
            onChange={(e) => update({ debounceMs: Number(e.target.value) })}
            style={{ width: 100 }}
          />
        </label>
      </div>
    </section>
  );
}
