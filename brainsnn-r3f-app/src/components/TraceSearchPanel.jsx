import React, { useEffect, useMemo, useState } from 'react';
import { recentSpans, subscribe } from '../utils/telemetry';
import { searchSpans, parseQuery } from '../utils/traceSearch';

/**
 * Layer 112 — Trace Search panel.
 */
export default function TraceSearchPanel() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);

  const spans = useMemo(() => recentSpans(500), [tick]);
  const clauses = useMemo(() => parseQuery(q), [q]);
  const hits = useMemo(() => searchSpans(q, spans), [q, spans]);

  return (
    <section className="panel panel-pad trace-search-panel">
      <div className="eyebrow">Layer 112 · trace search</div>
      <h2>Query the span buffer</h2>
      <p className="muted">
        Mini query language: <code>name=firewall.scan status=error duration>200</code>.
        Bare words match free-text against name + JSON-stringified
        attributes. Operators: <code>=</code> / <code>!=</code> / <code>&gt;</code> / <code>&lt;</code> / <code>&gt;=</code> / <code>&lt;=</code>.
      </p>

      <input
        className="share-input"
        placeholder='e.g. tool=get_brain_state status=error'
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginTop: 10 }}
      />

      {q && (
        <div className="muted small-note" style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11 }}>
          parsed: {clauses.map((c) => c.kind === 'op' ? `${c.field}${c.op}${c.value}` : `"${c.value}"`).join(' · ')}
        </div>
      )}

      <div className="muted small-note" style={{ marginTop: 8 }}>
        {hits.length} of {spans.length} match
      </div>

      <div style={{ marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>
        {hits.slice(0, 80).map((s) => (
          <div
            key={s.span_id}
            style={{
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.03)',
              borderLeft: `3px solid ${s.status?.code === 'error' ? '#dd6974' : '#5ee69a'}`,
              borderRadius: 4,
              marginTop: 2,
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{s.name}</strong>
              <span className="muted small-note">{s.duration_ms ?? '?'}ms · {s.status?.code}</span>
            </div>
            <span className="muted small-note">{JSON.stringify(s.attributes)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
