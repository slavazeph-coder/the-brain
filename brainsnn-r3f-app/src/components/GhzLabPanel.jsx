import React, { useMemo, useState } from 'react';
import { runGhzExperiment, mapGhzToBrainState } from '../utils/ghzState';

/**
 * Layer 107 — GHZ Lab.
 *
 * 3-qubit Greenberger-Horne-Zeilinger state. Builds (|000⟩ + |111⟩) / √2
 * via H ⊗ I ⊗ I → CNOT(0,1) → CNOT(0,2) and shows the 8-bin joint
 * distribution. The "parity" metric (P(000) + P(111)) is the GHZ
 * signature: 1.0 ideal, 1/4 fully randomised. Optional Apply-to-brain.
 */

const SHOTS_OPTIONS = [256, 1024, 4096];

const KET_COLORS = {
  '000': '#5ad4ff',
  '111': '#a86fdf',
};

function fmtPct(p) {
  return `${(p * 100).toFixed(1)}%`;
}

export default function GhzLabPanel({ onApplyToBrain }) {
  const [noise, setNoise] = useState(0);
  const [shots, setShots] = useState(1024);
  const [runToken, setRunToken] = useState(0);

  const result = useMemo(() => {
    void runToken;
    return runGhzExperiment({ shots, noise });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, noise, runToken]);

  const maxP = Math.max(...result.distribution);

  return (
    <section className="panel panel-pad ghz-lab-panel">
      <div className="eyebrow">Layer 107 · GHZ lab</div>
      <h2>3-qubit GHZ state — (|000⟩ + |111⟩) / √2</h2>
      <p className="muted">
        Extends the L102 Bell pair from 2 qubits to 3. After
        <code> H ⊗ I ⊗ I → CNOT(0,1) → CNOT(0,2)</code>, all three qubits
        always agree on measurement: 50% all-zero, 50% all-one, ~0% any
        mixed outcome. Like Bell, this is correlation, *not* signaling.
      </p>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Depolarizing noise</span>
            <strong style={{ fontFamily: 'monospace' }}>{noise.toFixed(2)}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={noise}
            onChange={(e) => setNoise(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="muted small-note">Shots:</span>
          {SHOTS_OPTIONS.map((s) => (
            <button key={s} className={`btn ${shots === s ? 'primary' : ''}`} onClick={() => setShots(s)}>{s}</button>
          ))}
          <button className="btn" onClick={() => setRunToken((t) => t + 1)}>Re-run</button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Joint distribution</h3>
        {result.labels.map((label, i) => {
          const p = result.distribution[i];
          const isCorrelated = label === '000' || label === '111';
          const color = KET_COLORS[label] || '#475569';
          return (
            <div key={label} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color, fontFamily: 'monospace' }}>|{label}⟩{isCorrelated && ' ★'}</span>
                <span className="muted">{fmtPct(p)} · {result.counts[i]} shots</span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.05)',
                  overflow: 'hidden',
                  marginTop: 2,
                }}
              >
                <div
                  style={{
                    width: `${(p / Math.max(maxP, 1e-6)) * 100}%`,
                    height: '100%',
                    background: color,
                    transition: 'width 0.2s',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginTop: 14,
        }}
      >
        <div className="muted small-note">
          parity P(000)+P(111): <strong style={{ color: '#5ee69a' }}>{result.parity.toFixed(3)}</strong>
        </div>
        <div className="muted small-note">
          leakage: <strong style={{ color: result.leakage > 0.1 ? '#fdab43' : '#5ee69a' }}>{result.leakage.toFixed(3)}</strong>
        </div>
        <div className="muted small-note">
          shots: <strong>{result.shots}</strong>
        </div>
      </div>

      {onApplyToBrain && (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            onClick={() => {
              const deltas = mapGhzToBrainState(result);
              onApplyToBrain({ result, deltas });
            }}
          >
            Apply to brain
          </button>
        </div>
      )}

      <p className="muted small-note" style={{ marginTop: 10 }}>
        ★ marks the two correlated kets. As noise rises the 6 mid-rows fill
        in toward 1/8 each; the GHZ signature is the *zero* in those
        rows, not the 50/50 split.
      </p>
    </section>
  );
}
