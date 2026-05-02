/**
 * Layer 114 — MCP Tool Usage
 *
 * Cross-reference the registered MCP tools (Layer 19 BRAIN_TOOLS)
 * with what's actually been called. Surfaces:
 *
 *   - dead tools: registered but never called over the buffer window
 *   - hot tools: top-N by call count
 *   - slow tools: highest p95 duration
 *   - flaky tools: highest error rate
 *
 * Pure: takes BRAIN_TOOLS + spans, returns a report. Pairs nicely
 * with Layer 102's dead-pattern detector (this is its MCP cousin).
 */

import { recentSpans } from './telemetry.js';
import { BRAIN_TOOLS } from './mcpBridge.js';

function percentile(arr, q) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function computeUsage(spans = recentSpans(500)) {
  const calls = spans.filter((s) => s.name === 'mcp.tool');
  const byTool = new Map();
  for (const s of calls) {
    const tool = s.attributes?.tool || '(unknown)';
    const b = byTool.get(tool) || { tool, count: 0, errors: 0, durations: [] };
    b.count += 1;
    if (s.status?.code === 'error') b.errors += 1;
    if (typeof s.duration_ms === 'number') b.durations.push(s.duration_ms);
    byTool.set(tool, b);
  }

  const stats = [...byTool.values()].map((b) => ({
    tool: b.tool,
    count: b.count,
    errors: b.errors,
    errorRate: b.count > 0 ? Number((b.errors / b.count).toFixed(3)) : 0,
    p50: percentile(b.durations, 0.5),
    p95: percentile(b.durations, 0.95),
  })).sort((a, b) => b.count - a.count);

  const calledNames = new Set(stats.map((s) => s.tool));
  const dead = (BRAIN_TOOLS || [])
    .filter((t) => !calledNames.has(t.name))
    .map((t) => ({ tool: t.name, description: t.description }));

  const hot = stats.slice(0, 6);
  const slow = stats.slice().sort((a, b) => b.p95 - a.p95).filter((s) => s.p95 > 0).slice(0, 5);
  const flaky = stats.slice().sort((a, b) => b.errorRate - a.errorRate).filter((s) => s.errorRate > 0).slice(0, 5);

  return {
    brainsnn: 'mcp-usage-v1',
    generatedAt: new Date().toISOString(),
    totals: {
      calls: calls.length,
      errors: calls.filter((s) => s.status?.code === 'error').length,
      registered: (BRAIN_TOOLS || []).length,
      called: stats.length,
      dead: dead.length,
    },
    hot,
    slow,
    flaky,
    dead,
    stats,
  };
}
