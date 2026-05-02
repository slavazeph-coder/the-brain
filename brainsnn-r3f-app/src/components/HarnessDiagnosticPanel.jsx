import React, { useEffect, useMemo, useState } from 'react';
import {
  recentSpans, spanCount, clearSpans, subscribe, exportSpans, isEnabled, setEnabled,
} from '../utils/telemetry';
import { runDiagnostic, renderReportText } from '../utils/harnessFailureModes';

/**
 * Layer 102 — Harness Diagnostic panel.
 *
 * Reads the unified telemetry span buffer (telemetry.js), runs the
 * failure-mode detectors + Laplace lift mining, and surfaces a
 * harness-report-v1 JSON document. Operators can copy the rendered
 * text into Cursor / Claude Code (HALO-style "fix what you can"
 * loop), or pipe the JSON to an MCP tool.
 */
export default function HarnessDiagnosticPanel() {
  const [tick, setTick] = useState(0);
  const [enabled, setEnabledState] = useState(() => isEnabled());

  useEffect(() => {
    const unsub = subscribe(() => setTick((n) => n + 1));
    return () => { unsub(); };
  }, []);

  const spans = useMemo(() => recentSpans(500), [tick]);
  const report = useMemo(() => runDiagnostic({ spans }), [spans]);
  const text = useMemo(() => renderReportText(report), [report]);

  function copyText() {
    try { navigator.clipboard.writeText(text); } catch { /* noop */ }
  }
  function copyJson() {
    try { navigator.clipboard.writeText(JSON.stringify(report, null, 2)); } catch { /* noop */ }
  }
  function downloadSpans() {
    const blob = new Blob([JSON.stringify(exportSpans(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-spans-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    setEnabledState(next);
  }
  function clear() {
    if (!window.confirm('Clear the local span buffer?')) return;
    clearSpans();
    setTick((n) => n + 1);
  }

  const tone = (
    report.tier === 'critical' ? '#dd6974'
      : report.tier === 'warn' ? '#fdab43'
        : '#5ee69a'
  );

  return (
    <section className="panel panel-pad harness-diagnostic-panel">
      <div className="eyebrow">Layer 102 · harness diagnostic</div>
      <h2>Self-diagnose the brain</h2>
      <p className="muted">
        Reads the telemetry span buffer (cannibalized OpenTelemetry
        schema) and clusters spans into named failure modes — slow
        scans, hung MCP, refusal loops, dead patterns, FP-heavy rules.
        Borrowed from <code>context-labs/halo</code>: the harness
        watches itself, then hands a structured fix-report to a coding
        agent. Copy the report into Cursor / Claude Code or pipe the
        JSON to an MCP tool.
      </p>

      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          background: `${tone}14`,
          borderLeft: `3px solid ${tone}`,
          marginTop: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ color: tone }}>{report.tier.toUpperCase()}</strong>
          <span className="muted small-note">
            {report.totals.spans} spans · {report.totals.errors} err · {report.totals.distinctNames} ops
          </span>
        </div>
        {report.findings.length === 0 ? (
          <p className="muted small-note" style={{ margin: '6px 0 0' }}>
            No failure modes detected. Use the firewall, MCP bridge, or
            steward — spans show up here automatically.
          </p>
        ) : (
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {report.findings.map((f) => (
              <li key={f.id} style={{ marginBottom: 6 }}>
                <strong>{f.label}</strong>{' '}
                <span className="muted small-note">×{f.count} · {f.severity}</span>
                {f.hint && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{f.hint}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn-sm" onClick={copyText} disabled={!report}>Copy report (text)</button>
        <button className="btn-sm" onClick={copyJson} disabled={!report}>Copy report (JSON)</button>
        <button className="ghost small" onClick={downloadSpans} disabled={spans.length === 0}>
          Download spans
        </button>
        <button className="ghost small" onClick={toggleEnabled}>
          {enabled ? 'Pause emit' : 'Resume emit'}
        </button>
        <button className="ghost small" onClick={clear} style={{ color: '#dd6974' }}>Clear</button>
      </div>

      {report.errorLift?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Error-correlated features</div>
          {report.errorLift.map((c) => (
            <div
              key={c.feature}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 60px 60px',
                gap: 8,
                padding: '4px 8px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 4,
                marginTop: 2,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              <span>{c.feature}</span>
              <span className="muted small-note">lift {c.lift}</span>
              <span className="muted small-note">err {c.posCount}</span>
              <span className="muted small-note">ok {c.negCount}</span>
            </div>
          ))}
        </div>
      )}

      {report.aggregates?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Top operations</div>
          {report.aggregates.map((a) => (
            <div
              key={a.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 80px 80px',
                gap: 8,
                padding: '4px 8px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 4,
                marginTop: 2,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              <span>{a.name}</span>
              <span className="muted small-note">×{a.count}</span>
              <span className="muted small-note">p50 {a.p50}ms</span>
              <span style={{ color: a.errorRate > 0 ? '#dd6974' : '' }}>
                err {Math.round(a.errorRate * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="muted small-note" style={{ marginTop: 12 }}>
        Spans are stored locally (cap {spanCount() ? '500' : '500'}) and
        never leave your device. Layer 57 (Data Portability) picks them
        up alongside everything else when you back up your state.
      </p>
    </section>
  );
}
