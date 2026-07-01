import React from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Meter } from '../../components/ui/Meter.jsx';
import { SOLITON_PRESETS, computeSolitonPreset, exploreSolitonField } from '../../lib/solitonLayer.js';

const AXES = [
  { id: 'pressure', label: 'Manipulation pressure' },
  { id: 'suppression', label: 'Cognitive suppression' },
  { id: 'trustErosion', label: 'Trust erosion' },
  { id: 'valence', label: 'Valence' },
  { id: 'arousal', label: 'Arousal' },
];
const BASES = Object.keys(SOLITON_PRESETS);
const SYNC_TONE = { bound: 'success', partial: 'warning', desynchronized: 'danger' };
const PRESET_NAMES = Object.keys(SOLITON_PRESETS);

// Line chart of the ensemble-averaged coherence sweep across a driver axis.
function SweepChart({ curve }) {
  if (!Array.isArray(curve) || curve.length < 2) return null;
  const n = curve.length;
  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => 34 - Math.max(0, Math.min(1, v)) * 32;
  const line = curve.map((c, i) => `${x(i).toFixed(2)},${y(c.gammaCoherence).toFixed(2)}`).join(' ');
  return (
    <svg className="soliton-sweep" viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label="Gamma coherence versus driver strength">
      <line x1="0" y1="2" x2="100" y2="2" className="soliton-sweep-grid" />
      <line x1="0" y1="18" x2="100" y2="18" className="soliton-sweep-grid" />
      <line x1="0" y1="34" x2="100" y2="34" className="soliton-sweep-axis" />
      <polyline points={line} className="soliton-sweep-line" />
      {curve.map((c, i) => (
        <circle key={i} cx={x(i).toFixed(2)} cy={y(c.gammaCoherence).toFixed(2)} r="1.1" className="soliton-sweep-dot" />
      ))}
    </svg>
  );
}

function PresetCard({ name }) {
  const preset = computeSolitonPreset(name);
  if (!preset) return null;
  const field = preset.solitonField;
  return (
    <article className="soliton-preset-card">
      <div className="soliton-preset-head">
        <strong>{preset.label}</strong>
        <Badge tone={SYNC_TONE[field.synchrony] || 'cyan'}>{field.synchrony}</Badge>
      </div>
      <Meter label="Binding" value={field.bindingScore} color="cyan" explanation={`${field.effectiveFrequencyHz} Hz · ${field.leapfrogEvents} leapfrogs`} />
    </article>
  );
}

export function SolitonLabPanel() {
  const [axis, setAxis] = React.useState('pressure');
  const [base, setBase] = React.useState('mixed');
  const sweep = React.useMemo(() => exploreSolitonField({ axis, base, steps: 11 }), [axis, base]);
  const endpoints = sweep.curve.length ? [sweep.curve[0], sweep.curve[sweep.curve.length - 1]] : [];

  return (
    <section className="research-panel soliton-lab-panel">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Layer 103 · field explorer</p>
          <h2>39 Hz soliton sensitivity lab</h2>
        </div>
        <span className="bsn-mono">ensemble ×{sweep.ensemble}</span>
      </div>

      <div className="soliton-lab-controls">
        <label>
          Sweep axis
          <select value={axis} onChange={(event) => setAxis(event.target.value)}>
            {AXES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Base archetype
          <select value={base} onChange={(event) => setBase(event.target.value)}>
            {BASES.map((name) => <option key={name} value={name}>{SOLITON_PRESETS[name].label}</option>)}
          </select>
        </label>
      </div>

      <div className="soliton-lab-chart">
        <SweepChart curve={sweep.curve} />
        <div className="soliton-lab-chart-legend">
          <span>gamma coherence</span>
          <span>{AXES.find((a) => a.id === axis)?.label || axis} 0 → 1 →</span>
        </div>
        {endpoints.length === 2 ? (
          <p className="bsn-note">
            At low {axis} the lattice binds ({endpoints[0].synchrony}, coherence {endpoints[0].gammaCoherence}); at high {axis} it fragments ({endpoints[1].synchrony}, coherence {endpoints[1].gammaCoherence}).
          </p>
        ) : null}
      </div>

      <div className="soliton-preset-grid">
        {PRESET_NAMES.map((name) => <PresetCard key={name} name={name} />)}
      </div>

      <p className="bsn-note">Deterministic client-side sweep of the Kuramoto + KdV model. Same function behind <code>POST /api/soliton/explore</code>. Not a literal brain measurement.</p>
    </section>
  );
}
