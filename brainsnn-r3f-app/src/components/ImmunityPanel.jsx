import React, { useEffect, useState } from 'react';
import {
  getImmunityState, subscribe, immunityLevel, resetImmunity, clearEvents, IMMUNITY_EVENTS
} from '../utils/immunityScore';
import {
  buildImmunityPayload, encodeImmunity, immunityUrl, sanitizeHandle, decodeImmunity
} from '../utils/immunityCard';

const HANDLE_KEY = 'brainsnn_handle_v1';

function readHandle() {
  try {
    return localStorage.getItem(HANDLE_KEY) || '';
  } catch {
    return '';
  }
}

function writeHandle(h) {
  try {
    localStorage.setItem(HANDLE_KEY, h);
  } catch { /* quota */ }
}

/**
 * Layer 23 — Cognitive Immunity Score Panel
 *
 * Persistent resilience dashboard + weekly leaderboard share loop.
 * Local metric becomes a social flex via /i/<hash> cards.
 */
export default function ImmunityPanel({ incomingCard = null }) {
  const [state, setState] = useState(getImmunityState());
  const [handle, setHandle] = useState(readHandle());
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [board, setBoard] = useState(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState('');

  useEffect(() => subscribe(setState), []);
  useEffect(() => { writeHandle(handle); }, [handle]);

  useEffect(() => {
    // Fetch leaderboard on mount
    loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = state.history[0]?.breakdown || { awareness: 0, resilience: 50, depth: 0, consistency: 0 };
  const level = immunityLevel(state.score);
  const recentEvents = state.events.slice(0, 6);

  async function loadBoard() {
    setBoardLoading(true);
    setBoardError('');
    try {
      const r = await fetch('/api/leaderboard');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setBoard(await r.json());
    } catch (err) {
      setBoardError(err.message || 'load failed');
    } finally {
      setBoardLoading(false);
    }
  }

  function buildPayload({ rank = null, total = null, week = null } = {}) {
    return buildImmunityPayload({
      handle: sanitizeHandle(handle || 'anon'),
      score: state.score,
      breakdown: current,
      streak: state.streak,
      events: state.events.length,
      rank,
      total,
      week,
    });
  }

  async function handleShare() {
    const payload = buildPayload({
      rank: submitResult?.rank,
      total: submitResult?.total,
      week: submitResult?.week,
    });
    const url = immunityUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy your immunity card URL:', url);
    }
  }

  function handleTweet() {
    const payload = buildPayload({
      rank: submitResult?.rank,
      total: submitResult?.total,
    });
    const url = immunityUrl(window.location.origin, payload);
    const rankBit = submitResult?.rank && submitResult?.total
      ? ` — rank ${submitResult.rank} of ${submitResult.total} this week`
      : '';
    const tweet = `My Cognitive Immunity: ${state.score}/100 · ${level.label}${rankBit}. ${state.streak}-day streak. Scan yours: ${url}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`,
      '_blank',
      'noopener'
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const r = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: sanitizeHandle(handle || 'anon'),
          score: state.score,
          streak: state.streak,
          events: state.events.length,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setSubmitResult({ error: data.error || `HTTP ${r.status}` });
        return;
      }
      setSubmitResult(data);
      loadBoard();
    } catch (err) {
      setSubmitResult({ error: err.message || 'submit failed' });
    } finally {
      setSubmitting(false);
    }
  }

  // Show incoming card flex banner if the user arrived via /i/<hash>
  const incoming = incomingCard && decodeImmunity(incomingCard);

  return (
    <section className="panel panel-pad immunity-panel">
      <div className="eyebrow">Layer 23 · weekly leaderboard</div>
      <h2>Cognitive Immunity Score</h2>
      <p className="muted">
        Persistent resilience metric from firewall scans, conversations, anomalies,
        and depth of usage. Daily streak · shareable card · weekly leaderboard.
      </p>

      {incoming && (
        <div
          className="immunity-incoming"
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderLeft: '3px solid #5ad4ff',
            background: 'rgba(90,212,255,0.05)',
            borderRadius: 6,
          }}
        >
          <strong>{incoming.handle}</strong> shared their immunity card:
          {' '}<strong style={{ color: level.color }}>{incoming.score}</strong> /100
          {incoming.rank ? ` · rank ${incoming.rank}${incoming.total ? ` of ${incoming.total}` : ''}` : ''}
          · {incoming.streak}-day streak. <span className="muted">Beat it below.</span>
        </div>
      )}

      <div className="immunity-hero">
        <div className="immunity-dial">
          <div
            className="immunity-ring"
            style={{
              background: `conic-gradient(${level.color} ${state.score}%, rgba(255,255,255,.08) 0%)`
            }}
          >
            <div className="immunity-ring-inner">
              <strong className="immunity-score">{state.score}</strong>
              <small className="immunity-label" style={{ color: level.color }}>
                {level.label}
              </small>
            </div>
          </div>
        </div>

        <div className="immunity-meta">
          <div className="immunity-streak">
            <small>Streak</small>
            <strong>{state.streak} day{state.streak === 1 ? '' : 's'}</strong>
          </div>
          <div className="immunity-streak">
            <small>Events</small>
            <strong>{state.events.length}</strong>
          </div>
          <div className="immunity-streak">
            <small>Baseline</small>
            <strong>{state.baseline}</strong>
          </div>
          {submitResult?.rank && (
            <div className="immunity-streak">
              <small>Weekly rank</small>
              <strong style={{ color: level.color }}>
                {submitResult.rank}{submitResult.total ? ` / ${submitResult.total}` : ''}
              </strong>
            </div>
          )}
        </div>
      </div>

      <div className="immunity-breakdown">
        {['awareness', 'resilience', 'depth', 'consistency'].map((k) => (
          <div key={k} className="immunity-dim">
            <div className="immunity-dim-head">
              <span className="immunity-dim-name">{k}</span>
              <span className="immunity-dim-val">{current[k]}</span>
            </div>
            <div className="immunity-dim-bar">
              <div className="immunity-dim-fill" style={{ width: `${current[k]}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="immunity-share" style={{ marginTop: 14 }}>
        <label className="share-label" htmlFor="immunity-handle">Handle (shown on share card + leaderboard)</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            id="immunity-handle"
            className="share-input"
            placeholder="anon"
            value={handle}
            onChange={(e) => setHandle(sanitizeHandle(e.target.value))}
            maxLength={24}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={handleShare} disabled={state.events.length === 0}>
            {copied ? 'Link copied ✓' : 'Share card'}
          </button>
          <button className="btn" onClick={handleTweet} disabled={state.events.length === 0}>
            Tweet
          </button>
          <button
            className="btn primary"
            onClick={handleSubmit}
            disabled={submitting || state.events.length === 0}
          >
            {submitting ? 'Submitting…' : 'Submit to weekly board'}
          </button>
        </div>
        {submitResult?.error && (
          <p className="muted" style={{ color: '#dd6974', marginTop: 6 }}>
            {submitResult.error}
          </p>
        )}
        {submitResult?.ok && (
          <p className="muted" style={{ marginTop: 6 }}>
            Submitted — you're rank <strong>{submitResult.rank}</strong> of {submitResult.total} this week.
          </p>
        )}
        {state.events.length === 0 && (
          <p className="muted small-note" style={{ marginTop: 6 }}>
            Run a firewall scan first — handles with zero events can't submit.
          </p>
        )}
      </div>

      <div className="immunity-sparkline">
        <label className="muted small-note">Score trend ({state.history.length} points)</label>
        <Sparkline history={state.history} color={level.color} />
      </div>

      <div className="immunity-leaderboard" style={{ marginTop: 14 }}>
        <div className="immunity-events-head">
          <strong>Weekly top 10{board?.week ? ` · ${board.week}` : ''}</strong>
          <div className="immunity-events-actions">
            <button className="ghost small" onClick={loadBoard} disabled={boardLoading}>
              {boardLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {boardError && (
          <p className="muted small-note" style={{ color: '#dd6974' }}>
            Leaderboard error: {boardError}
          </p>
        )}
        {board?.top?.length ? (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {board.top.slice(0, 10).map((row, i) => (
              <li
                key={`${row.handle}-${row.ts}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 0',
                  fontFamily: 'inherit',
                }}
              >
                <span>{row.handle}</span>
                <span style={{ color: immunityLevel(row.score).color }}>
                  <strong>{row.score}</strong>
                  <span className="muted small-note"> / 100</span>
                </span>
              </li>
            ))}
          </ol>
        ) : !boardLoading && !boardError ? (
          <p className="muted small-note">No entries yet this week — submit yours to seed it.</p>
        ) : null}
        {board?.backend === 'memory' && (
          <p className="muted small-note">
            (Leaderboard is running in ephemeral mode — set UPSTASH_REDIS_REST_URL to persist.)
          </p>
        )}
      </div>

      <div className="immunity-events">
        <div className="immunity-events-head">
          <strong>Recent events</strong>
          <div className="immunity-events-actions">
            <button className="ghost small" onClick={clearEvents}>Clear events</button>
            <button className="ghost small" onClick={resetImmunity}>Reset</button>
          </div>
        </div>
        {recentEvents.length === 0 && <p className="muted small-note">No events yet — scan content, analyze a conversation, or start the steward.</p>}
        {recentEvents.map((e, i) => (
          <div key={i} className="immunity-event-row">
            <span className="immunity-event-kind">{labelForEvent(e.type)}</span>
            <span className="immunity-event-meta muted small-note">
              {describeMeta(e.type, e.meta)}
            </span>
            <span className="immunity-event-time muted small-note">{agoLabel(e.timestamp)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sparkline({ history, color }) {
  if (!history?.length) return <div className="immunity-sparkline-empty muted small-note">No history yet.</div>;
  const W = 400;
  const H = 60;
  // Newest first → reverse for chronological plot
  const chronological = [...history].reverse();
  const pts = chronological.map((h, i) => ({
    x: (i / Math.max(1, chronological.length - 1)) * W,
    y: H - (h.score / 100) * H
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="immunity-spark-svg">
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      <path d={d} stroke={color} strokeWidth={1.6} fill="none" />
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2.5} fill={color} />
      )}
    </svg>
  );
}

function labelForEvent(type) {
  switch (type) {
    case IMMUNITY_EVENTS.FIREWALL_SCAN: return 'FIREWALL';
    case IMMUNITY_EVENTS.CONVERSATION_ANALYZED: return 'CONVO';
    case IMMUNITY_EVENTS.ANOMALY_DETECTED: return 'ANOMALY';
    case IMMUNITY_EVENTS.SNAPSHOT_SAVED: return 'SNAPSHOT';
    case IMMUNITY_EVENTS.STEWARD_RUN: return 'STEWARD';
    case IMMUNITY_EVENTS.GEMMA_SCAN: return 'GEMMA';
    case IMMUNITY_EVENTS.CODE_ANALYZED: return 'CODE';
    case IMMUNITY_EVENTS.KNOWLEDGE_SCANNED: return 'KNOWLEDGE';
    default: return type.toUpperCase();
  }
}

function describeMeta(type, meta = {}) {
  if (!meta) return '';
  if (typeof meta.pressure === 'number') return `pressure ${(meta.pressure * 100).toFixed(0)}%`;
  if (typeof meta.pressureAvg === 'number') return `avg pressure ${(meta.pressureAvg * 100).toFixed(0)}% over ${meta.turns || '?'} turns`;
  if (meta.anomalyCount) return `${meta.anomalyCount} region(s) >σ threshold`;
  if (meta.name) return meta.name;
  if (meta.files) return `${meta.files} files, ${meta.symbols} symbols`;
  return '';
}

function agoLabel(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
