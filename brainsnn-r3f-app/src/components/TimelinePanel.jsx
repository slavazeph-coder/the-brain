import React from 'react';

export default function TimelinePanel({ history, timelineIndex, onScrub, onReplay }) {
  return (
    <section className="panel panel-pad timeline-panel">
      <div className="subhead-row">
        <h3>Record / Replay Timeline</h3>
        <span className="muted">Scrub recent history</span>
      </div>

      <input
        type="range"
        min="0"
        max={Math.max(0, history.length - 1)}
        value={Math.min(timelineIndex, Math.max(0, history.length - 1))}
        onChange={(e) => onScrub(Number(e.target.value))}
      />

      <div className="timeline-stats">
        <span>Frames: {history.length}</span>
        <button className="btn" onClick={onReplay}>Replay burst</button>
      </div>
    </section>
  );
}
