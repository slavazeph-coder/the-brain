import { describe, expect, it } from '../test/tinyVitest.js';
import {
  evaluatePromotion,
  normalizeExperiment,
  proposeNextExperiment,
  selectChampion,
} from './researchDirector.js';

function experiment(id, meanPearson, overrides = {}) {
  return {
    id,
    status: overrides.status || 'EVALUATED',
    hypothesis: overrides.hypothesis || 'test',
    model: { family: overrides.family || 'ridge', version: '0.1.0', trained: overrides.trained ?? true, ...overrides.model },
    dataset: { id: 'fixture', split: 'validation', license: 'CC0', ...overrides.dataset },
    config: { alpha: overrides.alpha ?? 1, lagTr: overrides.lagTr ?? 3 },
    metrics: { meanPearson, medianPearson: meanPearson, positiveParcelFraction: 0.7, latencyMs: overrides.latencyMs ?? 100, ...overrides.metrics },
    benchmarkValid: Object.hasOwn(overrides, 'benchmarkValid') ? overrides.benchmarkValid : true,
    dataLeakageDetected: Object.hasOwn(overrides, 'dataLeakageDetected') ? overrides.dataLeakageDetected : false,
    failureReason: overrides.failureReason,
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
    const proposal = proposeNextExperiment({ experiments: [experiment('champ', 0.12)], datasetId: 'fixture', datasetSplit: 'validation' });
    expect(proposal.currentChampionId).toBe('champ');
    expect(proposal.proposedExperiment.parentId).toBe('champ');
    expect(proposal.proposedExperiment.dataset.split).toBe('validation');
  });

  it('does not coerce absent, blank or nonnumeric metric values into measured zero', () => {
    for (const value of [undefined, null, '', ' \t ', false, true, [], [0], {}, NaN, Infinity, -Infinity, 'NaN', 'Infinity']) {
      const row = experiment('invalid-metric', value);
      expect(normalizeExperiment(row).metrics.meanPearson).toBe(null);
      expect(selectChampion([row])).toBe(null);
      expect(evaluatePromotion({ candidate: row }).promote).toBe(false);
    }
  });

  it('keeps missing measurements absent through repeated normalization', () => {
    const row = normalizeExperiment(experiment('missing', null, { metrics: { latencyMs: null } }));
    expect(normalizeExperiment(row)).toEqual(row);
    expect(selectChampion([row])).toBe(null);
    const proposal = proposeNextExperiment({ experiments: [row], datasetId: 'fixture', datasetSplit: 'validation' });
    expect(proposal.currentChampionId).toBe(null);
    expect(proposal.proposedExperiment.config.alpha).toBe(1);
  });

  it('preserves measured zeros, numeric strings and the full valid Pearson range', () => {
    for (const value of [-1, -0.5, 0, '0', ' 0.25 ', 1]) {
      const row = experiment('measured', value, { metrics: { latencyMs: 0, positiveParcelFraction: 0, modelBytes: 0 } });
      expect(normalizeExperiment(row).metrics.meanPearson).toBe(Number(value));
      expect(normalizeExperiment(row).metrics.latencyMs).toBe(0);
      expect(normalizeExperiment(row).metrics.positiveParcelFraction).toBe(0);
      expect(normalizeExperiment(row).metrics.modelBytes).toBe(0);
      expect(evaluatePromotion({ candidate: row }).promote).toBe(true);
    }
    expect(selectChampion([experiment('negative', -0.2), experiment('zero', 0)]).id).toBe('zero');
    expect(evaluatePromotion({ candidate: experiment('less-negative', -0.1), champion: experiment('negative', -0.2) }).promote).toBe(true);
  });

  it('rejects out-of-range Pearson scores rather than clamping them into winners', () => {
    for (const score of [-1.00001, 1.00001, 99]) {
      const row = experiment('out-of-range', score);
      expect(selectChampion([row])).toBe(null);
      expect(evaluatePromotion({ candidate: row }).promote).toBe(false);
    }
  });

  it('uses the same completed trained eligibility for selection, promotion and planning', () => {
    const invalid = [
      ...['PROPOSED', 'APPROVED', 'QUEUED', 'RUNNING', 'FAILED', 'REJECTED'].map((status) => experiment(status, 0.9, { status })),
      experiment('untrained', 0.9, { trained: false }),
      experiment('string-trained', 0.9, { model: { trained: 'true' } }),
      experiment('unknown-training', 0.9, { model: { trained: null } }),
      experiment('string-valid', 0.9, { benchmarkValid: 'true' }),
      experiment('invalid-benchmark', 0.9, { benchmarkValid: false }),
      experiment('leak', 0.9, { dataLeakageDetected: true }),
      experiment('string-no-leak', 0.9, { dataLeakageDetected: 'false' }),
      experiment('unknown-leakage', 0.9, { dataLeakageDetected: undefined }),
      experiment('recorded-failure', 0.9, { failureReason: 'evaluation interrupted' }),
    ];
    for (const row of invalid) {
      expect(selectChampion([row])).toBe(null);
      expect(evaluatePromotion({ candidate: row }).promote).toBe(false);
    }
    const proposal = proposeNextExperiment({ experiments: invalid, datasetId: 'fixture', datasetSplit: 'validation' });
    expect(proposal.currentChampionId).toBe(null);
    expect(proposal.proposedExperiment.config.alpha).toBe(1);
    expect(proposal.proposedExperiment.model.family).toBe('ridge');
    expect(selectChampion([...invalid, experiment('completed', 0.1, { status: 'PROMOTED' })]).id).toBe('completed');
  });

  it('requires explicit dataset and split identities even for the first candidate', () => {
    for (const dataset of [{ id: null }, { id: '' }, { id: '  ' }, { id: 'unconfigured' }, { id: {} }, { split: null }, { split: '' }, { split: false }]) {
      const row = experiment('unknown-benchmark', 0.5, { dataset });
      expect(selectChampion([row])).toBe(null);
      expect(evaluatePromotion({ candidate: row }).promote).toBe(false);
    }
  });

  it('rejects comparisons across dataset or split and requires scope for mixed leaderboards', () => {
    const champion = experiment('champ', 0.1);
    const otherDataset = experiment('other-data', 0.8, { dataset: { id: 'different' } });
    const otherSplit = experiment('other-split', 0.9, { dataset: { split: 'training' } });
    for (const row of [otherDataset, otherSplit]) {
      expect(evaluatePromotion({ candidate: row, champion }).promote).toBe(false);
      expect(selectChampion([champion, row])).toBe(null);
    }
    expect(selectChampion([champion, otherDataset, otherSplit], { datasetId: 'fixture', datasetSplit: 'validation' }).id).toBe('champ');
    expect(selectChampion([champion, otherSplit], { datasetId: 'fixture' })).toBe(null);
  });

  it('does not turn an invalid supplied champion into a first-candidate promotion', () => {
    for (const champion of [experiment('missing-score', null), experiment('untrained', 0.1, { trained: false }), {}, false, 0, '']) {
      expect(evaluatePromotion({ candidate: experiment('candidate', 0.5), champion }).promote).toBe(false);
    }
    expect(evaluatePromotion({ candidate: experiment('candidate', 0.5), champion: null }).promote).toBe(true);
  });

  it('normalizes explicit benchmark scope consistently with stored identities', () => {
    const row = experiment('champ', 0.1, { dataset: { id: ' fixture ', split: ' validation ' } });
    expect(selectChampion([row], { datasetId: ' fixture ', datasetSplit: ' validation ' }).id).toBe('champ');
    const proposal = proposeNextExperiment({ experiments: [row], datasetId: ' fixture ', datasetSplit: ' validation ' });
    expect(proposal.currentChampionId).toBe('champ');
    expect(proposal.proposedExperiment.dataset.id).toBe('fixture');
    expect(proposal.proposedExperiment.dataset.split).toBe('validation');
    expect(selectChampion([row], { datasetId: '' })).toBe(null);
  });

  it('requires nonnegative measured latency on both sides of the comparison', () => {
    for (const latency of [undefined, null, '', ' ', false, true, [], {}, NaN, Infinity, -Infinity, -1]) {
      const row = experiment('unknown-latency', 0.5, { metrics: { latencyMs: latency } });
      expect(selectChampion([row])).toBe(null);
      expect(evaluatePromotion({ candidate: row }).promote).toBe(false);
      expect(evaluatePromotion({ candidate: row, champion: experiment('champ', 0.1) }).promote).toBe(false);
      expect(evaluatePromotion({ candidate: experiment('candidate', 0.6), champion: row }).promote).toBe(false);
    }
  });

  it('handles measured zero latency without bypassing a relative resource boundary', () => {
    const zeroChampion = experiment('zero-champ', 0.1, { latencyMs: 0 });
    expect(evaluatePromotion({ candidate: experiment('zero', 0.2, { latencyMs: 0 }), champion: zeroChampion }).promote).toBe(true);
    expect(evaluatePromotion({ candidate: experiment('positive', 0.2, { latencyMs: 0.001 }), champion: zeroChampion }).promote).toBe(false);
    expect(evaluatePromotion({ candidate: experiment('zero', 0.2, { latencyMs: 0 }), champion: experiment('positive-champ', 0.1) }).promote).toBe(true);
  });

  it('accepts exact configured improvement and latency boundaries', () => {
    const champion = experiment('champ', 0.125, { latencyMs: 100 });
    expect(evaluatePromotion({ candidate: experiment('boundary', 0.25, { latencyMs: 125 }), champion, minDelta: 0.125, maxLatencyIncreaseFraction: 0.25 }).promote).toBe(true);
    expect(evaluatePromotion({ candidate: experiment('over', 0.25, { latencyMs: 125.001 }), champion, minDelta: 0.125, maxLatencyIncreaseFraction: 0.25 }).promote).toBe(false);
  });

  it('fails closed on malformed or negative promotion limits', () => {
    for (const limit of [null, '', ' ', false, true, [], {}, NaN, Infinity, -1]) {
      expect(evaluatePromotion({ candidate: experiment('candidate', 0.5), minDelta: limit }).promote).toBe(false);
      expect(evaluatePromotion({ candidate: experiment('candidate', 0.5), maxLatencyIncreaseFraction: limit }).promote).toBe(false);
    }
    expect(evaluatePromotion({ candidate: experiment('candidate', 0.5), champion: experiment('champ', 0.1), minDelta: '0.1' }).promote).toBe(true);
  });

  it('counts only eligible comparable experiments toward planner expansion', () => {
    const unrelated = Array.from({ length: 6 }, (_, i) => experiment(`other-${i}`, 0.8, { dataset: { id: 'other-dataset' } }));
    const invalid = Array.from({ length: 6 }, (_, i) => experiment(`failed-${i}`, 0.9, { status: 'FAILED' }));
    const valid = Array.from({ length: 5 }, (_, i) => experiment(`valid-${i}`, i / 10));
    const plan = (experiments) => proposeNextExperiment({ experiments, datasetId: 'fixture', datasetSplit: 'validation' });
    expect(plan([...unrelated, ...invalid]).currentChampionId).toBe(null);
    expect(plan([...unrelated, ...invalid]).proposedExperiment.config.alpha).toBe(1);
    expect(plan([...unrelated, ...invalid, ...valid.slice(0, 4)]).proposedExperiment.model.family).toBe('ridge');
    expect(plan([...unrelated, ...invalid, ...valid]).proposedExperiment.model.family).toBe('tiny-fusion-mlp');
    expect(plan([...unrelated, ...invalid, ...valid]).currentChampionId).toBe('valid-4');
    expect(proposeNextExperiment({ experiments: valid }).currentChampionId).toBe(null);
  });

  it('preserves an explicitly zero budget while keeping unmeasured budgets unknown', () => {
    expect(proposeNextExperiment({ budget: { maxCostUsd: 0, maxGpuHours: '0', maxTrainingMinutes: null } }).budget).toEqual({ maxCostUsd: 0, maxGpuHours: 0, maxTrainingMinutes: null });
    expect(proposeNextExperiment({ budget: { maxCostUsd: false, maxGpuHours: '', maxTrainingMinutes: -1 } }).budget).toEqual({ maxCostUsd: null, maxGpuHours: null, maxTrainingMinutes: null });
  });
});
