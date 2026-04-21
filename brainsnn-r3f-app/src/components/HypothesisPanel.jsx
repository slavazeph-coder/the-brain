import React, { useMemo, useState } from 'react';
import {
  HYPOTHESIS_TYPES, testHypothesis, HYPOTHESIS_EXAMPLE,
} from '../utils/hypothesis';

/**
 * Layer 62 — Hypothesis Mode panel.
 * State a claim, paste evidence, get per-item for/against + verdict.
 */
export default function HypothesisPanel() {
  const [type, setType] = useState('gaslighting');
  const [evidence, setEvidence] = useState('');

  const report = useMemo(() => {
    if (!evidence.trim()) return null;
    return testHypothesis({ type, evidenceText: evidence });
  }, [type, evidence]);

  function loadExample() {
    setType(HYPOTHESIS_EXAMPLE.type);
    setEvidence(HYPOTHESIS_EXAMPLE.text);
  }

  return (
    <section className="panel panel-pad hypothesis-panel">
      <div className="eyebrow">Layer 62 · hypothesis mode</div>
      <h2>Structured inquiry</h2>
      <p className="muted">
        State what you suspect. Paste what you saw. Separate items with{' '}
        <code>---</code> or blank lines. Each piece of evidence is scored
        for/against your hypothesis, and the aggregate gives you a
        confidence tier — Supported / Mixed / Weak / Refuted.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <label className="muted small-note">Hypothesis:</label>
        <select
          className="share-input"
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ flex: 1, maxWidth: 320 }}
        >
          {HYPOTHESIS_TYPES.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
        </select>
        <button className="btn" onClick={loadExample}>Example</button>
        <button className="btn" onClick={() => setEvidence('')} disabled={!evidence}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder={"Evidence piece 1...\n---\nEvidence piece 2...\n---\nEvidence piece 3..."}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        rows={8}
        style={{ marginTop: 10 }}
      />

      {report && !report.error && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${report.verdict.color}14`,
              borderLeft: `3px solid ${report.verdict.color}`,
            }}
          >
            <span>
              <strong>{report.supported}/{report.totalEvidence}</strong> supports ·{' '}
              <strong>{Math.round(report.confidence * 100)}%</strong> confidence
            </span>
            <strong style={{ color: report.verdict.color }}>{report.verdict.label}</strong>
          </div>

          <div style={{ marginTop: 10 }}>
            {report.rows.map((r) => (
              <div
                key={r.idx}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  borderLeft: `3px solid ${r.matches ? '#5ee69a' : '#94a3b8'}`,
                  background: r.matches ? 'rgba(94,230,154,0.05)' : 'rgba(255,255,255,0.02)',
                  marginTop: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong style={{ color: r.matches ? '#5ee69a' : '#94a3b8' }}>
                    {r.matches ? '✓ supports' : '– against'}
                  </strong>
                  <span className="muted small-note">
                    pressure {Math.round(r.pressure * 100)}%
                  </span>
                </div>
                <p className="muted" style={{ margin: 0, fontStyle: 'italic' }}>
                  "{r.text.slice(0, 200)}{r.text.length > 200 ? '…' : ''}"
                </p>
                {r.templates?.length > 0 && (
                  <div className="muted small-note" style={{ marginTop: 4 }}>
                    templates: {r.templates.map((t) => t.label).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {report?.error && <p className="muted" style={{ color: '#dd6974' }}>{report.error}</p>}
    </section>
  );
}
