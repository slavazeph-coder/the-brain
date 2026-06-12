import React from "react";
import { SCENARIOS } from "../data/network";
import Term from "./Term";

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
  onSetMode,
}) {
  return (
    <div className="controls-bar">
      <div className="control-actions">
        <button
          className={`btn ${state.running ? "primary" : ""}`}
          onClick={onToggleRun}
        >
          {state.running ? "Pause" : "Resume"}
        </button>
        <button className="btn" onClick={onBurst}>
          <Term k="affectBurst">Trigger affect burst</Term>
        </button>
        <button className="btn" onClick={onReset}>
          Reset
        </button>
        <button
          className={`btn ${isRecording ? "recording" : ""}`}
          onClick={onToggleRecording}
        >
          {isRecording ? "Stop WebM" : "Record WebM"}
        </button>
        <button className="btn" onClick={onExportGif}>
          Export GIF
        </button>
      </div>

      <div className="scenario-row">
        {Object.entries(SCENARIOS).map(([key, value]) => (
          <button
            key={key}
            className={`chip-btn ${state.scenario === value.label ? "active" : ""}`}
            onClick={() => onScenario(key)}
          >
            {value.label}
          </button>
        ))}
      </div>

      <div className="status-row">
        <span className="status-badge">
          <Term k="payload">Payload</Term>: fear · urgency · trust erosion ·
          behavior pressure
        </span>
        <span className="status-badge">Export: {exportStatus}</span>
        <div className="quality-group">
          {["low", "high", "ultra"].map((q) => (
            <button
              key={q}
              className={`chip-btn ${quality === q ? "active" : ""}`}
              onClick={() => onSetQuality(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="quality-group">
          {["simulation", "tribe", "eeg"].map((m) => (
            <button
              key={m}
              className={`chip-btn ${mode === m ? "active" : ""}`}
              onClick={() => onSetMode(m)}
            >
              {m === "tribe" ? (
                <Term k="tribe">TRIBE v2</Term>
              ) : m === "eeg" ? (
                <Term k="liveEeg">Live EEG</Term>
              ) : (
                <Term k="simulation">Simulation</Term>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
