import React, { useEffect, useMemo, useState } from 'react';
import { recentSpans, subscribe } from '../utils/telemetry';
import { computeUsage } from '../utils/mcpToolUsage';

/**
 * Layer 114 — MCP Tool Usage panel.
 */
export default function McpToolUsagePanel() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  const usage = useMemo(() => computeUsage(recentSpans(500)), [tick]);

  return (
    <section className="panel panel-pad mcp-tool-usage-panel">
      <div className="eyebrow">Layer 114 · MCP tool usage</div>
      <h2>Hot · slow · flaky · dead</h2>
      <p className="muted">
        Cross-references Layer 19 BRAIN_TOOLS against actual mcp.tool
        spans in the buffer. Surfaces hot tools, slow tails, flaky
        error rates, and dead tools (registered but never called).
      </p>

      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(122,143,231,0.08)',
          borderLeft: '3px solid #7a8fe7',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <strong>
          {usage.totals.calls} calls · {usage.totals.errors} errors · {usage.totals.called} / {usage.totals.registered} tools used
        </strong>
        <span className="muted small-note">
          {usage.totals.dead} dead
        </span>
      </div>

      <ToolList title="Hot" tone="#5ee69a" tools={usage.hot} columns={['count', 'p50', 'p95']} />
      <ToolList title="Slow (by p95)" tone="#fdab43" tools={usage.slow} columns={['count', 'p50', 'p95']} />
      <ToolList title="Flaky (by error rate)" tone="#dd6974" tools={usage.flaky} columns={['count', 'errors', 'errorRate']} />

      {usage.dead.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Dead tools (registered, never called)</div>
          {usage.dead.slice(0, 10).map((d) => (
            <div
              key={d.tool}
              style={{
                padding: '4px 10px',
                background: 'rgba(221,105,116,0.08)',
                borderLeft: '3px solid #dd6974',
                borderRadius: 6,
                marginTop: 2,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              <strong>{d.tool}</strong>
              <div className="muted small-note">{d.description}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ToolList({ title, tone, tools, columns }) {
  if (!tools.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="eyebrow" style={{ color: tone }}>{title}</div>
      {tools.map((t) => (
        <div
          key={t.tool}
          style={{
            display: 'grid',
            gridTemplateColumns: `1fr ${columns.map(() => '70px').join(' ')}`,
            gap: 8,
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 4,
            marginTop: 2,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          <span>{t.tool}</span>
          {columns.map((c) => (
            <span key={c} className="muted small-note">
              {c === 'errorRate' ? `${Math.round((t[c] || 0) * 100)}%` : (t[c] ?? 0) + (c.startsWith('p') ? 'ms' : '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
