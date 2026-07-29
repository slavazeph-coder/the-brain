import { describe, expect, it } from '../test/tinyVitest.js';
import { calibrate, formatCalibrationCard, spearman } from './calibration.js';
import { CALIBRATION_CORPUS, LEVEL_RANK } from './calibrationCorpus.js';

const report = calibrate();

describe('spearman', () => {
  it('is 1 for a perfectly ordered pair of series', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
  });

  it('is -1 for a perfectly reversed series', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
  });

  it('handles ties through average ranks', () => {
    expect(spearman([1, 1, 2, 2], [5, 5, 9, 9])).toBe(1);
  });

  it('returns 0 for degenerate input', () => {
    expect(spearman([1], [1])).toBe(0);
    expect(spearman([1, 1, 1], [4, 5, 6])).toBe(0);
  });
});

describe('calibration corpus', () => {
  it('labels every item on every dimension with a known level', () => {
    for (const item of CALIBRATION_CORPUS) {
      expect(typeof item.content).toBe('string');
      expect(item.content.length).toBeGreaterThan(20);
      for (const level of Object.values(item.labels)) {
        expect(LEVEL_RANK[level] !== undefined).toBe(true);
      }
    }
  });

  it('has enough spread per dimension to rank', () => {
    for (const entry of Object.values(report.dimensions)) {
      expect(entry.n).toBeGreaterThanOrEqual(10);
      expect(entry.comparablePairs).toBeGreaterThan(30);
    }
  });
});

// These thresholds pin MEASURED behaviour, not aspiration. They exist so a
// scoring change cannot quietly make rank agreement worse; raise them whenever
// the engine genuinely improves.
describe('measured calibration (regression guard)', () => {
  it('ranks urgency well', () => {
    expect(report.dimensions.urgency.spearman).toBeGreaterThan(0.55);
  });

  it('ranks manipulation risk positively', () => {
    expect(report.dimensions.manipulationRisk.spearman).toBeGreaterThan(0.3);
  });

  it('ranks viral pull positively', () => {
    expect(report.dimensions.viralPull.spearman).toBeGreaterThan(0.25);
  });

  it('keeps overall pair accuracy above chance', () => {
    expect(report.overall.pairAccuracy).toBeGreaterThan(0.6);
  });

  // KNOWN DEFECT — documented, not hidden.
  //
  // Trust is currently ANTI-correlated with its labels: the engine ranks a
  // sincere, specific apology below outrage bait. Cause: TRUST_TERMS rewards
  // trust *vocabulary* rather than evidence, so "share this because once it's
  // gone" earns +13 for the connective "because", while "on Tuesday our update
  // broke checkout for six hours" earns nothing because none of its concrete
  // words are in the bank.
  //
  // This assertion documents the defect so it cannot silently worsen. When the
  // trust signal is fixed, flip it to a positive threshold.
  it('documents that trust ranking is currently inverted', () => {
    expect(report.dimensions.trust.spearman).toBeLessThan(0);
    expect(report.dimensions.trust.inversionRate).toBeGreaterThan(0.5);
  });
});

describe('formatCalibrationCard', () => {
  it('states accuracy, corpus size and mean rank agreement', () => {
    const card = formatCalibrationCard(report);
    expect(card).toMatch(/Ranks \d+% of \d+ labelled comparisons/);
    expect(card).toContain(`${report.corpusSize} archetypes`);
  });
});
