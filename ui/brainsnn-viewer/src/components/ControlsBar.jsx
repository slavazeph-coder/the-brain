import React from 'react';
import { SCENARIOS } from '../data/network';

export default function ControlsBar({ state, onToggleRun, onBurst, onReset, onScenario }) {
  return (
    <section className="panel panel-pad controls-bar">
      <div>
        <div className="eyebrow">Control Center</div>
        <h1>BrainSNN</h1>
        <p className="muted">3D neuromorphic network viewer with STDP learning, scenario presets, and a live inspector.</p>
      </div>
      <div className="control-actions">
        <button className={`btn ${state.running ? 'primary' : ''}`} onClick={onToggleRun}>{state.running ? 'Pause' : 'Resume'}</button>
        <button className="btn" onClick={onBurst}>Trigger burst</button>
        <button className="btn" onClick={onReset}>Reset</button>
      </div>
      <div className="scenario-row">
        {Object.entries(SCENARIOS).map(([key, value]) => (
          <button key={key} className={`chip-btn ${state.scenario === value.label ? 'active' : ''}`} onClick={() => onScenario(key)}>{value.label}</button>
        ))}
      </div>
    </section>
  );
}
