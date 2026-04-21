/**
 * Layer 67 — Calendar Heatmap
 *
 * Roll the receipt log + context log into a GitHub-style daily grid:
 * 53 weeks × 7 days, each cell colored by (scan count, mean pressure).
 *
 * Source of truth for history: receipt.js rolling log (+ context entries
 * when present) — both have timestamps.
 */

import { recentReceipts } from './receipt';
import { listContextEntries } from './contextMemory';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function ymdFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Build a { [dayKey]: { count, meanPressure, peak } } map from all
 * recorded receipts + context entries.
 */
export function buildDailyBuckets() {
  const buckets = new Map();
  const all = [
    ...recentReceipts().map((r) => ({ ts: r.ts, pressure: r.pressure || 0 })),
    ...listContextEntries().map((e) => ({ ts: e.ts, pressure: e.pressure || 0 })),
  ];
  for (const e of all) {
    if (!e.ts) continue;
    const key = dayKey(e.ts);
    const b = buckets.get(key) || { count: 0, sum: 0, peak: 0 };
    b.count += 1;
    b.sum += e.pressure || 0;
    if ((e.pressure || 0) > b.peak) b.peak = e.pressure || 0;
    buckets.set(key, b);
  }
  const out = {};
  for (const [k, b] of buckets) {
    out[k] = { count: b.count, meanPressure: b.sum / b.count, peak: b.peak };
  }
  return out;
}

/**
 * Return a grid of the last N days (default 53 weeks), column-major
 * (weeks). Each cell: { key, date, weekday, count, meanPressure }.
 */
export function buildGrid({ weeks = 53, now = Date.now() } = {}) {
  const buckets = buildDailyBuckets();
  // End on the most recent Saturday-boundary so the grid aligns
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const endTs = todayUtc;
  const startTs = endTs - (weeks * 7 - 1) * DAY_MS;
  const columns = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const ts = startTs + (w * 7 + d) * DAY_MS;
      if (ts > endTs) { col.push(null); continue; }
      const key = dayKey(ts);
      const b = buckets[key];
      col.push({
        key,
        ts,
        weekday: d,
        count: b?.count || 0,
        meanPressure: b?.meanPressure || 0,
        peak: b?.peak || 0,
      });
    }
    columns.push(col);
  }
  const totalDays = Object.keys(buckets).length;
  const totalScans = Object.values(buckets).reduce((a, b) => a + b.count, 0);
  return {
    columns,
    totalDays,
    totalScans,
    buckets,
    ymd: ymdFromKey,
  };
}

export function colorFor(cell) {
  if (!cell || cell.count === 0) return 'rgba(255,255,255,0.04)';
  const p = cell.meanPressure || 0;
  const strength = Math.min(1, 0.2 + cell.count * 0.05);
  if (p >= 0.55) return `rgba(221,105,116,${0.25 + strength * 0.55})`;
  if (p >= 0.25) return `rgba(253,171,67,${0.18 + strength * 0.55})`;
  return `rgba(109,170,69,${0.18 + strength * 0.55})`;
}
