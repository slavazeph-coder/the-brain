import React, { useMemo, useState } from 'react';
import { analyzeDebate, DEBATE_EXAMPLE } from '../utils/debate';

/**
 * Layer 64 — Debate Mode panel.
 * Two-speaker momentum graph + cumulative averages + winner.
 */
export default function DebatePanel() {
  const [raw, setRaw] = useState('');
  const report = useMemo(() => (raw.trim() ? analyzeDebate(raw) : null), [raw]);

  return (
    <section className="panel panel-pad debate-panel">
      <div className="eyebrow">Layer 64 · debate mode</div>
      <h2>Two-speaker momentum</h2>
      <p className="muted">
        Paste a back-and-forth conversation with speaker labels
        (<code>Alex:</code>, <code>Morgan:</code>, etc.). See per-turn pressure,
        a cumulative running average per speaker, and the "manipulation race"
        winner — lowest average pressure wins.
      </p>

      <div className="control-actions" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => setRaw(DEBATE_EXAMPLE)}>Try example</button>
        <button className="btn" onClick={() => setRaw('')} disabled={!raw}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder={`Alex: The project is behind...\nMorgan: Absolutely unbelievable...\n...`}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
      />

      {report && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <SpeakerCard name={report.aName} mean={report.meanA} count={report.countA} winner={report.winner === report.aName} />
            <SpeakerCard name={report.bName} mean={report.meanB} count={report.countB} winner={report.winner === report.bName} />
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">Running averages</div>
            <CumulativeGraph report={report} />
          </div>

          {report.peak && (
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow">Peak-pressure turn</div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  borderLeft: '3px solid #dd6974',
                  background: 'rgba(221,105,116,0.06)',
                }}
              >
                <strong>{report.peak.speaker}</strong>{' '}
                <span style={{ color: '#dd6974' }}>{Math.round(report.peak.pressure * 100)}%</span>
                <p className="muted" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>
                  "{report.peak.text.slice(0, 200)}"
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SpeakerCard({ name, mean, count, winner }) {
  const tone = mean >= 0.55 ? '#dd6974' : mean >= 0.25 ? '#fdab43' : '#6daa45';
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        borderLeft: `3px solid ${winner ? '#5ee69a' : tone}`,
        background: winner ? 'rgba(94,230,154,0.08)' : 'rgba(255,255,255,0.03)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{name}</strong>
        <span style={{ color: tone, fontWeight: 700, fontFamily: 'monospace' }}>
          {Math.round(mean * 100)}%
        </span>
      </div>
      <div className="muted small-note" style={{ marginTop: 4 }}>
        {count} turn{count === 1 ? '' : 's'} · avg pressure{winner ? ' · CLEANER 👑' : ''}
      </div>
    </div>
  );
}

function CumulativeGraph({ report }) {
  const W = 520;
  const H = 110;
  const n = report.cumulative.length;
  if (!n) return null;
  const xs = report.cumulative.map((_, i) => (i / Math.max(1, n - 1)) * W);
  const yA = report.cumulative.map((c) => H - c.avgA * H);
  const yB = report.cumulative.map((c) => H - c.avgB * H);
  const dA = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yA[i].toFixed(1)}`).join(' ');
  const dB = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yB[i].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      <path d={dA} stroke="#77dbe4" strokeWidth={2} fill="none" />
      <path d={dB} stroke="#fdab43" strokeWidth={2} fill="none" />
      <text x={8} y={14} fill="#77dbe4" fontSize={12} fontFamily="monospace">{report.aName}</text>
      <text x={8} y={H - 6} fill="#fdab43" fontSize={12} fontFamily="monospace">{report.bName}</text>
    </svg>
  );
}
