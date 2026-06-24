import { describe, expect, it } from '../../test/tinyVitest.js';
import { analyzeContentLocally } from '../../lib/analysisEngine.js';
import { deriveExecutiveVerdict } from '../../lib/scoreMapping.js';

describe('verdict labeling', () => {
  it('shows an unmistakable fallback label in verdict view model', () => {
    const result = analyzeContentLocally({ content: 'Last chance to act now before everything changes.' });
    expect(deriveExecutiveVerdict(result).label).toBe('Demo model result');
  });

  it('defensively renders sparse result data without undefined or NaN values', () => {
    const verdict = deriveExecutiveVerdict({ metrics: {}, isFallback: false, summary: '' });
    expect(JSON.stringify(verdict)).not.toMatch(/undefined|NaN/);
    expect(verdict.label).toBe('AI-estimated response');
  });
});
