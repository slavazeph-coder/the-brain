import React from 'react';

export function EvidencePanel({ result }) {
  const insights = Array.isArray(result.insights)
    ? result.insights.map((item, index) => typeof item === 'string'
      ? { label: ['What works', 'What hurts', 'Best next move'][index] || 'Insight', text: item }
      : item)
    : [];
  const recommendations = Array.isArray(result.recommendations)
    ? result.recommendations.map((item, index) => typeof item === 'string'
      ? { id: `recommendation-${index + 1}`, goal: 'Recommendation', title: `Recommended change ${index + 1}`, rationale: item }
      : item)
    : [];
  return (
    <section className="evidence-panel" aria-labelledby="evidence-panel-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Plain-English readout</p>
          <h2 id="evidence-panel-heading">Why BrainSNN scored it this way</h2>
        </div>
      </div>
      <div className="evidence-grid">
        {(insights.length ? insights : [
          { label: 'What works', text: 'The message has an identifiable promise.' },
          { label: 'What hurts', text: 'The proof and final action can be clearer.' },
          { label: 'Best next move', text: 'Rewrite the most vague sentence first.' },
        ]).slice(0, 3).map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
      <div className="recommendation-list">
        {recommendations.slice(0, 3).map((item) => (
          <article key={item.id || item.title}>
            <span>{item.goal || 'Recommendation'}</span>
            <h3>{item.title || 'Recommended change'}</h3>
            <p>{item.rationale || item.rewriteHint || item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
