import React, { useEffect, useState } from 'react';
import {
  BANDS, getOscillationState, setOscillationState,
} from '../utils/oscillations';

/**
 * Layer 71 — Neural Oscillations panel.
 * Toggle bands + adjust modulation gain. Persists to localStorage;
 * BrainFragments reads the state each frame.
 */
export default function OscillationsPanel() {
  const [state, setState] = useState(() => getOscillationState());

  useEffect(() => { setOscillationState(state); }, [state]);

  function toggle(id) {
    setState((s) => ({ ...s, active: { ...s.active, [id]: !s.active[id] } }));
  }
  function setGain(g) {
    setState((s) => ({ ...s, gain: g }));
  }

  const any = Object.values(state.active).some(Boolean);

  return (
    <section className="panel panel-pad oscillations-panel">
      <div className="eyebrow">Layer 71 · neural oscillations</div>
      <h2>Five classical EEG bands</h2>
      <p className="muted">
        Delta / Theta / Alpha / Beta / Gamma — each with its canonical
        frequency range and region-affinity profile. When a band is on,
        BrainFragments (Layer 37) modulates each region's activity with
        a sine wave at the band's center frequency.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <label className="muted small-note">Modulation gain:</label>
        <input
          type="range"
          min="0"
          max="0.4"
          step="0.01"
          value={state.gain}
          onChange={(e) => setGain(parseFloat(e.target.value))}
          style={{ flex: 1, maxWidth: 260 }}
        />
        <strong style={{ fontFamily: 'monospace' }}>{state.gain.toFixed(2)}</strong>
        <span className="muted small-note" style={{ marginLeft: 8 }}>
          {any ? 'bands active' : 'all off'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
        {BANDS.map((b) => {
          const on = !!state.active[b.id];
          return (
            <button
              key={b.id}
              onClick={() => toggle(b.id)}
              style={{
                textAlign: 'left',
                padding: '12px 14px',
                borderRadius: 8,
                borderLeft: `3px solid ${b.color}`,
                background: on ? `${b.color}18` : 'rgba(255,255,255,0.03)',
                border: 'none',
                color: '#e6f1ff',
                cursor: 'pointer',
                opacity: on ? 1 : 0.65,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: b.color }}>{b.label}</strong>
                <span className="muted small-note">{b.hzMin}–{b.hzMax} Hz</span>
              </div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.35 }}>{b.desc}</p>
              <div className="muted small-note" style={{ marginTop: 4 }}>
                regions: {Object.entries(b.regions).map(([r, w]) => `${r} ${Math.round(w * 100)}%`).join(' · ')}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: on ? '#5ee69a' : '#94a3b8' }}>
                {on ? '● on' : '○ off'}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
