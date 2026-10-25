import { describe, expect, it } from '../test/tinyVitest.js';
import { CALIBRATION_CORPUS } from './calibrationCorpus.js';
import { HOLDOUT_CORPUS } from './holdoutCorpus.js';
import { techniquePressure } from './persuasionTechniques.js';
import { buildHoldoutReport, describeItem, formatVerdict, rankAgreement } from './holdoutReport.js';

const report = buildHoldoutReport();

describe('the published numbers come from the engine, not from a copywriter', () => {
  // The whole value of the page is that it cannot drift from the code. If
  // someone edits a cue pattern in persuasionTechniques.js, the page must move.
  it('recomputes the in-sample figure rather than storing it', () => {
    expect(report.inSample.rho).toBe(rankAgreement(CALIBRATION_CORPUS).rho);
    expect(report.outOfSample.rho).toBe(rankAgreement(HOLDOUT_CORPUS).rho);
  });

  it('derives the gap from the two figures', () => {
    expect(Math.abs(report.generalisationGap - (report.inSample.rho - report.outOfSample.rho)))
      .toBeLessThan(0.0011);
  });

  it('counts the corpus rather than asserting its size', () => {
    expect(report.corpusSize).toBe(HOLDOUT_CORPUS.length);
    expect(report.items.length).toBe(HOLDOUT_CORPUS.length);
    expect(report.trapCount).toBe(HOLDOUT_CORPUS.filter((item) => item.kind === 'trap').length);
  });

  it('puts the same numbers in the sentence a reader sees', () => {
    const verdict = formatVerdict(report);
    expect(verdict).toContain(String(report.inSample.rho));
    expect(verdict).toContain(String(report.outOfSample.rho));
    expect(verdict).toContain(`${report.classesFound} of ${report.classesExpected}`);
  });
});

describe('the report is worth publishing only if it is unflattering', () => {
  // These are not performance targets. They record the direction of the result:
  // if the engine ever scored *better* on text it had never seen, the holdout
  // would have been contaminated and the page would be lying.
  it('scores worse on unseen text than on the text it was tuned on', () => {
    expect(report.outOfSample.rho).toBeLessThan(report.inSample.rho);
    expect(report.generalisationGap).toBeGreaterThan(0);
  });

  it('reports its false alarms rather than hiding them behind recall', () => {
    // A benign passage wrongly flagged is the failure a comms team pays for.
    expect(report.falseAlarmCount).toBeGreaterThan(0);
    expect(report.items.filter((item) => item.falseAlarm).length).toBe(report.falseAlarmCount);
  });

  it('admits the paraphrase result, which is the worst one', () => {
    expect(report.paraphraseCount).toBeGreaterThan(0);
    expect(report.paraphraseRecall).toBe(0);
  });
});

describe('describeItem', () => {
  it('shows the phrases behind every detection, so a reader can check it', () => {
    const flagged = report.items.find((item) => item.detected.length > 0);
    expect(Boolean(flagged)).toBe(true);
    for (const detection of flagged.detected) {
      expect(detection.matches.length).toBeGreaterThan(0);
      // Every trigger phrase must genuinely be in the passage being judged.
      for (const phrase of detection.matches) {
        expect(flagged.content.toLowerCase()).toContain(String(phrase).toLowerCase());
      }
    }
  });

  it('names what it missed instead of only what it caught', () => {
    const missing = report.items.filter((item) => item.missed.length > 0);
    expect(missing.length).toBeGreaterThan(0);
    for (const item of missing) {
      for (const id of item.missed) {
        expect(item.expectedTechniques).toContain(id);
        expect(item.detected.map((d) => d.id)).not.toContain(id);
      }
    }
  });

  it('agrees with the engine on the pressure score', () => {
    const item = HOLDOUT_CORPUS[0];
    expect(describeItem(item).pressure).toBe(techniquePressure(item.content).score);
  });

  it('marks a detection on a benign passage as a false alarm', () => {
    for (const item of report.items) {
      expect(item.falseAlarm).toBe(item.kind === 'trap' && item.detected.length > 0);
    }
  });
});
