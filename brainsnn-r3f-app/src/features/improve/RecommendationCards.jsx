import React from 'react';

export function RecommendationCards({ result }) {
  const recommendations = Array.isArray(result?.recommendations)
    ? result.recommendations.map((item, index) => typeof item === 'string'
      ? { id: `recommendation-${index + 1}`, goal: 'Recommendation', title: `Recommended change ${index + 1}`, rewriteHint: item }
      : item)
    : [];
  return (
    <section className="recommendation-cards" aria-labelledby="recommendation-cards-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Why this helps</p>
          <h2 id="recommendation-cards-heading">Recommended changes</h2>
        </div>
      </div>
      <div className="recommendation-card-grid">
        {recommendations.slice(0, 3).map((item) => (
          <article key={item.id || item.title}>
            <span>{item.goal || 'Recommendation'}</span>
            <h3>{item.title || 'Recommended change'}</h3>
            <p>{item.rewriteHint || item.rationale || item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
