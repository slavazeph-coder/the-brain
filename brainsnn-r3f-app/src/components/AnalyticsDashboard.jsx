import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildRegionTimeseries, correlationMatrix, detectAnomalies,
  checkThresholds, sessionSummary, trendDirection, movingAverage
} from '../utils/analytics';
import { REGION_INFO } from '../data/network';

// ---------- Mini sparkline (canvas) ----------

function Sparkline({ data, width = 120, height = 32, color = '#4fa8b3' }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data?.length) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const max = Math.max(...data, 0.01);
    const step = width / Math.max(data.length - 1, 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    data.forEach((v, i) => {
      const x = i * step;
      const y = height - (v / max) * (height - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // SMA overlay
    const sma = movingAverage(data, 5);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    sma.forEach((v, i) => {
      if (v === null) return;
      const x = i * step;
      const y = height - (v / max) * (height - 4) - 2;
      i === 0 || sma[i - 1] === null ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, width, height, color]);

  return <canvas ref={ref} width={width} height={height} className="analytics-sparkline" />;
}

// ---------- Trend arrow ----------

function TrendArrow({ direction }) {
  const cls = `trend-arrow trend-${direction}`;
  const symbol = direction === 'rising' ? '↑' : direction === 'falling' ? '↓' : '→';
  return <span className={cls}>{symbol}</span>;
}

// ---------- Correlation cell ----------

function CorrCell({ value }) {
  const abs = Math.abs(value);
  const hue = value >= 0 ? 170 : 0; // teal vs red
  const bg = `hsla(${hue},60%,50%,${abs * 0.5})`;
  return (
    <td className="corr-cell" style={{ background: bg }}>
      {value.toFixed(2)}
    </td>
  );
}

// ---------- Main Dashboard ----------

export default function AnalyticsDashboard({ state }) {
  const [expanded, setExpanded] = useState(false);

  // Build a richer history buffer that includes per-region values
  const historyBuffer = useRef([]);
  useEffect(() => {
    historyBuffer.current.push({ regions: { ...state.regions }, tick: state.tick });
    if (historyBuffer.current.length > 100) historyBuffer.current.shift();
  }, [state.tick, state.regions]);

  const timeseries = useMemo(
    () => buildRegionTimeseries(historyBuffer.current, 40),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tick]
  );

  const regionKeys = Object.keys(state.regions);
  const corrMatrix = useMemo(() => correlationMatrix(timeseries), [timeseries]);
  const anomalies = useMemo(() => detectAnomalies(timeseries), [timeseries]);
  const alerts = useMemo(() => checkThresholds(state.regions, timeseries), [state.regions, timeseries]);
  const summary = useMemo(() => sessionSummary(state.regions, timeseries, state.tick), [state.regions, timeseries, state.tick]);

  return (
    <section className="panel panel-pad analytics-dashboard">
      <div className="analytics-header" onClick={() => setExpanded(!expanded)}>
        <div>
          <div className="eyebrow">Neural Analytics</div>
          <h2>Mission Control</h2>
        </div>
        <div className="analytics-summary-bar">
          <span className="analytics-pill">Mean {(summary.meanActivity * 100).toFixed(0)}%</span>
          <span className="analytics-pill">Lead {summary.leadRegion}</span>
          <span className="analytics-pill trend-rising">{summary.risingCount}↑</span>
          <span className="analytics-pill trend-falling">{summary.fallingCount}↓</span>
          {alerts.length > 0 && (
            <span className="analytics-pill alert-pill">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
          )}
          <button className="btn-sm" style={{ marginLeft: 'auto' }}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Always-visible: compact trend row */}
      <div className="analytics-trend-row">
        {regionKeys.map((key) => (
          <div key={key} className="analytics-trend-cell">
            <span className="analytics-region-label" style={{ color: REGION_INFO[key]?.color || '#fff' }}>
              {key}
            </span>
            <Sparkline data={timeseries[key] || []} color={REGION_INFO[key]?.color || '#4fa8b3'} />
            <div className="analytics-trend-footer">
              <span>{((state.regions[key] || 0) * 100).toFixed(0)}%</span>
              <TrendArrow direction={trendDirection(timeseries[key] || [])} />
            </div>
          </div>
        ))}
      </div>

      {expanded && (
        <>
          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="analytics-alerts">
              <div className="eyebrow">Active alerts</div>
              <div className="analytics-alert-list">
                {alerts.map((a, i) => (
                  <div key={i} className={`analytics-alert ${a.severity}`}>
                    <span className="analytics-alert-icon">{a.severity === 'warning' ? '⚠' : 'ℹ'}</span>
                    <span>{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Anomalies */}
          {anomalies.length > 0 && (
            <div className="analytics-anomalies">
              <div className="eyebrow">Anomaly detections (z-score &gt; 2.0)</div>
              <div className="analytics-anomaly-list">
                {anomalies.slice(0, 5).map((a, i) => (
                  <div key={i} className="analytics-anomaly-item">
                    <strong>{a.region}</strong>
                    <span>tick {a.tick}</span>
                    <span>{(a.value * 100).toFixed(0)}%</span>
                    <span className="analytics-zscore">z={a.zScore}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Correlation matrix */}
          <div className="analytics-corr">
            <div className="eyebrow">Region correlation matrix</div>
            <div className="analytics-corr-scroll">
              <table className="corr-table">
                <thead>
                  <tr>
                    <th />
                    {regionKeys.map((k) => <th key={k}>{k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {regionKeys.map((row) => (
                    <tr key={row}>
                      <th>{row}</th>
                      {regionKeys.map((col) => {
                        const key = row <= col ? `${row}-${col}` : `${col}-${row}`;
                        return <CorrCell key={col} value={corrMatrix[key] ?? 0} />;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Session stats */}
          <div className="analytics-session-stats">
            <div className="eyebrow">Session stats</div>
            <div className="metric-grid">
              <div className="metric"><small>Tick</small><strong>{summary.tick}</strong></div>
              <div className="metric"><small>Mean activity</small><strong>{(summary.meanActivity * 100).toFixed(1)}%</strong></div>
              <div className="metric"><small>Lead</small><strong>{summary.leadRegion}</strong></div>
              <div className="metric"><small>Trailing</small><strong>{summary.trailingRegion}</strong></div>
              <div className="metric"><small>Rising</small><strong>{summary.risingCount}</strong></div>
              <div className="metric"><small>Falling</small><strong>{summary.fallingCount}</strong></div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
