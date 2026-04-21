import React, { useState } from 'react';
import { runDiagnostic } from '../utils/diagnostic';

/**
 * Layer 61 — Firewall Diagnostic panel.
 */
export default function DiagnosticPanel() {
  const [threshold, setThreshold] = useState(0.3);
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 20));
    try {
      setReport(runDiagnostic({ threshold }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="panel panel-pad diagnostic-panel">
      <div className="eyebrow">Layer 61 · firewall diagnostic</div>
      <h2>Rule health check</h2>
      <p className="muted">
        Runs the currently active ruleset (defaults + custom) through the
        red-team corpus + benign controls. Reports F1, detection rate, FPR,
        and — most usefully — which patterns are dead (never fire) and
        which are the biggest false-positive contributors.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <label className="muted small-note">Threshold:</label>
        <input
          type="range"
          min="0.1"
          max="0.7"
          step="0.05"
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          style={{ flex: 1, maxWidth: 300 }}
        />
        <strong>{threshold.toFixed(2)}</strong>
        <button className="btn primary" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run diagnostic'}
        </button>
      </div>

      {report && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${report.grade.color}14`,
              borderLeft: `3px solid ${report.grade.color}`,
            }}
          >
            <span>
              <strong>F1 {(report.f1 * 100).toFixed(1)}%</strong> · detect{' '}
              <strong>{(report.detectionRate * 100).toFixed(1)}%</strong> · FPR{' '}
              <strong>{(report.fpr * 100).toFixed(1)}%</strong>
            </span>
            <strong style={{ color: report.grade.color, fontSize: 24 }}>
              {report.grade.letter}
            </strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div>
              <div className="eyebrow">Dead patterns ({report.dead.length})</div>
              <p className="muted small-note">Never fired on either corpus — candidates to remove.</p>
              {report.dead.length === 0 ? (
                <p className="muted">All patterns fired at least once.</p>
              ) : report.dead.map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: 'rgba(221,105,116,0.06)',
                    marginTop: 4,
                    fontFamily: 'monospace',
                    fontSize: 11,
                  }}
                >
                  <strong style={{ color: '#dd6974' }}>{p.category}</strong>{' '}
                  /{p.source.slice(0, 80)}/
                </div>
              ))}
            </div>

            <div>
              <div className="eyebrow">FP contributors ({report.fpContributors.length})</div>
              <p className="muted small-note">Fire on benigns — candidates to tighten.</p>
              {report.fpContributors.length === 0 ? (
                <p className="muted">Zero benign hits. Clean.</p>
              ) : report.fpContributors
                .sort((a, b) => b.benignHits - a.benignHits)
                .slice(0, 8)
                .map((p, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      background: 'rgba(253,171,67,0.08)',
                      marginTop: 4,
                      fontFamily: 'monospace',
                      fontSize: 11,
                    }}
                  >
                    <strong style={{ color: '#fdab43' }}>{p.category}</strong>{' '}
                    <span className="muted small-note">({p.benignHits} benign hits)</span>{' '}
                    /{p.source.slice(0, 80)}/
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
