import React from 'react';
import { Meter } from '../../components/ui/Meter.jsx';
import { getBusinessMetrics } from '../../lib/scoreMapping.js';

export function DecisionScorecard({ result }) {
  const metrics = getBusinessMetrics(result);
  return (
    <section className="decision-scorecard" aria-labelledby="decision-scorecard-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Business signals</p>
          <h2 id="decision-scorecard-heading">What the audience is likely to feel</h2>
        </div>
      </div>
      <div className="scorecard-grid">
        {metrics.map((metric) => <Meter key={metric.id} {...metric} />)}
      </div>
    </section>
  );
}
