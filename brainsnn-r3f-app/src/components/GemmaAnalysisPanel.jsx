import React, { useEffect, useRef, useState } from 'react';
import { isGemmaConfigured, analyzeContentWithGemma, analyzeMultimodalWithGemma, checkGemmaHealth } from '../utils/gemmaEngine';
import { SCORE_FIELDS } from '../utils/cognitiveFirewall';

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

export default function GemmaAnalysisPanel({ onApplyToNetwork }) {
  const [status, setStatus] = useState('checking'); // checking | online | offline | unconfigured
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  // Health check on mount
  useEffect(() => {
    if (!isGemmaConfigured()) {
      setStatus('unconfigured');
      return;
    }
    let cancelled = false;
    checkGemmaHealth().then((h) => {
      if (!cancelled) setStatus(h.ok ? 'online' : 'offline');
    });
    return () => { cancelled = true; };
  }, []);

  const handleAnalyzeText = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await analyzeContentWithGemma(text);
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
      const res = await analyzeMultimodalWithGemma(file);
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

  const riskColor = !overall ? 'var(--primary)' : overall > 0.65 ? '#dd6974' : overall > 0.35 ? '#fdab43' : '#6daa45';
  const statusColor = status === 'online' ? 'var(--ok)' : status === 'offline' ? 'var(--danger)' : 'var(--muted)';

  return (
    <section className="panel panel-pad gemma-panel">
      <div className="eyebrow gemma-eyebrow">
        <span>GEMMA 4 — Deep Analysis</span>
        <span className="gemma-status-dot" style={{ background: statusColor }} title={status} />
      </div>
      <h2>AI-Powered Content Scanner</h2>
      <p className="muted">
        {status === 'unconfigured'
          ? 'Set VITE_GEMMA_API_ENDPOINT and VITE_GEMMA_API_KEY to enable Gemma 4 deep analysis. Supports text, images, video, and audio.'
          : status === 'online'
          ? 'Gemma 4 online — paste text or upload media for AI-driven manipulation analysis beyond regex patterns.'
          : status === 'offline'
          ? 'Gemma 4 endpoint unreachable — check your configuration.'
          : 'Checking Gemma 4 availability...'}
      </p>

      {status !== 'unconfigured' && (
        <>
          {/* Text input */}
          <textarea
            className="firewall-input"
            placeholder="Paste content for deep AI analysis..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
          />

          {/* Multimodal upload */}
          <div className="gemma-upload-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,audio/*"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Upload media
            </button>
            {file && <span className="muted gemma-file-name">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>}
          </div>

          {/* Action buttons */}
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
              <button className="btn" onClick={handleApply}>
                Apply to brain
              </button>
            )}
          </div>

          {error && <p className="gemma-error">{error}</p>}
        </>
      )}

      {result && (
        <div className="firewall-result gemma-result">
          <div className="firewall-overall" style={{ '--risk': riskColor }}>
            <span>Overall risk (Gemma 4)</span>
            <strong>{(overall * 100).toFixed(0)}%</strong>
          </div>

          <div className="firewall-scores">
            {SCORE_FIELDS.map((f) => (
              <ScoreRow key={f.key} {...f} value={result[f.key]} />
            ))}
          </div>

          {result.reasoning && (
            <div className="gemma-reasoning">
              <span className="eyebrow">AI reasoning</span>
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
            <span className="gemma-source-badge">Gemma 4</span>
          </div>
        </div>
      )}
    </section>
  );
}
