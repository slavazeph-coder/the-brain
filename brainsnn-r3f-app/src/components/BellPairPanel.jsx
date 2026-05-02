import React, { useMemo, useState } from 'react';
import { runBellPairExperiment, mapBellToBrainState } from '../utils/bellPair';

/**
 * Layer 102 — Bell Pair Lab.
 *
 * Two-qubit entanglement, in-browser. Builds |Φ+⟩ = (|00⟩ + |11⟩)/√2 by
 * running |00⟩ → H ⊗ I → CNOT, then rotates qubit 0 with RY(θ) so the user
 * can watch correlation break smoothly. Shows joint outcomes |00⟩ |01⟩ |10⟩
 * |11⟩ as four bars, plus a signed correlation strength in [-1, 1].
 *
 * Important framing: correlation here is a quantum statistical fact about
 * a many-shot distribution, not "spooky action" at a distance in any
 * mystical sense. No ER=EPR, no consciousness telepathy, no portals.
 */

const SHOTS_OPTIONS = [256, 1024, 4096];

const BASIS_LABELS = ['|00⟩', '|01⟩', '|10⟩', '|11⟩'];
const BASIS_COLORS = ['#5ad4ff', '#fdab43', '#dd6974', '#a86fdf'];

function fmtPercent(p) {
  return `${(p * 100).toFixed(1)}%`;
}

function explain({ correlation, rotationTheta, noise, mode }) {
  const corr = correlation.toFixed(2);
  if (mode === 'metaphor') {
    if (correlation > 0.85) {
      return `Two coins, perfectly mirrored (correlation ${corr}). Either both heads or both tails — never mixed. Metaphor: a pair of friends who finish each other's sentences.`;
    }
    if (correlation < -0.85) {
      return `Two coins, perfectly anti-mirrored (correlation ${corr}). Always one head and one tail. Metaphor: opposites locked into balance.`;
    }
    if (Math.abs(correlation) < 0.15) {
      return `The link snapped. Each coin lands independent of the other (correlation ${corr}). Metaphor: rotated the question hard enough that the shared answer dissolved.`;
    }
    return `Partial agreement (correlation ${corr}). Metaphor: the friendship is real but fading.`;
  }
  // scientific
  if (rotationTheta === 0 && noise < 0.05) {
    return `|Φ+⟩ measured in the computational basis. Outcomes are 50/50 split between |00⟩ and |11⟩, never |01⟩ or |10⟩. Correlation ${corr}: maximal classical-impossible correlation across two non-interacting qubits.`;
  }
  if (Math.abs(correlation) < 0.15) {
    return `Rotation moved qubit 0 to a basis where the Bell state's correlations average out. Correlation ${corr}. Reading qubit 0 no longer predicts qubit 1. (No information was sent — this is the basis-mismatch lesson, not "spooky action".)`;
  }
  if (correlation < 0) {
    return `RY(${rotationTheta.toFixed(2)}) flipped the in-basis correlation. Anti-correlated outcomes (|01⟩, |10⟩) now dominate. Correlation ${corr}.`;
  }
  return `Bell state with rotation ${rotationTheta.toFixed(2)} and noise ${noise.toFixed(2)}. Correlation ${corr}; noise ${noise > 0 ? 'is mixing in uniform randomness' : 'is zero'}.`;
}

function JointBars({ distribution, counts }) {
  return (
    <div style={{ marginTop: 12 }}>
      {distribution.map((p, i) => (
        <div key={BASIS_LABELS[i]} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: BASIS_COLORS[i], fontFamily: 'monospace' }}>{BASIS_LABELS[i]}</span>
            <span className="muted">{fmtPercent(p)} · {counts[i]} shots</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', marginTop: 2 }}>
            <div style={{ width: `${Math.max(0, Math.min(100, p * 100))}%`, height: '100%', background: BASIS_COLORS[i], transition: 'width 0.18s ease-out' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CircuitDiagram({ rotationTheta }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.03)',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.7,
      }}
    >
      <div>q0 |0⟩ ──[H]──●──{rotationTheta !== 0 ? `[RY(${rotationTheta.toFixed(2)})]──` : '──────────────'}<span style={{ color: '#5ad4ff' }}>M</span></div>
      <div>q1 |0⟩ ─────────⊕────────────────<span style={{ color: '#a86fdf' }}>M</span></div>
    </div>
  );
}

export default function BellPairPanel({ onApplyToBrain } = {}) {
  const [rotationTheta, setRotationTheta] = useState(0);
  const [shots, setShots] = useState(1024);
  const [noise, setNoise] = useState(0);
  const [mode, setMode] = useState('scientific');
  const [runToken, setRunToken] = useState(0);

  const result = useMemo(() => {
    void runToken;
    return runBellPairExperiment({ rotationTheta, shots, noise });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationTheta, shots, noise, runToken]);

  const explanation = useMemo(
    () => explain({ correlation: result.correlation, rotationTheta, noise, mode }),
    [result.correlation, rotationTheta, noise, mode],
  );

  const brainDeltas = useMemo(() => mapBellToBrainState(result), [result]);
  const corrColor = result.correlation > 0.5 ? '#5ee69a' : result.correlation < -0.5 ? '#a86fdf' : '#fdab43';

  return (
    <section className="panel panel-pad bell-pair-panel">
      <div className="eyebrow">Layer 102 · bell pair lab</div>
      <h2>Two qubits, one shared answer</h2>
      <p className="muted">
        Build the Bell state <code>|Φ+⟩ = (|00⟩ + |11⟩)/√2</code> with{' '}
        <code>H ⊗ I → CNOT</code>, then rotate qubit 0 with RY(θ) and measure
        both qubits jointly. Correlation runs from +1 (perfect mirror) to −1
        (perfect opposites) to 0 (noise dissolved the link).
      </p>
      <p className="muted small-note">
        This is <em>statistical correlation</em> across many shots, not
        information transfer. No consciousness, no telepathy, no portals.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setMode((m) => (m === 'scientific' ? 'metaphor' : 'scientific'))}>
          Mode: {mode === 'scientific' ? 'Scientific' : 'Metaphor'}
        </button>
        <button className="btn" onClick={() => setRunToken((t) => t + 1)}>Re-run</button>
        <button className="btn" onClick={() => { setRotationTheta(0); setNoise(0); setShots(1024); }}>Reset</button>
        {onApplyToBrain && (
          <button className="btn primary" onClick={() => onApplyToBrain({ result, deltas: brainDeltas })}>Apply to brain</button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">RY rotation θ on qubit 0 (0 → π)</span>
            <strong style={{ fontFamily: 'monospace' }}>{rotationTheta.toFixed(3)}</strong>
          </div>
          <input type="range" min="0" max={Math.PI} step="0.01" value={rotationTheta} onChange={(e) => setRotationTheta(parseFloat(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Depolarizing noise (0 = pure, 1 = uniform)</span>
            <strong style={{ fontFamily: 'monospace' }}>{noise.toFixed(2)}</strong>
          </div>
          <input type="range" min="0" max="1" step="0.01" value={noise} onChange={(e) => setNoise(parseFloat(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="muted small-note">Shots:</span>
          {SHOTS_OPTIONS.map((s) => (
            <button key={s} className={`btn ${shots === s ? 'primary' : ''}`} onClick={() => setShots(s)}>{s}</button>
          ))}
        </div>
      </div>

      <CircuitDiagram rotationTheta={rotationTheta} />

      <JointBars distribution={result.distribution} counts={result.counts} />

      <div
        style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 8,
          background: `${corrColor}18`,
          borderLeft: `3px solid ${corrColor}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          Correlation strength <strong style={{ fontFamily: 'monospace' }}>{result.correlation.toFixed(3)}</strong>
        </span>
        <span className="muted small-note">
          {result.correlation > 0.5 ? 'mirrored' : result.correlation < -0.5 ? 'anti-mirrored' : 'decohered'}
        </span>
      </div>

      <p className="muted" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>{explanation}</p>

      <details style={{ marginTop: 10 }}>
        <summary className="muted small-note" style={{ cursor: 'pointer' }}>Region deltas (preview)</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6, marginTop: 6, fontSize: 12, fontFamily: 'monospace' }}>
          {Object.entries(brainDeltas).map(([region, delta]) => (
            <div key={region} style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.03)' }}>
              <div className="muted">{region}</div>
              <div style={{ color: delta > 0 ? '#5ee69a' : '#94a3b8' }}>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
