/**
 * Layer 106 — Trace Replay
 *
 * Scrub the unified span buffer like a recording. Given the buffer:
 *   - Pick a window [from, to]
 *   - Walk it forward at 1×, 2×, 8× speed
 *   - At each tick, emit the spans that completed in that bucket
 *
 * Useful for "show me what the harness was doing during the
 * outage at 14:32" without having to re-run the brain.
 *
 * Pure logic — UI handles wall-clock pacing via setInterval.
 */

import { recentSpans } from './telemetry.js';

const STEP_KEY = 'brainsnn_replay_window_v1';

export function loadWindow() {
  try {
    return JSON.parse(localStorage.getItem(STEP_KEY) || 'null');
  } catch { return null; }
}

export function saveWindow(win) {
  try { localStorage.setItem(STEP_KEY, JSON.stringify(win)); } catch { /* noop */ }
}

/**
 * Build a chronological frame list. Each frame represents a slice of
 * the buffer with the spans that ended within the bucket.
 *
 * frameMs: bucket size; smaller → finer granularity, more frames.
 */
export function buildFrames({ spans = recentSpans(500), from, to, frameMs = 1000 } = {}) {
  if (!spans.length) return { frames: [], from: null, to: null, frameMs };
  const sorted = spans
    .filter((s) => typeof s.end_time === 'number')
    .slice()
    .sort((a, b) => a.end_time - b.end_time);
  const start = from ?? sorted[0].end_time;
  const end = to ?? sorted[sorted.length - 1].end_time;
  if (end <= start) return { frames: [], from: start, to: end, frameMs };

  const frames = [];
  let bucketStart = start;
  let cursor = 0;
  while (bucketStart < end) {
    const bucketEnd = Math.min(end, bucketStart + frameMs);
    const items = [];
    while (cursor < sorted.length && sorted[cursor].end_time <= bucketEnd) {
      items.push(sorted[cursor]);
      cursor += 1;
    }
    frames.push({
      tStart: bucketStart,
      tEnd: bucketEnd,
      spans: items,
      stats: {
        count: items.length,
        errors: items.filter((s) => s.status?.code === 'error').length,
        names: [...new Set(items.map((s) => s.name))],
      },
    });
    bucketStart = bucketEnd;
  }
  return { frames, from: start, to: end, frameMs };
}

/**
 * Roll-forward state: walk frames, accumulate per-name running
 * totals. Lets a UI show "spans by name as the replay progresses".
 */
export function rollForward(frames, upToIndex) {
  const totals = new Map();
  let errors = 0;
  let count = 0;
  for (let i = 0; i <= upToIndex && i < frames.length; i++) {
    const f = frames[i];
    count += f.stats.count;
    errors += f.stats.errors;
    for (const s of f.spans) {
      const k = s.name;
      const v = totals.get(k) || { count: 0, errors: 0 };
      v.count += 1;
      if (s.status?.code === 'error') v.errors += 1;
      totals.set(k, v);
    }
  }
  return {
    count,
    errors,
    byName: [...totals.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}
