import React, { useEffect, useState } from 'react';
import {
  STANDARD_PATTERNS, loadCustomPatterns, addCustomPattern, removeCustomPattern,
  clearCustomPatterns, piiAuditSummary,
} from '../utils/telemetrySanitizer';
import { recentSpans, subscribe } from '../utils/telemetry';

/**
 * Layer 108 — Telemetry Sanitizer panel.
 *
 * Inspect what PII the redactor would catch in the live buffer,
 * curate custom patterns. Layer 107 always runs through this on
 * export — this panel is for dialing it in.
 */
export default function SanitizerPanel() {
  const [tick, setTick] = useState(0);
  const [custom, setCustom] = useState(() => loadCustomPatterns());
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  const audit = piiAuditSummary(recentSpans(500));

  function add() {
    setErr('');
    if (!source.trim()) return;
    try {
      const list = addCustomPattern({ label: label.trim(), source: source.trim() });
      setCustom(list);
      setLabel('');
      setSource('');
    } catch (e) { setErr(e.message); }
  }
  function rm(id) {
    removeCustomPattern(id);
    setCustom(loadCustomPatterns());
  }
  function clearAll() {
    if (!window.confirm('Clear all custom PII patterns?')) return;
    clearCustomPatterns();
    setCustom([]);
  }

  return (
    <section className="panel panel-pad sanitizer-panel">
      <div className="eyebrow">Layer 108 · telemetry sanitizer</div>
      <h2>PII redaction before egress</h2>
      <p className="muted">
        Before any span leaves this device (Layer 107 OTLP push, Layer
        96 cross-device sync, Layer 57 export), every string attribute
        runs through this redactor. Standard patterns ship for email
        / phone / IP / SSN-like / card / bearer-token. Add custom
        regexes for your domain (employee IDs, internal slugs).
      </p>

      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: audit.flagged ? 'rgba(253,171,67,0.10)' : 'rgba(94,230,154,0.08)',
          borderLeft: `3px solid ${audit.flagged ? '#fdab43' : '#5ee69a'}`,
        }}
      >
        <strong>{audit.flagged} / {audit.total} spans flagged</strong>
        {audit.byLabel.length > 0 && (
          <span className="muted small-note" style={{ marginLeft: 8 }}>
            {audit.byLabel.map((l) => `${l.label}×${l.count}`).join(' · ')}
          </span>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="eyebrow">Standard patterns</div>
        {STANDARD_PATTERNS.map((p) => (
          <div
            key={p.id}
            style={{
              padding: '4px 10px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 6,
              marginTop: 2,
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            <strong style={{ color: '#7a8fe7' }}>{p.label}</strong>
            <span className="muted" style={{ marginLeft: 8 }}>/{p.source}/</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="eyebrow">Custom patterns</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8 }}>
          <input
            className="share-input"
            placeholder="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={32}
          />
          <input
            className="share-input"
            placeholder="regex source (e.g. EMP-\\d{6})"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button className="btn-sm" onClick={add} disabled={!source.trim()}>Add</button>
        </div>
        {err && <p className="muted small-note" style={{ color: '#dd6974' }}>{err}</p>}

        {custom.length === 0 ? (
          <p className="muted small-note" style={{ marginTop: 8 }}>No custom patterns yet.</p>
        ) : (
          <>
            {custom.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 10px', background: 'rgba(255,255,255,0.03)',
                  borderRadius: 6, marginTop: 2, fontFamily: 'monospace', fontSize: 12,
                }}
              >
                <span>
                  <strong>{p.label}</strong>
                  <span className="muted" style={{ marginLeft: 8 }}>/{p.source}/</span>
                </span>
                <button className="ghost small" onClick={() => rm(p.id)} style={{ color: '#dd6974' }}>
                  Remove
                </button>
              </div>
            ))}
            <button className="ghost small" onClick={clearAll} style={{ marginTop: 8, color: '#dd6974' }}>
              Clear all custom
            </button>
          </>
        )}
      </div>
    </section>
  );
}
