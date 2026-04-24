import React, { useEffect, useState } from 'react';
import { calibrationReport, listFeedback, clearFeedback } from '../utils/feedback';

export default function FeedbackPanel() {
  const [report, setReport] = useState(() => calibrationReport());
  const [rows, setRows] = useState(() => listFeedback());

  useEffect(() => {
    const id = setInterval(() => {
      setReport(calibrationReport());
      setRows(listFeedback());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  function wipe() {
    if (!window.confirm('Clear all calibration feedback?')) return;
    clearFeedback();
    setReport(calibrationReport());
    setRows(listFeedback());
  }

  const tone = report.suggestedMul > 1.05 ? '#fdab43' : report.suggestedMul < 0.95 ? '#77dbe4' : '#5ee69a';

  return (
    <section className="panel panel-pad feedback-panel">
      <div className="eyebrow">Layer 93 · feedback calibration</div>
      <h2>Tell the Firewall how it\'s doing</h2>
      <p className="muted">
        When you scan content in the Firewall panel, tag the result as
        <em> too cold / accurate / too hot</em>. BrainSNN tracks the bias
        over time and offers a per-user calibration multiplier — shown
        inline on every scan as "calibrated: X%".
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
        <Tile label="Total scans rated" value={report.total} />
        <Tile label="Accuracy" value={report.total ? `${Math.round(report.accuracy * 100)}%` : '—'} />
        <Tile label="Bias" value={report.total ? (report.bias > 0.05 ? 'runs hot' : report.bias < -0.05 ? 'runs cold' : 'neutral') : '—'} />
        <Tile label="Suggested ×" value={`${report.suggestedMul.toFixed(2)}`} tone={tone} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 13, color: '#cbd5e1' }}>
        <span><strong style={{ color: '#77dbe4' }}>too cold</strong> {report.tooCold}</span>
        <span><strong style={{ color: '#5ee69a' }}>accurate</strong> {report.accurate}</span>
        <span><strong style={{ color: '#dd6974' }}>too hot</strong> {report.tooHot}</span>
        <button className="ghost small" onClick={wipe} style={{ marginLeft: 'auto', color: '#dd6974' }}>Clear</button>
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Recent ratings</div>
          {rows.slice(-10).reverse().map((r, i) => {
            const color = r.verdict === 'too_hot' ? '#dd6974' : r.verdict === 'too_cold' ? '#77dbe4' : '#5ee69a';
            return (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '100px 70px 1fr 130px',
                  gap: 8,
                  alignItems: 'center',
                  padding: '4px 10px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 4,
                  marginTop: 4,
                  fontSize: 12,
                }}
              >
                <strong style={{ color }}>{r.verdict.replace('_', ' ')}</strong>
                <span className="muted small-note">{Math.round(r.pressure * 100)}%</span>
                <span className="muted" style={{ fontStyle: 'italic' }}>{r.excerpt || '(no excerpt)'}</span>
                <span className="muted small-note">{new Date(r.ts).toISOString().slice(11, 16)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
      <div className="muted small-note">{label}</div>
      <strong style={{ fontSize: 22, color: tone || '#f1ece5' }}>{value}</strong>
    </div>
  );
}
