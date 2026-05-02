import React, { useEffect, useMemo, useState } from 'react';
import { recentSpans, subscribe } from '../utils/telemetry';
import { deriveTour } from '../utils/traceDrivenTour';
import { LAYER_GROUPS } from '../utils/layerCatalog';

/**
 * Layer 110 — Trace-Driven Tour panel.
 *
 * Static role tours (Layer 94) ship six steps regardless of usage.
 * This layer reads the live span buffer and produces a personalized
 * "next thing to try" based on which ops you've actually run.
 */
export default function TraceDrivenTourPanel() {
  const [tick, setTick] = useState(0);

  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);

  const tour = useMemo(() => deriveTour({ spans: recentSpans(500) }), [tick]);

  function jump(layerId) {
    // Reuses the flash-panel helper convention from CommandPalette
    if (typeof window === 'undefined') return;
    const el = document.querySelector(`[data-layer-id="${layerId}"]`)
            || document.querySelector('.panel'); // fallback to first panel
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section className="panel panel-pad trace-driven-tour-panel">
      <div className="eyebrow">Layer 110 · trace-driven tour</div>
      <h2>Tour built from your usage</h2>
      <p className="muted">
        Layer 94 ships static role tours. This layer reads the live
        span buffer (Layer 102) and recommends the next layer based
        on what you've actually been doing.
      </p>

      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(122,143,231,0.08)',
          borderLeft: '3px solid #7a8fe7',
        }}
      >
        <strong>Usage so far</strong>
        <p className="muted small-note" style={{ margin: '4px 0 0' }}>{tour.summary}</p>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="eyebrow">Try these next</div>
        {tour.steps.length === 0 ? (
          <p className="muted small-note">No steps to recommend yet.</p>
        ) : tour.steps.map((s, i) => {
          const groupColor = LAYER_GROUPS[s.group]?.color || '#7a8fe7';
          return (
            <div
              key={s.layerId}
              style={{
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.03)',
                borderLeft: `3px solid ${groupColor}`,
                borderRadius: 6,
                marginTop: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>
                  <span className="muted small-note">L{s.layerId} · </span>
                  {s.label}
                </strong>
                <button className="ghost small" onClick={() => jump(s.layerId)}>Open</button>
              </div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{s.body}</p>
              <span className="muted small-note">→ {s.layerName}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
