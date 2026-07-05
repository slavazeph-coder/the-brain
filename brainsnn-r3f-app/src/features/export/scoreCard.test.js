import { describe, expect, it } from '../../test/tinyVitest.js';
import { composeScoreCardText } from './scoreCard.js';

const mockResult = {
  rawContent: 'Most ads ask for attention before earning trust. Show proof first, then invite the buyer to decide. This sentence pads the content well past the excerpt cutoff length.',
  metrics: { trust: 48, urgency: 70, empathy: 56, fear: 44, anger: 18, excitement: 82 },
  viralScore: 74,
  gaugeGapScore: 66,
  confidence: 76,
};

describe('composeScoreCardText', () => {
  it('truncates the excerpt to ~90 chars with an ellipsis', () => {
    const card = composeScoreCardText(mockResult);
    expect(card.excerpt.length).toBeLessThanOrEqual(90);
    expect(card.excerpt.endsWith('…')).toBe(true);
  });

  it('includes viral pull and manipulation risk rows', () => {
    const card = composeScoreCardText(mockResult);
    const labels = card.metricRows.map(([label]) => label);
    expect(labels).toContain('Viral Pull');
    expect(labels).toContain('Manipulation Risk');
    expect(card.footer).toBe('brainsnn.com');
  });

  it('maps viral labels across thresholds', () => {
    expect(composeScoreCardText({ ...mockResult, viralScore: 80 }).viralLabel).toBe('Built to spread');
    expect(composeScoreCardText({ ...mockResult, viralScore: 60 }).viralLabel).toBe('Shareable with a push');
    expect(composeScoreCardText({ ...mockResult, viralScore: 20 }).viralLabel).toBe('Low spread pressure');
  });

  it('survives an empty result', () => {
    const card = composeScoreCardText({});
    expect(typeof card.headline).toBe('string');
    expect(card.excerpt).toBe('');
  });
});
