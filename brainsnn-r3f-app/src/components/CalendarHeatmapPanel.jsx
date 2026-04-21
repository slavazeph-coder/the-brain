import React, { useMemo, useState } from 'react';
import { buildGrid, colorFor } from '../utils/calendarHeatmap';

/**
 * Layer 67 — Calendar Heatmap panel.
 * 53-week × 7-day grid over the rolling receipt + context log.
 */
export default function CalendarHeatmapPanel() {
  const [tick, setTick] = useState(0);
  const grid = useMemo(() => buildGrid(), [tick]);

  return (
    <section className="panel panel-pad calendar-heatmap-panel">
      <div className="eyebrow">Layer 67 · calendar heatmap</div>
      <h2>Scan activity over time</h2>
      <p className="muted">
        Every scan leaves a receipt (Layer 46) and optionally a context
        entry (Layer 63). This grid rolls both into a GitHub-style 53-week
        view — green for calm days, orange for tilted, red when you
        encountered high-pressure content.
      </p>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderRadius: 6,
          background: 'rgba(255,255,255,0.04)',
          marginTop: 10,
        }}
      >
        <span>
          <strong>{grid.totalDays}</strong> active day{grid.totalDays === 1 ? '' : 's'} ·{' '}
          <strong>{grid.totalScans}</strong> scan{grid.totalScans === 1 ? '' : 's'}
        </span>
        <button className="ghost small" onClick={() => setTick((t) => t + 1)}>Refresh</button>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 2,
          overflowX: 'auto',
          padding: '8px 4px',
          background: 'rgba(0,0,0,0.16)',
          borderRadius: 8,
        }}
      >
        {grid.columns.map((col, ci) => (
          <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {col.map((cell, ri) => (
              <div
                key={ri}
                title={
                  cell
                    ? `${cell.key} · ${cell.count} scan${cell.count === 1 ? '' : 's'} · mean ${Math.round(cell.meanPressure * 100)}%`
                    : ''
                }
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: colorFor(cell),
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
        <span className="muted">Less</span>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(109,170,69,0.6)' }} />
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(253,171,67,0.6)' }} />
        <div style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(221,105,116,0.7)' }} />
        <span className="muted">More / higher-pressure</span>
      </div>
    </section>
  );
}
