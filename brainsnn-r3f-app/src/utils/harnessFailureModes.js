/**
 * Layer 102 — Failure-mode taxonomy
 *
 * HALO ships a named list of failure modes its analyzer looks for —
 * "hallucinated tool calls", "redundant args", "refusal loops". Each
 * mode is a pattern the harness keeps falling into. The Brain has its
 * own failure modes; this module codifies them as detectors that run
 * over the unified telemetry span buffer.
 *
 * Each detector returns:
 *   { id, label, severity, count, examples: [span], hint? }
 *
 * `hint` is an actionable nudge the report writer (or a coding agent
 * via Layer 19 MCP) can act on without further context.
 *
 * Severity tiers: 'info' < 'warn' < 'critical'.
 */

import { aggregateByName, recentSpans } from './telemetry.js';
import { mineSpansByOutcome } from './harnessLift.js';
import { decorateSpansWithAnnotations } from './spanAnnotation.js';

const SLOW_SCAN_MS = 250;
const HUNG_MCP_MS = 4000;

function pickExamples(spans, n = 3) {
  return spans.slice(0, n).map((s) => ({
    name: s.name,
    span_id: s.span_id,
    duration_ms: s.duration_ms,
    status: s.status?.code,
    attributes: s.attributes,
    end_time: s.end_time,
  }));
}

/* ------------------------------ detectors ----------------------------- */

export function detectErrorBursts(spans) {
  const errs = spans.filter((s) => s.status?.code === 'error');
  if (errs.length < 3) return null;
  // burst = >=3 errors within a 60-second window
  const sorted = errs.slice().sort((a, b) => (a.end_time || 0) - (b.end_time || 0));
  let bursts = 0;
  for (let i = 0; i < sorted.length - 2; i++) {
    if ((sorted[i + 2].end_time - sorted[i].end_time) <= 60_000) bursts += 1;
  }
  if (bursts === 0) return null;
  return {
    id: 'error-burst',
    label: 'Error burst',
    severity: 'critical',
    count: errs.length,
    examples: pickExamples(sorted, 3),
    hint: 'Multiple errors within a 60-second window. Inspect the most recent span attributes — likely a flapping integration or expired credential.',
  };
}

export function detectSlowScans(spans) {
  const slow = spans.filter((s) => s.name === 'firewall.scan' && (s.duration_ms || 0) > SLOW_SCAN_MS);
  if (slow.length < 3) return null;
  return {
    id: 'slow-scan',
    label: 'Slow firewall scans',
    severity: 'warn',
    count: slow.length,
    examples: pickExamples(slow.sort((a, b) => b.duration_ms - a.duration_ms), 3),
    hint: `Scans exceeding ${SLOW_SCAN_MS}ms. Check rule pack size (Layer 83) or pathological regex; consider Layer 61 Diagnostic to flag dead patterns.`,
  };
}

export function detectHungMcp(spans) {
  const hung = spans.filter((s) => s.name?.startsWith('mcp.') && (s.duration_ms || 0) > HUNG_MCP_MS);
  if (hung.length === 0) return null;
  return {
    id: 'hung-mcp',
    label: 'Hung MCP calls',
    severity: hung.length >= 3 ? 'critical' : 'warn',
    count: hung.length,
    examples: pickExamples(hung, 3),
    hint: `MCP calls over ${HUNG_MCP_MS}ms. Check Layer 19 bridge: stalled WebSocket relay or a tool returning a large payload.`,
  };
}

export function detectDeadPatterns(spans) {
  // Spans that emit `firewall.scan` with no rule hits across many runs
  // suggest the active ruleset is under-firing. Only meaningful when
  // we have ≥10 scans to look at.
  const scans = spans.filter((s) => s.name === 'firewall.scan');
  if (scans.length < 10) return null;
  const empty = scans.filter((s) => (s.attributes?.evidenceCount ?? 0) === 0 && (s.attributes?.pressure ?? 0) < 0.05);
  const ratio = empty.length / scans.length;
  if (ratio < 0.6) return null;
  return {
    id: 'dead-patterns',
    label: 'Under-firing ruleset',
    severity: 'warn',
    count: empty.length,
    examples: pickExamples(empty, 3),
    hint: `${Math.round(ratio * 100)}% of recent scans returned zero evidence. Run Layer 61 Diagnostic, or seed Layer 31 Brain Evolve from the latest red-team run.`,
  };
}

export function detectFpHeavyScans(spans) {
  // Scans with high pressure but low evidence count are suspicious —
  // either feedback (Layer 93) calibration is off, or a single
  // pattern is dominating. Use feedback signal if we have it.
  const fb = spans.filter((s) => s.name === 'firewall.scan' && s.attributes?.feedback === 'too_hot');
  if (fb.length < 2) return null;
  return {
    id: 'fp-heavy',
    label: 'False-positive complaints',
    severity: 'warn',
    count: fb.length,
    examples: pickExamples(fb, 3),
    hint: 'Multiple "too hot" calibration ratings. Inspect Coverage Heatmap (Layer 66) for the pattern that fired and consider widening it.',
  };
}

export function detectAnnotatedFalsePositives(spans) {
  // Layer 105 — operators flagging spans as false-positive is a strong
  // direct signal that the active ruleset is mis-firing
  const fps = spans.filter((s) => s.attributes?._annotation === 'false-positive');
  if (fps.length < 2) return null;
  return {
    id: 'annotated-fp',
    label: 'Operator-flagged false positives',
    severity: fps.length >= 5 ? 'critical' : 'warn',
    count: fps.length,
    examples: pickExamples(fps, 3),
    hint: 'Operators marked these spans as over-firing. Inspect the attributes — likely a single regex pattern catching benign text. Run Layer 66 Coverage Heatmap.',
  };
}

export function detectRefusalLoop(spans) {
  // Three consecutive same-name error spans within 30s = loop
  if (spans.length < 3) return null;
  const sorted = spans.slice().sort((a, b) => (a.end_time || 0) - (b.end_time || 0));
  for (let i = 0; i <= sorted.length - 3; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const c = sorted[i + 2];
    if (
      a.status?.code === 'error'
      && b.status?.code === 'error'
      && c.status?.code === 'error'
      && a.name === b.name && b.name === c.name
      && (c.end_time - a.end_time) < 30_000
    ) {
      return {
        id: 'refusal-loop',
        label: 'Refusal loop',
        severity: 'critical',
        count: 3,
        examples: pickExamples([a, b, c], 3),
        hint: `Three consecutive ${a.name} errors within 30s. Likely the same upstream failure being retried — surface to user, don't auto-retry.`,
      };
    }
  }
  return null;
}

/* ------------------------------ runner ------------------------------- */

const ALL_DETECTORS = [
  detectErrorBursts,
  detectRefusalLoop,
  detectHungMcp,
  detectSlowScans,
  detectDeadPatterns,
  detectFpHeavyScans,
  detectAnnotatedFalsePositives,
];

/**
 * Run every detector and produce the unified harness diagnostic
 * report. Optional `liftAttributes` lets you mine which attribute
 * values correlate with errors.
 */
export function runDiagnostic({
  spans = recentSpans(500),
  liftAttributes = ['name', 'tool'],
} = {}) {
  // Layer 105 — fold operator annotations into span attributes so
  // detectors and the lift miner can see them
  const decorated = decorateSpansWithAnnotations(spans);
  const findings = [];
  for (const fn of ALL_DETECTORS) {
    try {
      const f = fn(decorated);
      if (f) findings.push(f);
    } catch { /* a single broken detector mustn't take down the report */ }
  }
  spans = decorated;

  const byName = aggregateByName(spans);
  const errorLift = mineSpansByOutcome(spans, {
    attributeKeys: liftAttributes,
    isPositive: (s) => s.status?.code === 'error',
    minPositive: 2,
    minLift: 2,
    topK: 8,
  });

  const totals = {
    spans: spans.length,
    errors: spans.filter((s) => s.status?.code === 'error').length,
    distinctNames: byName.length,
  };

  const tier = (
    findings.some((f) => f.severity === 'critical') ? 'critical'
      : findings.some((f) => f.severity === 'warn') ? 'warn'
        : 'healthy'
  );

  return {
    brainsnn: 'harness-report-v1',
    generatedAt: new Date().toISOString(),
    tier,
    totals,
    findings,
    aggregates: byName.slice(0, 12),
    errorLift: errorLift.candidates,
  };
}

/**
 * Render the report as a compact text block — easy to copy-paste into
 * Cursor / Claude Code with a "fix what you can" prompt.
 */
export function renderReportText(report) {
  if (!report) return '';
  const lines = [];
  lines.push(`# BrainSNN Harness Diagnostic — ${report.tier.toUpperCase()}`);
  lines.push(`Generated ${report.generatedAt}`);
  lines.push(`Spans: ${report.totals.spans} · Errors: ${report.totals.errors} · Distinct ops: ${report.totals.distinctNames}`);
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('No failure modes detected.');
  } else {
    lines.push('## Findings');
    for (const f of report.findings) {
      lines.push(`- [${f.severity}] ${f.label} ×${f.count}`);
      if (f.hint) lines.push(`    hint: ${f.hint}`);
    }
  }
  if (report.errorLift?.length) {
    lines.push('');
    lines.push('## Error-correlated features (Laplace lift)');
    for (const c of report.errorLift) {
      lines.push(`- ${c.feature} · lift=${c.lift} · err=${c.posCount} ok=${c.negCount}`);
    }
  }
  return lines.join('\n');
}
