import React, { useMemo, useState } from 'react';
import { runSweep, rowsToCsv, sweepSummary, sweepBrainDeltas } from '../utils/quantumSweep';

/**
 * Layer 103 — Quantum Sweep panel.
 *
 * Auto-sweeps a parameter through the L101 single-qubit experiment family
 * and renders a small SVG line chart of P(0) (and the ideal curve where
 * one is well-defined). Lets the user download a CSV with the same column
 * shape as the offline Qiskit suite at /quantum_alignment/results/.
 */

const KINDS = [
  { id: 'phase', label: 'Phase θ ∈ [0, π]', help: 'Sweeps θ; ideal P(0) = cos²(θ/2).' },
  { id: 'noise', label: 'Noise ∈ [0, 1]', help: 'Sweeps depolarizing-style noise at fixed θ.' },
  { id: 'depth', label: 'X·X depth', help: 'Sweeps logical-identity depth; ideal P(0)=1.' },
];

const SHOTS_OPTIONS = [256, 1024, 4096];

function csvDownload(rows, kind) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `quantum_sweep_${kind}_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function SweepChart({ rows }) {
  if (!rows.length) return null;
  const W = 360;
  const H = 140;
  const padL = 32;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = rows.map((r) => r.parameter);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;
  const xCoord = (v) => padL + ((v - xMin) / xSpan) * innerW;
  const yCoord = (p) => padT + (1 - p) * innerH;
  const linePath = (key) =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(r.parameter).toFixed(2)} ${yCoord(r[key]).toFixed(2)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: W, marginTop: 10, background: 'rgba(255,255,255,0.025)', borderRadius: 6 }}
      role="img"
      aria-label="Sweep chart"
    >
      {/* gridlines + axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((y) => (
        <g key={y}>
          <line x1={padL} y1={yCoord(y)} x2={W - padR} y2={yCoord(y)} stroke="rgba(255,255,255,0.06)" />
          <text x={padL - 4} y={yCoord(y) + 3} fontSize="9" fill="#94a3b8" textAnchor="end">{y.toFixed(2)}</text>
        </g>
      ))}
      {/* ideal curve, dashed */}
      <path d={linePath('expectedP0')} fill="none" stroke="#5ee69a" strokeWidth="1.2" strokeDasharray="3 3" />
      {/* measured P(0) */}
      <path d={linePath('p0')} fill="none" stroke="#5ad4ff" strokeWidth="1.8" />
      {/* measured P(1) */}
      <path d={linePath('p1')} fill="none" stroke="#a86fdf" strokeWidth="1.2" opacity="0.8" />
      {/* x ticks */}
      <text x={padL} y={H - 6} fontSize="9" fill="#94a3b8">{rows[0].parameterLabel}</text>
      <text x={W - padR} y={H - 6} fontSize="9" fill="#94a3b8" textAnchor="end">{rows[rows.length - 1].parameterLabel}</text>
      {/* legend */}
      <g transform={`translate(${padL + 6}, ${padT + 8})`}>
        <rect x="0" y="-7" width="9" height="2" fill="#5ad4ff" />
        <text x="13" y="0" fontSize="9" fill="#cbd5e1">P(0) measured</text>
        <rect x="86" y="-7" width="9" height="2" fill="#a86fdf" />
        <text x="99" y="0" fontSize="9" fill="#cbd5e1">P(1)</text>
        <rect x="124" y="-7" width="9" height="2" fill="#5ee69a" />
        <text x="137" y="0" fontSize="9" fill="#cbd5e1">P(0) ideal</text>
      </g>
    </svg>
  );
}

export default function QuantumSweepPanel({ onApplyToBrain }) {
  const [kind, setKind] = useState('phase');
  const [shots, setShots] = useState(1024);
  const [steps, setSteps] = useState(9);
  const [noise, setNoise] = useState(0.05);
  const [theta, setTheta] = useState(Math.PI / 2);
  const [maxDepth, setMaxDepth] = useState(12);
  const [runToken, setRunToken] = useState(0);

  const rows = useMemo(() => {
    void runToken;
    return runSweep({ kind, shots, steps, noise, theta, maxDepth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, shots, steps, noise, theta, maxDepth, runToken]);

  const summary = useMemo(() => sweepSummary(rows), [rows]);
  const kindMeta = KINDS.find((k) => k.id === kind) || KINDS[0];

  return (
    <section className="panel panel-pad quantum-sweep-panel">
      <div className="eyebrow">Layer 103 · quantum sweep</div>
      <h2>Auto-sweep a parameter, download a CSV</h2>
      <p className="muted">
        Runs the L101 experiment across a range of parameters, plots P(0)
        and P(1) against the closed-form ideal, and exports the same column
        shape as the offline Qiskit suite at <code>quantum_alignment/results/</code>.
        Compare browser-sim curves with hardware curves directly.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {KINDS.map((k) => (
          <button key={k.id} className={`btn ${kind === k.id ? 'primary' : ''}`} onClick={() => setKind(k.id)} title={k.help}>
            {k.label}
          </button>
        ))}
        <button className="btn" onClick={() => setRunToken((t) => t + 1)}>Re-run</button>
        <button className="btn primary" onClick={() => csvDownload(rows, kind)} disabled={!rows.length}>
          Download CSV
        </button>
        {onApplyToBrain && (
          <button
            className="btn"
            disabled={!summary}
            onClick={() => {
              const deltas = sweepBrainDeltas(summary);
              if (deltas) onApplyToBrain({ summary, deltas, kind });
            }}
          >
            Apply to brain
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">Steps</span>
            <strong style={{ fontFamily: 'monospace' }}>{steps}</strong>
          </div>
          <input type="range" min="3" max="33" step="2" value={steps} onChange={(e) => setSteps(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
        </div>
        {kind !== 'noise' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">Noise (fixed)</span>
              <strong style={{ fontFamily: 'monospace' }}>{noise.toFixed(2)}</strong>
            </div>
            <input type="range" min="0" max="1" step="0.01" value={noise} onChange={(e) => setNoise(parseFloat(e.target.value))} style={{ width: '100%' }} />
          </div>
        )}
        {kind === 'noise' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">θ (fixed) — phase circuit angle</span>
              <strong style={{ fontFamily: 'monospace' }}>{theta.toFixed(2)}</strong>
            </div>
            <input type="range" min="0" max={Math.PI} step="0.01" value={theta} onChange={(e) => setTheta(parseFloat(e.target.value))} style={{ width: '100%' }} />
          </div>
        )}
        {kind === 'depth' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">Max X·X depth</span>
              <strong style={{ fontFamily: 'monospace' }}>{maxDepth}</strong>
            </div>
            <input type="range" min="2" max="32" step="1" value={maxDepth} onChange={(e) => setMaxDepth(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="muted small-note">Shots:</span>
          {SHOTS_OPTIONS.map((s) => (
            <button key={s} className={`btn ${shots === s ? 'primary' : ''}`} onClick={() => setShots(s)}>{s}</button>
          ))}
        </div>
      </div>

      <SweepChart rows={rows} />

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12, fontSize: 12 }}>
          <div className="muted small-note"><strong>{summary.n}</strong> rows</div>
          <div className="muted small-note">avg error <strong>{summary.avgError.toFixed(3)}</strong></div>
          <div className="muted small-note">max error <strong>{summary.maxError.toFixed(3)}</strong></div>
          <div className="muted small-note">P(0) range <strong>{summary.rangeP0.toFixed(3)}</strong></div>
          <div className="muted small-note">avg coherence <strong>{summary.avgCoherence.toFixed(0)}</strong>/100</div>
        </div>
      )}

      <p className="muted small-note" style={{ marginTop: 8 }}>
        {kindMeta.help} CSV columns mirror the Qiskit suite where they overlap.
      </p>
    </section>
  );
}
