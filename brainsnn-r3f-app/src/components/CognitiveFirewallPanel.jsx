import React, { useEffect, useMemo, useState } from 'react';
import { scoreContent, scoreContentSmart, SCORE_FIELDS } from '../utils/cognitiveFirewall';
import { isGemmaConfigured } from '../utils/gemmaEngine';
import { buildReactionPayload, reactionUrl, AFFECT_LABELS } from '../utils/reactionCard';
import { scoreSentences, pressureBand, heatmapSummary } from '../utils/heatmap';
import { refutationsFor } from '../utils/refutations';
import {
  counterDraft,
  buildCounterDraftPayload,
  counterDraftUrl,
} from '../utils/counterDraft';

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
  const [draft, setDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const [openRefutation, setOpenRefutation] = useState(null);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const gemmaAvailable = isGemmaConfigured();

  // Layer 40 — sentence heatmap (computed lazily when user opens it)
  const heatmap = useMemo(() => {
    if (!heatmapOpen || !text.trim()) return null;
    return scoreSentences(text);
  }, [heatmapOpen, text]);
  const heatmapStats = useMemo(() => heatmap ? heatmapSummary(heatmap) : null, [heatmap]);

  // Layer 41 — refutations for detected templates
  const refutations = useMemo(
    () => (result?.templates?.length ? refutationsFor(result.templates) : []),
    [result?.templates],
  );

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

  // Layer 42 — counter-draft
  const handleNeutralize = async () => {
    if (!text.trim() || drafting) return;
    setDrafting(true);
    setDraft(null);
    try {
      const r = await counterDraft(text);
      setDraft(r);
    } finally {
      setDrafting(false);
    }
  };

  const handleCopyDraft = async () => {
    if (!draft?.after) return;
    try {
      await navigator.clipboard.writeText(draft.after);
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 2500);
    } catch {
      window.prompt('Copy neutralized text:', draft.after);
    }
  };

  const handleShareDraft = async () => {
    if (!draft?.ok) return;
    const payload = buildCounterDraftPayload(draft);
    const url = counterDraftUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 2500);
    } catch {
      window.prompt('Copy counter-draft URL:', url);
    }
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

          {result.templates?.length > 0 && (
            <div className="firewall-templates">
              <span className="eyebrow">Propaganda templates · Layer 39</span>
              <div className="firewall-chips" style={{ marginTop: 6 }}>
                {result.templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    className="firewall-chip"
                    onClick={() => setOpenRefutation(openRefutation === tpl.id ? null : tpl.id)}
                    title={`${tpl.desc} — click for the counter-response`}
                    style={{
                      background: openRefutation === tpl.id ? 'rgba(168,111,223,0.28)' : 'rgba(168,111,223,0.12)',
                      borderColor: '#a86fdf',
                      color: '#e2d3ff',
                      cursor: 'pointer',
                    }}
                  >
                    {tpl.label} · {tpl.hits}×
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layer 41 — Refutation for the open template */}
          {openRefutation && refutations.length > 0 && (() => {
            const match = refutations.find((r) => r.id === openRefutation);
            if (!match) return null;
            return (
              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  borderLeft: '3px solid #a86fdf',
                  background: 'rgba(168,111,223,0.08)',
                  borderRadius: 6,
                }}
              >
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Counter-response · {match.label}
                </div>
                <p style={{ margin: '6px 0', fontWeight: 600 }}>{match.refutation.core}</p>
                <blockquote
                  style={{
                    margin: '8px 0',
                    padding: '6px 10px',
                    fontStyle: 'italic',
                    borderLeft: '2px solid rgba(255,255,255,0.1)',
                    background: 'rgba(0,0,0,0.12)',
                    borderRadius: 4,
                  }}
                >
                  "{match.refutation.script}"
                </blockquote>
                <p className="muted small-note" style={{ margin: 0 }}>
                  {match.refutation.stance}
                </p>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(match.refutation.script).catch(() => {});
                    }}
                  >
                    Copy response
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Layer 40 — Heatmap toggle + rendering */}
          <div style={{ marginTop: 12 }}>
            <button className="btn-sm" onClick={() => setHeatmapOpen(!heatmapOpen)}>
              {heatmapOpen ? 'Hide sentence heatmap' : 'Show sentence heatmap'}
            </button>
          </div>
          {heatmapOpen && heatmap && (
            <div style={{ marginTop: 10 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Sentence heatmap · Layer 40
              </div>
              {heatmapStats && (
                <p className="muted small-note" style={{ marginTop: 0 }}>
                  {heatmapStats.count} sentence{heatmapStats.count === 1 ? '' : 's'} ·{' '}
                  mean {Math.round(heatmapStats.mean * 100)}% · peak {Math.round(heatmapStats.peak * 100)}% ·{' '}
                  {heatmapStats.high} high-pressure
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {heatmap.map((row) => {
                  const band = pressureBand(row.pressure);
                  return (
                    <div
                      key={row.idx}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        borderLeft: `3px solid ${band.border}`,
                        background: band.bg,
                        lineHeight: 1.4,
                      }}
                      title={`${Math.round(row.pressure * 100)}% pressure · ${band.label}`}
                    >
                      <span>{row.text}</span>
                      <span className="muted small-note" style={{ marginLeft: 8 }}>
                        {Math.round(row.pressure * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Layer 42 — Counter-Draft */}
          <div style={{ marginTop: 14 }}>
            <div className="eyebrow">Counter-draft · Layer 42</div>
            <p className="muted small-note" style={{ marginTop: 2 }}>
              Rewrite the same information without manipulation signatures.
              Uses Gemma when configured, falls back to local substitution.
            </p>
            <div className="control-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={handleNeutralize} disabled={drafting || text.trim().length < 5}>
                {drafting ? 'Neutralizing…' : draft ? 'Re-run neutralize' : 'Neutralize this'}
              </button>
              {draft?.ok && (
                <>
                  <button className="btn" onClick={handleCopyDraft}>
                    {draftCopied ? 'Copied ✓' : 'Copy neutral text'}
                  </button>
                  <button className="btn" onClick={handleShareDraft}>
                    Share before/after
                  </button>
                </>
              )}
            </div>
            {draft?.ok && (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderLeft: '3px solid #5ee69a',
                  background: 'rgba(94,230,154,0.05)',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="muted small-note">
                    engine: <strong>{draft.engine}</strong> · pressure{' '}
                    <strong>{Math.round(draft.beforePressure * 100)}%</strong> →{' '}
                    <strong style={{ color: '#5ee69a' }}>{Math.round(draft.afterPressure * 100)}%</strong>
                  </span>
                  <span className="muted small-note">
                    −{Math.round(draft.reduction * 100)} pts
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>"{draft.after}"</p>
              </div>
            )}
          </div>

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
