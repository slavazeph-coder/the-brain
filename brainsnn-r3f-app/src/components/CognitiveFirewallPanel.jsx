import React, { useEffect, useState } from 'react';
import { scoreContent, scoreContentSmart, SCORE_FIELDS } from '../utils/cognitiveFirewall';
import { isGemmaConfigured } from '../utils/gemmaEngine';
import { buildReactionPayload, reactionUrl, AFFECT_LABELS } from '../utils/reactionCard';

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

export default function CognitiveFirewallPanel({ onApplyToNetwork, initialScan = null }) {
  const [text, setText] = useState(initialScan?.text || '');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(initialScan?.result || null);
  const [scanning, setScanning] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const gemmaAvailable = isGemmaConfigured();

  // Auto-apply pre-seeded scans (used by demo tiles + /r/<hash> rehydration)
  useEffect(() => {
    if (initialScan?.autoApply && initialScan?.result && onApplyToNetwork) {
      onApplyToNetwork(initialScan.result);
    }
  }, [initialScan?.autoApply]);

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

  const handleFetchUrl = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setFetchError('');
    try {
      const resp = await fetch(`/api/fetch-url?u=${encodeURIComponent(url.trim())}`);
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setFetchError(data.error || `HTTP ${resp.status}`);
        return;
      }
      setText(data.text || '');
      setResult(null);
    } catch (err) {
      setFetchError(err.message || 'fetch failed');
    } finally {
      setFetching(false);
    }
  };

  const handleApply = () => {
    if (result && onApplyToNetwork) onApplyToNetwork(result);
  };

  const handleShare = async () => {
    if (!result) return;
    const payload = buildReactionPayload(text, result);
    const url = reactionUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      window.prompt('Copy this reaction URL:', url);
    }
  };

  const handleTweet = () => {
    if (!result) return;
    const payload = buildReactionPayload(text, result);
    const reaction = reactionUrl(window.location.origin, payload);
    const affect = AFFECT_LABELS[payload.a]?.label || 'signal';
    const pct = Math.round(((payload.e + payload.c + payload.m) / 3) * 100);
    const tweet = `BrainSNN reading: ${pct}% pressure · ${affect}. What's it read in your feed? ${reaction}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`,
      '_blank',
      'noopener'
    );
  };

  const overall = result
    ? (result.emotionalActivation + result.cognitiveSuppression + result.manipulationPressure) / 3
    : null;

  const riskColor = !overall ? '#4fa8b3' : overall > 0.65 ? '#dd6974' : overall > 0.35 ? '#fdab43' : '#6daa45';

  return (
    <section className="panel panel-pad cognitive-firewall-panel">
      <div className="eyebrow">TRIBE V2</div>
      <h2>Cognitive Firewall</h2>
      <p className="muted">
        Paste any content — or drop a URL — and the engine scores likely manipulation signatures.
        Share the reaction back with anyone.
      </p>

      <div className="firewall-url-row" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="url"
          className="share-input"
          placeholder="Paste a tweet / article URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFetchUrl();
          }}
          style={{ flex: 1 }}
        />
        <button
          className="btn-sm"
          onClick={handleFetchUrl}
          disabled={fetching || !url.trim()}
        >
          {fetching ? 'Fetching…' : 'Fetch text'}
        </button>
      </div>
      {fetchError && (
        <p className="muted" style={{ color: '#dd6974', marginTop: 0 }}>
          Fetch failed: {fetchError}. Paste the text manually instead.
        </p>
      )}

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
        {result && (
          <button className="btn" onClick={handleShare}>
            {shareCopied ? 'Link copied ✓' : 'Share this reaction'}
          </button>
        )}
        {result && (
          <button className="btn" onClick={handleTweet}>
            Tweet this
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
