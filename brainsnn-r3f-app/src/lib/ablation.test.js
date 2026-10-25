import { describe, expect, it } from '../test/tinyVitest.js';
import { analyzeSensitivity, formatBand, scoreText, topDrivers } from './ablation.js';

// A benign opener followed by a heavy manipulation sentence: attribution should
// find the second sentence, not spread the blame evenly.
const MIXED = 'Our team shipped a small update to the billing page this week. '
  + 'URGENT: verify your account within 24 hours or it will be permanently deleted, click immediately!';

const CALM = 'We got this wrong. On Tuesday our update broke checkout for six hours. '
  + 'Here is exactly what failed, what we refunded, and the two changes that stop it happening again.';

describe('analyzeSensitivity', () => {
  it('is deterministic', () => {
    const a = analyzeSensitivity(MIXED);
    const b = analyzeSensitivity(MIXED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('declines to attribute a single sentence', () => {
    const single = analyzeSensitivity('Only forty were ever made this season, and viewings close soon.');
    expect(single.sentences).toEqual([]);
    expect(single.band).toBe(null);
    expect(single.note.length).toBeGreaterThan(0);
  });

  it('produces one entry per sentence with a contribution per score', () => {
    const sensitivity = analyzeSensitivity(MIXED);
    expect(sensitivity.sentences.length).toBe(2);
    for (const entry of sensitivity.sentences) {
      expect(typeof entry.sentence).toBe('string');
      for (const id of Object.keys(sensitivity.baseline)) {
        expect(Number.isFinite(entry.contributions[id])).toBe(true);
      }
    }
  });

  it('attributes manipulation risk to the pressure sentence', () => {
    const sensitivity = analyzeSensitivity(MIXED);
    const drivers = topDrivers(sensitivity, 'manipulationRisk');
    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers[0].sentence).toMatch(/URGENT/);
    expect(drivers[0].contribution).toBeGreaterThan(0);
  });

  it('reports a jackknife band that brackets the replicates', () => {
    const sensitivity = analyzeSensitivity(MIXED);
    for (const id of Object.keys(sensitivity.baseline)) {
      const entry = sensitivity.band[id];
      expect(entry.min).toBeLessThanOrEqual(entry.median);
      expect(entry.median).toBeLessThanOrEqual(entry.max);
      expect(entry.stderr).toBeGreaterThanOrEqual(0);
      expect(entry.point).toBe(sensitivity.baseline[id]);
    }
  });

  it('gives a wider risk band to mixed content than to uniformly calm content', () => {
    const mixed = analyzeSensitivity(MIXED).band.manipulationRisk;
    const calm = analyzeSensitivity(CALM).band.manipulationRisk;
    expect(mixed.max - mixed.min).toBeGreaterThan(calm.max - calm.min);
  });

  it('measures order sensitivity for every score', () => {
    const sensitivity = analyzeSensitivity(MIXED, { shuffles: 4 });
    for (const id of Object.keys(sensitivity.baseline)) {
      expect(sensitivity.orderSensitivity[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('honours a shuffles count of zero', () => {
    const sensitivity = analyzeSensitivity(MIXED, { shuffles: 0 });
    for (const id of Object.keys(sensitivity.baseline)) {
      expect(sensitivity.orderSensitivity[id]).toBe(0);
    }
  });
});

describe('topDrivers', () => {
  it('returns shares that sum to about 100 percent', () => {
    const sensitivity = analyzeSensitivity(MIXED);
    const drivers = topDrivers(sensitivity, 'manipulationRisk', { limit: 10 });
    if (drivers.length) {
      const total = drivers.reduce((sum, entry) => sum + entry.share, 0);
      expect(Math.abs(total - 100)).toBeLessThan(0.5);
    }
  });

  it('is empty for an unattributable sensitivity', () => {
    expect(topDrivers(null, 'trust')).toEqual([]);
    expect(topDrivers(analyzeSensitivity('One short line only here.'), 'trust')).toEqual([]);
  });
});

describe('scoreText', () => {
  it('returns the four headline scores', () => {
    const { scores } = scoreText(CALM);
    expect(Object.keys(scores).sort()).toEqual(['emotionalCharge', 'hookStrength', 'manipulationRisk', 'trust']);
  });
});

describe('formatBand', () => {
  it('renders a point estimate with its standard error', () => {
    expect(formatBand({ point: 72, stderr: 4.5 })).toBe('72 ±4.5');
    expect(formatBand(null)).toBe('');
  });
});
