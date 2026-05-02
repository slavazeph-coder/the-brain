import React, { useEffect, useState } from 'react';
import {
  subscribe, getStatus, updateConfig, start, stop, runOnce,
  revertApplied, clearAppliedLog,
} from '../utils/autoSteward';

/**
 * Layer 103 — Auto-Apply Rule Steward panel.
 *
 * Closes the HALO loop: poll the harness report, derive a candidate
 * rule diff, and apply low-risk additions automatically. Defaults to
 * dryRun + paused so nothing happens until the operator explicitly
 * arms it.
 */
export default function AutoStewardPanel() {
  const [status, setStatus] = useState(() => getStatus());

  useEffect(() => subscribe(setStatus), []);

  const cfg = status.config;
  const tone = (
    status.lastReportTier === 'critical' ? '#dd6974'
      : status.lastReportTier === 'warn' ? '#fdab43'
        : '#5ee69a'
  );

  function field(key, parser = (v) => v) {
    return (e) => updateConfig({ [key]: parser(e.target.value) });
  }

  return (
    <section className="panel panel-pad auto-steward-panel">
      <div className="eyebrow">Layer 103 · auto-apply rule steward</div>
      <h2>Self-driving Layer 102 loop</h2>
      <p className="muted">
        Each cycle, pull the harness report, derive a rule diff, and
        apply low-risk additions to Layer 55. Default config is
        dry-run + manual — flip <code>enabled</code> to arm it. Quota
        + lift threshold prevent runaway rule growth. Every applied
        rule is reversible from the log below.
      </p>

      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: `${tone}14`,
          borderLeft: `3px solid ${tone}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ color: tone }}>
            {status.running ? 'RUNNING' : 'IDLE'} · last tier {status.lastReportTier}
          </strong>
          <span className="muted small-note">
            cycle {status.cycleCount} · {status.lastDiffAdditions} candidates · {status.appliedLog.length} applied
          </span>
        </div>
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        {status.running ? (
          <button className="btn-sm" onClick={stop}>Stop</button>
        ) : (
          <button className="btn" onClick={start}>Start</button>
        )}
        <button className="ghost small" onClick={runOnce}>Run once</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
          />
          <span className="muted small-note">enabled</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.dryRun}
            onChange={(e) => updateConfig({ dryRun: e.target.checked })}
          />
          <span className="muted small-note">dry run</span>
        </label>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        <NumberInput label="interval (ms)" value={cfg.intervalMs} onChange={field('intervalMs', Number)} min={5000} step={5000} />
        <NumberInput label="min lift" value={cfg.minLift} onChange={field('minLift', Number)} min={1} step={1} />
        <NumberInput label="max / cycle" value={cfg.maxPerCycle} onChange={field('maxPerCycle', Number)} min={1} max={6} step={1} />
        <NumberInput label="quota / hour" value={cfg.quotaPerHour} onChange={field('quotaPerHour', Number)} min={1} max={60} step={1} />
        <NumberInput label="min pattern chars" value={cfg.minPatternChars} onChange={field('minPatternChars', Number)} min={2} step={1} />
      </div>

      {status.lastDiffFollowUps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Suggested follow-ups (manual)</div>
          {status.lastDiffFollowUps.map((f, i) => (
            <div
              key={i}
              style={{
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 6,
                marginTop: 4,
                fontSize: 12,
              }}
            >
              <strong>L{f.layer} · {f.action}</strong>
              <div className="muted small-note" style={{ marginTop: 2 }}>{f.reason}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="eyebrow">Applied log</div>
          {status.appliedLog.length > 0 && (
            <button className="ghost small" onClick={clearAppliedLog} style={{ color: '#dd6974' }}>Clear</button>
          )}
        </div>
        {status.appliedLog.length === 0 ? (
          <p className="muted small-note">Nothing applied yet.</p>
        ) : status.appliedLog.map((e, i) => (
          <div
            key={`${e.ts}-${i}`}
            style={{
              padding: '6px 10px',
              background: e.reverted ? 'rgba(221,105,116,0.08)' : 'rgba(255,255,255,0.03)',
              borderRadius: 6,
              marginTop: 4,
              fontFamily: 'monospace',
              fontSize: 12,
              opacity: e.reverted ? 0.55 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <strong style={{ color: '#a86fdf' }}>{e.category}</strong>
                {' '}/{e.pattern}/
                {e.dryRun && <span className="muted small-note" style={{ marginLeft: 8 }}>· dry-run</span>}
                {e.error && <span style={{ marginLeft: 8, color: '#dd6974' }}>· {e.error}</span>}
              </span>
              {e.ruleId && !e.reverted && !e.dryRun && (
                <button className="ghost small" onClick={() => revertApplied(e.ruleId)}>Revert</button>
              )}
              {e.reverted && <span className="muted small-note">reverted</span>}
            </div>
            <div className="muted small-note">
              {new Date(e.ts).toLocaleString()} · cycle {e.cycle} · {e.source}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NumberInput({ label, value, onChange, ...rest }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted small-note">{label}</span>
      <input
        className="share-input"
        type="number"
        value={value}
        onChange={onChange}
        {...rest}
      />
    </label>
  );
}
