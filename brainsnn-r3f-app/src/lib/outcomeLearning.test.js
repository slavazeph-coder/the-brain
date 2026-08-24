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
      temporalReadout: overrides.temporalReadout || {
        points: [
          { timestamp: 0, responseChange: 20, attentionProxy: 35, loadProxy: 30, visualTone: 45, luminance: 55, stability: 80 },
          { timestamp: 1, responseChange: 70, attentionProxy: 74, loadProxy: 62, visualTone: 54, luminance: 60, stability: 30 },
          { timestamp: 2, responseChange: 40, attentionProxy: 52, loadProxy: 48, visualTone: 50, luminance: 58, stability: 60 },
        ],
      },
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
      ...(overrides.neuralMirror ? { neuralMirror: overrides.neuralMirror } : {}),
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

  it('creates a bounded, state-id-agnostic creative signature with an explicitly excluded CPU Neural Mirror baseline', () => {
    const signature = buildCreativeSignature(makeResult('a'));
    const values = Object.values(signature.features);
    expect(signature.schemaVersion).toBe('brainsnn.signature.v0.2');
    expect(Object.prototype.hasOwnProperty.call(signature.features, 'stateId')).toBe(false);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(signature.neuralMirror.modelId).toBe('brainsnn-mirror-cpu-baseline');
    expect(signature.neuralMirror.validatedAgainstNeuralData).toBe(false);
    expect(signature.neuralMirror.canInfluenceSimilarity).toBe(false);
    expect(signature.provenance.neuralMirrorEligibleForOutcomeSimilarity).toBe(false);
  });

  it('returns identical similarity for identical signatures and lower similarity for changed patterns', () => {
    const first = buildCreativeSignature(makeResult('a'));
    const second = buildCreativeSignature(makeResult('b', { trust: 20, agreement: 0.25, meanSurprise: 0.8, reviewWindows: 2, transitions: 2 }));
    expect(signatureSimilarity(first, first)).toBe(1);
    expect(signatureSimilarity(first, second) < 1).toBe(true);
  });

  it('does not let unvalidated Neural Mirror embeddings change commercial outcome similarity', () => {
    const first = buildCreativeSignature(makeResult('a'));
    const second = JSON.parse(JSON.stringify(first));
    second.neuralMirror.embedding = second.neuralMirror.embedding.map((value) => -value);
    expect(first.neuralMirror.canInfluenceSimilarity).toBe(false);
    expect(signatureSimilarity(first, second)).toBe(1);
  });

  it('only blends Neural Mirror similarity after compatible validation gates are explicitly present', () => {
    const first = buildCreativeSignature(makeResult('a'));
    const second = JSON.parse(JSON.stringify(first));
    for (const signature of [first, second]) {
      signature.neuralMirror.canInfluenceSimilarity = true;
      signature.neuralMirror.validatedAgainstNeuralData = true;
      signature.neuralMirror.trained = true;
      signature.neuralMirror.anatomicalRegistration = true;
      signature.neuralMirror.modelId = 'brainsnn-mirror-validated-fixture';
      signature.neuralMirror.modelVersion = '1.0.0';
      signature.neuralMirror.referenceSpace = 'fixture-parcels';
    }
    second.neuralMirror.embedding = second.neuralMirror.embedding.map((value) => -value);
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
    expect(evaluation.neuralMirror.eligibleForOutcomeSimilarity).toBe(false);
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
