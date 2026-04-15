import React, { useMemo, useState } from 'react';
import {
  NEUROTRANSMITTERS,
  NT_IDS,
  NT_BASELINE,
  NT_PRESETS
} from '../data/neurotransmitters';
import {
  computeRegionDeltas,
  describeLevels,
  decodedToNTLevels,
  expandPresetLevels
} from '../utils/neurochemistry';

const REGION_ORDER = ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL'];

function baselineLevels() {
  const levels = {};
  for (const nt of NT_IDS) levels[nt] = NT_BASELINE;
  return levels;
}

/**
 * Layer 30 — Neurochemistry Sandbox
 *
 * Six NT sliders (DA / 5-HT / CORT / OXT / NE / ACh) that directly modulate
 * brain regions through real neuroscience weight profiles. Presets simulate
 * states (caffeine, meditation, SSRI, stress, panic, flow). "Match from last
 * decode" derives NT levels from the Layer 29 affect fingerprint.
 */
export default function NeurochemistryPanel({ onApplyBath, lastAffectDecode }) {
  const [levels, setLevels] = useState(baselineLevels);
  const [activePreset, setActivePreset] = useState('baseline');
  const [gain, setGain] = useState(0.6);

  const deltas = useMemo(() => computeRegionDeltas(levels, gain), [levels, gain]);
  const description = useMemo(() => describeLevels(levels), [levels]);

  function setLevel(nt, value) {
    setLevels((prev) => ({ ...prev, [nt]: value }));
    setActivePreset(null);
  }

  function handlePreset(preset) {
    setLevels(expandPresetLevels(preset));
    setActivePreset(preset.id);
  }

  function handleReset() {
    setLevels(baselineLevels());
    setActivePreset('baseline');
  }

  function handleMatchDecode() {
    if (!lastAffectDecode) return;
    const derived = decodedToNTLevels(lastAffectDecode);
    setLevels(derived);
    setActivePreset(null);
  }

  function handleApply() {
    onApplyBath?.(levels, {
      label:
        activePreset && activePreset !== 'baseline'
          ? `NT: ${NT_PRESETS.find((p) => p.id === activePreset)?.label}`
          : 'NT Bath',
      gain
    });
  }

  const maxDelta = Math.max(0.01, ...Object.values(deltas).map((d) => Math.abs(d)));

  return (
    <section className="panel panel-pad nt-panel">
      <div className="eyebrow">Layer 30</div>
      <h2>Neurochemistry Sandbox</h2>
      <p className="muted">
        Six neurotransmitters, each with a real-neuroscience region-effect
        profile. Slide them above/below baseline to modulate the brain — or
        apply a preset to simulate caffeine, meditation, stress, SSRIs, flow,
        panic, or MDMA. Layer 29's affect decode can derive an implied NT
        signature — this is the chemistry beneath the feeling.
      </p>

      <div className="nt-presets">
        {NT_PRESETS.map((p) => (
          <button
            key={p.id}
            className={`nt-preset ${activePreset === p.id ? 'active' : ''}`}
            onClick={() => handlePreset(p)}
            title={p.vibe}
          >
            <span className="nt-preset-icon">{p.icon}</span>
            <span className="nt-preset-label">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="nt-sliders">
        {NT_IDS.map((nt) => (
          <NTSlider
            key={nt}
            nt={NEUROTRANSMITTERS[nt]}
            value={levels[nt]}
            onChange={(v) => setLevel(nt, v)}
          />
        ))}
      </div>

      <div className="nt-status">
        <strong className="muted small-note">Current chemistry</strong>
        <span className="nt-status-text">{description}</span>
      </div>

      <div className="nt-region-preview">
        <strong className="muted small-note" style={{ display: 'block', marginBottom: 6 }}>
          Region impact preview — Σ of NT deltas × region weights × gain
        </strong>
        <div className="nt-region-grid">
          {REGION_ORDER.map((region) => {
            const d = deltas[region] ?? 0;
            const pct = Math.round((Math.abs(d) / maxDelta) * 100);
            const sign = d >= 0 ? '+' : '−';
            const tint = d >= 0 ? '#7dd87f' : '#ff6040';
            return (
              <div key={region} className="nt-region-cell">
                <div className="nt-region-label">{region}</div>
                <div className="nt-region-bar-wrap">
                  <div
                    className="nt-region-bar"
                    style={{
                      width: `${pct}%`,
                      background: tint,
                      marginLeft: d >= 0 ? '50%' : `${50 - pct / 2}%`
                    }}
                  />
                </div>
                <div className="nt-region-val" style={{ color: tint }}>
                  {sign}
                  {(Math.abs(d) * 100).toFixed(0)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="nt-gain-row">
        <label className="muted small-note">
          Gain · {gain.toFixed(2)}
          <input
            type="range"
            min="0.2"
            max="1.2"
            step="0.05"
            value={gain}
            onChange={(e) => setGain(parseFloat(e.target.value))}
          />
        </label>
        <span className="muted small-note">
          How strongly NT deviation translates into region change.
        </span>
      </div>

      <div className="nt-actions">
        <button className="primary" onClick={handleApply}>
          Apply bath to brain
        </button>
        <button className="ghost small" onClick={handleReset}>
          Reset to baseline
        </button>
        <button
          className="ghost small"
          onClick={handleMatchDecode}
          disabled={!lastAffectDecode || lastAffectDecode.empty}
          title={
            lastAffectDecode && !lastAffectDecode.empty
              ? 'Derive NT levels from the last affect decode'
              : 'Decode an affect in Layer 29 first'
          }
        >
          Match from last decode
        </button>
      </div>
    </section>
  );
}

function NTSlider({ nt, value, onChange }) {
  const dev = value - NT_BASELINE;
  const sign = dev >= 0 ? '+' : '−';
  const pct = Math.round(Math.abs(dev) * 200); // percentage deviation from baseline

  return (
    <div className="nt-slider-row">
      <div className="nt-slider-head">
        <span className="nt-slider-dot" style={{ background: nt.color }} />
        <strong>{nt.label}</strong>
        <span className="muted small-note">{nt.short}</span>
        <span
          className="nt-slider-dev"
          style={{ color: dev === 0 ? '#8a8f99' : dev > 0 ? '#7dd87f' : '#ff6040' }}
        >
          {dev === 0 ? 'baseline' : `${sign}${pct}%`}
        </span>
      </div>
      <div className="nt-slider-wrap">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ accentColor: nt.color }}
        />
        <div className="nt-slider-tick" />
      </div>
      <div className="nt-slider-blurb muted small-note">{nt.blurb}</div>
    </div>
  );
}
