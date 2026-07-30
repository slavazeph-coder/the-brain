// Reference distribution for interpreting a score.
//
// The headline scores are 0-100 INDICES, not probabilities. Users read "72" as
// "72%", which is not what it means and is why the calibration harness reports
// a large expected calibration error against any probabilistic reading.
//
// Rather than invent a probability, give the number a meaning that is actually
// true: where it sits against the labelled archetypes. "Higher than 85% of
// known archetypes" is interpretable, checkable, and honest.
import { CALIBRATION_CORPUS } from './calibrationCorpus.js';
import { scoreCorpusItem } from './calibration.js';

let cachedDistribution = null;

/** Sorted engine scores for every corpus item, per metric. Computed once. */
export function referenceDistribution() {
  if (cachedDistribution) return cachedDistribution;
  const byMetric = {};
  for (const item of CALIBRATION_CORPUS) {
    const metrics = scoreCorpusItem(item);
    for (const [id, value] of Object.entries(metrics)) {
      if (!Number.isFinite(value)) continue;
      (byMetric[id] = byMetric[id] || []).push(value);
    }
  }
  for (const values of Object.values(byMetric)) values.sort((a, b) => a - b);
  cachedDistribution = byMetric;
  return cachedDistribution;
}

/**
 * Percentile of `score` within the reference distribution, using the midpoint
 * convention so ties do not read as beating themselves.
 */
export function scorePercentile(metricId, score) {
  const values = referenceDistribution()[metricId];
  if (!values?.length || !Number.isFinite(score)) return null;
  let below = 0;
  let equal = 0;
  for (const value of values) {
    if (value < score) below += 1;
    else if (value === score) equal += 1;
  }
  return Math.round(((below + equal / 2) / values.length) * 100);
}

export function ordinal(value) {
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th';
  return `${value}${suffix}`;
}

/** Plain-language reading of where a score sits. */
export function describePercentile(metricId, score) {
  const percentile = scorePercentile(metricId, score);
  if (percentile == null) return '';
  const corpusSize = referenceDistribution()[metricId]?.length || 0;
  if (percentile >= 90) return `higher than ${percentile}% of ${corpusSize} known archetypes`;
  if (percentile <= 10) return `lower than ${100 - percentile}% of ${corpusSize} known archetypes`;
  return `around the ${ordinal(percentile)} percentile of ${corpusSize} known archetypes`;
}

// Kept explicit so the UI never implies a probability it cannot support.
export const SCORE_SCALE_NOTE = 'Scores are 0–100 indices, not probabilities. '
  + 'The percentile compares this text against the labelled archetype corpus.';
