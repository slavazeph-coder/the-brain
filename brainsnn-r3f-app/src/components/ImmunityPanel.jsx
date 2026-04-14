import React, { useEffect, useState } from 'react';
import {
  getImmunityState, subscribe, immunityLevel, resetImmunity, clearEvents, IMMUNITY_EVENTS
} from '../utils/immunityScore';

/**
 * Layer 23 — Cognitive Immunity Score Panel
 *
 * Persistent resilience dashboard. Shows the rolled-up immunity score,
 * per-dimension breakdown, streak, sparkline of score over time, and
 * recent events that contributed to the score.
 */
export default function ImmunityPanel() {
  const [state, setState] = useState(getImmunityState());

  useEffect(() => subscribe(setState), []);

  const current = state.history[0]?.breakdown || { awareness: 0, resilience: 50, depth: 0, consistency: 0 };
  const level = immunityLevel(state.score);
  const recentEvents = state.events.slice(0, 6);

  return (
    <section className="panel panel-pad immunity-panel">
      <div className="eyebrow">Layer 23</div>
      <h2>Cognitive Immunity Score</h2>
      <p className="muted">
        Persistent resilience metric rolled up from all protective layers —
        firewall scans, conversation analyses, anomalies, steward runs, depth
        of usage. Daily streak-based consistency multiplier.
      </p>

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

      <div className="immunity-sparkline">
        <label className="muted small-note">Score trend ({state.history.length} points)</label>
        <Sparkline history={state.history} color={level.color} />
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
