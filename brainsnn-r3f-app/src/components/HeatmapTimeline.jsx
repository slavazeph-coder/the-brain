import React, { useEffect, useRef } from 'react';
import { createHeatmapBuffer, pushFrame, getOrderedSeries, valueToColor } from '../utils/heatmapBuffer';
import { REGION_INFO } from '../data/network';

const CELL_W = 6;
const CELL_H = 22;
const LABEL_W = 42;
const MAX_STEPS = 80;

export default function HeatmapTimeline({ state }) {
  const canvasRef = useRef(null);
  const bufferRef = useRef(null);
  const regionKeys = Object.keys(state.regions);

  // Initialize buffer
  if (!bufferRef.current) {
    bufferRef.current = createHeatmapBuffer(regionKeys, MAX_STEPS);
  }

  // Push new frame
  useEffect(() => {
    pushFrame(bufferRef.current, state.regions);
  }, [state.tick, state.regions]);

  // Render heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const heatmap = bufferRef.current;
    const series = getOrderedSeries(heatmap);

    const width = LABEL_W + heatmap.filled * CELL_W;
    const height = regionKeys.length * CELL_H;
    canvas.width = Math.max(width, LABEL_W + 60);
    canvas.height = height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw labels
    ctx.font = '11px monospace';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < regionKeys.length; r++) {
      const key = regionKeys[r];
      ctx.fillStyle = REGION_INFO[key]?.color || '#888';
      ctx.fillText(key, 4, r * CELL_H + CELL_H / 2);
    }

    // Draw cells
    for (let r = 0; r < regionKeys.length; r++) {
      const key = regionKeys[r];
      const vals = series[key];
      if (!vals) continue;
      for (let t = 0; t < vals.length; t++) {
        const [cr, cg, cb] = valueToColor(vals[t]);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(LABEL_W + t * CELL_W, r * CELL_H + 1, CELL_W - 1, CELL_H - 2);
      }
    }
  }, [state.tick, regionKeys]);

  return (
    <section className="panel panel-pad heatmap-panel">
      <div className="eyebrow">Activity Heatmap</div>
      <h2>Region Timeline</h2>
      <p className="muted">
        Color intensity shows activity level over the last {MAX_STEPS} ticks.
        Blue = low, cyan = moderate, yellow = high, red = peak.
      </p>
      <div className="heatmap-scroll">
        <canvas ref={canvasRef} className="heatmap-canvas" />
      </div>
    </section>
  );
}
