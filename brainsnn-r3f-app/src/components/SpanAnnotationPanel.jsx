import React, { useEffect, useMemo, useState } from 'react';
import { recentSpans, subscribe } from '../utils/telemetry';
import {
  STANDARD_LABELS, listAnnotations, annotate, unannotate, annotationStats, clearAnnotations,
} from '../utils/spanAnnotation';

/**
 * Layer 105 — Span Annotation panel.
 *
 * Pick a label, click a span, attach a note. Annotations feed back
 * into Layer 102's runDiagnostic() — operator-marked false positives
 * become a first-class finding and a high-lift signal for the next
 * rule diff.
 */
export default function SpanAnnotationPanel() {
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState('');
  const [annotMap, setAnnotMap] = useState(() => listAnnotations());
  const [pickedLabel, setPickedLabel] = useState(STANDARD_LABELS[0].id);
  const [note, setNote] = useState('');

  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => { setAnnotMap(listAnnotations()); }, [tick]);

  const spans = useMemo(() => recentSpans(120), [tick]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return spans;
    return spans.filter((s) => (
      s.name.toLowerCase().includes(q)
      || JSON.stringify(s.attributes || {}).toLowerCase().includes(q)
    ));
  }, [spans, filter]);

  const stats = useMemo(annotationStats, [annotMap, tick]);

  function tag(spanId) {
    const created = annotate({ spanId, label: pickedLabel, note });
    setAnnotMap({ ...annotMap, [spanId]: created });
    setNote('');
  }
  function untag(spanId) {
    unannotate(spanId);
    const next = { ...annotMap };
    delete next[spanId];
    setAnnotMap(next);
  }
  function clearAll() {
    if (!window.confirm('Clear all span annotations?')) return;
    clearAnnotations();
    setAnnotMap({});
  }

  return (
    <section className="panel panel-pad span-annotation-panel">
      <div className="eyebrow">Layer 105 · span annotation</div>
      <h2>Label spans, sharpen the diagnostic</h2>
      <p className="muted">
        Mark spans as <code>false-positive</code> / <code>real-bug</code> /
        <code> benign</code>. Layer 102 picks up labels on next run —
        operator-flagged false positives surface as their own finding
        and the lift miner uses the labels as features.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {STANDARD_LABELS.map((l) => (
          <button
            key={l.id}
            className={pickedLabel === l.id ? 'btn-sm' : 'ghost small'}
            onClick={() => setPickedLabel(l.id)}
            title={l.desc}
            style={{ borderLeft: `3px solid ${l.tone}` }}
          >
            {l.id}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <input
          className="share-input"
          placeholder="Filter spans (name, attribute value)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <input
          className="share-input"
          placeholder="Optional note for the next click…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
      </div>

      {stats.count > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(122,143,231,0.08)',
            borderLeft: '3px solid #7a8fe7',
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            <strong>{stats.count}</strong> annotations ·{' '}
            {stats.totals.map((t) => `${t.label}×${t.count}`).join(' · ')}
          </span>
          <button className="ghost small" onClick={clearAll} style={{ color: '#dd6974' }}>Clear</button>
        </div>
      )}

      <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <p className="muted small-note">No spans matching filter.</p>
        ) : filtered.slice(0, 60).map((s) => {
          const a = annotMap[s.span_id];
          const labelMeta = a ? STANDARD_LABELS.find((x) => x.id === a.label) : null;
          const tone = labelMeta?.tone || (s.status?.code === 'error' ? '#dd6974' : '#5ee69a');
          return (
            <div
              key={s.span_id}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                marginTop: 2,
                background: a ? `${tone}10` : 'rgba(255,255,255,0.03)',
                borderLeft: `3px solid ${tone}`,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  <strong>{s.name}</strong>
                  <span className="muted small-note" style={{ marginLeft: 8 }}>
                    {s.duration_ms ?? '?'}ms · {s.status?.code}
                  </span>
                </span>
                <span>
                  {a ? (
                    <button className="ghost small" onClick={() => untag(s.span_id)}>Remove</button>
                  ) : (
                    <button className="btn-sm" onClick={() => tag(s.span_id)}>Tag</button>
                  )}
                </span>
              </div>
              <div className="muted small-note">{JSON.stringify(s.attributes)}</div>
              {a && (
                <div style={{ marginTop: 4 }}>
                  <span className="muted small-note">→ </span>
                  <strong style={{ color: tone }}>{a.label}</strong>
                  {a.note && <span className="muted small-note"> — {a.note}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
