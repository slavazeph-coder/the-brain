/**
 * Layer 110 — Trace-Driven Tour
 *
 * Layer 94 (Role Tour) is static — same six steps regardless of how
 * the user actually uses the app. This layer reads the live span
 * buffer + applied-rule log + scan archive, derives a personalized
 * tour from actual usage patterns, and surfaces "you've spent most
 * of your time on X — try Y next."
 *
 * Pure: takes the buffer + signals, emits a tour-v1 envelope. UI
 * decides whether to render or skip.
 */

import { recentSpans, aggregateByName } from './telemetry.js';
import { LAYER_CATALOG } from './layerCatalog.js';

const STEP_LIBRARY = [
  // Triggered when a particular signal fires
  {
    when: ({ topOps }) => topOps.includes('firewall.scan') && topOps.length === 1,
    layerId: 88,
    label: 'Try Persona Simulator',
    body: 'You scan a lot. Persona Simulator runs the same text through 4 reader lenses — see where the manipulation lives between viewpoints.',
  },
  {
    when: ({ totalsByName }) => (totalsByName['mcp.tool'] || 0) > 5,
    layerId: 21,
    label: 'Try Brain Steward',
    body: 'You drive MCP tools manually. The Steward can run the loop for you — auto-snapshot on anomalies, narrate state changes.',
  },
  {
    when: ({ errorRate }) => errorRate > 0.1,
    layerId: 102,
    label: 'Open Harness Diagnostic',
    body: 'Your harness has a non-trivial error rate. Layer 102 clusters spans into named failure modes and proposes fixes.',
  },
  {
    when: ({ totalsByName }) => (totalsByName['steward.tick'] || 0) > 2,
    layerId: 103,
    label: 'Try the Auto-Apply Steward',
    body: 'The Steward runs. Layer 103 polls the diagnostic each cycle and applies low-risk rule diffs automatically — kill-switch always available.',
  },
  {
    when: ({ topOps }) => topOps.includes('firewall.scan') && (topOps.length || 0) >= 2,
    layerId: 104,
    label: 'Snapshot before/after a change',
    body: 'You scan often. Layer 104 lets you snapshot the harness report, make a change, snapshot again, and see exactly what shifted.',
  },
  {
    when: ({ totalsByName }) => (totalsByName['firewall.scan'] || 0) > 10,
    layerId: 67,
    label: 'Open Calendar Heatmap',
    body: 'You scan often enough that a 53-week activity grid will tell you something. Layer 67 buckets receipts + context by day.',
  },
  // Default fallback
  {
    when: () => true,
    layerId: 72,
    label: 'Browse the Layer Explorer',
    body: 'Not sure where to start? Layer 72 indexes all 100+ layers with search + group filter.',
  },
];

function lookupLayer(id) {
  return LAYER_CATALOG.find((l) => l.id === id) || null;
}

export function deriveTour({ spans = recentSpans(500), maxSteps = 5 } = {}) {
  const aggregates = aggregateByName(spans);
  const totalsByName = Object.fromEntries(aggregates.map((a) => [a.name, a.count]));
  const topOps = aggregates.slice(0, 3).map((a) => a.name);
  const totalSpans = aggregates.reduce((s, a) => s + a.count, 0);
  const totalErrors = aggregates.reduce((s, a) => s + a.errorCount, 0);
  const errorRate = totalSpans > 0 ? totalErrors / totalSpans : 0;
  const ctx = { aggregates, totalsByName, topOps, totalSpans, totalErrors, errorRate };

  const steps = [];
  const seen = new Set();
  for (const t of STEP_LIBRARY) {
    let trigger;
    try { trigger = t.when(ctx); } catch { trigger = false; }
    if (!trigger) continue;
    if (seen.has(t.layerId)) continue;
    seen.add(t.layerId);
    const layer = lookupLayer(t.layerId);
    steps.push({
      layerId: t.layerId,
      layerName: layer?.name || 'unknown',
      group: layer?.group || 'view',
      label: t.label,
      body: t.body,
    });
    if (steps.length >= maxSteps) break;
  }

  const summary = (
    totalSpans === 0
      ? 'No usage yet — start with a Cognitive Firewall scan.'
      : `You've run ${totalSpans} ops, ${(errorRate * 100).toFixed(0)}% errors. Top ops: ${topOps.join(', ')}.`
  );

  return {
    brainsnn: 'tour-v1',
    generatedAt: new Date().toISOString(),
    summary,
    context: { totalSpans, totalErrors, errorRate: Number(errorRate.toFixed(3)), topOps },
    steps,
  };
}
