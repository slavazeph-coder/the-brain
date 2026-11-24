import { describe, expect, it } from '../test/tinyVitest.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { createRewritePlan } from './draftRewrite.js';

// A typical high-pressure ad: vague scarcity, a guaranteed result and loss framed around delay.
const PRESSURE_AD = 'Limited spots left! Our AI platform guarantees 10x growth in 7 days. Join 5,000 marketers who already switched. Book a demo today and stop losing money every single day you wait.';

describe('pressure the Creative Engine used to miss', () => {
  it('removes vague scarcity, guaranteed results and delay-as-loss when asked to reduce manipulation', () => {
    const plan = createRewritePlan(PRESSURE_AD, 'reduce-risk');
    expect(plan.appliedCount).toBe(3);
    expect(plan.content).toBe('Open spots! Our AI platform aims to deliver 10x growth in 7 days. Join 5,000 marketers who already switched. Book a demo today and stop losing money over time.');
    // The user's own proof is untouched.
    expect(plan.content).toContain('Join 5,000 marketers who already switched.');
  });

  it('treats a guaranteed result as a trust problem too', () => {
    const plan = createRewritePlan(PRESSURE_AD, 'trust');
    expect(plan.content).toContain('aims to deliver 10x growth');
    expect(plan.content).toContain('Limited spots left!');
  });

  it('leaves honest guarantees and specific scarcity alone', () => {
    const honest = 'Every plan includes a 30-day money-back guarantee. 3 seats left for the March 4 cohort.';
    expect(createRewritePlan(honest, 'reduce-risk').appliedCount).toBe(0);
  });

  it('never lists a line it flags as pressure under What works', () => {
    const result = analyzeContentLocally({ content: PRESSURE_AD });
    const works = result.insights.find((insight) => insight.label === 'What works').text;
    expect(works).not.toContain('Limited spots left');
    expect(works).toContain('Join 5,000 marketers');
    const allPressure = analyzeContentLocally({ content: 'Limited time only! Act fast before it is too late.' });
    expect(allPressure.insights.find((insight) => insight.label === 'What works').text).toContain('none works on its own yet');
  });

  it('does not recommend moving proof that already sits right before the ask', () => {
    const ids = analyzeContentLocally({ content: PRESSURE_AD }).recommendations.map((rec) => rec.id);
    expect(ids).not.toContain('move-proof-to-ask');
    expect(ids[0]).toBe('replace-vague-line');
    const reorder = analyzeContentLocally({ content: 'Book a demo today. Our platform helps teams ship faster. 12 teams cut onboarding from 3 days to 4 hours.' });
    expect(reorder.recommendations[0].id).toBe('move-proof-to-ask');
  });
});

describe('the verdict says each thing once', () => {
  it('does not repeat the headline or What hurts in the line under the headline', async () => {
    const { deriveExecutiveVerdict } = await import('./scoreMapping.js');
    const verdict = deriveExecutiveVerdict(analyzeContentLocally({ content: PRESSURE_AD }));
    expect(verdict.interpretation.startsWith(verdict.headline)).toBe(false);
    expect(verdict.interpretation).not.toBe(verdict.primaryRisk);
    expect(verdict.interpretation.length).toBeGreaterThan(10);
  });

  it('never calls a draft low risk when this scan flags most of its lines as pressure', () => {
    const result = analyzeContentLocally({ content: PRESSURE_AD });
    expect(result.riskRating).toBe('Moderate trust risk');
    expect(result.riskDescription).not.toContain('unlikely to feel manipulative');
    const honest = analyzeContentLocally({ content: 'We cut onboarding from 3 days to 4 hours for 12 teams. Here is how we measured it, and what we still do not know.' });
    expect(honest.riskRating).toBe('Low trust risk');
  });
});
