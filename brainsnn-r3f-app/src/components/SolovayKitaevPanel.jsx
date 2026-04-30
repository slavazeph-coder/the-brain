import React, { useMemo, useState } from 'react';
import { approximationReport } from '../utils/solovayKitaev';

/**
 * Layer 108 — Solovay-Kitaev mini-demo.
 *
 * Educational *basic-approximation* step. Pick a target rotation RZ(θ);
 * the panel runs a brute-force search over {H, T, T†}-sequences up to
 * length 8 and shows the best approximation at each length. Plotting
 * distance vs sequence length makes the convergence visible.
 *
 * This is NOT the full SK algorithm — that one recursively combines two
 * basic approximations to drive ε down exponentially in the recursion
 * depth. Here we stop after the search; the convergence rate visible in
 * the plot is the input to that recursion.
 */

const MAX_LEN_CAP = 8;

function SeriesChart({ series }) {
  const W = 360;
  const Hh = 140;
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = Hh - padT - padB;
  const xs = series.map((s) => s.maxLen);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;
  const yMax = Math.max(0.01, ...series.map((s) => s.distance));
  const xCoord = (v) => padL + ((v - xMin) / xSpan) * innerW;
  const yCoord = (d) => padT + (1 - d / yMax) * innerH;

  const path = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xCoord(s.maxLen).toFixed(2)} ${yCoord(s.distance).toFixed(2)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${Hh}`}
      style={{ width: '100%', maxWidth: W, marginTop: 10, background: 'rgba(255,255,255,0.025)', borderRadius: 6 }}
      role="img"
      aria-label="Convergence chart"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((y) => (
        <g key={y}>
          <line x1={padL} y1={yCoord(y * yMax)} x2={W - padR} y2={yCoord(y * yMax)} stroke="rgba(255,255,255,0.06)" />
          <text x={padL - 4} y={yCoord(y * yMax) + 3} fontSize="9" fill="#94a3b8" textAnchor="end">
            {(y * yMax).toFixed(2)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#5ad4ff" strokeWidth="1.8" />
      {series.map((s) => (
        <circle key={s.maxLen} cx={xCoord(s.maxLen)} cy={yCoord(s.distance)} r="2.5" fill="#5ee69a" />
      ))}
      <text x={padL} y={Hh - 6} fontSize="9" fill="#94a3b8">L=1</text>
      <text x={W - padR} y={Hh - 6} fontSize="9" fill="#94a3b8" textAnchor="end">L={xMax}</text>
    </svg>
  );
}

export default function SolovayKitaevPanel() {
  const [theta, setTheta] = useState(0.3);
  const [maxLen, setMaxLen] = useState(6);

  const report = useMemo(() => approximationReport(theta, maxLen), [theta, maxLen]);

  return (
    <section className="panel panel-pad solovay-kitaev-panel">
      <div className="eyebrow">Layer 108 · solovay-kitaev mini-demo</div>
      <h2>Approximate any RZ(θ) with sequences over <code>{`{H, T, T†}`}</code></h2>
      <p className="muted">
        Brute-force basic-approximation step: pick a rotation, search every
        gate sequence up to length L over the universal alphabet, return
        the closest match (Frobenius distance modulo global phase). The
        full Solovay-Kitaev algorithm then recursively composes two basic
        approximations to drive ε down exponentially with depth.
      </p>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">target θ ∈ [0, 2π]</span>
            <strong style={{ fontFamily: 'monospace' }}>{theta.toFixed(3)}</strong>
          </div>
          <input
            type="range"
            min="0"
            max={2 * Math.PI}
            step="0.01"
            value={theta}
            onChange={(e) => setTheta(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">max sequence length L</span>
            <strong style={{ fontFamily: 'monospace' }}>{maxLen}</strong>
          </div>
          <input
            type="range"
            min="1"
            max={MAX_LEN_CAP}
            step="1"
            value={maxLen}
            onChange={(e) => setMaxLen(parseInt(e.target.value, 10))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <SeriesChart series={report.series} />

      <div style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Best at L = {maxLen}</h3>
        <div
          style={{
            padding: 10,
            background: 'rgba(255,255,255,0.025)',
            borderRadius: 6,
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          <div>
            <span className="muted">sequence: </span>
            <strong style={{ color: '#5ad4ff' }}>
              {report.best.sequence.length ? report.best.sequence.join(' · ') : '(empty / identity)'}
            </strong>
          </div>
          <div>
            <span className="muted">distance: </span>
            <strong style={{ color: report.best.distance < 0.05 ? '#5ee69a' : '#fdab43' }}>
              {report.best.distance.toExponential(3)}
            </strong>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Convergence series</h3>
        <table style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
              <th>L</th>
              <th>distance</th>
              <th>sequence</th>
            </tr>
          </thead>
          <tbody>
            {report.series.map((s) => (
              <tr key={s.maxLen} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td>{s.maxLen}</td>
                <td style={{ color: s.distance < 0.05 ? '#5ee69a' : '#fdab43' }}>
                  {s.distance.toExponential(2)}
                </td>
                <td className="muted small-note">{s.sequence.length ? s.sequence.join('·') : '(empty)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted small-note" style={{ marginTop: 10 }}>
        L is capped at {MAX_LEN_CAP} because brute-force scales as 3^L. Real SK
        uses recursive group-commutator composition to reach much smaller ε
        without exponential search.
      </p>
    </section>
  );
}
