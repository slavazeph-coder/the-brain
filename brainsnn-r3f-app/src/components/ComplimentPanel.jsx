import React, { useMemo, useState } from 'react';
import { scoreCompliment, COMPLIMENT_EXAMPLES } from '../utils/compliment';

/**
 * Layer 79 — Compliment Detector panel.
 */
export default function ComplimentPanel() {
  const [text, setText] = useState('');

  const result = useMemo(() => (text.trim() ? scoreCompliment(text) : null), [text]);

  return (
    <section className="panel panel-pad compliment-panel">
      <div className="eyebrow">Layer 79 · compliment detector</div>
      <h2>Grounded praise vs love-bombing</h2>
      <p className="muted">
        The inverse of the Firewall. Checks whether praise is specific,
        observed, and bounded (grounded appreciation) or superlative,
        unconditional, and premature (love-bombing pattern from Layer 39).
      </p>

      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {COMPLIMENT_EXAMPLES.map((ex) => (
          <button key={ex.label} className="btn-sm" onClick={() => setText(ex.text)}>
            {ex.label}
          </button>
        ))}
        <button className="btn-sm" onClick={() => setText('')} disabled={!text}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder="Paste a thank-you note, DM, performance review excerpt, love letter, onboarding pitch…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        style={{ marginTop: 10 }}
      />

      {result && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${result.color}14`,
              borderLeft: `3px solid ${result.color}`,
            }}
          >
            <span>
              Genuine <strong>{Math.round(result.genuineness * 100)}%</strong> ·{' '}
              Love-bombing risk{' '}
              <strong style={{ color: result.loveBombingRisk >= 0.5 ? '#dd6974' : '#cbd5e1' }}>
                {Math.round(result.loveBombingRisk * 100)}%
              </strong>
            </span>
            <strong style={{ color: result.color }}>{result.verdict}</strong>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginTop: 10,
              fontFamily: 'monospace',
              fontSize: 13,
            }}
          >
            <Stat label="Specific markers" value={result.specificityHits} />
            <Stat label="Maximalist markers" value={result.maximalistHits} tone="#dd6974" />
            <Stat label="Hedging markers" value={result.hedgingHits} tone="#77dbe4" />
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone = '#5ee69a' }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }}>
      <div className="muted small-note">{label}</div>
      <strong style={{ fontSize: 20, color: tone }}>{value}</strong>
    </div>
  );
}
