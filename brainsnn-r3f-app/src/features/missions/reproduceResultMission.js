import { clampInteger, createSeededRandom } from './missionRuntime.js';

export const REPRODUCE_RESULT_MISSION = Object.freeze({
  id: '004',
  type: 'RESEARCH',
  title: 'Reproduce a Result',
  mission: 'Reproduce a predeclared finite numerical result from the declared seeded dataset and method.',
  boundary: 'Use the full declared dataset and ordinary least squares with an intercept; no hidden trimming or preprocessing.',
  judge: 'Deterministic coefficient acceptance test with absolute error at or below 0.01.',
  claimBoundary: 'This is a finite synthetic reproducibility exercise. Agreement applies only to the declared generated dataset, method, seed and tolerance and is not proof of a scientific theory, external dataset validity or real-world causal effect.',
});

function clampTrim(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(0.45, Math.max(0, parsed));
}

function generateDataset(seed, sampleCount) {
  const random = createSeededRandom(seed, 260829);
  return Array.from({ length: sampleCount }, (_, index) => {
    const x = -2 + random() * 4;
    const noise = (random() - 0.5) * 0.8;
    const y = 1.4 + (2.75 * x) + noise;
    return {
      sampleId: `sample-${String(index + 1).padStart(4, '0')}`,
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
    };
  });
}

function ols(rows) {
  const n = rows.length;
  const meanX = rows.reduce((sum, row) => sum + row.x, 0) / n;
  const meanY = rows.reduce((sum, row) => sum + row.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    numerator += (row.x - meanX) * (row.y - meanY);
    denominator += (row.x - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - (slope * meanX);
  return { slope, intercept };
}

export function runReproduceResultMission({
  seed = 260829,
  samples = 500,
  trimFraction = 0,
} = {}) {
  const sampleCount = clampInteger(samples, { min: 50, max: 2000, fallback: 500 });
  const trim = clampTrim(trimFraction);
  const dataset = generateDataset(seed, sampleCount);
  const reference = ols(dataset);

  const ranked = dataset
    .map((row) => ({
      ...row,
      residualMagnitude: Math.abs(row.y - (reference.intercept + reference.slope * row.x)),
    }))
    .sort((a, b) => b.residualMagnitude - a.residualMagnitude);
  const trimCount = Math.floor(sampleCount * trim);
  const excluded = new Set(ranked.slice(0, trimCount).map((row) => row.sampleId));
  const used = dataset.filter((row) => !excluded.has(row.sampleId));
  const observed = ols(used);
  const absoluteError = Math.abs(observed.slope - reference.slope);

  const ledger = dataset.map((row) => ({
    ...row,
    included: !excluded.has(row.sampleId),
    boundaryViolation: excluded.has(row.sampleId),
  }));

  const boundaryViolations = trimCount;
  const accepted = absoluteError <= 0.01;
  const status = boundaryViolations > 0
    ? 'BOUNDARY FAILURE'
    : accepted
      ? 'MISSION SUCCESS'
      : 'MISSION INCOMPLETE';

  return {
    mission: REPRODUCE_RESULT_MISSION,
    configuration: {
      seed: Number(seed) || 260829,
      samples: sampleCount,
      trimFraction: trim,
      method: 'ordinary_least_squares_with_intercept',
      tolerance: 0.01,
    },
    metrics: {
      totalSamples: sampleCount,
      samplesUsed: used.length,
      excludedSamples: trimCount,
      referenceSlope: Number(reference.slope.toFixed(8)),
      observedSlope: Number(observed.slope.toFixed(8)),
      absoluteError: Number(absoluteError.toFixed(8)),
      accepted,
      boundaryViolations,
    },
    status,
    ledger,
  };
}

export function compareReproduceResultRuns(baseline, candidate) {
  const previous = new Map(baseline.ledger.map((entry) => [entry.sampleId, entry]));
  let changedInclusion = 0;
  for (const entry of candidate.ledger) {
    if (previous.get(entry.sampleId)?.included !== entry.included) changedInclusion += 1;
  }
  return {
    changedInclusion,
    slopeDelta: Number((candidate.metrics.observedSlope - baseline.metrics.observedSlope).toFixed(8)),
    errorDelta: Number((candidate.metrics.absoluteError - baseline.metrics.absoluteError).toFixed(8)),
    newViolations: Math.max(0, candidate.metrics.boundaryViolations - baseline.metrics.boundaryViolations),
    baselineStatus: baseline.status,
    candidateStatus: candidate.status,
  };
}
