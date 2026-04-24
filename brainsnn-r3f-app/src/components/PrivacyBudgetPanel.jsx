import React, { useState } from 'react';
import { snapshotBudget, humanBytes, removeKey, approximateQuota } from '../utils/privacyBudget';

/**
 * Layer 86 — Privacy Budget panel.
 */
export default function PrivacyBudgetPanel() {
  const [budget, setBudget] = useState(() => snapshotBudget());

  function refresh() { setBudget(snapshotBudget()); }
  function wipeOne(key) {
    if (!window.confirm(`Delete ${key}?`)) return;
    removeKey(key);
    refresh();
  }

  const quota = approximateQuota();
  const pct = Math.min(100, (budget.totalBytes / quota) * 100);
  const tone = pct > 70 ? '#dd6974' : pct > 40 ? '#fdab43' : '#5ee69a';

  return (
    <section className="panel panel-pad privacy-budget-panel">
      <div className="eyebrow">Layer 86 · privacy budget</div>
      <h2>What BrainSNN stores about you</h2>
      <p className="muted">
        Every localStorage key written by BrainSNN, with its byte size
        and the layer that wrote it. Nothing here leaves your device
        unless you tap Share. Wipe individual keys or the whole bundle
        (Layer 57) any time.
      </p>

      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          background: `${tone}14`,
          borderLeft: `3px solid ${tone}`,
          marginTop: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            <strong>{budget.keyCount}</strong> keys ·{' '}
            <strong style={{ color: tone }}>{budget.readableTotal}</strong>
          </span>
          <span className="muted small-note">
            ≈ {pct.toFixed(1)}% of a 5 MB origin quota
          </span>
        </div>
        <div style={{ width: '100%', height: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 4, marginTop: 8 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: tone, borderRadius: 4 }} />
        </div>
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={refresh}>Refresh</button>
      </div>

      <div style={{ marginTop: 10 }}>
        {budget.entries.length === 0 ? (
          <p className="muted small-note">No BrainSNN data stored yet.</p>
        ) : budget.entries.map((e) => (
          <div
            key={e.key}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 110px 80px',
              gap: 8,
              alignItems: 'center',
              padding: '6px 10px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.03)',
              marginTop: 4,
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            <div>
              <strong>{e.label}</strong>
              <div className="muted small-note">{e.key}</div>
            </div>
            <span className="muted small-note">L{e.layer}</span>
            <span>{humanBytes(e.bytes)}</span>
            <button className="ghost small" onClick={() => wipeOne(e.key)} style={{ color: '#dd6974' }}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <p className="muted small-note" style={{ marginTop: 12 }}>
        Prefer to move everything at once? Use Layer 57 (Data Portability)
        to export / import / wipe all BrainSNN keys as a versioned bundle.
      </p>
    </section>
  );
}
