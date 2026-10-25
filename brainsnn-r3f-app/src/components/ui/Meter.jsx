import React from 'react';
import { clampScore } from '../../lib/formatters.js';

export function Meter({ label, value, explanation, color = 'cyan' }) {
  const score = clampScore(value);
  return (
    <div className={`bsn-meter bsn-meter-${color}`}>
      <div className="bsn-meter-head">
        <span>{label}</span>
        <strong>{score}</strong>
      </div>
      <div className="bsn-meter-track" aria-hidden="true">
        <span style={{ width: `${score}%` }} />
      </div>
      <p>{explanation}</p>
    </div>
  );
}
