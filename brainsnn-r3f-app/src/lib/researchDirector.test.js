import { describe, expect, it } from '../test/tinyVitest.js';
import {
  evaluatePromotion,
  proposeNextExperiment,
  selectChampion,
} from './researchDirector.js';

function experiment(id, meanPearson, overrides = {}) {
  return {
    id,
    status: overrides.status || 'EVALUATED',
    hypothesis: overrides.hypothesis || 'test',
    model: { family: overrides.family || 'ridge', version: '0.1.0', trained: overrides.trained ?? true },
    dataset: { id: 'fixture', split: 'validation', license: 'CC0' },
    config: { alpha: overrides.alpha ?? 1, lagTr: overrides.lagTr ?? 3 },
    metrics: { meanPearson, medianPearson: meanPearson, positiveParcelFraction: 0.7, latencyMs: overrides.latencyMs ?? 100 },
    benchmarkValid: overrides.benchmarkValid ?? true,
    dataLeakageDetected: overrides.dataLeakageDetected ?? false,
  };
}

describe('Research Director V0.1', () => {
  it('selects the best valid measured benchmark rather than the newest experiment', () => {
    const champion = selectChampion([
      experiment('a', 0.08),
      experiment('b', 0.13),
      experiment('c', 0.2, { benchmarkValid: false }),
    ]);
    expect(champion.id).toBe('b');
  });

  it('blocks promotion when validation or leakage gates fail', () => {
    expect(evaluatePromotion({ candidate: experiment('bad', 0.4, { benchmarkValid: false }) }).promote).toBe(false);
    expect(evaluatePromotion({ candidate: experiment('leak', 0.4, { dataLeakageDetected: true }) }).promote).toBe(false);
  });

  it('requires a measured improvement over the current champion', () => {
    const champion = experiment('champ', 0.12);
    expect(evaluatePromotion({ candidate: experiment('small', 0.1205), champion, minDelta: 0.002 }).promote).toBe(false);
    expect(evaluatePromotion({ candidate: experiment('better', 0.13), champion, minDelta: 0.002 }).promote).toBe(true);
  });

  it('rejects a better score when latency violates the configured resource boundary', () => {
    const champion = experiment('champ', 0.12, { latencyMs: 100 });
    const result = evaluatePromotion({ candidate: experiment('slow', 0.15, { latencyMs: 150 }), champion, maxLatencyIncreaseFraction: 0.25 });
    expect(result.promote).toBe(false);
    expect(result.reason.includes('latency')).toBe(true);
  });

  it('proposes the first ridge benchmark with human approval required', () => {
    const proposal = proposeNextExperiment({ experiments: [] });
    expect(proposal.requiresApproval).toBe(true);
    expect(proposal.proposedExperiment.model.family).toBe('ridge');
    expect(proposal.decisionAuthority).toBe('objective benchmark, not the planner');
    expect(proposal.currentChampionId).toBe(null);
  });

  it('branches the next experiment from the objective champion', () => {
    const proposal = proposeNextExperiment({ experiments: [experiment('champ', 0.12)] });
    expect(proposal.currentChampionId).toBe('champ');
    expect(proposal.proposedExperiment.parentId).toBe('champ');
  });
});
