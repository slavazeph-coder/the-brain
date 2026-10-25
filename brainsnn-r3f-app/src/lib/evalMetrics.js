// Evaluation metrics for scoring against an externally labelled corpus.
//
// The in-repo calibration is ordinal (rank agreement) because our own labels
// are ordinal. Public corpora such as the SemEval persuasion-technique tasks
// carry binary labels per item, which supports stronger statistics: ranking
// quality (AUC), probabilistic accuracy (Brier), and — most importantly —
// whether a score of 80 actually means 80% (calibration error).
//
// Reporting calibration matters because a score that ranks well can still be
// systematically overconfident, and users read these numbers as percentages.

/**
 * Area under the ROC curve, computed from ranks so ties are handled correctly.
 * Equivalent to the probability that a random positive outranks a random
 * negative. 0.5 is chance.
 */
export function rocAuc(scores, labels) {
  const rows = scores
    .map((score, index) => ({ score, label: labels[index] ? 1 : 0 }))
    .filter((row) => Number.isFinite(row.score));
  const positives = rows.filter((row) => row.label === 1).length;
  const negatives = rows.length - positives;
  if (!positives || !negatives) return 0.5;

  // Average ranks for ties.
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  const ranks = new Array(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[k] = rank;
    i = j + 1;
  }
  let rankSum = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].label === 1) rankSum += ranks[index];
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Mean squared error between a probability and the outcome. Lower is better. */
export function brierScore(probabilities, labels) {
  if (!probabilities.length) return 0;
  let total = 0;
  for (let i = 0; i < probabilities.length; i += 1) {
    const p = Math.max(0, Math.min(1, probabilities[i]));
    total += (p - (labels[i] ? 1 : 0)) ** 2;
  }
  return total / probabilities.length;
}

/**
 * Expected Calibration Error with a reliability table. Bins predictions and
 * compares mean predicted probability against observed frequency, so we can
 * say plainly whether "80" behaves like 80%.
 */
export function expectedCalibrationError(probabilities, labels, { bins = 10 } = {}) {
  const table = Array.from({ length: bins }, () => ({ count: 0, predicted: 0, observed: 0 }));
  for (let i = 0; i < probabilities.length; i += 1) {
    const p = Math.max(0, Math.min(0.999999, probabilities[i]));
    const bin = table[Math.floor(p * bins)];
    bin.count += 1;
    bin.predicted += p;
    bin.observed += labels[i] ? 1 : 0;
  }
  let ece = 0;
  const reliability = table.map((bin, index) => {
    const entry = {
      bin: index,
      range: [index / bins, (index + 1) / bins],
      count: bin.count,
      meanPredicted: bin.count ? bin.predicted / bin.count : 0,
      observedRate: bin.count ? bin.observed / bin.count : 0,
    };
    if (bin.count) ece += (bin.count / probabilities.length) * Math.abs(entry.meanPredicted - entry.observedRate);
    return entry;
  });
  return { ece: Math.round(ece * 10000) / 10000, reliability };
}

/** Precision, recall and F1 at a threshold, for per-technique detection. */
export function classificationAt(scores, labels, threshold) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < scores.length; i += 1) {
    const predicted = scores[i] >= threshold;
    const actual = Boolean(labels[i]);
    if (predicted && actual) tp += 1;
    else if (predicted && !actual) fp += 1;
    else if (!predicted && actual) fn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    threshold,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    tp,
    fp,
    fn,
  };
}

/** The threshold maximising F1, so a detector is judged at its best operating point. */
export function bestF1(scores, labels, { steps = 20 } = {}) {
  let best = classificationAt(scores, labels, 0);
  for (let step = 1; step <= steps; step += 1) {
    const candidate = classificationAt(scores, labels, (step / steps) * 100);
    if (candidate.f1 > best.f1) best = candidate;
  }
  return best;
}

/**
 * Full report for one binary dimension. `scores` are 0-100 engine outputs.
 */
export function evaluateBinary(scores, labels, { bins = 10 } = {}) {
  const probabilities = scores.map((score) => Math.max(0, Math.min(1, score / 100)));
  const { ece, reliability } = expectedCalibrationError(probabilities, labels, { bins });
  return {
    n: scores.length,
    positives: labels.filter(Boolean).length,
    auc: Math.round(rocAuc(scores, labels) * 10000) / 10000,
    brier: Math.round(brierScore(probabilities, labels) * 10000) / 10000,
    ece,
    reliability,
    bestF1: bestF1(scores, labels),
  };
}
