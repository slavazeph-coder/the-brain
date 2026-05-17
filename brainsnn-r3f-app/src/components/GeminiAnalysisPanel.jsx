import React, { useEffect, useRef, useState } from 'react';
import {
  isGeminiConfigured,
  analyzeContentWithGemini,
  analyzeMultimodalWithGemini,
  checkGeminiHealth,
  getGeminiModel
} from '../utils/geminiEngine';
import { SCORE_FIELDS } from '../utils/cognitiveFirewall';
import { inspectPrompt } from '../utils/lobsterTrap';

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

export default function GeminiAnalysisPanel({ onApplyToNetwork }) {
  const [status, setStatus] = useState('checking');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trap, setTrap] = useState(null);
  const fileRef = useRef(null);
  const model = getGeminiModel();

  useEffect(() => {
    if (!isGeminiConfigured()) {
      setStatus('unconfigured');
      return;
    }
    let cancelled = false;
    checkGeminiHealth().then((h) => {
      if (!cancelled) setStatus(h.ok ? 'online' : 'offline');
    });
    return () => { cancelled = true; };
  }, []);

  const handleAnalyzeText = async () => {
    setLoading(true);
    setError('');
    setTrap(null);
    try {
      const decision = inspectPrompt({ prompt: text, surface: 'gemini.analyze' });
      setTrap(decision);
      if (decision.action === 'block') {
        throw new Error(`Lobster Trap blocked: ${decision.reasons.join(', ')}`);
      }
      const payload = decision.action === 'redact' ? decision.redacted : text;
      const res = await analyzeContentWithGemini(payload);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeMedia = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await analyzeMultimodalWithGemini(file);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (result && onApplyToNetwork) onApplyToNetwork(result);
  };

  const overall = result
    ? (result.emotionalActivation + result.cognitiveSuppression + result.manipulationPressure) / 3
    : null;
  const riskColor = !overall ? 'var(--accent)' : overall > 0.65 ? 'var(--danger)' : overall > 0.35 ? '#fdab43' : 'var(--ok)';
  const statusColor = status === 'online' ? 'var(--ok)' : status === 'offline' ? 'var(--danger)' : 'var(--muted)';

  return (
    <section className="panel panel-pad gemma-panel">
      <div className="eyebrow gemma-eyebrow">
        <span>GEMINI — Deep Analysis ({model})</span>
        <span className="gemma-status-dot" style={{ background: statusColor }} title={status} />
      </div>
      <h2>Gemini-Powered Manipulation Scanner</h2>
      <p className="muted">
        {status === 'unconfigured'
          ? 'Set VITE_GEMINI_API_KEY (Google AI Studio) to enable Gemini deep analysis. Supports text, images, video, audio. Every prompt is pre-screened by Lobster Trap.'
          : status === 'online'
          ? `${model} online — every prompt is pre-screened by Lobster Trap before it leaves the browser.`
          : status === 'offline'
          ? 'Gemini endpoint unreachable — check VITE_GEMINI_API_KEY.'
          : 'Checking Gemini availability...'}
      </p>

      {status !== 'unconfigured' && (
        <>
          <textarea
            className="firewall-input"
            placeholder="Paste content for Gemini analysis..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
          />

          <div className="gemma-upload-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,audio/*"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <button className="btn" onClick={() => fileRef.current?.click()}>Upload media</button>
            {file && <span className="muted gemma-file-name">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>}
          </div>

          <div className="control-actions" style={{ marginTop: 12 }}>
            <button
              className="btn primary gemma-btn"
              onClick={handleAnalyzeText}
              disabled={loading || text.trim().length < 5 || status !== 'online'}
            >
              {loading ? 'Analysing...' : 'Analyse text'}
            </button>
            <button
              className="btn gemma-btn"
              onClick={handleAnalyzeMedia}
              disabled={loading || !file || status !== 'online'}
            >
              {loading ? 'Analysing...' : 'Analyse media'}
            </button>
            {result && (
              <button className="btn" onClick={handleApply}>Apply to brain</button>
            )}
          </div>

          {trap && trap.action !== 'allow' && (
            <p className="muted" style={{ marginTop: 8 }}>
              Lobster Trap: <strong>{trap.action.toUpperCase()}</strong> — {trap.reasons.join('; ')}
            </p>
          )}

          {error && <p className="gemma-error">{error}</p>}
        </>
      )}

      {result && (
        <div className="firewall-result gemma-result">
          <div className="firewall-overall" style={{ '--risk': riskColor }}>
            <span>Overall risk (Gemini)</span>
            <strong>{(overall * 100).toFixed(0)}%</strong>
          </div>

          <div className="firewall-scores">
            {SCORE_FIELDS.map((f) => (
              <ScoreRow key={f.key} {...f} value={result[f.key]} />
            ))}
          </div>

          {result.reasoning && (
            <div className="gemma-reasoning">
              <span className="eyebrow">Gemini reasoning</span>
              <p>{result.reasoning}</p>
            </div>
          )}

          <div className="firewall-action">
            <span className="eyebrow">Recommended action</span>
            <p>{result.recommendedAction}</p>
          </div>

          {result.evidence?.length > 0 && (
            <div className="firewall-evidence">
              <span className="eyebrow">Evidence traces</span>
              <div className="firewall-chips">
                {result.evidence.map((e, i) => (
                  <span key={i} className="firewall-chip">{e}</span>
                ))}
              </div>
            </div>
          )}

          <div className="firewall-confidence">
            Confidence: <strong>{result.confidence}</strong>
            <span className="gemma-source-badge">{result.source}</span>
          </div>
        </div>
      )}
    </section>
  );
}
