/**
 * Layer 103 — Quantum Sweep
 *
 * Automates parameter sweeps over the L101 single-qubit experiment family
 * and emits a CSV with the same column shape as the offline Qiskit suite at
 * /quantum_alignment/results/results.csv. The point: a user can run a
 * sweep in the browser, download the CSV, and compare it directly against
 * the Qiskit ideal/noisy/real CSV for the same parameters.
 *
 * Three sweep kinds:
 *   - 'phase'         — sweeps θ ∈ [0, π] for fixed noise / shots
 *   - 'noise'         — sweeps noise ∈ [0, 1] for fixed θ / shots
 *   - 'depth'         — sweeps X·X pair count ∈ [0, maxDepth] for fixed
 *                       noise / shots (decoherence experiment)
 *
 * Pure JS, no DOM, deterministic-ish (uses Math.random for shot sampling).
 */

import {
  runPhaseExperiment,
  runDecoherenceExperiment,
  coherenceScore,
} from './quantumCoherence.js';

// ---------- sweep -----------------------------------------------------------

function linspace(start, stop, count) {
  if (count <= 1) return [start];
  const step = (stop - start) / (count - 1);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(start + step * i);
  return out;
}

function rangeInts(start, stop, count) {
  // inclusive, integer-snapped, evenly spaced.
  if (count <= 1) return [Math.round(start)];
  const out = new Set();
  const step = (stop - start) / (count - 1);
  for (let i = 0; i < count; i += 1) {
    out.add(Math.max(0, Math.round(start + step * i)));
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Run a sweep. `kind` is 'phase' | 'noise' | 'depth'. Returns an array of
 * row objects. Each row carries enough context to reproduce: parameter,
 * shots, noise, distribution, counts, expected probability for the ideal
 * outcome where one is well-defined.
 */
export function runSweep({
  kind = 'phase',
  shots = 1024,
  steps = 9,
  noise = 0,
  theta = 0,
  maxDepth = 12,
} = {}) {
  const rows = [];
  if (kind === 'phase') {
    for (const t of linspace(0, Math.PI, steps)) {
      const res = runPhaseExperiment({ theta: t, shots, noise });
      const expectedP0 = Math.cos(t / 2) ** 2;
      rows.push({
        kind,
        parameter: t,
        parameterLabel: `θ=${t.toFixed(3)}`,
        shots,
        noise,
        p0: res.distribution[0],
        p1: res.distribution[1],
        counts0: res.counts[0],
        counts1: res.counts[1],
        expectedP0,
        error: Math.abs(res.distribution[0] - expectedP0),
        coherence: coherenceScore({ noise, depth: 1, observedMidway: false }),
      });
    }
    return rows;
  }
  if (kind === 'noise') {
    for (const n of linspace(0, 1, steps)) {
      const res = runPhaseExperiment({ theta, shots, noise: n });
      const expectedP0 = Math.cos(theta / 2) ** 2;
      rows.push({
        kind,
        parameter: n,
        parameterLabel: `noise=${n.toFixed(2)}`,
        shots,
        noise: n,
        p0: res.distribution[0],
        p1: res.distribution[1],
        counts0: res.counts[0],
        counts1: res.counts[1],
        expectedP0,
        error: Math.abs(res.distribution[0] - expectedP0),
        coherence: coherenceScore({ noise: n, depth: 1, observedMidway: false }),
      });
    }
    return rows;
  }
  if (kind === 'depth') {
    for (const d of rangeInts(0, maxDepth, steps)) {
      const res = runDecoherenceExperiment({ xxPairs: d, shots, noise });
      rows.push({
        kind,
        parameter: d,
        parameterLabel: `xx=${d}`,
        shots,
        noise,
        p0: res.distribution[0],
        p1: res.distribution[1],
        counts0: res.counts[0],
        counts1: res.counts[1],
        expectedP0: 1.0,
        error: Math.abs(res.distribution[0] - 1.0),
        coherence: coherenceScore({ noise, depth: d + 1, observedMidway: false }),
      });
    }
    return rows;
  }
  throw new Error(`Unknown sweep kind: ${kind}`);
}

// ---------- CSV serialization ----------------------------------------------

/**
 * CSV columns mirror the Qiskit suite's results.csv where they overlap.
 * Extra columns (counts0/counts1/coherence) are appended.
 */
export const SWEEP_CSV_COLUMNS = [
  'kind',
  'parameter',
  'parameter_label',
  'shots',
  'noise',
  'p0',
  'p1',
  'counts0',
  'counts1',
  'expected_p0',
  'error',
  'coherence_score',
];

function csvEscape(value) {
  if (value == null) return '';
  const str = typeof value === 'number' ? String(value) : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(rows) {
  const lines = [SWEEP_CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.kind,
      typeof r.parameter === 'number' ? r.parameter.toFixed(6) : r.parameter,
      r.parameterLabel,
      r.shots,
      typeof r.noise === 'number' ? r.noise.toFixed(4) : r.noise,
      r.p0?.toFixed(6) ?? '',
      r.p1?.toFixed(6) ?? '',
      r.counts0,
      r.counts1,
      r.expectedP0?.toFixed(6) ?? '',
      r.error?.toFixed(6) ?? '',
      r.coherence,
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

// ---------- summary stats ---------------------------------------------------

/**
 * Map a sweep summary to brain region deltas (for the L103 Apply-to-brain
 * button). The mapping is intentionally analogous to L101 / L102:
 *
 *   PFC  ↑ avgCoherence  (focus / planning rises with quantum-ness)
 *   AMY  ↑ maxError      (alarm rises with how off-ideal the curve is)
 *   THL  ↑ rangeP0       (sensory routing rises with parameter sensitivity)
 *   HPC  ↑ avgError      (memory / consolidation tied to overall fidelity)
 *   BG   ↑ rangeP0 again (action-selection sharpness)
 *   CBL  ↑ maxError      (correction load)
 *   CTX  ↑ n / 33        (cortical area scales with sweep resolution)
 *
 * All deltas land in [-0.5, +0.5] before App.jsx applies its 0.3 scaling
 * factor.
 */
export function sweepBrainDeltas(summary) {
  if (!summary) return null;
  const clamp = (v) => Math.max(-0.5, Math.min(0.5, v));
  return {
    PFC: clamp((summary.avgCoherence / 100) * 0.5),
    AMY: clamp(summary.maxError),
    THL: clamp(summary.rangeP0 * 0.5),
    HPC: clamp(summary.avgError),
    BG: clamp(summary.rangeP0 * 0.4),
    CBL: clamp(summary.maxError * 0.8),
    CTX: clamp((summary.n / 33) * 0.4),
  };
}

export function sweepSummary(rows) {
  if (!rows.length) return null;
  let maxError = 0;
  let avgError = 0;
  let minP0 = Infinity;
  let maxP0 = -Infinity;
  let avgCoherence = 0;
  for (const r of rows) {
    if (r.error > maxError) maxError = r.error;
    avgError += r.error;
    if (r.p0 < minP0) minP0 = r.p0;
    if (r.p0 > maxP0) maxP0 = r.p0;
    avgCoherence += r.coherence;
  }
  return {
    n: rows.length,
    maxError: maxError,
    avgError: avgError / rows.length,
    minP0,
    maxP0,
    rangeP0: maxP0 - minP0,
    avgCoherence: avgCoherence / rows.length,
  };
}
