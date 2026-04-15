/**
 * Brain State Snapshots — persistence, comparison & shareable reports
 *
 * Stores named snapshots of the full brain state in localStorage.
 * Supports export/import as JSON, side-by-side comparison, and
 * generating shareable report summaries.
 */

const STORAGE_KEY = 'brainsnn_snapshots';

// ---------- storage ----------

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeStore(snapshots) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

// ---------- public API ----------

export function listSnapshots() {
  return readStore().map(({ id, name, timestamp, scenario, summary }) => ({
    id, name, timestamp, scenario, summary
  }));
}

export function saveSnapshot(state, name = '') {
  const snapshots = readStore();
  const regions = { ...state.regions };
  const weights = { ...state.weights };
  const mean = Object.values(regions).reduce((a, v) => a + v, 0) / Object.keys(regions).length;
  const plasticity = Object.values(weights).reduce((a, v) => a + v, 0) / Object.keys(weights).length;
  const leadRegion = Object.entries(regions).sort((a, b) => b[1] - a[1])[0][0];

  const snapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name || `${state.scenario} @ tick ${state.tick}`,
    timestamp: new Date().toISOString(),
    scenario: state.scenario,
    tick: state.tick,
    regions,
    weights,
    selected: state.selected,
    burst: state.burst,
    summary: {
      mean: parseFloat(mean.toFixed(4)),
      plasticity: parseFloat(plasticity.toFixed(4)),
      leadRegion,
      regionCount: Object.keys(regions).length,
      connectionCount: Object.keys(weights).length
    }
  };

  snapshots.unshift(snapshot);
  // Keep max 50 snapshots
  if (snapshots.length > 50) snapshots.length = 50;
  writeStore(snapshots);
  return snapshot;
}

export function loadSnapshot(id) {
  const snapshots = readStore();
  return snapshots.find((s) => s.id === id) || null;
}

export function deleteSnapshot(id) {
  const snapshots = readStore().filter((s) => s.id !== id);
  writeStore(snapshots);
}

export function clearAllSnapshots() {
  writeStore([]);
}

// ---------- comparison ----------

export function compareSnapshots(snapA, snapB) {
  if (!snapA || !snapB) return null;

  const regionDiffs = {};
  const allRegions = new Set([...Object.keys(snapA.regions), ...Object.keys(snapB.regions)]);
  for (const key of allRegions) {
    const a = snapA.regions[key] ?? 0;
    const b = snapB.regions[key] ?? 0;
    regionDiffs[key] = {
      a: parseFloat(a.toFixed(4)),
      b: parseFloat(b.toFixed(4)),
      delta: parseFloat((b - a).toFixed(4)),
      pctChange: a > 0 ? parseFloat(((b - a) / a * 100).toFixed(1)) : null
    };
  }

  const weightDiffs = {};
  const allWeights = new Set([...Object.keys(snapA.weights), ...Object.keys(snapB.weights)]);
  for (const key of allWeights) {
    const a = snapA.weights[key] ?? 0;
    const b = snapB.weights[key] ?? 0;
    weightDiffs[key] = {
      a: parseFloat(a.toFixed(4)),
      b: parseFloat(b.toFixed(4)),
      delta: parseFloat((b - a).toFixed(4))
    };
  }

  const meanA = snapA.summary.mean;
  const meanB = snapB.summary.mean;

  return {
    snapA: { id: snapA.id, name: snapA.name, scenario: snapA.scenario },
    snapB: { id: snapB.id, name: snapB.name, scenario: snapB.scenario },
    regionDiffs,
    weightDiffs,
    overallDelta: parseFloat((meanB - meanA).toFixed(4)),
    mostChanged: Object.entries(regionDiffs)
      .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
      .slice(0, 3)
      .map(([key, val]) => ({ region: key, ...val }))
  };
}

// ---------- export / import ----------

export function exportSnapshotJSON(id) {
  const snap = loadSnapshot(id);
  if (!snap) return null;
  return JSON.stringify(snap, null, 2);
}

export function exportAllSnapshotsJSON() {
  return JSON.stringify(readStore(), null, 2);
}

export function importSnapshotsJSON(jsonString) {
  const parsed = JSON.parse(jsonString);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const existing = readStore();
  const existingIds = new Set(existing.map((s) => s.id));
  let imported = 0;

  for (const item of items) {
    if (item.id && item.regions && !existingIds.has(item.id)) {
      existing.unshift(item);
      imported++;
    }
  }

  if (existing.length > 50) existing.length = 50;
  writeStore(existing);
  return imported;
}

// ---------- report generation ----------

export function generateReport(snapshot, firewallResult = null, gemmaResult = null) {
  const lines = [
    `# BrainSNN State Report`,
    ``,
    `**Snapshot:** ${snapshot.name}`,
    `**Scenario:** ${snapshot.scenario}`,
    `**Timestamp:** ${snapshot.timestamp}`,
    `**Tick:** ${snapshot.tick}`,
    ``,
    `## Region Activity`,
    ``,
    `| Region | Activity |`,
    `|--------|----------|`,
    ...Object.entries(snapshot.regions).map(([k, v]) => `| ${k} | ${(v * 100).toFixed(1)}% |`),
    ``,
    `**Mean firing:** ${(snapshot.summary.mean * 100).toFixed(1)}%`,
    `**Plasticity:** ${(snapshot.summary.plasticity * 100).toFixed(1)}%`,
    `**Lead region:** ${snapshot.summary.leadRegion}`,
  ];

  if (firewallResult) {
    lines.push(
      ``,
      `## Cognitive Firewall Scan`,
      ``,
      `- Emotional activation: ${(firewallResult.emotionalActivation * 100).toFixed(0)}%`,
      `- Cognitive suppression: ${(firewallResult.cognitiveSuppression * 100).toFixed(0)}%`,
      `- Manipulation pressure: ${(firewallResult.manipulationPressure * 100).toFixed(0)}%`,
      `- Trust erosion: ${(firewallResult.trustErosion * 100).toFixed(0)}%`,
      `- **Recommendation:** ${firewallResult.recommendedAction}`
    );
  }

  if (gemmaResult) {
    lines.push(
      ``,
      `## Gemma 4 Deep Analysis`,
      ``,
      `- Emotional activation: ${(gemmaResult.emotionalActivation * 100).toFixed(0)}%`,
      `- Cognitive suppression: ${(gemmaResult.cognitiveSuppression * 100).toFixed(0)}%`,
      `- Manipulation pressure: ${(gemmaResult.manipulationPressure * 100).toFixed(0)}%`,
      `- Trust erosion: ${(gemmaResult.trustErosion * 100).toFixed(0)}%`,
      gemmaResult.reasoning ? `- **AI Reasoning:** ${gemmaResult.reasoning}` : '',
      `- **Recommendation:** ${gemmaResult.recommendedAction}`
    );
  }

  lines.push(``, `---`, `*Generated by BrainSNN — neuromorphic brain analysis platform*`);
  return lines.filter(Boolean).join('\n');
}
