import { describe, expect, it } from '../test/tinyVitest.js';
import {
  bestF1,
  brierScore,
  classificationAt,
  evaluateBinary,
  expectedCalibrationError,
  rocAuc,
} from './evalMetrics.js';

describe('rocAuc', () => {
  it('is 1 for a perfect ranking', () => {
    expect(rocAuc([10, 20, 30, 40], [0, 0, 1, 1])).toBe(1);
  });

  it('is 0 for a perfectly inverted ranking', () => {
    expect(rocAuc([40, 30, 20, 10], [0, 0, 1, 1])).toBe(0);
  });

  it('is 0.5 when every score is tied', () => {
    expect(rocAuc([5, 5, 5, 5], [0, 1, 0, 1])).toBe(0.5);
  });

  it('returns 0.5 when one class is absent', () => {
    expect(rocAuc([1, 2, 3], [1, 1, 1])).toBe(0.5);
    expect(rocAuc([1, 2, 3], [0, 0, 0])).toBe(0.5);
  });

  it('handles partial ties correctly', () => {
    // One positive tied with one negative in the middle.
    const auc = rocAuc([1, 2, 2, 3], [0, 0, 1, 1]);
    expect(auc).toBeGreaterThan(0.5);
    expect(auc).toBeLessThan(1);
  });
});

describe('brierScore', () => {
  it('is 0 for perfect confident predictions', () => {
    expect(brierScore([1, 0, 1, 0], [1, 0, 1, 0])).toBe(0);
  });

  it('is 1 for confidently wrong predictions', () => {
    expect(brierScore([0, 1], [1, 0])).toBe(1);
  });

  it('is 0.25 for maximally uncertain predictions', () => {
    expect(brierScore([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBe(0.25);
  });
});

describe('expectedCalibrationError', () => {
  it('is ~0 when predicted probabilities match observed frequencies', () => {
    // Twenty items at p=0.5, half of which are positive.
    const probabilities = new Array(20).fill(0.5);
    const labels = probabilities.map((_, index) => (index % 2 === 0 ? 1 : 0));
    expect(expectedCalibrationError(probabilities, labels).ece).toBeLessThan(0.01);
  });

  it('is large when predictions are systematically overconfident', () => {
    // Claims 90% certainty, right only half the time.
    const probabilities = new Array(20).fill(0.9);
    const labels = probabilities.map((_, index) => (index % 2 === 0 ? 1 : 0));
    const { ece } = expectedCalibrationError(probabilities, labels);
    expect(ece).toBeGreaterThan(0.35);
  });

  it('returns a reliability table covering every bin', () => {
    const { reliability } = expectedCalibrationError([0.1, 0.5, 0.9], [0, 1, 1], { bins: 5 });
    expect(reliability.length).toBe(5);
    const counted = reliability.reduce((sum, bin) => sum + bin.count, 0);
    expect(counted).toBe(3);
  });
});

describe('classificationAt / bestF1', () => {
  it('computes precision, recall and F1 at a threshold', () => {
    const result = classificationAt([90, 80, 20, 10], [1, 1, 0, 0], 50);
    expect(result.tp).toBe(2);
    expect(result.fp).toBe(0);
    expect(result.fn).toBe(0);
    expect(result.f1).toBe(1);
  });

  it('finds the best operating point', () => {
    const best = bestF1([90, 80, 60, 20, 10], [1, 1, 1, 0, 0]);
    expect(best.f1).toBe(1);
    expect(best.threshold).toBeLessThanOrEqual(60);
  });

  it('handles a detector that fires on nothing', () => {
    const result = classificationAt([1, 2, 3], [1, 1, 1], 99);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f1).toBe(0);
  });
});

describe('evaluateBinary', () => {
  it('summarises ranking, accuracy and calibration together', () => {
    const scores = [95, 88, 70, 40, 22, 10];
    const labels = [1, 1, 1, 0, 0, 0];
    const report = evaluateBinary(scores, labels);
    expect(report.n).toBe(6);
    expect(report.positives).toBe(3);
    expect(report.auc).toBe(1);
    expect(report.brier).toBeGreaterThanOrEqual(0);
    expect(report.ece).toBeGreaterThanOrEqual(0);
    expect(report.bestF1.f1).toBe(1);
  });

  it('shows that good ranking does not imply good calibration', () => {
    // Perfectly ordered, but every score is squashed into a narrow band, so
    // the numbers rank well while meaning nothing as percentages.
    const scores = [52, 51, 50, 49, 48, 47];
    const labels = [1, 1, 1, 0, 0, 0];
    const report = evaluateBinary(scores, labels);
    expect(report.auc).toBe(1);
    expect(report.ece).toBeGreaterThan(0.3);
  });
});
