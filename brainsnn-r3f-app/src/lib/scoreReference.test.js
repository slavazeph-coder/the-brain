import { describe, expect, it } from '../test/tinyVitest.js';
import { describePercentile, ordinal, referenceDistribution, scorePercentile, SCORE_SCALE_NOTE } from './scoreReference.js';
import { CALIBRATION_CORPUS } from './calibrationCorpus.js';
import { scoreCorpusItem } from './calibration.js';

describe('referenceDistribution', () => {
  it('covers every headline metric across the whole corpus', () => {
    const distribution = referenceDistribution();
    for (const id of ['manipulationRisk', 'trust', 'urgency', 'shareability']) {
      expect(distribution[id].length).toBe(CALIBRATION_CORPUS.length);
    }
  });

  it('is sorted ascending', () => {
    for (const values of Object.values(referenceDistribution())) {
      for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe('scorePercentile', () => {
  it('places an extreme score at the top and a floor score at the bottom', () => {
    expect(scorePercentile('manipulationRisk', 100)).toBe(100);
    expect(scorePercentile('manipulationRisk', 0)).toBe(0);
  });

  it('is monotonic in the score', () => {
    const low = scorePercentile('manipulationRisk', 30);
    const mid = scorePercentile('manipulationRisk', 60);
    const high = scorePercentile('manipulationRisk', 90);
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it('ranks phishing above a neutral notice on manipulation risk', () => {
    const phishing = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'account-phishing-email'));
    const notice = scoreCorpusItem(CALIBRATION_CORPUS.find((item) => item.id === 'plain-status-update'));
    expect(scorePercentile('manipulationRisk', phishing.manipulationRisk))
      .toBeGreaterThan(scorePercentile('manipulationRisk', notice.manipulationRisk));
  });

  it('returns null for an unknown metric or a non-numeric score', () => {
    expect(scorePercentile('notAMetric', 50)).toBe(null);
    expect(scorePercentile('trust', Number.NaN)).toBe(null);
  });
});

describe('describePercentile', () => {
  it('reads plainly at the extremes and in the middle', () => {
    expect(describePercentile('manipulationRisk', 100)).toMatch(/higher than/);
    expect(describePercentile('manipulationRisk', 0)).toMatch(/lower than/);
    expect(describePercentile('manipulationRisk', 50)).toMatch(/percentile|higher than|lower than/);
  });

  it('is empty for an unknown metric', () => {
    expect(describePercentile('notAMetric', 50)).toBe('');
  });
});

describe('ordinal', () => {
  it('uses the right suffix, including the teens', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(81)).toBe('81st');
  });
});

describe('SCORE_SCALE_NOTE', () => {
  it('states plainly that the scores are not probabilities', () => {
    expect(SCORE_SCALE_NOTE).toContain('not probabilities');
  });
});
