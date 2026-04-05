import React from 'react';
import { SCENARIOS } from '../data/network';

export default function ControlsBar({
  state,
  onToggleRun,
  onBurst,
  onReset,
  onScenario,
  onToggleRecording,
  onExportGif,
  isRecording,
  exportStatus,
  quality,
  onSetQuality,
  mode,
  onSetMode
}) {
  return (
    <section className="panel panel-pad controls-bar">
      <div>
        <div className="eyebrow">Control Center</div>
        <h1>BrainSNN</h1>
        <p className="muted">
          3D neuromorphic network viewer with STDP learning, TRIBE v2 predictions, inspector analytics, recording export, and adaptive quality modes.
        </p>
      </div>

      <div className="control-actions">
        <button className={`btn ${state.running ? 'primary' : ''}`} onClick={onToggleRun}>
          {state.running ? 'Pause' : 'Resume'}
        </button>
        <button className="btn" onClick={onBurst}>Trigger burst</button>
        <button className="btn" onClick={onReset}>Reset</button>
        <button className={`btn ${isRecording ? 'recording' : ''}`} onClick={onToggleRecording}>
          {isRecording ? 'Stop WebM' : 'Record WebM'}
        </button>
        <button className="btn" onClick={onExportGif}>Export GIF</button>
      </div>

      <div className="scenario-row">
        {Object.entries(SCENARIOS).map(([key, value]) => (
          <button
            key={key}
            className={`chip-btn ${state.scenario === value.label ? 'active' : ''}`}
            onClick={() => onScenario(key)}
          >
            {value.label}
          </button>
        ))}
      </div>

      <div className="status-row">
        <span className="status-badge">Export: {exportStatus}</span>
        <div className="quality-group">
          {['low', 'high', 'ultra'].map((q) => (
            <button
              key={q}
              className={`chip-btn ${quality === q ? 'active' : ''}`}
              onClick={() => onSetQuality(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="quality-group">
          {['simulation', 'tribe', 'eeg'].map((m) => (
            <button
              key={m}
              className={`chip-btn ${mode === m ? 'active' : ''}`}
              onClick={() => onSetMode(m)}
            >
              {m === 'tribe' ? 'TRIBE v2' : m === 'eeg' ? 'Live EEG' : 'Simulation'}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
