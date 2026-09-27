import { describe, expect, it } from '../../test/tinyVitest.js';
import { createCpuBaselineAdapter } from './adapters/cpuBaseline.js';
import { discoverComputeDevice, normalizeComputeDevice } from './device.js';
import { normalizeExperimentIndex, readExperimentIndex } from './experimentRegistry.js';
import { createScanReceipt } from './receipts.js';
import {
  NEURAL_PREDICTION_DISCLAIMER,
  createNeuralPrediction,
  createSpatialExportContract,
  validateNeuralPrediction,
} from './schema.js';
import { detectNeuralTemporalEvents } from './temporalEvents.js';

function featureSequence({ available = true } = {}) {
  return {
    schemaVersion: 'brainsnn.multimodal-features.v1',
    inputId: 'fixture',
    ablation: 'language',
    selectedModalities: ['language'],
    embeddingDimension: 28,
    featureLayout: { vision: 8, audio: 8, language: 12 },
    modalityStatus: {
      vision: { status: 'unavailable' },
      audio: { status: 'unavailable' },
      language: { status: available ? 'available' : 'unavailable' },
    },
    extractorMetadata: { language: { id: 'fixture-language', version: '1.0.0', latencyMs: 12 } },
    segments: [
      {
        id: 'segment-0', index: 0, startMs: 0, endMs: 1500,
        fused: [...new Array(16).fill(0), 0.1, 0.2, 0.3, ...new Array(9).fill(0)],
        modalityContribution: { vision: 0, audio: 0, language: 1 },
      },
      {
        id: 'segment-1', index: 1, startMs: 1500, endMs: 3000,
        fused: [...new Array(16).fill(0), 0.6, 0.2, 0.1, ...new Array(9).fill(0)],
        modalityContribution: { vision: 0, audio: 0, language: 1 },
      },
    ],
    provenance: { fusionMethod: 'fixture' },
  };
}

async function capturedError(callback) {
  try {
    await callback();
    return null;
  } catch (error) {
    return error;
  }
}

describe('canonical neural mirror contracts', () => {
  it('discovers CPU without assuming CUDA and preserves reported CUDA capabilities', () => {
    expect(discoverComputeDevice().type).toBe('cpu');
    const gpu = normalizeComputeDevice({
      id: 'cuda:0', type: 'cuda', name: 'GPU worker', memoryMb: 98304,
      capabilities: ['prediction', 'training'],
    });
    expect(gpu.type).toBe('cuda');
    expect(gpu.memoryMb).toBe(98304);
    expect(gpu.capabilities).toContain('training');
  });

  it('creates and validates a dense canonical prediction with a derived compatibility view', () => {
    const prediction = createNeuralPrediction({
      model: { id: 'fixture', version: '1', device: 'cpu' },
      modelStatus: 'baseline_untrained',
      referenceSpace: { type: 'parcel', parcelCount: 3 },
      timeline: [{
        startMs: 0, endMs: 1500, activations: [0.1, -0.2, 0.3], confidence: 0.2,
        modalityContribution: { vision: 0, audio: 0, language: 1 },
      }],
      evidence: { method: 'fixture', validatedAgainstNeuralData: false, confidenceMethod: 'fixture only' },
      provenance: { commercialUse: true, researchOnly: false },
    });
    expect(validateNeuralPrediction(prediction).valid).toBe(true);
    expect(Object.keys(prediction.compatibilityViews.broadRegions7.regions)).toHaveLength(7);
    expect(prediction.disclaimer).toBe(NEURAL_PREDICTION_DISCLAIMER);
    expect(prediction.evidence.validatedAgainstNeuralData).toBe(false);
    const spatial = createSpatialExportContract(prediction, 'volume');
    expect(spatial.status).toBe('mapping_required');
    expect(spatial.frames).toHaveLength(0);
    expect(spatial.kind).toContain('predicted');
  });

  it('rejects non-finite activation payloads and altered scientific disclaimers', () => {
    const base = {
      model: { id: 'fixture', version: '1', device: 'cpu' }, modelStatus: 'untrained',
      referenceSpace: { type: 'parcel', parcelCount: 1 },
      timeline: [{ startMs: 0, endMs: 10, activations: [Number.NaN], confidence: 0.2 }],
      evidence: { method: 'fixture', validatedAgainstNeuralData: false, confidenceMethod: 'none' },
      provenance: { commercialUse: true },
    };
    expect(validateNeuralPrediction(base).valid).toBe(false);
    expect(validateNeuralPrediction({ ...base, timeline: [{ startMs: 0, endMs: 10, activations: [0], confidence: 0.2 }], disclaimer: 'MRI result' }).valid).toBe(false);
    expect(validateNeuralPrediction({ ...base, timeline: [{ startMs: 0, endMs: 10, activations: [null], confidence: 0.2 }] }).valid).toBe(false);
    expect(validateNeuralPrediction({ ...base, timeline: [{ startMs: '0', endMs: 10, activations: [0], confidence: 0.2 }] }).valid).toBe(false);
  });

  it('produces a deterministic untrained CPU baseline and refuses bias-only prediction', async () => {
    const metadata = createCpuBaselineAdapter().metadata();
    expect(metadata.parcelCount).toBe(1000);
    expect(metadata.trained).toBe(false);
    expect(metadata.validated).toBe(false);
    const adapter = createCpuBaselineAdapter({ parcelCount: 12, seed: 7 });
    const first = await adapter.predict(featureSequence());
    const second = await adapter.predict(featureSequence());
    expect(first).toEqual(second);
    expect(first.timeline[0].activations).toHaveLength(12);
    expect(first.modelStatus).toBe('baseline_untrained');
    expect(first.evidence.validatedAgainstNeuralData).toBe(false);
    const error = await capturedError(() => adapter.predict(featureSequence({ available: false })));
    expect(error.code).toBe('no_modalities_available');
  });

  it('emits neutral bounded temporal events', async () => {
    const prediction = await createCpuBaselineAdapter({ parcelCount: 8 }).predict(featureSequence());
    const events = detectNeuralTemporalEvents(prediction);
    expect(events.some((event) => event.type === 'response_peak')).toBe(true);
    expect(events.some((event) => event.type === 'rapid_change')).toBe(true);
    expect(events.every((event) => event.confidence >= 0 && event.confidence <= 1)).toBe(true);
    expect(events.map((event) => event.description).join(' ')).not.toContain('emotion');
  });

  it('makes receipt hashes deterministic despite latency and wall-clock provenance', async () => {
    const input = { schemaVersion: 'brainsnn.multimodal.v1', id: 'fixture' };
    const featuresA = featureSequence();
    const featuresB = { ...featureSequence(), extractorMetadata: { language: { id: 'fixture-language', version: '1.0.0', latencyMs: 999 } } };
    const prediction = await createCpuBaselineAdapter({ parcelCount: 8 }).predict(featureSequence());
    const predictionB = { ...prediction, provenance: { ...prediction.provenance, processedAt: '2099-01-01T00:00:00Z' } };
    const first = createScanReceipt({ input, features: featuresA, prediction, now: () => new Date('2026-01-01T00:00:00Z') });
    const second = createScanReceipt({ input, features: featuresB, prediction: predictionB, now: () => new Date('2030-01-01T00:00:00Z') });
    expect(first.featureHash).toBe(second.featureHash);
    expect(first.neuralPredictionHash).toBe(second.neuralPredictionHash);
    expect(first.deterministicFingerprint).toBe(second.deterministicFingerprint);
    expect(first.id).toBe(second.id);
  });

  it('normalizes the Python experiment index shape without exposing checkpoint paths', async () => {
    const index = normalizeExperimentIndex({
      updatedAt: '2026-08-22T00:00:00Z',
      experiments: [{
        experimentId: 'mirror-0042', model: { id: 'ridge-v0', version: '0.1.0' },
        dataset: { id: 'fixture', version: '1', synthetic: true },
        device: { id: 'cpu:0', type: 'cpu', name: 'local', capabilities: ['training'] },
        startedAt: '2026-08-22T00:00:00Z', endedAt: '2026-08-22T00:01:00Z',
        status: 'completed', stage: 'champion', promotedChampion: true, checkpointPath: '/private/model.json',
        metrics: { validation: { meanPearson: 0.4, medianPearson: 0.3, positiveParcelFraction: 0.8, synthetic: true } },
      }],
    });
    expect(index.champion.model).toBe('ridge-v0');
    expect(index.champion.modelInfo.version).toBe('0.1.0');
    expect(index.champion.datasetInfo.synthetic).toBe(true);
    expect(index.champion.deviceInfo.type).toBe('cpu');
    expect(index.champion.startTime).toBe('2026-08-22T00:00:00Z');
    expect(index.champion.metricsBySplit.validation.meanPearson).toBe(0.4);
    expect(index.champion.checkpointAvailable).toBe(true);
    expect(JSON.stringify(index)).not.toContain('/private/model.json');
    expect((await readExperimentIndex('/definitely/missing/experiments.json')).status).toBe('unavailable');
  });
});
