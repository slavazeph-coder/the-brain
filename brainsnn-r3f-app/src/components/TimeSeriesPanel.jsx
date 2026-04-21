import React, { useMemo, useState } from 'react';
import {
  analyzeTimeSeries, buildTimelinePayload, timelineUrl, TIMESERIES_EXAMPLE, trendLabel,
} from '../utils/timeSeries';

/**
 * Layer 43 — Time-Series Autopsy panel.
 * Bulk paste dated messages, see manipulation trend + escalation points,
 * share a /t/<hash> card.
 */
export default function TimeSeriesPanel() {
  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(() => raw.trim() ? analyzeTimeSeries(raw) : null, [raw]);
  const tone = analysis ? trendLabel(analysis.slope) : null;

  async function handleShare() {
    if (!analysis) return;
    const payload = buildTimelinePayload({ title, analysis });
    const url = timelineUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy timeline URL:', url);
    }
  }

  function handleTweet() {
    if (!analysis) return;
    const payload = buildTimelinePayload({ title, analysis });
    const url = timelineUrl(window.location.origin, payload);
    const tweet = `Ran ${analysis.points.length} messages over time through BrainSNN — trend: ${tone.label} (peak ${Math.round(analysis.peak.pressure * 100)}%). ${url}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, '_blank', 'noopener');
  }

  return (
    <section className="panel panel-pad timeseries-panel">
      <div className="eyebrow">Layer 43 · time-series autopsy</div>
      <h2>Manipulation over time</h2>
      <p className="muted">
        Paste a chronological stream of messages — one per line, each starting
        with a date. See whether the manipulation pressure is rising, stable,
        or easing up, and where it spiked.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          className="share-input"
          placeholder="Title (optional) — e.g. 'boss emails Q3–Q4'"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 48))}
          maxLength={48}
          style={{ flex: 1 }}
        />
      </div>

      <textarea
        className="firewall-input"
        placeholder={`2024-06-01: Heads up, the Q2 planning doc is ready.\n2024-08-14: The numbers need attention before the next review.\n...`}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
      />

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setRaw(TIMESERIES_EXAMPLE)}>Try example</button>
        <button className="btn" onClick={() => setRaw('')} disabled={!raw}>Clear</button>
        {analysis && (
          <>
            <button className="btn primary" onClick={handleShare}>
              {copied ? 'Link copied ✓' : 'Share timeline'}
            </button>
            <button className="btn" onClick={handleTweet}>Tweet</button>
          </>
        )}
      </div>

      {analysis && tone && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${tone.color}14`,
              borderLeft: `3px solid ${tone.color}`,
              marginBottom: 10,
            }}
          >
            <span>
              <strong>{analysis.points.length}</strong> points · mean{' '}
              <strong>{Math.round(analysis.meanPressure * 100)}%</strong> · peak{' '}
              <strong>{Math.round(analysis.peak.pressure * 100)}%</strong> on{' '}
              <strong>{analysis.peak.date}</strong>
            </span>
            <strong style={{ color: tone.color }}>
              {tone.label} · {analysis.slope > 0 ? '+' : ''}
              {(analysis.slope * 100).toFixed(2)} pts / msg
            </strong>
          </div>

          <Sparkline points={analysis.points} />

          {analysis.escalations.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow">Escalation points</div>
              {analysis.escalations.map((e) => (
                <div
                  key={e.idx}
                  style={{
                    padding: '8px 12px',
                    borderLeft: '3px solid #dd6974',
                    background: 'rgba(221,105,116,0.06)',
                    borderRadius: 6,
                    marginTop: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{e.point.date}</strong>
                    <span style={{ color: '#dd6974' }}>
                      +{Math.round(e.delta * 100)} pts spike
                    </span>
                  </div>
                  <p className="muted" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>
                    "{e.point.text.slice(0, 160)}"
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Sparkline({ points }) {
  if (!points?.length) return null;
  const W = 520;
  const H = 80;
  const xs = points.map((_, i) => (i / Math.max(1, points.length - 1)) * W);
  const ys = points.map((p) => H - p.pressure * H);
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      <path d={d} stroke="#5ad4ff" strokeWidth={1.6} fill="none" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xs[i]}
          cy={ys[i]}
          r={p.pressure > 0.55 ? 3.2 : 2}
          fill={p.pressure > 0.55 ? '#dd6974' : '#5ad4ff'}
        />
      ))}
    </svg>
  );
}
