import React, { useState } from 'react';
import { scoreContent, scoreContentSmart, SCORE_FIELDS } from '../utils/cognitiveFirewall';
import { isGemmaConfigured } from '../utils/gemmaEngine';

function ScoreRow({ label, desc, value, color }) {
  return (
    <div className="firewall-score-row">
      <div className="firewall-score-head">
        <span>{label}</span>
        <strong style={{ color }}>{(value * 100).toFixed(0)}%</strong>
      </div>
      <p className="muted">{desc}</p>
      <div className="weight-bar">
        <span style={{ width: `${value * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export default function CognitiveFirewallPanel({ onApplyToNetwork }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const gemmaAvailable = isGemmaConfigured();

  const handleScan = async () => {
    setScanning(true);
    try {
      const score = await scoreContentSmart(text);
      setResult(score);
    } catch (_) {
      setResult(scoreContent(text));
    } finally {
      setScanning(false);
    }
  };

  const handleApply = () => {
    if (result && onApplyToNetwork) onApplyToNetwork(result);
  };

  const overall = result
    ? ((result.emotionalActivation + result.cognitiveSuppression + result.manipulationPressure) / 3)
    : null;

  const riskColor = !overall ? '#4fa8b3' : overall > 0.65 ? '#dd6974' : overall > 0.35 ? '#fdab43' : '#6daa45';

  return (
    <section className="panel panel-pad cognitive-firewall-panel">
      <div className="eyebrow">TRIBE V2</div>
      <h2>Cognitive Firewall</h2>
      <p className="muted">
        Paste any content below. The engine scores likely manipulation signatures —
        not literal mind reading, but pattern-based cognitive risk indicators.
      </p>

      <textarea
        className="firewall-input"
        placeholder="Paste a headline, article snippet, ad copy, social post..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
      />

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={handleScan} disabled={text.trim().length < 5 || scanning}>
          {scanning ? 'Scanning...' : gemmaAvailable ? 'Scan with Gemma 4' : 'Scan content'}
        </button>
        {result && (
          <button className="btn" onClick={handleApply}>
            Apply to brain
          </button>
        )}
      </div>

      {result && (
        <div className="firewall-result">
          <div className="firewall-overall" style={{ '--risk': riskColor }}>
            <span>Overall risk</span>
            <strong>{(overall * 100).toFixed(0)}%</strong>
          </div>

          <div className="firewall-scores">
            {SCORE_FIELDS.map((f) => (
              <ScoreRow key={f.key} {...f} value={result[f.key]} />
            ))}
          </div>

          <div className="firewall-action">
            <span className="eyebrow">Recommended action</span>
            <p>{result.recommendedAction}</p>
          </div>

          {result.evidence.length > 0 && (
            <div className="firewall-evidence">
              <span className="eyebrow">Evidence traces</span>
              <div className="firewall-chips">
                {result.evidence.map((e, i) => (
                  <span key={i} className="firewall-chip">{e}</span>
                ))}
              </div>
            </div>
          )}

          {result.reasoning && (
            <div className="gemma-reasoning">
              <span className="eyebrow">AI reasoning</span>
              <p>{result.reasoning}</p>
            </div>
          )}

          <div className="firewall-confidence">
            Confidence: <strong>{result.confidence}</strong>
            {result.source === 'gemma4' && <span className="gemma-source-badge">Gemma 4</span>}
            {result.source === 'regex_fallback' && <span className="gemma-source-badge fallback">Regex fallback</span>}
          </div>
        </div>
      )}
    </section>
  );
}
