import React, { useEffect, useMemo, useState } from 'react';
import { recentSpans, subscribe } from '../utils/telemetry';
import { distributionsByName } from '../utils/spanDistribution';

/**
 * Layer 111 — Span Distribution panel.
 */
export default function SpanDistributionPanel() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  const dists = useMemo(() => distributionsByName(recentSpans(500)), [tick]);

  return (
    <section className="panel panel-pad span-distribution-panel">
      <div className="eyebrow">Layer 111 · span distribution</div>
      <h2>Tail-latency over the buffer</h2>
      <p className="muted">
        Per-name duration histogram + p50 / p90 / p95 / p99. Spots
        the slow tail that the aggregateByName p50/p95 alone can hide.
      </p>

      {dists.length === 0 ? (
        <p className="muted small-note" style={{ marginTop: 10 }}>No spans yet.</p>
      ) : dists.map((d) => (
        <div key={d.name} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{d.name}</strong>
            <span className="muted small-note">
              ×{d.count} · p50 {d.p50}ms · p95 {d.p95}ms · p99 {d.p99}ms · max {d.max}ms
            </span>
          </div>
          <Histogram dist={d} />
        </div>
      ))}
    </section>
  );
}

function Histogram({ dist }) {
  const max = Math.max(1, ...dist.buckets);
  return (
    <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 2 }}>
      {dist.buckets.map((c, i) => {
        const h = (c / max) * 36;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', height: 36, display: 'flex', alignItems: 'flex-end' }}>
              <div
                style={{
                  width: '100%',
                  height: `${h}px`,
                  background: '#7a8fe7',
                  borderRadius: 2,
                }}
              />
            </div>
            <span className="muted small-note" style={{ fontSize: 10, marginTop: 2 }}>{dist.labels[i]}</span>
            <span className="muted small-note" style={{ fontSize: 10 }}>×{c}</span>
          </div>
        );
      })}
    </div>
  );
}
