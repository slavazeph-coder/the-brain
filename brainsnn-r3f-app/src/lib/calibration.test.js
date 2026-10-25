import { describe, expect, it } from '../test/tinyVitest.js';
import { calibrate, formatCalibrationCard, scoreCorpusItem, spearman } from './calibration.js';
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
//
// Measured 2026-07 after folding the taxonomy-aligned technique detector into
// manipulation risk at 30% weight: trust 0.70, manipulationRisk 0.89 (was
// 0.63), urgency 0.64, viralPull 0.37; overall pair accuracy 0.84 (was 0.81),
// mean Spearman 0.65 (was 0.59).
describe('measured calibration (regression guard)', () => {
  it('ranks urgency well', () => {
    expect(report.dimensions.urgency.spearman).toBeGreaterThan(0.55);
  });

  it('ranks manipulation risk well', () => {
    expect(report.dimensions.manipulationRisk.spearman).toBeGreaterThan(0.85);
    expect(report.dimensions.manipulationRisk.inversionRate).toBeLessThan(0.1);
  });

  it('ranks viral pull positively', () => {
    expect(report.dimensions.viralPull.spearman).toBeGreaterThan(0.3);
  });

  // Regression guard for a fixed defect: trust used to be ANTI-correlated
  // (Spearman -0.505), ranking outrage bait above a sincere apology, because
  // TRUST_TERMS rewarded trust *vocabulary* rather than evidence. Adding
  // specificity and stated-limitation signals turned it positive. This must
  // never go negative again.
  it('ranks trust in the right direction', () => {
    expect(report.dimensions.trust.spearman).toBeGreaterThan(0.6);
    expect(report.dimensions.trust.inversionRate).toBeLessThan(0.25);
  });

  it('keeps overall pair accuracy well above chance', () => {
    expect(report.overall.pairAccuracy).toBeGreaterThan(0.82);
    expect(report.overall.meanSpearman).toBeGreaterThan(0.6);
  });
});

describe('the trust defect that calibration caught', () => {
  it('now scores a specific apology above outrage bait', () => {
    const apology = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'sincere-apology'));
    const outrage = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'outrage-bait-post'));
    expect(apology.trust).toBeGreaterThan(outrage.trust);
  });

  it('credits concrete checkable detail on its own', () => {
    const specific = scoreCorpusItem({ content: 'Median export time fell from 42 seconds to 6 seconds on Tuesday across 14 teams.' });
    const plain = scoreCorpusItem({ content: 'The update went out and things are better now than they were before.' });
    // The concrete version names no trust vocabulary at all, yet must outrank
    // an unfalsifiable claim of improvement.
    expect(specific.trust).toBeGreaterThan(plain.trust + 20);
  });

  it('credits stated limitations as a trust signal', () => {
    const hedged = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'transparent-limitation'));
    const absolute = scoreCorpusItem({ content: 'This is the ultimate world-class solution and it is guaranteed to work for everyone.' });
    expect(hedged.trust).toBeGreaterThan(absolute.trust);
  });

  // Fix for the limitation this suite previously pinned: the specificity
  // signal counted numerals, so a fake deadline ("verify within 24 hours")
  // read as concrete detail. Specifics inside urgency phrasing are now
  // discounted, which must not cost an HONEST deadline its credit.
  it('no longer lets a fake deadline buy trust', () => {
    const phishing = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'account-phishing-email'));
    const flashSale = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'countdown-flash-sale'));
    expect(phishing.trust).toBeLessThanOrEqual(60);
    expect(flashSale.trust).toBeLessThan(50);
  });

  it('still credits a deadline that gives its reason', () => {
    const honest = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'measured-deadline-notice'));
    const phishing = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'account-phishing-email'));
    expect(honest.trust).toBeGreaterThan(phishing.trust + 25);
  });
});

describe('formatCalibrationCard', () => {
  it('states accuracy, corpus size and mean rank agreement', () => {
    const card = formatCalibrationCard(report);
    expect(card).toMatch(/Ranks \d+% of \d+ labelled comparisons/);
    expect(card).toContain(`${report.corpusSize} archetypes`);
  });
});
