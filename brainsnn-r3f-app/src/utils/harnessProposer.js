/**
 * Layer 102 — Harness Proposer
 *
 * Translate a harness diagnostic report into actionable proposals a
 * coding agent (Cursor, Claude Code, Codex) — or a self-driving Brain
 * Steward — can apply. This is the "report → fix" half of HALO's
 * loop, scoped to the Brain's specific lever set:
 *
 *   - propose Layer 55 custom-rule additions from error-correlated
 *     n-gram lift candidates (only those that look like manipulation
 *     vocabulary)
 *   - propose Layer 31 Brain Evolve runs when dead-pattern findings
 *     dominate
 *   - propose Layer 61 Diagnostic / Layer 66 Coverage when slow-scan
 *     or fp-heavy findings dominate
 *
 * Output schema (rule-diff-v1):
 *   {
 *     brainsnn: 'rule-diff-v1',
 *     generatedAt, reportTier,
 *     additions: [{ category, pattern, label, source }],
 *     followUps: [{ layer, action, reason }],
 *   }
 *
 * Pure function — no I/O. The agent decides whether to apply.
 */

const MANIP_HINT = {
  urgency: /\b(now|urgent|hurry|immediately|fast|deadline|expir|countdown|limited)\b/i,
  outrage: /\b(outrage|disgust|shock|scandal|betray|fraud|disgrace|exploit)\b/i,
  fear: /\b(danger|threat|attack|fear|panic|crisis|crash|collapse|warn)\b/i,
  certainty: /\b(proven|guaranteed|certain|absolute|undeniabl|fact|100%|always|never)\b/i,
};

function classifyFeature(feature) {
  // Strip prefix tokens like "name:" / "tool:" — keep only the value
  const value = feature.includes(':') ? feature.split(':').slice(1).join(':') : feature;
  for (const [cat, rx] of Object.entries(MANIP_HINT)) {
    if (rx.test(value)) return { category: cat, value };
  }
  return null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function suggestPatternFromFeature(value) {
  // n-gram features arrive lowercased + space-separated; turn into a
  // case-insensitive word-boundary regex
  const tokens = value.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (tokens.length === 0) return null;
  return `\\b${tokens.join('\\s+')}\\b`;
}

export function proposeRuleDiff(report, { topK = 6 } = {}) {
  const additions = [];
  const followUps = [];

  if (!report || report.brainsnn !== 'harness-report-v1') {
    return {
      brainsnn: 'rule-diff-v1',
      generatedAt: new Date().toISOString(),
      reportTier: report?.tier || 'unknown',
      additions,
      followUps,
    };
  }

  // 1) Mine error-correlated lift candidates that smell like manipulation
  const seen = new Set();
  for (const c of report.errorLift || []) {
    const cls = classifyFeature(c.feature);
    if (!cls) continue;
    if (seen.has(cls.value)) continue;
    seen.add(cls.value);
    const pattern = suggestPatternFromFeature(cls.value);
    if (!pattern) continue;
    additions.push({
      category: cls.category,
      pattern,
      label: `auto-${cls.category}-${seen.size}`,
      source: `error-lift:${c.lift}`,
    });
    if (additions.length >= topK) break;
  }

  // 2) Map findings → next-action recommendations
  const findingIds = new Set((report.findings || []).map((f) => f.id));
  if (findingIds.has('dead-patterns')) {
    followUps.push({
      layer: 31,
      action: 'run-brain-evolve',
      reason: 'Active ruleset is under-firing on recent scans; seed an evolution round from the latest red-team corpus.',
    });
  }
  if (findingIds.has('slow-scan')) {
    followUps.push({
      layer: 61,
      action: 'run-diagnostic',
      reason: 'Scan latency over threshold; audit the active ruleset for dead or pathological patterns.',
    });
  }
  if (findingIds.has('fp-heavy')) {
    followUps.push({
      layer: 66,
      action: 'open-coverage-heatmap',
      reason: 'Repeated "too hot" calibration ratings; inspect which pattern is dominating each scan.',
    });
  }
  if (findingIds.has('hung-mcp') || findingIds.has('refusal-loop')) {
    followUps.push({
      layer: 19,
      action: 'inspect-mcp-bridge',
      reason: 'MCP-side stalling or repeated errors; check the bridge context and the failing tool.',
    });
  }
  if (findingIds.has('error-burst')) {
    followUps.push({
      layer: 21,
      action: 'pause-steward',
      reason: 'Error burst detected — pause the autopilot loop until root cause is understood.',
    });
  }

  return {
    brainsnn: 'rule-diff-v1',
    generatedAt: new Date().toISOString(),
    reportTier: report.tier,
    additions,
    followUps,
  };
}
