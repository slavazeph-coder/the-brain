/**
 * Heatmap Timeline Recorder
 *
 * Accumulates per-region activity over time into a 2D matrix
 * suitable for canvas-based heatmap rendering.
 *
 * Matrix: rows = regions, cols = time steps.
 */

export function createHeatmapBuffer(regionKeys, maxSteps = 80) {
  const buffer = {};
  for (const key of regionKeys) {
    buffer[key] = new Float32Array(maxSteps);
  }
  return { buffer, regionKeys, maxSteps, cursor: 0, filled: 0 };
}

export function pushFrame(heatmap, regions) {
  const { buffer, regionKeys, maxSteps } = heatmap;
  for (const key of regionKeys) {
    buffer[key][heatmap.cursor] = regions[key] ?? 0;
  }
  heatmap.cursor = (heatmap.cursor + 1) % maxSteps;
  heatmap.filled = Math.min(heatmap.filled + 1, maxSteps);
  return heatmap;
}

/**
 * Get the ordered timeseries for rendering (oldest → newest).
 */
export function getOrderedSeries(heatmap) {
  const { buffer, regionKeys, maxSteps, cursor, filled } = heatmap;
  const result = {};
  for (const key of regionKeys) {
    const arr = new Float32Array(filled);
    for (let i = 0; i < filled; i++) {
      const idx = filled < maxSteps ? i : (cursor + i) % maxSteps;
      arr[i] = buffer[key][idx];
    }
    result[key] = arr;
  }
  return result;
}

/**
 * Color mapping: value (0-1) → [r, g, b] (0-255).
 * Uses a cool-to-warm gradient: dark blue → cyan → yellow → red.
 */
export function valueToColor(v) {
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.25) {
    const s = t / 0.25;
    return [0, Math.round(s * 80), Math.round(40 + s * 100)];
  }
  if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [0, Math.round(80 + s * 100), Math.round(140 + s * 40)];
  }
  if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [Math.round(s * 255), Math.round(180 + s * 55), Math.round(180 - s * 120)];
  }
  const s = (t - 0.75) / 0.25;
  return [255, Math.round(235 - s * 150), Math.round(60 - s * 60)];
}
