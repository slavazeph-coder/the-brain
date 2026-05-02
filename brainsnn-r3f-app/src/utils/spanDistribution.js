/**
 * Layer 111 — Span Distribution
 *
 * Duration histogram + percentiles per span name. Helps spot the
 * tail-latency outliers that aggregateByName's p50/p95 hide.
 *
 * Buckets are log-scale by default (1 / 5 / 10 / 50 / 100 / 500 /
 * 1000 / 5000 / >5000 ms) so a 50× spread compresses readably.
 */

import { recentSpans } from './telemetry.js';

const DEFAULT_BUCKETS = [1, 5, 10, 50, 100, 500, 1000, 5000];

function bucketIndex(durationMs, bounds) {
  for (let i = 0; i < bounds.length; i++) {
    if (durationMs <= bounds[i]) return i;
  }
  return bounds.length;
}

function percentile(arr, q) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function distributionFor(spans = recentSpans(500), { bounds = DEFAULT_BUCKETS, name = null } = {}) {
  const filtered = name ? spans.filter((s) => s.name === name) : spans;
  if (!filtered.length) return null;

  const durations = filtered
    .map((s) => s.duration_ms)
    .filter((d) => typeof d === 'number' && d >= 0);
  if (!durations.length) return null;

  const buckets = new Array(bounds.length + 1).fill(0);
  for (const d of durations) buckets[bucketIndex(d, bounds)] += 1;

  const labels = [...bounds.map((b) => `≤${b}`), `>${bounds[bounds.length - 1]}`];

  return {
    name: name || '(all)',
    count: durations.length,
    min: Math.min(...durations),
    max: Math.max(...durations),
    mean: Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)),
    p50: percentile(durations, 0.5),
    p90: percentile(durations, 0.9),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    bounds,
    buckets,
    labels,
  };
}

export function distributionsByName(spans = recentSpans(500), { topK = 8 } = {}) {
  const byName = new Map();
  for (const s of spans) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  const out = [];
  for (const [name, group] of byName) {
    const d = distributionFor(group, { name });
    if (d) out.push(d);
  }
  return out.sort((a, b) => b.count - a.count).slice(0, topK);
}
