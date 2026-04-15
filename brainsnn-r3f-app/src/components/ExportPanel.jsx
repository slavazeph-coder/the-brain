import React from 'react';

export default function ExportPanel({
  trimStart,
  trimDuration,
  fps,
  width,
  onChange,
  exportProgress,
  exportStatus
}) {
  return (
    <section className="panel panel-pad export-panel">
      <div className="subhead-row">
        <h3>GIF Export Controls</h3>
        <span className="muted">Trim before conversion</span>
      </div>

      <div className="export-grid">
        <label>
          <span>Trim start (s)</span>
          <input type="number" min="0" step="0.1" value={trimStart} onChange={(e) => onChange('trimStart', Number(e.target.value))} />
        </label>
        <label>
          <span>Duration (s)</span>
          <input type="number" min="0.5" step="0.1" value={trimDuration} onChange={(e) => onChange('trimDuration', Number(e.target.value))} />
        </label>
        <label>
          <span>FPS</span>
          <input type="number" min="6" max="20" step="1" value={fps} onChange={(e) => onChange('fps', Number(e.target.value))} />
        </label>
        <label>
          <span>Width</span>
          <input type="number" min="320" max="960" step="80" value={width} onChange={(e) => onChange('width', Number(e.target.value))} />
        </label>
      </div>

      <div className="progress-wrap">
        <div className="progress-bar">
          <span style={{ width: `${exportProgress}%` }} />
        </div>
        <div className="timeline-stats">
          <span>{exportStatus}</span>
          <span>{exportProgress}%</span>
        </div>
      </div>
    </section>
  );
}
