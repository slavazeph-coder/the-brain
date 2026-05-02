/**
 * Layer 104 — Harness Comparator
 *
 * "Did my rule change actually help?" — diff two harness-report-v1
 * envelopes (typically a baseline snapshot + the latest report) and
 * surface the deltas a user or coding agent can act on.
 *
 *   - finding deltas: which findings appeared / disappeared / shifted
 *     severity
 *   - aggregate deltas: per-op p50 / error-rate change
 *   - tier transition: healthy → warn → critical and reverse
 *
 * Pure function. Pair with snapshotReport() to capture before/after
 * fixtures around any change.
 */

const TIER_RANK = { healthy: 0, warn: 1, critical: 2, unknown: 0 };
const SEV_RANK = { info: 0, warn: 1, critical: 2 };

function index(arr, key) {
  const m = new Map();
  for (const item of arr || []) m.set(item[key], item);
  return m;
}

export function compareReports(baseline, current) {
  if (!baseline || baseline.brainsnn !== 'harness-report-v1'
   || !current || current.brainsnn !== 'harness-report-v1') {
    return {
      brainsnn: 'harness-diff-v1',
      generatedAt: new Date().toISOString(),
      ok: false,
      reason: 'invalid-input',
    };
  }

  const tierShift = TIER_RANK[current.tier] - TIER_RANK[baseline.tier];
  const tierLabel = (
    tierShift < 0 ? 'improved'
      : tierShift > 0 ? 'regressed'
        : 'unchanged'
  );

  // Findings
  const baseF = index(baseline.findings, 'id');
  const currF = index(current.findings, 'id');
  const findings = { added: [], removed: [], shifted: [] };
  for (const [id, f] of currF) {
    if (!baseF.has(id)) {
      findings.added.push(f);
    } else {
      const prev = baseF.get(id);
      if (SEV_RANK[f.severity] !== SEV_RANK[prev.severity] || f.count !== prev.count) {
        findings.shifted.push({
          id,
          label: f.label,
          severity: { from: prev.severity, to: f.severity },
          count: { from: prev.count, to: f.count },
        });
      }
    }
  }
  for (const [id, f] of baseF) {
    if (!currF.has(id)) findings.removed.push(f);
  }

  // Aggregates
  const baseA = index(baseline.aggregates || [], 'name');
  const currA = index(current.aggregates || [], 'name');
  const aggregates = [];
  const allNames = new Set([...baseA.keys(), ...currA.keys()]);
  for (const name of allNames) {
    const a = baseA.get(name);
    const b = currA.get(name);
    if (!a) {
      aggregates.push({ name, status: 'new', after: b });
    } else if (!b) {
      aggregates.push({ name, status: 'gone', before: a });
    } else {
      aggregates.push({
        name,
        status: 'present',
        countDelta: b.count - a.count,
        p50Delta: b.p50 - a.p50,
        errorRateDelta: Number((b.errorRate - a.errorRate).toFixed(3)),
      });
    }
  }
  aggregates.sort((x, y) => Math.abs((y.errorRateDelta ?? 0)) - Math.abs((x.errorRateDelta ?? 0)));

  // Totals
  const totals = {
    spans: { from: baseline.totals.spans, to: current.totals.spans, delta: current.totals.spans - baseline.totals.spans },
    errors: { from: baseline.totals.errors, to: current.totals.errors, delta: current.totals.errors - baseline.totals.errors },
  };

  return {
    brainsnn: 'harness-diff-v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    tier: { from: baseline.tier, to: current.tier, shift: tierLabel },
    totals,
    findings,
    aggregates: aggregates.slice(0, 12),
  };
}

export function renderDiffText(diff) {
  if (!diff || !diff.ok) return diff?.reason || 'invalid diff';
  const lines = [];
  lines.push(`# Harness diff — ${diff.tier.from} → ${diff.tier.to} (${diff.tier.shift.toUpperCase()})`);
  lines.push(`Spans Δ${diff.totals.spans.delta} · Errors Δ${diff.totals.errors.delta}`);
  if (diff.findings.added.length) {
    lines.push('');
    lines.push('## New findings');
    for (const f of diff.findings.added) lines.push(`+ [${f.severity}] ${f.label} ×${f.count}`);
  }
  if (diff.findings.removed.length) {
    lines.push('');
    lines.push('## Resolved findings');
    for (const f of diff.findings.removed) lines.push(`- [${f.severity}] ${f.label} ×${f.count}`);
  }
  if (diff.findings.shifted.length) {
    lines.push('');
    lines.push('## Severity / count changes');
    for (const f of diff.findings.shifted) {
      lines.push(`~ ${f.label} · ${f.severity.from}→${f.severity.to} · ×${f.count.from}→×${f.count.to}`);
    }
  }
  return lines.join('\n');
}

/* ---------------------------- snapshots ----------------------------- */

const SNAPSHOTS_KEY = 'brainsnn_harness_snapshots_v1';
const MAX_SNAPSHOTS = 20;

export function listSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
  } catch { return []; }
}

export function saveSnapshot({ label, report }) {
  if (!report || report.brainsnn !== 'harness-report-v1') {
    throw new Error('Need a harness-report-v1 to snapshot');
  }
  const list = listSnapshots();
  const entry = {
    id: `hs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    label: (label || `snap-${list.length + 1}`).slice(0, 40),
    report,
  };
  const next = [entry, ...list].slice(0, MAX_SNAPSHOTS);
  try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  return entry;
}

export function deleteSnapshot(id) {
  const next = listSnapshots().filter((s) => s.id !== id);
  try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  return next;
}

export function clearSnapshots() {
  try { localStorage.removeItem(SNAPSHOTS_KEY); } catch { /* noop */ }
}
