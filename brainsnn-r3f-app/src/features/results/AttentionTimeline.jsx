import React from 'react';
import { clampScore } from '../../lib/formatters.js';

export function AttentionTimeline({ result }) {
  const curve = Array.isArray(result.attentionCurve) && result.attentionCurve.length
    ? result.attentionCurve
    : [{ label: 'Opening', value: result.viralScore || 50, reason: 'Estimated attention' }];
  return (
    <section className="attention-timeline" aria-labelledby="attention-timeline-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Attention timeline</p>
          <h2 id="attention-timeline-heading">Where attention rises or fades</h2>
        </div>
      </div>
      <div className="timeline-bars" role="list">
        {curve.slice(0, 10).map((point, index) => {
          const value = clampScore(point.value ?? point.level, 50);
          return (
            <div className="timeline-bar" role="listitem" key={`${point.label}-${index}`}>
              <span style={{ height: `${Math.max(12, value)}%` }} aria-hidden="true" />
              <strong>{value}</strong>
              <p>{point.label || (typeof point.second === 'number' ? `${point.second}s` : `Beat ${index + 1}`)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
