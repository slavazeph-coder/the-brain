import React from 'react';
import { deriveExecutiveVerdict } from '../../lib/scoreMapping.js';
import { getHeadlineScores } from '../../lib/headlineScores.js';

export function SharePreview({ result }) {
  const verdict = deriveExecutiveVerdict(result);
  return (
    <div className="share-preview-card" id="brainsnn-share-preview">
      <span>BRAIN SCAN</span>
      <div>
        <h3>{verdict.headline}</h3>
        <p>AI-estimated content response</p>
      </div>
      <dl>
        {getHeadlineScores(result).map((metric) => (
          <div key={metric.id}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
        ))}
      </dl>
      <strong>brainsnn.com</strong>
    </div>
  );
}
