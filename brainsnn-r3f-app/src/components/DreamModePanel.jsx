import React, { useEffect, useState } from 'react';
import {
  getDreamStatus, subscribeDream, updateDreamConfig,
  startDreamMonitor, stopDreamMonitor, forceDream, wakeUp,
  phaseLabel, phaseColor, DREAM_STATE
} from '../utils/dreamMode';

/**
 * Layer 26 — Dream Mode Panel
 *
 * When idle for N seconds, the brain drifts into replay-consolidation:
 * recent snapshots cycle through at slow cadence, STDP-style weight
 * reinforcement nudges connection weights toward average-activated
 * states. Shows current phase, replay progress, and a dream log.
 */
export default function DreamModePanel() {
  const [status, setStatus] = useState(getDreamStatus());

  useEffect(() => subscribeDream(setStatus), []);

  const isMonitoring =
    status.phase !== DREAM_STATE.AWAKE || !!status.dreamLog.find((l) => l.kind === 'monitor' && l.text.includes('started'));

  const idleSec = Math.floor(status.idleForMs / 1000);
  const triggerSec = Math.floor(status.config.idleTriggerMs / 1000);
  const color = phaseColor(status.phase);

  return (
    <section className="panel panel-pad dream-panel">
      <div className="eyebrow">Layer 26</div>
      <h2>Dream Mode · Replay Consolidation</h2>
      <p className="muted">
        When the brain is idle, recent snapshots replay in slow cycles.
        STDP-style weight reinforcement nudges connections toward recent
        experience — analogous to hippocampal replay during sleep.
      </p>

      <div className="dream-hero">
        <div className="dream-phase-dot" style={{ background: color }} />
        <div className="dream-phase-body">
          <strong style={{ color }}>{phaseLabel(status.phase)}</strong>
          <div className="muted small-note">
            {status.phase === DREAM_STATE.AWAKE && (
              <>Idle {idleSec}s of {triggerSec}s needed to dream</>
            )}
            {status.phase === DREAM_STATE.DREAMING && (
              <>
                Cycle {status.cycleCount} · replaying snapshot{' '}
                {status.replayIndex % Math.max(1, status.replayedSnapshots.length) + 1}/{status.replayedSnapshots.length}
              </>
            )}
          </div>
        </div>
        <div className="dream-actions">
          <button
            className={isMonitoring ? 'ghost small' : 'primary small'}
            onClick={isMonitoring ? stopDreamMonitor : () => startDreamMonitor()}
          >
            {isMonitoring ? 'Stop monitor' : 'Start monitor'}
          </button>
          {status.phase === DREAM_STATE.DREAMING ? (
            <button className="ghost small" onClick={() => wakeUp('manual')}>
              Wake up
            </button>
          ) : (
            <button className="ghost small" onClick={forceDream}>
              Force dream
            </button>
          )}
        </div>
      </div>

      <div className="dream-rules">
        <label className="muted small-note">Config</label>
        <div className="dream-rules-grid">
          <div className="dream-rule">
            <small>Idle trigger</small>
            <select
              value={status.config.idleTriggerMs}
              onChange={(e) => updateDreamConfig({ idleTriggerMs: Number(e.target.value) })}
            >
              <option value={15_000}>15s</option>
              <option value={30_000}>30s</option>
              <option value={60_000}>60s</option>
              <option value={120_000}>2m</option>
            </select>
          </div>
          <div className="dream-rule">
            <small>Replay speed</small>
            <select
              value={status.config.replayIntervalMs}
              onChange={(e) => updateDreamConfig({ replayIntervalMs: Number(e.target.value) })}
            >
              <option value={1200}>Fast (1.2s)</option>
              <option value={2400}>Normal (2.4s)</option>
              <option value={4000}>Slow (4s)</option>
            </select>
          </div>
          <div className="dream-rule">
            <small>Max snapshots</small>
            <select
              value={status.config.maxSnapshotsToReplay}
              onChange={(e) => updateDreamConfig({ maxSnapshotsToReplay: Number(e.target.value) })}
            >
              <option value={3}>3</option>
              <option value={6}>6</option>
              <option value={10}>10</option>
            </select>
          </div>
          <div className="dream-rule">
            <small>Consolidation</small>
            <select
              value={status.config.consolidationStrength}
              onChange={(e) => updateDreamConfig({ consolidationStrength: Number(e.target.value) })}
            >
              <option value={0.04}>Gentle</option>
              <option value={0.08}>Normal</option>
              <option value={0.14}>Strong</option>
            </select>
          </div>
        </div>
      </div>

      {status.replayedSnapshots.length > 0 && (
        <div className="dream-replayed">
          <label className="muted small-note">Replay queue</label>
          <div className="dream-replay-chips">
            {status.replayedSnapshots.map((s, i) => {
              const active = (status.replayIndex % status.replayedSnapshots.length) === i
                && status.phase === DREAM_STATE.DREAMING;
              return (
                <span
                  key={s.id || i}
                  className={`dream-chip ${active ? 'active' : ''}`}
                  style={active ? { borderColor: color, background: `${color}22` } : undefined}
                  title={`${s.scenario} @ ${s.timestamp}`}
                >
                  {s.name.length > 22 ? s.name.slice(0, 22) + '…' : s.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="dream-log">
        <label className="muted small-note">Dream log</label>
        {status.dreamLog.length === 0 && (
          <p className="muted small-note">No dream activity yet. Save snapshots, then wait (or force dream).</p>
        )}
        {status.dreamLog.slice(0, 8).map((entry, i) => (
          <div key={i} className={`dream-log-row kind-${entry.kind}`}>
            <span className="dream-log-kind">{entry.kind}</span>
            <span className="dream-log-text">{entry.text}</span>
            <span className="dream-log-time muted small-note">{agoLabel(entry.timestamp)}</span>
          </div>
        ))}
      </div>

      <p className="muted small-note">
        Any activity (panel click, scan, snapshot) wakes the brain and resets
        the idle timer. Dream mode never modifies your saved snapshots — only
        the live simulation state drifts.
      </p>
    </section>
  );
}

function agoLabel(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
