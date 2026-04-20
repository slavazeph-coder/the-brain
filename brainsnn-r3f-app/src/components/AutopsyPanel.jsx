import React, { useEffect, useMemo, useState } from 'react';
import { runAutopsy, summarizeAutopsy, AUTOPSY_EXAMPLE } from '../utils/autopsy';
import {
  buildAutopsyPayload, autopsyUrl, autopsyLevelFor, decodeAutopsy
} from '../utils/autopsyCard';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';

/**
 * Layer 36 — Autopsy Mode
 *
 * Paste any transcript. Get a per-speaker cognitive profile. Share
 * the result as an OG card (/a/<hash>).
 */
export default function AutopsyPanel({ initialHash = null }) {
  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchUrl, setFetchUrl] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [copied, setCopied] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [incoming] = useState(() => initialHash ? decodeAutopsy(initialHash) : null);

  const autopsy = useMemo(() => raw.trim() ? runAutopsy(raw) : null, [raw]);
  const summary = useMemo(() => autopsy ? summarizeAutopsy(autopsy) : null, [autopsy]);
  const level = summary ? autopsyLevelFor(summary.pressure) : null;

  // One-shot immunity bump per distinct run
  useEffect(() => {
    if (!recorded && autopsy && autopsy.meta.turnCount >= 3) {
      setRecorded(true);
      try {
        recordImmunity(IMMUNITY_EVENTS.CONVERSATION_ANALYZED, {
          pressureAvg: autopsy.meta.overallPressure,
          turns: autopsy.meta.turnCount,
        });
      } catch { /* swallow */ }
    }
  }, [autopsy, recorded]);

  async function handleFetch() {
    if (!fetchUrl.trim()) return;
    setFetching(true);
    setFetchError('');
    try {
      const r = await fetch(`/api/fetch-url?u=${encodeURIComponent(fetchUrl.trim())}`);
      const data = await r.json();
      if (!r.ok || data.error) {
        setFetchError(data.error || `HTTP ${r.status}`);
        return;
      }
      setRaw(data.text || '');
      if (data.title && !title) setTitle(data.title);
    } catch (err) {
      setFetchError(err.message || 'fetch failed');
    } finally {
      setFetching(false);
    }
  }

  async function handleShare() {
    if (!summary) return;
    const payload = buildAutopsyPayload({ title, summary });
    const url = autopsyUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this autopsy URL:', url);
    }
  }

  function handleTweet() {
    if (!summary) return;
    const payload = buildAutopsyPayload({ title, summary });
    const url = autopsyUrl(window.location.origin, payload);
    const top = summary.speakers[0];
    const leadLabel = top ? `${top.n || top.name} led at ${Math.round((top.p || top.avgPressure) * 100)}% pressure` : 'autopsy ready';
    const tweet = `Just ran a chat autopsy — ${leadLabel}. ${summary.turns} turns, ${summary.speakers.length} speakers. Scan yours: ${url}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`,
      '_blank',
      'noopener'
    );
  }

  return (
    <section className="panel panel-pad autopsy-panel">
      <div className="eyebrow">Layer 36 · autopsy mode</div>
      <h2>Chat Autopsy</h2>
      <p className="muted">
        Paste any transcript, group chat export, interview, or political speech.
        The Firewall scores every message; you get a per-speaker profile and a
        shareable card showing who installed which feelings in whom.
      </p>

      {incoming && incoming.speakers?.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderLeft: '3px solid #5ad4ff',
            background: 'rgba(90,212,255,0.05)',
            borderRadius: 6,
          }}
        >
          <strong>{incoming.title}</strong> — {incoming.turns} turns · overall{' '}
          <strong style={{ color: autopsyLevelFor(incoming.pressure).color }}>
            {Math.round(incoming.pressure * 100)}%
          </strong>. Lead speaker:{' '}
          <strong>{incoming.speakers[0].name}</strong> ({Math.round(incoming.speakers[0].avgPressure * 100)}%,{' '}
          {incoming.speakers[0].dominantAffect}). <span className="muted">Paste your own below.</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          className="share-input"
          placeholder="Autopsy title (optional, e.g. 'debate night', 'slack drama')"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 48))}
          maxLength={48}
          style={{ flex: 1 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="url"
          className="share-input"
          placeholder="Paste URL (article / transcript / tweet thread)…"
          value={fetchUrl}
          onChange={(e) => setFetchUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFetch(); }}
          style={{ flex: 1 }}
        />
        <button className="btn-sm" onClick={handleFetch} disabled={fetching || !fetchUrl.trim()}>
          {fetching ? 'Fetching…' : 'Fetch'}
        </button>
      </div>
      {fetchError && (
        <p className="muted" style={{ color: '#dd6974', marginTop: 0 }}>
          Fetch failed: {fetchError}.
        </p>
      )}

      <textarea
        className="firewall-input"
        placeholder={`Alex: I'm worried about the deadline.\nMorgan: Absolutely not. Everyone knows the deadline is final...`}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
      />

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setRaw(AUTOPSY_EXAMPLE)}>Try an example</button>
        <button className="btn" onClick={() => setRaw('')} disabled={!raw}>Clear</button>
        {summary && (
          <>
            <button className="btn primary" onClick={handleShare}>
              {copied ? 'Link copied ✓' : 'Share autopsy'}
            </button>
            <button className="btn" onClick={handleTweet}>Tweet result</button>
          </>
        )}
      </div>

      {summary && level && (
        <div className="autopsy-result" style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${level.color}14`,
              borderLeft: `3px solid ${level.color}`,
              marginBottom: 12,
            }}
          >
            <span>
              <strong>{summary.turns}</strong> turns · <strong>{summary.speakers.length}</strong> speakers · overall pressure{' '}
            </span>
            <strong style={{ color: level.color }}>
              {Math.round(summary.pressure * 100)}% · {level.label}
            </strong>
          </div>

          <div className="eyebrow">Per-speaker</div>
          {autopsy.speakers.map((s) => {
            const lvl = autopsyLevelFor(s.avgPressure);
            return (
              <div
                key={s.name}
                style={{
                  padding: '10px 12px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderLeft: `3px solid ${lvl.color}`,
                  borderRadius: 6,
                  marginTop: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong>{s.name}</strong>
                  <span style={{ color: lvl.color, fontWeight: 700 }}>
                    {Math.round(s.avgPressure * 100)}%
                    <span className="muted small-note"> avg · {s.turns} turn{s.turns === 1 ? '' : 's'}</span>
                  </span>
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span className="muted small-note">dominant: <strong>{s.dominantAffect}</strong></span>
                  <span className="muted small-note">peak: {Math.round(s.peakPressure * 100)}%</span>
                </div>
                {s.peakQuote && (
                  <p className="muted" style={{ margin: '6px 0 0', fontStyle: 'italic', fontSize: 13 }}>
                    "{s.peakQuote}"
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
