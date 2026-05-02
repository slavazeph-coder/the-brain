import React, { useEffect, useState } from 'react';
import {
  loadConfig, saveConfig, exportSpansOnce, exportResults, clearResults,
} from '../utils/otlpExporter';
import { piiAuditSummary } from '../utils/telemetrySanitizer';
import { recentSpans } from '../utils/telemetry';

/**
 * Layer 107 — OTLP Exporter panel.
 *
 * Push the local span buffer to any OTLP-HTTP collector
 * (Honeycomb / Tempo / Datadog / Jaeger).
 */
export default function OtlpExporterPanel() {
  const [cfg, setCfg] = useState(() => loadConfig());
  const [results, setResults] = useState(() => exportResults());
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState(() => piiAuditSummary(recentSpans(500)));

  useEffect(() => { setResults(exportResults()); }, []);
  useEffect(() => {
    const id = setInterval(() => setAudit(piiAuditSummary(recentSpans(500))), 5000);
    return () => clearInterval(id);
  }, []);

  function update(partial) {
    const next = saveConfig(partial);
    setCfg(next);
  }

  async function pushReal() {
    setBusy(true);
    await exportSpansOnce();
    setResults(exportResults());
    setBusy(false);
  }
  async function pushDryRun() {
    setBusy(true);
    await exportSpansOnce({ dryRun: true });
    setResults(exportResults());
    setBusy(false);
  }
  function wipe() {
    clearResults();
    setResults([]);
  }

  return (
    <section className="panel panel-pad otlp-exporter-panel">
      <div className="eyebrow">Layer 107 · OTLP exporter</div>
      <h2>Push spans to a real collector</h2>
      <p className="muted">
        BrainSNN telemetry is OTel-shaped already. Plug in your
        collector endpoint (Honeycomb / Grafana Tempo / Datadog /
        Jaeger via the OTel collector), opt in, and the buffer
        pushes through Layer 108's sanitizer on every export.
        Nothing leaves the device until you flip <code>enabled</code>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <input
          className="share-input"
          placeholder="https://collector.example.com/v1/traces"
          value={cfg.endpoint}
          onChange={(e) => update({ endpoint: e.target.value })}
        />
        <input
          className="share-input"
          placeholder="Authorization header (optional)"
          value={cfg.authHeader}
          onChange={(e) => update({ authHeader: e.target.value })}
        />
        <input
          className="share-input"
          placeholder="service.name (default: brainsnn)"
          value={cfg.serviceName}
          onChange={(e) => update({ serviceName: e.target.value })}
        />
        <input
          className="share-input"
          type="number"
          min={10}
          max={500}
          value={cfg.batchSize}
          onChange={(e) => update({ batchSize: Number(e.target.value) })}
        />
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="muted small-note">enabled</span>
        </label>
        <button className="btn-sm" onClick={pushDryRun} disabled={busy}>Dry run</button>
        <button className="btn" onClick={pushReal} disabled={busy || !cfg.enabled || !cfg.endpoint}>
          Push now
        </button>
        {results.length > 0 && (
          <button className="ghost small" onClick={wipe} style={{ color: '#dd6974' }}>Clear results</button>
        )}
      </div>

      {audit.flagged > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(253,171,67,0.10)',
            borderLeft: '3px solid #fdab43',
            borderRadius: 6,
          }}
        >
          <strong>PII detected in {audit.flagged} / {audit.total} spans.</strong>
          <span className="muted small-note" style={{ marginLeft: 8 }}>
            {audit.byLabel.map((l) => `${l.label}×${l.count}`).join(' · ')}
          </span>
          <div className="muted small-note" style={{ marginTop: 2 }}>
            Layer 108 sanitizes on every export — open it to add custom patterns.
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Recent exports</div>
          {results.map((r, i) => (
            <div
              key={`${r.ts}-${i}`}
              style={{
                padding: '4px 10px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 6,
                marginTop: 2,
                fontFamily: 'monospace',
                fontSize: 12,
                color: r.ok ? '' : '#dd6974',
              }}
            >
              {new Date(r.ts).toLocaleString()} · {r.count} spans · {r.ok ? 'ok' : 'fail'}
              {r.dryRun && ' (dry-run)'}
              {r.status && ` · ${r.status}`}
              {r.error && ` · ${r.error}`}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
