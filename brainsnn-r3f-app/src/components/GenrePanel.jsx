import React, { useMemo, useState } from 'react';
import { classifyGenre, GENRE_CATALOG } from '../utils/genreClassifier';

export default function GenrePanel() {
  const [text, setText] = useState('');
  const report = useMemo(() => (text.trim() ? classifyGenre(text) : null), [text]);

  return (
    <section className="panel panel-pad genre-panel">
      <div className="eyebrow">Layer 87 · genre classifier</div>
      <h2>What kind of text is this?</h2>
      <p className="muted">
        Heuristic genre detector across {GENRE_CATALOG.length} catalog entries
        (news headline, ad copy, political speech, personal message, customer
        support, academic, dating profile, legalese, corporate all-hands).
        Feeds the rest of the pipeline with a "what am I reading" tag.
      </p>

      <textarea
        className="firewall-input"
        placeholder="Paste any text..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        style={{ marginTop: 10 }}
      />

      {report && report.ranked.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(90,212,255,0.06)',
              borderLeft: '3px solid #5ad4ff',
            }}
          >
            <strong>Primary: {report.primary.label}</strong>
            <span className="muted small-note" style={{ marginLeft: 8 }}>
              {report.primary.score} hit{report.primary.score === 1 ? '' : 's'} · signal strength {report.signalStrength}
            </span>
          </div>

          <div style={{ marginTop: 8 }}>
            {report.ranked.slice(0, 6).map((g) => (
              <div
                key={g.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '210px 1fr 60px',
                  gap: 8,
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,0.02)',
                  marginTop: 4,
                }}
              >
                <span>{g.label}</span>
                <div style={{ width: '100%', height: 6, background: '#1a1f2e', borderRadius: 999 }}>
                  <div style={{ width: `${Math.round(g.share * 100)}%`, height: '100%', background: '#5ad4ff', borderRadius: 999 }} />
                </div>
                <span className="muted small-note" style={{ fontFamily: 'monospace' }}>
                  {g.score}×
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
