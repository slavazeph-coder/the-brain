// The published evidence page, assembled from code rather than written down.
//
// WHY THIS EXISTS
//
// STRANGER_CLIENT_PASS.md has carried "publish one real case study" as an open
// item for a while, and none existed. For a marketing or comms team a neuron
// sandbox is not a reason to hire anyone; a measured result on text the tool has
// never seen is.
//
// THE ONE RULE
//
// Every number this returns is computed here, at render time, from the same
// modules the product runs on. Nothing is a literal. A page that quotes a
// hand-typed 0.918 becomes wrong the first time someone edits a cue pattern, and
// nobody finds out — which is the precise failure this codebase keeps deleting
// from its own marketing copy. holdoutReport.test.js asserts the derivation.
//
// WHAT IS BEING COMPARED, AND WHY IT IS NOT A TRICK
//
// The honest comparison needs *one predictor over two corpora*, not two
// predictors. `calibrate()` reports manipulationRisk through the whole layer
// stack; `evaluateHoldout()` reports it through `techniquePressure` alone.
// Quoting one against the other would look like a generalisation gap and might
// just be two different functions. So the in-sample figure here is recomputed
// with `techniquePressure` over the calibration corpus — the same function,
// scored the same way, differing only in whether the cue patterns were tuned
// while looking at the text.
//
// That is the number worth publishing, and it is not flattering.

import { spearman } from './calibration.js';
import { CALIBRATION_CORPUS, LEVEL_RANK } from './calibrationCorpus.js';
import { HOLDOUT_CORPUS } from './holdoutCorpus.js';
import { evaluateHoldout } from './holdoutEval.js';
import { DETECTOR_LIMITS, detectTechniques, techniquePressure } from './persuasionTechniques.js';

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/**
 * Rank agreement between human manipulation-risk labels and `techniquePressure`
 * over any corpus. One predictor, so two corpora are comparable.
 */
export function rankAgreement(corpus) {
  const items = corpus.filter((item) => item.labels?.manipulationRisk != null);
  const truth = items.map((item) => LEVEL_RANK[item.labels.manipulationRisk]);
  const predicted = items.map((item) => techniquePressure(item.content).score);
  return { n: items.length, rho: round(spearman(truth, predicted)) };
}

/** What a reader needs to judge one passage: the text, the label, and what the
 *  detector actually said about it, including the phrases that triggered it. */
export function describeItem(item) {
  const found = detectTechniques(item.content);
  const expected = item.techniques || [];
  const foundIds = found.map((entry) => entry.id);
  return {
    id: item.id,
    kind: item.kind,
    content: item.content,
    expectedLevel: item.labels.manipulationRisk,
    expectedTechniques: expected,
    pressure: techniquePressure(item.content).score,
    detected: found.map((entry) => ({
      id: entry.id,
      label: entry.label,
      published: entry.published,
      mapping: entry.mapping,
      confidence: entry.confidence,
      // The phrases that fired it. A detection nobody can check is not evidence.
      matches: entry.matches,
    })),
    missed: expected.filter((id) => !foundIds.includes(id)),
    // On a trap passage every detection is a false alarm by definition.
    falseAlarm: item.kind === 'trap' && foundIds.length > 0,
  };
}

/**
 * Everything the evidence page renders.
 *
 * `verdict` is deliberately blunt. A vendor that leads with its own worst result
 * is the one a comms team can check, and every claim here is one `npm test` away
 * from being contradicted if it drifts.
 */
export function buildHoldoutReport() {
  const heldOut = evaluateHoldout();
  const inSample = rankAgreement(CALIBRATION_CORPUS);
  const outOfSample = rankAgreement(HOLDOUT_CORPUS);

  return {
    inSample,
    outOfSample,
    // The gap is the finding. Positive means it did worse on unseen text, which
    // is the expected and honest direction.
    generalisationGap: round(inSample.rho - outOfSample.rho),
    corpusSize: heldOut.corpusSize,
    passageRecall: heldOut.passageRecall,
    classRecall: heldOut.classRecall,
    classesFound: heldOut.classesFound,
    classesExpected: heldOut.classesExpected,
    falseAlarmRate: heldOut.falseAlarmRate,
    falseAlarmCount: heldOut.falseAlarms.length,
    trapCount: HOLDOUT_CORPUS.filter((item) => item.kind === 'trap').length,
    paraphraseRecall: heldOut.byKind.paraphrase?.classRecall ?? null,
    paraphraseCount: heldOut.byKind.paraphrase?.n ?? 0,
    byKind: heldOut.byKind,
    items: HOLDOUT_CORPUS.map(describeItem),
    limits: DETECTOR_LIMITS,
  };
}

/** The headline, in the words a buyer would use, with the figures substituted. */
export function formatVerdict(report) {
  return `On ${report.corpusSize} passages it had never been tuned against, rank agreement fell from `
    + `${report.inSample.rho} to ${report.outOfSample.rho}. It found `
    + `${report.classesFound} of ${report.classesExpected} annotated techniques, `
    + `missed every one of the ${report.paraphraseCount} expressed in paraphrase, and raised `
    + `${report.falseAlarmCount} false alarms on ${report.trapCount} benign passages.`;
}
