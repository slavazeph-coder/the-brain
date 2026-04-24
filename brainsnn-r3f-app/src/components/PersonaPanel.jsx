import React, { useMemo, useState } from 'react';
import { simulatePersonas } from '../utils/personas';

const EXAMPLES = [
  {
    label: 'Workplace pressure',
    text: "URGENT — we need this shipped by EOD or the deal walks. Everyone is counting on you. Don't be the reason the team loses.",
  },
  {
    label: 'Relationship guilt',
    text: "After everything I've done for you, this is how you treat me? I guess I'm just not important enough to prioritize. Fine. I'll just carry this alone.",
  },
  {
    label: 'Calm message',
    text: 'Hey — free for a quick walk at 3? No pressure if the day\'s already booked.',
  },
];

export default function PersonaPanel() {
  const [text, setText] = useState('');
  const report = useMemo(() => (text.trim() ? simulatePersonas(text) : null), [text]);

  return (
    <section className="panel panel-pad persona-panel">
      <div className="eyebrow">Layer 88 · persona simulator</div>
      <h2>Read it through four lenses</h2>
      <p className="muted">
        Same text, four readers. Skeptic weights urgency/certainty high.
        Ally attenuates. Target amplifies emotional activation. Observer
        stays flat. The delta between lenses is where manipulation lives.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex.label} className="btn-sm" onClick={() => setText(ex.text)}>
            {ex.label}
          </button>
        ))}
        <button className="btn-sm" onClick={() => setText('')} disabled={!text}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder="Paste any message..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        style={{ marginTop: 10 }}
      />

      {report && !report.empty && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
          {report.rows.map((row) => (
            <div
              key={row.id}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                borderLeft: `3px solid ${row.color}`,
                background: `${row.color}10`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ color: row.color }}>{row.label}</strong>
                <span style={{ fontFamily: 'monospace', color: row.color }}>
                  {Math.round(row.pressure * 100)}%
                </span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>
                {row.interpretation}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
