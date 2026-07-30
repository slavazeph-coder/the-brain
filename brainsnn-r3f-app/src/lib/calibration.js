// Ordinal calibration of the scoring engine against a labelled corpus.
//
// We do not claim numeric ground truth — "manipulation risk = 84" is not a fact
// about a sentence. What is checkable is ORDER: a phishing email should carry
// more manipulation pressure than an understated luxury line. So calibration is
// reported as rank agreement (Spearman rho) plus the count of pairs whose order
// the engine gets backwards, which is the honest, falsifiable claim.
import { getBusinessMetrics } from './scoreMapping.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { runLayerRouter } from './layerRouter.js';
import {
  CALIBRATION_CORPUS,
  CALIBRATION_DIMENSIONS,
  DIMENSION_METRICS,
  LEVEL_RANK,
} from './calibrationCorpus.js';

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

// Average ranks, so tied labels (many items share a level) rank correctly.
function averageRanks(values) {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  let position = 0;
  while (position < indexed.length) {
    let end = position;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[position].value) end += 1;
    const rank = (position + end) / 2 + 1;
    for (let i = position; i <= end; i += 1) ranks[indexed[i].index] = rank;
    position = end + 1;
  }
  return ranks;
}

export function spearman(a, b) {
  if (a.length !== b.length || a.length < 2) return 0;
  const ra = averageRanks(a);
  const rb = averageRanks(b);
  const n = ra.length;
  const meanA = ra.reduce((sum, value) => sum + value, 0) / n;
  const meanB = rb.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let devA = 0;
  let devB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    num += da * db;
    devA += da * da;
    devB += db * db;
  }
  if (devA <= 0 || devB <= 0) return 0;
  return num / Math.sqrt(devA * devB);
}

export function scoreCorpusItem(item) {
  const baseResult = analyzeContentLocally({ content: item.content, contentType: 'text', forceFallback: true });
  const result = runLayerRouter({ content: item.content, contentType: 'text', baseResult });
  return Object.fromEntries(getBusinessMetrics(result).map((metric) => [metric.id, metric.value]));
}

/**
 * Rank agreement per dimension. `inversions` counts label-ordered pairs the
 * engine ranks backwards; ties in the label are not counted either way.
 */
export function calibrate({ corpus = CALIBRATION_CORPUS } = {}) {
  const scored = corpus.map((item) => ({ item, metrics: scoreCorpusItem(item) }));

  const dimensions = {};
  for (const dimension of CALIBRATION_DIMENSIONS) {
    const metricId = DIMENSION_METRICS[dimension];
    const rows = scored
      .filter(({ item }) => item.labels?.[dimension] != null)
      .map(({ item, metrics }) => ({
        id: item.id,
        expected: LEVEL_RANK[item.labels[dimension]],
        actual: metrics[metricId],
      }));

    let inversions = 0;
    let comparable = 0;
    const worst = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (rows[i].expected === rows[j].expected) continue;
        comparable += 1;
        const expectedHigher = rows[i].expected > rows[j].expected ? rows[i] : rows[j];
        const expectedLower = rows[i].expected > rows[j].expected ? rows[j] : rows[i];
        if (expectedHigher.actual < expectedLower.actual) {
          inversions += 1;
          worst.push({
            higher: expectedHigher.id,
            lower: expectedLower.id,
            gap: round(expectedLower.actual - expectedHigher.actual, 1),
          });
        }
      }
    }
    worst.sort((a, b) => b.gap - a.gap);

    dimensions[dimension] = {
      metric: metricId,
      n: rows.length,
      comparablePairs: comparable,
      inversions,
      inversionRate: comparable ? round(inversions / comparable) : 0,
      spearman: round(spearman(rows.map((row) => row.expected), rows.map((row) => row.actual))),
      worstInversions: worst.slice(0, 3),
    };
  }

  const values = Object.values(dimensions);
  const totalPairs = values.reduce((sum, entry) => sum + entry.comparablePairs, 0);
  const totalInversions = values.reduce((sum, entry) => sum + entry.inversions, 0);

  return {
    corpusSize: corpus.length,
    dimensions,
    overall: {
      comparablePairs: totalPairs,
      inversions: totalInversions,
      pairAccuracy: totalPairs ? round(1 - totalInversions / totalPairs) : 0,
      meanSpearman: round(values.reduce((sum, entry) => sum + entry.spearman, 0) / (values.length || 1)),
    },
  };
}

/** One-line human summary for a calibration card in the UI or README. */
export function formatCalibrationCard(report) {
  const { overall, corpusSize } = report;
  const percent = Math.round(overall.pairAccuracy * 100);
  return `Ranks ${percent}% of ${overall.comparablePairs} labelled comparisons correctly `
    + `across ${corpusSize} archetypes (mean Spearman ${overall.meanSpearman}).`;
}
