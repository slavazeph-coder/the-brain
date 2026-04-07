import React, { useMemo, useState } from 'react';
import { mapTRIBEToRegions, scoreContent } from '../utils/tribe';

const SCORE_FIELDS = [
  { key: 'emotionalActivation', label: 'Emotional activation', desc: 'Fear / outrage / panic optimization', color: '#dd6974' },
  { key: 'cognitiveSuppression', label: 'Cognitive suppression', desc: 'Urgency / certainty theater / overload', color: '#fdab43' },
  { key: 'manipulationPressure', label: 'Manipulation pressure', desc: 'Steering reaction over understanding', color: '#a86fdf' },
  { key: 'trustErosion', label: 'Trust erosion risk', desc: 'Sensationalism / coercive framing', color: '#5591c7' },
];

function ScoreRow({ label, desc, value, color }) {
  return (
    <div className="tribe-score-row">
      <div className="tribe-score-head">
        <span>{label}</span>
        <strong style={{ color }}>{(value * 100).toFixed(0)}%</strong>
      </div>
      <p className="muted">{desc}</p>
      <div className="weight-bar"><span style={{ width: `${value * 100}%`, background: color }} /></div>
    </div>
  );
}

export default function TRIBEPanel({ state, onApplyState }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const overall = useMemo(() => {
    if (!result) return null;
    return (result.emotionalActivation + result.cognitiveSuppression + result.manipulationPressure) / 3;
  }, [result]);

  const riskColor = !overall ? '#4fa8b3' : overall > 0.65 ? '#dd6974' : overall > 0.35 ? '#fdab43' : '#6daa45';

  const handleScan = () => {
    setResult(scoreContent(text));
  };

  const handleApply = () => {
    if (!result || !onApplyState || !state) return;
    onApplyState((previous) => mapTRIBEToRegions(previous, result));
  };

  return (
    <section className="panel panel-pad tribe-panel">
      <div className="eyebrow">TRIBE V2</div>
      <h2>Cognitive Firewall</h2>
      <p className="muted">
        Paste a headline, article snippet, ad, or social post. The engine scores likely manipulation signatures — not literal mind reading, but pattern-based cognitive risk indicators.
      </p>

      <textarea
        className="tribe-input"
        placeholder="Paste a headline, article snippet, ad copy, social post…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
      />

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={handleScan} disabled={text.trim().length < 5}>Scan content</button>
        {result ? <button className="btn" onClick={handleApply}>Apply to brain</button> : null}
      </div>

      {result ? (
        <div className="tribe-result">
          <div className="tribe-overall" style={{ '--risk': riskColor }}>
            <span>Overall risk</span>
            <strong>{(overall * 100).toFixed(0)}%</strong>
          </div>

          <div className="tribe-scores">
            {SCORE_FIELDS.map((field) => (
              <ScoreRow key={field.key} {...field} value={result[field.key]} />
            ))}
          </div>

          <div className="tribe-action">
            <span className="eyebrow">Recommended action</span>
            <p>{result.recommendedAction}</p>
          </div>

          {result.evidence.length ? (
            <div className="tribe-evidence">
              <span className="eyebrow">Evidence traces</span>
              <div className="tribe-chips">
                {result.evidence.map((evidence, index) => (
                  <span key={`${evidence}-${index}`} className="tribe-chip">{evidence}</span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="tribe-confidence">Confidence: <strong>{result.confidence}</strong></div>
        </div>
      ) : null}
    </section>
  );
}
