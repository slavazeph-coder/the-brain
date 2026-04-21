import React, { useMemo, useState } from 'react';
import { coverageFor, tokenizeWithSpans, CATEGORY_COLORS } from '../utils/coverage';

const EXAMPLE = 'URGENT: you won\'t believe the shocking scandal they covered up. Everyone knows the truth — act now or face devastating consequences. 100% proven.';

/**
 * Layer 66 — Coverage Heatmap panel.
 */
export default function CoveragePanel() {
  const [text, setText] = useState(EXAMPLE);
  const report = useMemo(() => (text.trim() ? coverageFor(text) : null), [text]);
  const tokens = useMemo(() => (report ? tokenizeWithSpans(text, report.spans) : []), [text, report]);

  return (
    <section className="panel panel-pad coverage-panel">
      <div className="eyebrow">Layer 66 · coverage heatmap</div>
      <h2>Which pattern caught which word</h2>
      <p className="muted">
        Runs the currently active Firewall ruleset (defaults + custom) over
        your text and highlights the exact substrings each pattern matched.
        Click-through debugging for rule development — pair with Layer 55
        and Layer 61.
      </p>

      <div className="control-actions" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => setText(EXAMPLE)}>Reset to example</button>
        <button className="btn" onClick={() => setText('')} disabled={!text}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
      />

      {report && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              marginBottom: 10,
            }}
          >
            <span>
              <strong>{report.totalHits}</strong> matches across{' '}
              <strong>{report.firedPatternCount}</strong> of{' '}
              <strong>{report.totalPatternCount}</strong> active patterns
            </span>
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.24)',
              lineHeight: 1.6,
              fontFamily: '-apple-system, system-ui, sans-serif',
            }}
          >
            {tokens.map((t, i) =>
              t.plain ? (
                <span key={i}>{t.text}</span>
              ) : (
                <mark
                  key={i}
                  style={{
                    background: `${CATEGORY_COLORS[t.category] || '#888'}33`,
                    color: '#f1ece5',
                    borderBottom: `2px solid ${CATEGORY_COLORS[t.category] || '#888'}`,
                    padding: '0 2px',
                  }}
                  title={`matched ${t.category}`}
                >
                  {t.text}
                </mark>
              )
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">Fired patterns (top 15)</div>
            {report.fired.slice(0, 15).map((p, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 10px',
                  borderLeft: `3px solid ${CATEGORY_COLORS[p.category] || '#888'}`,
                  background: 'rgba(255,255,255,0.02)',
                  marginTop: 4,
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                <span>
                  <strong style={{ color: CATEGORY_COLORS[p.category] || '#888' }}>{p.category}</strong>
                  {' '}· /{p.source.slice(0, 70)}/
                </span>
                <strong>{p.hits}×</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
