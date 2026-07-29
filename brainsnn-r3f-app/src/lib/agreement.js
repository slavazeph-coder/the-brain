// Inter-annotator agreement (Krippendorff's alpha).
//
// A labelled corpus without an agreement statistic is an opinion, not evidence:
// it says nothing about whether the labels are reproducible by another person.
// Alpha handles what simpler statistics cannot — any number of annotators,
// missing ratings, and ordinal categories where "low vs extreme" is a bigger
// disagreement than "low vs moderate".
//
// Reference: K. Krippendorff, Content Analysis: An Introduction to Its
// Methodology, 3rd ed., ch. 12.

/** Distance functions between two category indices. */
export const METRICS = Object.freeze({
  nominal: () => (a, b) => (a === b ? 0 : 1),
  interval: () => (a, b) => (a - b) ** 2,
  // Ordinal distance depends on how many observations sit between the ranks.
  ordinal: (marginals) => (a, b) => {
    if (a === b) return 0;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let sum = 0;
    for (let g = lo; g <= hi; g += 1) sum += marginals[g] || 0;
    sum -= ((marginals[lo] || 0) + (marginals[hi] || 0)) / 2;
    return sum * sum;
  },
});

/**
 * @param {Array<Array<number|null>>} ratings - one row per unit, one column
 *   per annotator; null or undefined means "not rated".
 * @param {{ metric?: 'nominal'|'ordinal'|'interval', categories?: number }} options
 * @returns {{ alpha: number, observed: number, expected: number, units: number, pairableValues: number }}
 */
export function krippendorffAlpha(ratings, { metric = 'ordinal', categories = null } = {}) {
  const rows = (ratings || []).map((row) => (row || []).filter((value) => value != null && Number.isFinite(value)));
  const usable = rows.filter((row) => row.length >= 2);
  if (!usable.length) {
    return { alpha: 1, observed: 0, expected: 0, units: 0, pairableValues: 0 };
  }

  const maxCategory = categories != null
    ? categories - 1
    : Math.max(...usable.flat());
  const size = maxCategory + 1;

  // Coincidence matrix: every ordered pair within a unit, weighted by 1/(m-1).
  const coincidence = Array.from({ length: size }, () => new Array(size).fill(0));
  for (const row of usable) {
    const m = row.length;
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (i === j) continue;
        coincidence[row[i]][row[j]] += 1 / (m - 1);
      }
    }
  }

  const marginals = coincidence.map((row) => row.reduce((sum, value) => sum + value, 0));
  const total = marginals.reduce((sum, value) => sum + value, 0);
  if (total <= 1) {
    return { alpha: 1, observed: 0, expected: 0, units: usable.length, pairableValues: total };
  }

  const distance = METRICS[metric] ? METRICS[metric](marginals) : METRICS.ordinal(marginals);

  let observed = 0;
  for (let c = 0; c < size; c += 1) {
    for (let k = 0; k < size; k += 1) {
      if (coincidence[c][k] === 0) continue;
      observed += coincidence[c][k] * distance(c, k);
    }
  }
  observed /= total;

  let expected = 0;
  for (let c = 0; c < size; c += 1) {
    for (let k = 0; k < size; k += 1) {
      if (c === k) continue;
      expected += marginals[c] * marginals[k] * distance(c, k);
    }
  }
  expected /= total * (total - 1);

  const alpha = expected === 0 ? 1 : 1 - observed / expected;
  return {
    alpha: Math.round(alpha * 10000) / 10000,
    observed: Math.round(observed * 10000) / 10000,
    expected: Math.round(expected * 10000) / 10000,
    units: usable.length,
    pairableValues: total,
  };
}

/**
 * Conventional reading of alpha. Krippendorff's own guidance: rely on data
 * above 0.8, treat 0.667-0.8 as tentative, and do not draw conclusions below.
 */
export function interpretAlpha(alpha) {
  if (alpha >= 0.8) return { label: 'reliable', usable: true, note: 'Conclusions can rest on these labels.' };
  if (alpha >= 0.667) return { label: 'tentative', usable: true, note: 'Draw only tentative conclusions.' };
  if (alpha > 0) return { label: 'unreliable', usable: false, note: 'Agreement is above chance but too low to rely on.' };
  return { label: 'no agreement', usable: false, note: 'Annotators agree no better than chance.' };
}

/**
 * Agreement per dimension for an annotation set shaped as
 * { itemId: { dimension: { annotatorId: levelIndex } } }.
 */
export function agreementByDimension(annotations, { dimensions, annotators, metric = 'ordinal', categories = null } = {}) {
  const report = {};
  for (const dimension of dimensions) {
    const ratings = Object.values(annotations).map((byDimension) => {
      const perAnnotator = byDimension?.[dimension] || {};
      return annotators.map((annotator) => (perAnnotator[annotator] ?? null));
    });
    const result = krippendorffAlpha(ratings, { metric, categories });
    report[dimension] = { ...result, ...interpretAlpha(result.alpha) };
  }
  return report;
}
