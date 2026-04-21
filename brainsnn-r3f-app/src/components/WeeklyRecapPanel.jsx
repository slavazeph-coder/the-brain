import React, { useEffect, useState } from 'react';
import { computeWeeklyRecap, buildRecapPayload, recapUrl } from '../utils/weeklyRecap';

const HANDLE_KEY = 'brainsnn_handle_v1';

function readHandle() {
  try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; }
}
function writeHandle(h) {
  try { localStorage.setItem(HANDLE_KEY, h); } catch { /* quota */ }
}

/**
 * Layer 50 — Weekly Recap panel.
 * Pulls from Immunity + DailyChallenge + Receipts localStorage and
 * renders a shareable /w/<hash> card.
 */
export default function WeeklyRecapPanel() {
  const [recap, setRecap] = useState(null);
  const [handle, setHandle] = useState(readHandle());
  const [copied, setCopied] = useState(false);

  useEffect(() => { setRecap(computeWeeklyRecap()); }, []);
  useEffect(() => { writeHandle(handle); }, [handle]);

  function refresh() {
    setRecap(computeWeeklyRecap());
  }

  async function handleShare() {
    if (!recap) return;
    const url = recapUrl(window.location.origin, buildRecapPayload({ handle, recap }));
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy weekly recap URL:', url);
    }
  }

  function handleTweet() {
    if (!recap) return;
    const url = recapUrl(window.location.origin, buildRecapPayload({ handle, recap }));
    const tweet = `My BrainSNN week: immunity ${recap.score}${recap.immunityDelta >= 0 ? '+' : ''}${recap.immunityDelta}, ${recap.streak}-day streak, ${recap.scansThisWeek} scans. ${url}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, '_blank', 'noopener');
  }

  if (!recap) return null;

  const deltaColor = recap.immunityDelta > 0 ? '#5ee69a' : recap.immunityDelta < 0 ? '#dd6974' : '#fdab43';

  return (
    <section className="panel panel-pad weekly-recap-panel">
      <div className="eyebrow">Layer 50 · weekly recap</div>
      <h2>This week on your brain</h2>
      <p className="muted">
        Rolls your local Immunity + Daily Challenge + Receipts history into a
        single shareable card. Everything is computed in-browser; nothing
        leaves your machine unless you tap Share.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
        <Stat label="Immunity" value={recap.score} suffix="/100" />
        <Stat
          label="Δ this week"
          value={`${recap.immunityDelta >= 0 ? '+' : ''}${recap.immunityDelta}`}
          color={deltaColor}
        />
        <Stat label="Streak" value={recap.streak} suffix=" d" />
        <Stat label="Scans" value={recap.scansThisWeek} />
        <Stat label="Events" value={recap.eventsThisWeek} />
        <Stat label="Mean pressure" value={`${Math.round(recap.meanPressure * 100)}%`} />
        <Stat label="Daily played" value={`${recap.dailyPlayed}/7`} />
        <Stat label="Daily accuracy" value={`${recap.dailyMeanAccuracy}%`} />
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="share-label" htmlFor="recap-handle">Handle</label>
        <input
          id="recap-handle"
          className="share-input"
          placeholder="anon"
          value={handle}
          onChange={(e) => setHandle(e.target.value.slice(0, 24))}
          maxLength={24}
          style={{ marginTop: 6 }}
        />
      </div>

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button className="btn" onClick={refresh}>Refresh</button>
        <button className="btn primary" onClick={handleShare}>
          {copied ? 'Link copied ✓' : 'Share recap'}
        </button>
        <button className="btn" onClick={handleTweet}>Tweet</button>
      </div>
    </section>
  );
}

function Stat({ label, value, suffix = '', color }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span className="muted small-note">{label}</span>
      <strong style={{ fontSize: 22, color: color || '#f1ece5' }}>
        {value}
        <span className="muted small-note" style={{ fontSize: 13, marginLeft: 2 }}>{suffix}</span>
      </strong>
    </div>
  );
}
