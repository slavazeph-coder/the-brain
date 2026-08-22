import { describe, expect, it } from '../test/tinyVitest.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { compareResults, deriveExecutiveVerdict, getBusinessMetrics } from './scoreMapping.js';

describe('score mapping', () => {
  it('maps backend AnalysisResult fields into business metrics', () => {
    const result = analyzeContentLocally({
      content: 'This tested customer example shows proof before the launch. See the result today.',
      forceFallback: false,
    });
    const metrics = getBusinessMetrics(result);
    expect(metrics.map((metric) => metric.label)).toContain('Hook Strength');
    expect(metrics.map((metric) => metric.label)).toContain('Manipulation Risk');
    expect(metrics.every((metric) => metric.value >= 0 && metric.value <= 100)).toBe(true);
  });

  it('generates an executive verdict from contextual recommendation fields', () => {
    const result = analyzeContentLocally({
      content: 'They do not want you to know this urgent secret. Act now before every competitor steals your customers.',
    });
    const verdict = deriveExecutiveVerdict(result);
    expect(verdict.headline).toBe(result.recommendations[0].title);
    expect(verdict.primaryRisk).toBe(result.recommendations[0].rationale);
    expect(verdict.bestNextMove).toBe(result.recommendations[0].rewriteHint);
    expect(verdict.label).toBe('Deterministic local result');
    expect(verdict.score).toBeGreaterThanOrEqual(0);
  });

  it('calculates version comparison deltas', () => {
    const original = analyzeContentLocally({ content: 'Last chance. You will lose everything if you wait.' });
    const revised = analyzeContentLocally({ content: 'Here is the customer proof and a calmer reason to decide today.' });
    const rows = compareResults(original, revised);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.id === 'trust')?.delta).not.toBe(0);
  });
});
