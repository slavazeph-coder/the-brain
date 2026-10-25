// Per-sentence math for content scores.
//
// The headline scores are weighted sums over term-bank hits, which makes them
// deterministic but opaque: "Manipulation Risk 72" says nothing about *why*.
// This module answers that by re-running the scorer on modified inputs, which
// is genuinely new information rather than a restatement of the same features.
//
//   * contribution — leave-one-sentence-out: how much each sentence adds to
//     each score (baseline minus the score without it).
//   * uncertainty  — the same leave-one-out runs, read as a jackknife, give a
//     standard error and range. This is a real estimator, not an asserted
//     confidence number.
//   * order sensitivity — seeded sentence shuffles show whether the verdict
//     depends on composition or merely on arrangement.
import { analyzeContentLocally } from './analysisEngine.js';
import { runLayerRouter } from './layerRouter.js';
import { getHeadlineScores } from './headlineScores.js';
import { splitIntoSegments } from './validation.js';
import { createRng } from './rng.js';

// Each extra sentence costs one full local scan, so cap the work. 18 matches
// the ceiling splitIntoSegments already applies.
export const MAX_ABLATION_SENTENCES = 18;

export function scoreText(content) {
  const baseResult = analyzeContentLocally({ content, contentType: 'text', forceFallback: true });
  const result = runLayerRouter({ content, contentType: 'text', baseResult });
  return { result, scores: Object.fromEntries(getHeadlineScores(result).map((score) => [score.id, score.value])) };
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Leave-one-sentence-out contributions plus a jackknife uncertainty band.
 * Returns null when the text has fewer than two sentences, where per-sentence
 * attribution is meaningless.
 */
export function analyzeSensitivity(content, { seed = 'ablation', shuffles = 6 } = {}) {
  const segments = splitIntoSegments(content).slice(0, MAX_ABLATION_SENTENCES);
  const baseline = scoreText(content);
  const scoreIds = Object.keys(baseline.scores);

  if (segments.length < 2) {
    return {
      baseline: baseline.scores,
      sentences: [],
      band: null,
      orderSensitivity: null,
      note: 'Add a second sentence to see per-sentence contributions.',
    };
  }

  const sentences = segments.map((sentence, index) => {
    const without = segments.filter((_, other) => other !== index).join(' ');
    const ablated = scoreText(without);
    const contributions = {};
    for (const id of scoreIds) contributions[id] = round(baseline.scores[id] - ablated.scores[id]);
    return { index, sentence, contributions, scoresWithout: ablated.scores };
  });

  // Jackknife: the leave-one-out replicates estimate the standard error of each
  // score with respect to sentence composition.
  const band = {};
  const n = sentences.length;
  for (const id of scoreIds) {
    const replicates = sentences.map((entry) => entry.scoresWithout[id]);
    const replicateMean = replicates.reduce((sum, value) => sum + value, 0) / n;
    const variance = ((n - 1) / n) * replicates.reduce((sum, value) => sum + (value - replicateMean) ** 2, 0);
    band[id] = {
      point: baseline.scores[id],
      min: round(Math.min(...replicates)),
      max: round(Math.max(...replicates)),
      median: round(median(replicates)),
      stderr: round(Math.sqrt(Math.max(0, variance))),
    };
  }

  // Does the verdict depend on what was said, or merely on the running order?
  const rng = createRng(seed);
  const orderScores = [];
  for (let run = 0; run < Math.max(0, shuffles); run += 1) {
    const shuffled = [...segments];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    orderScores.push(scoreText(shuffled.join(' ')).scores);
  }
  const orderSensitivity = {};
  for (const id of scoreIds) {
    const values = orderScores.map((entry) => entry[id]);
    orderSensitivity[id] = values.length
      ? round(Math.max(...values) - Math.min(...values))
      : 0;
  }

  return { baseline: baseline.scores, sentences, band, orderSensitivity, note: '' };
}

/**
 * The sentences driving a single score, largest contribution first, with each
 * one's share of the total positive contribution.
 */
export function topDrivers(sensitivity, scoreId, { limit = 3 } = {}) {
  if (!sensitivity?.sentences?.length) return [];
  const ranked = [...sensitivity.sentences]
    .map((entry) => ({ ...entry, contribution: entry.contributions[scoreId] ?? 0 }))
    .filter((entry) => entry.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);
  const total = ranked.reduce((sum, entry) => sum + entry.contribution, 0);
  return ranked.slice(0, limit).map((entry) => ({
    index: entry.index,
    sentence: entry.sentence,
    contribution: entry.contribution,
    share: total > 0 ? round((entry.contribution / total) * 100, 1) : 0,
  }));
}

export function formatBand(entry) {
  if (!entry) return '';
  return `${entry.point} ±${entry.stderr}`;
}
