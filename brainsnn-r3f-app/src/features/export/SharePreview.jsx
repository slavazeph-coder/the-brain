import React from 'react';
import { deriveExecutiveVerdict, getBusinessMetrics } from '../../lib/scoreMapping.js';

export function SharePreview({ result }) {
  const verdict = deriveExecutiveVerdict(result);
  const metricMap = Object.fromEntries(getBusinessMetrics(result).map((metric) => [metric.id, metric.value]));
  return (
    <div className="share-preview-card" id="brainsnn-share-preview">
      <span>BRAIN SCAN</span>
      <div>
        <h3>{verdict.headline}</h3>
        <p>AI-estimated content response</p>
      </div>
      <dl>
        <div><dt>Hook Strength</dt><dd>{metricMap.hookStrength}</dd></div>
        <div><dt>Trust</dt><dd>{metricMap.trust}</dd></div>
        <div><dt>Manipulation Risk</dt><dd>{metricMap.manipulationRisk}</dd></div>
      </dl>
      <strong>brainsnn.com</strong>
    </div>
  );
}
