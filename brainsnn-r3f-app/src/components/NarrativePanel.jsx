import React, { useEffect, useRef, useState } from 'react';
import { generateNarrative, statusLine } from '../utils/narrative';

export default function NarrativePanel({ state, trends, firewallResult }) {
  const [lines, setLines] = useState([]);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (paused) return;
    const narrative = generateNarrative({
      regions: state.regions,
      scenario: state.scenario,
      trends,
      firewallResult,
      tick: state.tick
    });
    setLines((prev) => {
      const next = [...prev, { tick: state.tick, sentences: narrative, ts: Date.now() }];
      return next.slice(-20); // keep last 20 entries
    });
  }, [state.tick, state.scenario, paused]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  const status = statusLine(state.regions, state.scenario);

  return (
    <section className="panel panel-pad narrative-panel">
      <div className="narrative-header">
        <div>
          <div className="eyebrow">Neural Narrative</div>
          <p className="narrative-status-line">{status}</p>
        </div>
        <button className="btn-sm" onClick={() => setPaused(!paused)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="narrative-feed" ref={scrollRef}>
        {lines.map((entry, i) => (
          <div key={i} className="narrative-entry">
            <span className="narrative-tick">T{entry.tick}</span>
            <div className="narrative-text">
              {entry.sentences.map((s, j) => (
                <p key={j}>{s}</p>
              ))}
            </div>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="muted">Narrative will appear as the brain evolves...</p>
        )}
      </div>
    </section>
  );
}
