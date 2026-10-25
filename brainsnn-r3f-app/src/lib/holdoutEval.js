// Scoring the technique detector against the holdout set.
//
// The calibration report answers "does the engine rank these the way a human
// labelled them". This answers a narrower and more honest question: on text
// the cue patterns were never tuned against, how often does the detector find
// the technique a human would tag, and how often does it flag something in a
// passage where a human would tag nothing?
//
// Precision and recall are reported separately and per kind, because the
// aggregate hides the thing that matters. A detector that fires on everything
// scores well on recall and is useless; one that never fires scores perfectly
// on the trap cases and is also useless.
import { detectTechniques, techniquePressure } from './persuasionTechniques.js';
import { spearman } from './calibration.js';
import { HOLDOUT_CORPUS, HOLDOUT_KINDS } from './holdoutCorpus.js';
import { LEVEL_RANK } from './calibrationCorpus.js';

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/**
 * Per-item detection outcome. `expected` is what a human annotator tagged;
 * `found` is what the detector returned.
 */
export function scoreHoldoutItem(item) {
  const found = detectTechniques(item.content).map((entry) => entry.id);
  const expected = item.techniques || [];
  const hit = expected.filter((id) => found.includes(id));
  const missed = expected.filter((id) => !found.includes(id));
  // On a trap item every detection is a false alarm. On a labelled item, an
  // extra technique is not automatically wrong — a passage can carry more than
  // the annotator listed — so it is reported but not counted against recall.
  const extra = found.filter((id) => !expected.includes(id));
  return {
    id: item.id,
    kind: item.kind,
    expected,
    found,
    hit,
    missed,
    extra,
    pressure: techniquePressure(item.content).score,
  };
}

/**
 * Aggregate report. Kept free of thresholds on purpose: this module measures,
 * it does not judge. The tests decide what is acceptable, and the README
 * quotes whatever this returns.
 */
export function evaluateHoldout({ corpus = HOLDOUT_CORPUS } = {}) {
  const rows = corpus.map(scoreHoldoutItem);

  const labelled = rows.filter((row) => row.expected.length > 0);
  const traps = rows.filter((row) => row.kind === 'trap');

  const totalExpected = labelled.reduce((sum, row) => sum + row.expected.length, 0);
  const totalHit = labelled.reduce((sum, row) => sum + row.hit.length, 0);

  // Passage-level: did we notice this passage was doing something at all?
  const flagged = labelled.filter((row) => row.found.length > 0).length;
  const falseAlarms = traps.filter((row) => row.found.length > 0);

  const byKind = {};
  for (const kind of HOLDOUT_KINDS) {
    const subset = rows.filter((row) => row.kind === kind);
    if (!subset.length) continue;
    const expectedHere = subset.reduce((sum, row) => sum + row.expected.length, 0);
    const hitHere = subset.reduce((sum, row) => sum + row.hit.length, 0);
    byKind[kind] = {
      n: subset.length,
      passagesFlagged: subset.filter((row) => row.found.length > 0).length,
      classRecall: expectedHere ? round(hitHere / expectedHere) : null,
      expectedClasses: expectedHere,
    };
  }

  const truth = corpus.map((item) => LEVEL_RANK[item.labels.manipulationRisk]);
  const predicted = corpus.map((item) => techniquePressure(item.content).score);

  return {
    corpusSize: corpus.length,
    // Fraction of human-tagged classes the detector found.
    classRecall: totalExpected ? round(totalHit / totalExpected) : 0,
    classesExpected: totalExpected,
    classesFound: totalHit,
    // Fraction of manipulative passages flagged with at least one technique.
    passageRecall: labelled.length ? round(flagged / labelled.length) : 0,
    // Benign passages wrongly flagged — the failure mode that matters most.
    falseAlarmRate: traps.length ? round(falseAlarms.length / traps.length) : 0,
    falseAlarms: falseAlarms.map((row) => ({ id: row.id, found: row.found })),
    // Rank agreement on unseen text, directly comparable to the in-sample 0.918.
    spearman: round(spearman(truth, predicted)),
    byKind,
    rows,
  };
}

/** One-line summary for the README and the calibration card. */
export function formatHoldoutCard(report) {
  return `On ${report.corpusSize} held-out passages: rank agreement ${report.spearman}, `
    + `${Math.round(report.passageRecall * 100)}% of manipulative passages flagged, `
    + `${Math.round(report.classRecall * 100)}% of annotated classes found, `
    + `${report.falseAlarms.length} false alarm(s) on benign text.`;
}
