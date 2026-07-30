import { describe, expect, it } from '../test/tinyVitest.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { runLayerRouter } from './layerRouter.js';
import { getHeadlineScores } from './headlineScores.js';

function scanLocally(content) {
  const baseResult = analyzeContentLocally({ content, contentType: 'text', forceFallback: true });
  return runLayerRouter({ content, contentType: 'text', baseResult });
}

describe('getHeadlineScores', () => {
  it('returns the four playground headline scores in order', () => {
    const scores = getHeadlineScores(scanLocally('Here is exactly what failed, what we refunded, and the two changes that stop it happening again.'));
    expect(scores.map((score) => score.label)).toEqual(['Attention', 'Trust', 'Emotional Charge', 'Manipulation Risk']);
    expect(scores.map((score) => score.id)).toEqual(['hookStrength', 'trust', 'emotionalCharge', 'manipulationRisk']);
  });

  it('keeps every value inside 0-100 and preserves metric semantics', () => {
    const scores = getHeadlineScores(scanLocally('A calm and specific update about the roadmap with proof and a measured ask.'));
    for (const score of scores) {
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(100);
      expect(typeof score.direction).toBe('string');
      expect(typeof score.explanation).toBe('string');
    }
  });

  it('scores high-pressure content as riskier than trustworthy', () => {
    const scores = getHeadlineScores(scanLocally('URGENT last chance! Act now or lose everything forever — they don\'t want you to know this secret. Click immediately!'));
    const byId = Object.fromEntries(scores.map((score) => [score.id, score.value]));
    expect(byId.manipulationRisk).toBeGreaterThan(byId.trust);
  });

  it('is deterministic for identical input', () => {
    const content = 'Only forty were ever made. Private viewings close this week.';
    expect(JSON.stringify(getHeadlineScores(scanLocally(content)))).toBe(JSON.stringify(getHeadlineScores(scanLocally(content))));
  });

  it('tolerates missing or null results', () => {
    for (const empty of [{}, null, undefined]) {
      const scores = getHeadlineScores(empty);
      expect(scores.length).toBe(4);
      for (const score of scores) expect(Number.isFinite(score.value)).toBe(true);
    }
  });
});
