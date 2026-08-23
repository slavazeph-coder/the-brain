import { beforeEach, describe, expect, it } from '../test/tinyVitest.js';
import {
  OUTCOME_KEY,
  buildCreativeSignature,
  createOutcomeRecord,
  evaluateAgainstBrandHistory,
  loadOutcomeRecords,
  outcomePercentiles,
  saveOutcomeRecords,
  signatureSimilarity,
} from './outcomeLearning.js';

function makeResult(id, overrides = {}) {
  const windows = overrides.windows || [
    { stateId: 2, spikeRateProxy: 0.42, sparsityProxy: 0.68, deterministicFlags: ['claim_present'] },
    { stateId: 2, spikeRateProxy: 0.48, sparsityProxy: 0.64, deterministicFlags: ['proof_present'] },
    { stateId: 8, spikeRateProxy: 0.55, sparsityProxy: 0.6, deterministicFlags: ['cta_present'] },
  ];
  return {
    id,
    title: `Creative ${id}`,
    metrics: { trust: overrides.trust ?? 72 },
    firewallSignals: { manipulationPressure: overrides.pressure ?? 0.18 },
    scores: { clarity: overrides.clarity ?? 70 },
    multimodal: {
      beliefReport: {
        model: { id: 'brainsnn-sdbn-proxy-v0', version: '0.1.0', learnedWeights: false },
        windows,
        summary: {
          meanSurprise: overrides.meanSurprise ?? 0.31,
          surpriseVariance: overrides.surpriseVariance ?? 0.02,
          agreementScore: overrides.agreement ?? 0.76,
          stateTransitions: overrides.transitions ?? 1,
          reviewWindows: overrides.reviewWindows ?? 0,
          uniqueStates: overrides.uniqueStates ?? 2,
        },
      },
    },
  };
}

function records(metricId, values) {
  return values.map((value, index) => createOutcomeRecord({
    id: `${metricId}-${index}`,
    savedAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    result: makeResult(`r${index}`, {
      trust: 45 + index * 6,
      agreement: 0.45 + index * 0.05,
      meanSurprise: 0.55 - index * 0.035,
      reviewWindows: index < 2 ? 1 : 0,
    }),
    brandName: 'Acme',
    creativeLabel: `Creative ${index}`,
    metricId,
    value,
  }));
}

describe('Brand Brain outcome learning', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates a bounded, state-id-agnostic creative signature', () => {
    const signature = buildCreativeSignature(makeResult('a'));
    const values = Object.values(signature.features);
    expect(signature.schemaVersion).toBe('brainsnn.signature.v0.1');
    expect(Object.prototype.hasOwnProperty.call(signature.features, 'stateId')).toBe(false);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('returns identical similarity for identical signatures and lower similarity for changed patterns', () => {
    const first = buildCreativeSignature(makeResult('a'));
    const second = buildCreativeSignature(makeResult('b', { trust: 20, agreement: 0.25, meanSurprise: 0.8, reviewWindows: 2, transitions: 2 }));
    expect(signatureSimilarity(first, first)).toBe(1);
    expect(signatureSimilarity(first, second) < 1).toBe(true);
  });

  it('ranks higher-is-better and lower-is-better metrics in the correct direction', () => {
    const roas = records('roas', [1, 2, 4]);
    const roasRanks = outcomePercentiles(roas, 'roas');
    expect(roasRanks.get('roas-2')).toBe(1);
    expect(roasRanks.get('roas-0')).toBe(0);

    const cpa = records('cpa', [100, 60, 25]);
    const cpaRanks = outcomePercentiles(cpa, 'cpa');
    expect(cpaRanks.get('cpa-2')).toBe(1);
    expect(cpaRanks.get('cpa-0')).toBe(0);
  });

  it('gates historical fit until at least three same-brand same-metric outcomes exist', () => {
    const history = records('roas', [1.2, 2.1]);
    const evaluation = evaluateAgainstBrandHistory({ result: makeResult('current'), records: history, brandName: 'Acme', metricId: 'roas' });
    expect(evaluation.sampleCount).toBe(2);
    expect(evaluation.maturity.id).toBe('collecting');
    expect(evaluation.historicalFit).toBe(null);
  });

  it('produces nearest-neighbor evidence after the collection threshold', () => {
    const history = records('roas', [0.9, 1.3, 2.2, 3.5, 4.1]);
    const evaluation = evaluateAgainstBrandHistory({ result: makeResult('current', { trust: 70 }), records: history, brandName: 'Acme', metricId: 'roas' });
    expect(evaluation.sampleCount).toBe(5);
    expect(evaluation.maturity.id).toBe('directional');
    expect(evaluation.historicalFit >= 0 && evaluation.historicalFit <= 100).toBe(true);
    expect(evaluation.neighbors).toHaveLength(5);
    expect(evaluation.neighbors[0].similarity >= evaluation.neighbors[1].similarity).toBe(true);
    expect(evaluation.boundary.includes('not a causal estimate')).toBe(true);
  });

  it('only exposes feature associations once comparative history is available', () => {
    const shortHistory = records('roas', [1, 1.2, 1.5, 2, 2.5, 3, 3.5]);
    const shortEvaluation = evaluateAgainstBrandHistory({ result: makeResult('current'), records: shortHistory, brandName: 'Acme', metricId: 'roas' });
    expect(shortEvaluation.associations).toHaveLength(0);

    const longHistory = records('roas', [0.8, 1, 1.2, 1.6, 2.1, 2.8, 3.4, 4.2]);
    const longEvaluation = evaluateAgainstBrandHistory({ result: makeResult('current'), records: longHistory, brandName: 'Acme', metricId: 'roas' });
    expect(longEvaluation.maturity.id).toBe('comparative');
    expect(Array.isArray(longEvaluation.associations)).toBe(true);
  });

  it('persists versioned outcome records and safely loads legacy array storage', () => {
    const record = records('roas', [2.4])[0];
    saveOutcomeRecords([record]);
    expect(loadOutcomeRecords()).toHaveLength(1);

    window.localStorage.setItem(OUTCOME_KEY, JSON.stringify([record]));
    const migrated = loadOutcomeRecords();
    expect(migrated).toHaveLength(1);
    expect(migrated[0].schemaVersion).toBe('brainsnn.outcome.v0.1');
  });
});
