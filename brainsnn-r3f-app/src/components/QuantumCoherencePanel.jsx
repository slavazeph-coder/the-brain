import React, { useMemo, useState } from 'react';
import {
  runPhaseExperiment,
  runObservationExperiment,
  runDecoherenceExperiment,
  coherenceScore,
  mapQuantumToBrainState,
} from '../utils/quantumCoherence';

/**
 * Layer 101 — Quantum Coherence Lab panel.
 *
 * Local, in-browser simulation of the simplest possible quantum circuit:
 *   |0⟩ → H → RZ(θ) → H → M
 *
 * Teaches superposition, phase, interference, observation, noise, and
 * decoherence. The "Metaphor" toggle re-frames the same numbers in
 * everyday language; nothing in this panel claims literal multiverse
 * theory, consciousness collapse, Planck foam, or spiritual portals —
 * those are framing aids, not physics claims.
 */

const SHOTS_OPTIONS = [256, 1024, 4096];

const SHOTS_HINT = {
  256: 'Quick — noisy bars',
  1024: 'Default — balanced',
  4096: 'Slow — smooth bars',
};

function fmtPercent(p) {
  return `${(p * 100).toFixed(1)}%`;
}

function ProbabilityBars({ distribution, counts }) {
  const [p0, p1] = distribution;
  return (
    <div style={{ marginTop: 12 }}>
      {[
        { label: '|0⟩', p: p0, count: counts[0], color: '#5ad4ff' },
        { label: '|1⟩', p: p1, count: counts[1], color: '#a86fdf' },
      ].map((b) => (
        <div key={b.label} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: b.color, fontFamily: 'monospace' }}>{b.label}</span>
            <span className="muted">
              {fmtPercent(b.p)} · {b.count} shots
            </span>
          </div>
          <div
            style={{
              height: 10,
              borderRadius: 4,
              background: 'rgba(255,255,255,0.05)',
              overflow: 'hidden',
              marginTop: 4,
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, b.p * 100))}%`,
                height: '100%',
                background: b.color,
                transition: 'width 0.18s ease-out',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CircuitRow({ theta, observeMidway, depth }) {
  const gates = [
    { label: 'H', desc: 'Hadamard — make superposition' },
    { label: `RZ(${theta.toFixed(2)})`, desc: 'Rotate the relative phase' },
  ];
  if (observeMidway) {
    gates.push({ label: '👁 M', desc: 'Mid-circuit measurement' });
  }
  if (depth > 0) {
    gates.push({ label: `(X·X)×${depth}`, desc: 'Identity on paper, decoherence in practice' });
  }
  gates.push({ label: 'H', desc: 'Hadamard — recombine for interference' });
  gates.push({ label: 'M', desc: 'Final measurement — read out 0 or 1' });

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        marginTop: 10,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <span className="muted small-note" style={{ alignSelf: 'center' }}>|0⟩</span>
      {gates.map((g, i) => (
        <React.Fragment key={`${g.label}-${i}`}>
          <span className="muted" style={{ alignSelf: 'center' }}>→</span>
          <span
            title={g.desc}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              background: 'rgba(90, 212, 255, 0.12)',
              border: '1px solid rgba(90, 212, 255, 0.35)',
              fontFamily: 'monospace',
              fontSize: 12,
              color: '#5ad4ff',
            }}
          >
            {g.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function buildExplanation({ result, score, mode, theta, observeMidway, depth, noise }) {
  const [p0, p1] = result.distribution;
  const dominant = p0 >= p1 ? '|0⟩' : '|1⟩';
  const dominantPct = fmtPercent(Math.max(p0, p1));
  const balanced = Math.abs(p0 - p1) < 0.1;

  if (mode === 'metaphor') {
    if (observeMidway) {
      return `Watching the qubit mid-flight collapsed it. Like checking a Schrödinger box too early — the second H spreads the now-classical bit back into ~50/50, score ${score}/100. Metaphor: peek at a held thought and you lose the held thought.`;
    }
    if (balanced) {
      return `Phase tuned to a place where both outcomes interfere equally — ${dominantPct} either way. Metaphor: two stories with equal pull. Coherence ${score}/100.`;
    }
    if (noise > 0.5) {
      return `Noise ate the interference. The qubit drifted toward ${dominant} (${dominantPct}) but without the clean fringe. Metaphor: signal in a loud room. Coherence ${score}/100.`;
    }
    if (depth > 0) {
      return `Stacked ${depth} X·X pairs — algebraically a no-op, but each gate leaks. Metaphor: a long whispered chain stays the same on paper, drifts in real life. Coherence ${score}/100.`;
    }
    return `Phase steered the wave to ${dominant} (${dominantPct}). Metaphor: aligned attention picks one outcome out of two. Coherence ${score}/100.`;
  }

  // Scientific mode
  if (observeMidway) {
    return `Mid-circuit measurement collapsed |+⟩ to a basis state, killing interference at the second H. Result is ~50/50 (${dominantPct} ${dominant}). Coherence ${score}/100. This is the "watched-path kills fringe" lesson.`;
  }
  if (depth > 0) {
    return `${depth} X·X pairs. Ideal: identity (P(0)=1). With noise=${noise.toFixed(2)} and dephasing per gate, you got P(${dominant})=${dominantPct}. Coherence drops with depth × noise. Score ${score}/100.`;
  }
  if (balanced) {
    return `θ=${theta.toFixed(2)} sits near π/2 — H·RZ(π/2)·H gives ~50/50. P(${dominant})=${dominantPct}. Interference fringe present at low noise. Score ${score}/100.`;
  }
  return `H → RZ(${theta.toFixed(2)}) → H → M. Phase rotation interferes at the second H, biasing the readout to ${dominant} (${dominantPct}). Noise=${noise.toFixed(2)}, coherence ${score}/100.`;
}

export default function QuantumCoherencePanel({ onApplyToBrain } = {}) {
  const [theta, setTheta] = useState(0);
  const [shots, setShots] = useState(1024);
  const [noise, setNoise] = useState(0);
  const [depth, setDepth] = useState(0); // X-X pair count
  const [observeMidway, setObserveMidway] = useState(false);
  const [mode, setMode] = useState('scientific'); // 'scientific' | 'metaphor'
  const [runToken, setRunToken] = useState(0); // bumps every Run click

  const result = useMemo(() => {
    void runToken;
    if (observeMidway) {
      return runObservationExperiment({ shots, observeMidway: true, noise });
    }
    if (depth > 0) {
      return runDecoherenceExperiment({ xxPairs: depth, shots, noise });
    }
    return runPhaseExperiment({ theta, shots, noise });
    // theta/shots/noise/depth/observe/runToken trigger re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theta, shots, noise, depth, observeMidway, runToken]);

  const score = useMemo(
    () => coherenceScore({
      noise,
      depth: Math.max(1, depth + 1),
      observedMidway: observeMidway,
    }),
    [noise, depth, observeMidway],
  );

  const explanation = useMemo(
    () => buildExplanation({ result, score, mode, theta, observeMidway, depth, noise }),
    [result, score, mode, theta, observeMidway, depth, noise],
  );

  const brainDeltas = useMemo(() => mapQuantumToBrainState(result), [result]);

  return (
    <section className="panel panel-pad quantum-coherence-panel">
      <div className="eyebrow">Layer 101 · quantum coherence lab</div>
      <h2>Phase, interference, decoherence — in your browser</h2>
      <p className="muted">
        A single qubit running <code>|0⟩ → H → RZ(θ) → H → M</code>, simulated
        locally in JavaScript. Slide θ to see interference move probability
        between |0⟩ and |1⟩. Add noise. Toggle a mid-circuit observation.
        Stack X·X pairs to watch identity-on-paper fall apart in practice.
      </p>
      <p className="muted small-note">
        This teaches the mechanism behind the word "alignment" — phase
        coherence steers outcomes; noise and observation kill it. It does
        not prove multiverse theory, consciousness collapse, Planck foam,
        or spiritual portals. Those are metaphors when the toggle is on.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={() => setMode((m) => (m === 'scientific' ? 'metaphor' : 'scientific'))}
        >
          Mode: {mode === 'scientific' ? 'Scientific' : 'Metaphor'}
        </button>
        <button className="btn" onClick={() => setRunToken((t) => t + 1)}>Re-run</button>
        <button
          className="btn"
          onClick={() => {
            setTheta(0); setNoise(0); setDepth(0);
            setObserveMidway(false); setShots(1024);
          }}
        >
          Reset
        </button>
        {onApplyToBrain && (
          <button
            className="btn primary"
            onClick={() => onApplyToBrain({ result, deltas: brainDeltas, score })}
          >
            Apply to brain
          </button>
        )}
      </div>

      {/* Sliders */}
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Phase θ (0 → π)</span>
            <strong style={{ fontFamily: 'monospace' }}>{theta.toFixed(3)}</strong>
          </div>
          <input
            type="range"
            min="0"
            max={Math.PI}
            step="0.01"
            value={theta}
            onChange={(e) => setTheta(parseFloat(e.target.value))}
            disabled={observeMidway || depth > 0}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Noise (0 = ideal, 1 = thermal mush)</span>
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

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Depth — extra X·X pairs (algebraically zero work)</span>
            <strong style={{ fontFamily: 'monospace' }}>{depth}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="12"
            step="1"
            value={depth}
            onChange={(e) => setDepth(parseInt(e.target.value, 10))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted small-note">Shots:</span>
          {SHOTS_OPTIONS.map((s) => (
            <button
              key={s}
              className={`btn ${shots === s ? 'primary' : ''}`}
              onClick={() => setShots(s)}
              title={SHOTS_HINT[s]}
            >
              {s}
            </button>
          ))}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginLeft: 'auto',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={observeMidway}
              onChange={(e) => setObserveMidway(e.target.checked)}
            />
            <span className="muted small-note">Observe midway</span>
          </label>
        </div>
      </div>

      {/* Circuit visualization */}
      <CircuitRow theta={theta} observeMidway={observeMidway} depth={depth} />

      {/* Probability bars */}
      <ProbabilityBars distribution={result.distribution} counts={result.counts} />

      {/* Coherence score */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 8,
          background: `rgba(90, 212, 255, ${0.05 + (score / 100) * 0.18})`,
          borderLeft: `3px solid ${score >= 70 ? '#5ee69a' : score >= 40 ? '#fdab43' : '#dd6974'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          Coherence score{' '}
          <strong style={{ fontFamily: 'monospace' }}>{score}</strong>/100
        </span>
        <span className="muted small-note">
          {score >= 70 ? 'phase intact' : score >= 40 ? 'fading' : 'decohered'}
        </span>
      </div>

      {/* Explanation */}
      <p className="muted" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
        {explanation}
      </p>

      {/* Brain deltas preview */}
      <details style={{ marginTop: 10 }}>
        <summary className="muted small-note" style={{ cursor: 'pointer' }}>
          Region deltas (preview)
        </summary>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
            gap: 6,
            marginTop: 6,
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          {Object.entries(brainDeltas).map(([region, delta]) => (
            <div
              key={region}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <div className="muted">{region}</div>
              <div style={{ color: delta > 0 ? '#5ee69a' : '#94a3b8' }}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
