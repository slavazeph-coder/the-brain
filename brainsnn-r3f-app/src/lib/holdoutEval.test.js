import { describe, expect, it } from '../test/tinyVitest.js';
import { evaluateHoldout, formatHoldoutCard, scoreHoldoutItem } from './holdoutEval.js';
import { HOLDOUT_CORPUS, HOLDOUT_PROTOCOL } from './holdoutCorpus.js';
import { CALIBRATION_CORPUS } from './calibrationCorpus.js';

const report = evaluateHoldout();

describe('holdout corpus hygiene', () => {
  it('shares no passage with the corpus the detector was tuned on', () => {
    const tuned = new Set(CALIBRATION_CORPUS.map((item) => item.content.trim()));
    for (const item of HOLDOUT_CORPUS) {
      expect(tuned.has(item.content.trim())).toBe(false);
    }
  });

  it('shares no id with the calibration corpus', () => {
    const ids = new Set(CALIBRATION_CORPUS.map((item) => item.id));
    for (const item of HOLDOUT_CORPUS) expect(ids.has(item.id)).toBe(false);
  });

  it('carries the trap and paraphrase cases that make the measurement worth having', () => {
    const kinds = HOLDOUT_CORPUS.map((item) => item.kind);
    expect(kinds.filter((kind) => kind === 'trap').length).toBeGreaterThan(3);
    expect(kinds.filter((kind) => kind === 'paraphrase').length).toBeGreaterThan(2);
  });

  it('gives every trap case an empty technique list and a low label', () => {
    for (const item of HOLDOUT_CORPUS.filter((entry) => entry.kind === 'trap')) {
      expect(item.techniques).toHaveLength(0);
      expect(item.labels.manipulationRisk).toBe('low');
    }
  });

  it('states the do-not-tune protocol', () => {
    expect(HOLDOUT_PROTOCOL).toContain('must not be tuned');
  });
});

// MEASURED, NOT ASPIRED TO.
//
// These assertions record what the detector actually does on text it was never
// tuned against. Several of them pin FAILURES. That is deliberate: a limitation
// with a test around it stays visible, while a limitation in a comment quietly
// rots. Do not "fix" a failing expectation here by editing the detector's cue
// patterns — that would turn the holdout into a second training set and destroy
// the only honest measurement in this file. See holdoutCorpus.js.
//
// Measured 2026-07: held-out Spearman 0.488 (in-sample 0.918), class recall
// 0.50, passage recall 0.67, 3 false alarms on 5 benign passages, and 0 of 4
// paraphrased techniques detected.
describe('measured holdout performance', () => {
  it('generalises far worse than its in-sample number suggests', () => {
    // The honest headline. In-sample was 0.918; anything near that here would
    // mean the holdout is contaminated.
    expect(report.spearman).toBeLessThan(0.7);
    expect(report.spearman).toBeGreaterThan(0.3);
  });

  it('still beats the engine score it augments', () => {
    // The engine score alone measures 0.051 on this set. The detector is the
    // better generaliser even at 0.488, which is why it carries half the weight.
    expect(report.spearman).toBeGreaterThan(0.4);
  });

  it('finds roughly half the annotated classes', () => {
    expect(report.classRecall).toBeGreaterThanOrEqual(0.4);
    expect(report.classRecall).toBeLessThan(0.8);
  });

  // The recall ceiling DETECTOR_LIMITS claims, demonstrated rather than asserted.
  it('is blind to techniques expressed in phrasing outside its cue lists', () => {
    expect(report.byKind.paraphrase.classRecall).toBeLessThan(0.3);
  });

  it('does much better when the phrasing is conventional', () => {
    expect(report.byKind.plain.classRecall).toBeGreaterThan(report.byKind.paraphrase.classRecall);
    expect(report.byKind.plain.classRecall).toBeGreaterThan(0.5);
  });

  // The failure mode that matters most: flagging an honest message.
  it('raises false alarms on benign text that borrows charged vocabulary', () => {
    expect(report.falseAlarms.length).toBeGreaterThan(0);
    const flagged = report.falseAlarms.map((entry) => entry.id);
    expect(flagged.includes('postmortem-with-hard-words')).toBe(true);
  });

  it('does not false-alarm on the honest deadline or the honest limited run', () => {
    const flagged = report.falseAlarms.map((entry) => entry.id);
    expect(flagged.includes('measured-deadline-with-reason')).toBe(false);
    expect(flagged.includes('honest-limited-run')).toBe(false);
  });
});

describe('scoreHoldoutItem', () => {
  it('separates hits, misses and extras', () => {
    const row = scoreHoldoutItem(HOLDOUT_CORPUS.find((item) => item.id === 'political-labelling-post'));
    expect(row.missed).toHaveLength(0);
    expect(row.hit.length).toBeGreaterThan(2);
  });

  it('reports every miss for a passage it does not detect at all', () => {
    const row = scoreHoldoutItem(HOLDOUT_CORPUS.find((item) => item.id === 'paraphrased-scarcity'));
    expect(row.found).toHaveLength(0);
    expect(row.missed).toEqual(['appeal-to-time']);
  });
});

describe('formatHoldoutCard', () => {
  it('reports the held-out numbers plainly, including the false alarms', () => {
    const card = formatHoldoutCard(report);
    expect(card).toContain('held-out');
    expect(card).toMatch(/false alarm/);
  });
});
