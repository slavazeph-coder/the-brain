import React, { useEffect, useState } from 'react';
import {
  computeBadges, BADGE_CATALOG, buildBadgePayload, badgesUrl, sanitizeHandle,
} from '../utils/badges';

const HANDLE_KEY = 'brainsnn_handle_v1';

function readHandle() { try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; } }
function writeHandle(h) { try { localStorage.setItem(HANDLE_KEY, h); } catch { /* noop */ } }

const TIER_COLORS = { bronze: '#b57d3c', silver: '#c5cbd3', gold: '#f6c344' };

/**
 * Layer 56 — Badges panel.
 */
export default function BadgesPanel() {
  const [rollup, setRollup] = useState(() => computeBadges());
  const [handle, setHandle] = useState(readHandle());
  const [copied, setCopied] = useState(false);

  useEffect(() => { writeHandle(handle); }, [handle]);

  function refresh() { setRollup(computeBadges()); }

  async function handleShare() {
    const payload = buildBadgePayload({ handle: sanitizeHandle(handle || 'anon'), rollup });
    const url = badgesUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy your badges URL:', url);
    }
  }

  function handleTweet() {
    const payload = buildBadgePayload({ handle: sanitizeHandle(handle || 'anon'), rollup });
    const url = badgesUrl(window.location.origin, payload);
    const tweet = `My BrainSNN badges: ${rollup.earned.length}/${BADGE_CATALOG.length}. ${url}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, '_blank', 'noopener');
  }

  return (
    <section className="panel panel-pad badges-panel">
      <div className="eyebrow">Layer 56 · badges</div>
      <h2>Progression</h2>
      <p className="muted">
        {rollup.earned.length} of {BADGE_CATALOG.length} earned. Badges are
        computed deterministically from your local state (immunity, streak,
        receipts, custom rules, bypass feed) — they update the instant you
        cross a threshold.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginTop: 12 }}>
        {BADGE_CATALOG.map((b) => {
          const earned = rollup.earned.some((e) => e.id === b.id);
          const progress = rollup.progress[b.id];
          const color = TIER_COLORS[b.tier] || '#888';
          return (
            <div
              key={b.id}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                borderLeft: `3px solid ${earned ? color : 'rgba(255,255,255,0.08)'}`,
                background: earned ? `${color}14` : 'rgba(255,255,255,0.02)',
                opacity: earned ? 1 : 0.55,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: earned ? color : '#e6f1ff' }}>{b.label}</strong>
                <span className="muted small-note" style={{ textTransform: 'uppercase' }}>{b.tier}</span>
              </div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                {b.desc}
              </p>
              {progress && !earned && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ width: '100%', height: 4, background: '#1a1f2e', borderRadius: 999 }}>
                    <div style={{ width: `${Math.min(100, (progress.have / progress.need) * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
                  </div>
                  <span className="muted small-note">{progress.have} / {progress.need}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="share-label">Handle</label>
        <input
          className="share-input"
          placeholder="anon"
          value={handle}
          onChange={(e) => setHandle(e.target.value.slice(0, 24))}
          style={{ marginTop: 4 }}
        />
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={refresh}>Refresh</button>
        <button className="btn primary" onClick={handleShare}>
          {copied ? 'Link copied ✓' : 'Share badge rack'}
        </button>
        <button className="btn" onClick={handleTweet}>Tweet</button>
      </div>
    </section>
  );
}
