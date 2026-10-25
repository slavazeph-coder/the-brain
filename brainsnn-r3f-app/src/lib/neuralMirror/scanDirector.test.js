import { describe, expect, it } from '../../test/tinyVitest.js';
import { createScanDirector } from './scanDirector.js';
import { NEURAL_PREDICTION_DISCLAIMER } from './schema.js';

function videoFixture() {
  return {
    schemaVersion: 'brainsnn.multimodal.v1',
    id: 'browser-video-fixture',
    source: { type: 'video', filename: 'fixture.mp4', durationMs: 3000, mimeType: 'video/mp4' },
    text: { transcript: 'Security companies could pay $300+ for footage labeling. The product then demonstrates the structured output.' },
    observations: {
      vision: [
        { timestampMs: 100, luminance: 0.35, motion: 0.15, red: 0.2, green: 0.4, blue: 0.6 },
        { timestampMs: 1700, luminance: 0.75, motion: 0.8, red: 0.7, green: 0.5, blue: 0.3 },
      ],
      audio: [
        { timestampMs: 200, audioEnergy: 0.25, speechPresent: true },
        { timestampMs: 1800, audioEnergy: 0.8, speechPresent: true },
      ],
    },
    provenance: { userProvided: true, extractorVersions: { browserSampler: '1.0.0' } },
  };
}

describe('ScanDirector integration', () => {
  it('runs fixture video through segmentation, features, CPU prediction, BrainSNN, and evidence', async () => {
    const director = createScanDirector({ env: {}, parcelCount: 16, now: () => new Date('2026-08-22T12:00:00Z') });
    const result = await director.run(videoFixture(), { context: 'video_script' });
    expect(result.schemaVersion).toBe('brainsnn.creative-scan.v1');
    expect(result.metrics.trust).toBeGreaterThanOrEqual(0);
    expect(result.firewallSignals.manipulationPressure).toBeGreaterThanOrEqual(0);
    expect(result.stimulus.temporal.segmentCount).toBe(2);
    expect(result.stimulus.temporal.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([[0, 1500], [1500, 3000]]);
    expect(result.neural.schemaVersion).toBe('brainsnn.neural-prediction.v1');
    expect(result.neural.model.id).toBe('brainsnn-cpu-baseline');
    expect(result.neural.modelStatus).toBe('baseline_untrained');
    expect(result.neural.timeline).toHaveLength(2);
    expect(result.neural.timeline.every((frame) => frame.activations.length === 16)).toBe(true);
    expect(result.neural.timeline.every((frame) => frame.activations.every(Number.isFinite))).toBe(true);
    expect(result.neural.timeline.every((frame) => frame.confidence >= 0 && frame.confidence <= 1)).toBe(true);
    expect(result.neural.evidence.validatedAgainstNeuralData).toBe(false);
    expect(result.neural.disclaimer).toBe(NEURAL_PREDICTION_DISCLAIMER);
    expect(result.modalityStatus.vision.status).toBe('available');
    expect(result.modalityStatus.audio.status).toBe('available');
    expect(result.modalityStatus.language.status).toBe('available');
    expect(result.neuralEvents.length).toBeGreaterThan(0);
    expect(result.creativeSignals.source).toBe('BrainSNN deterministic layer stack');
    expect(result.creativeSignals.timeline).toHaveLength(2);
    expect(result.sourceLabels.creativeSignals).toBe('BrainSNN deterministic layer stack');
    expect(result.sourceLabels.neural).toContain('brainsnn-cpu-baseline');
    expect(result.scanTrace).toContain('neural.brainsnn-cpu-baseline.complete');
    expect(result.scanTrace.at(-1)).toBe('report.complete');
    expect(result.computeTrace.find((item) => item.engine === 'tribe-reference').status).toBe('excluded');
    expect(result.tribeProjection.mappingProvenance.canonicalSource).toBe('brainsnn.neural-prediction.v1');
    expect(result.tribeProjection.measured).toBe(false);
    expect(result.evidenceGaps.topRecommendation.mostValuableProof).toHaveLength(5);
    expect(result.recommendations[0].timestampMs).toBe(0);
    expect(result.recommendations.filter((item) => item?.id === result.recommendations[0].id)).toHaveLength(1);
    expect(result.receipt.id).toMatch(/^mirror-/);
    expect(result.receipt.legacyReceiptId).toMatch(/^bsnn-/);
    expect(result.receipt.inputHash.length).toBeGreaterThan(0);
    expect(result.receipt.contentHash.length).toBeGreaterThan(0);
    expect(result.receipt.resultHash.length).toBeGreaterThan(0);
    expect(result.receipt.solitonHash.length).toBeGreaterThan(0);
    expect(result.telemetry.gpuSeconds).toBe(null);
    expect(result.telemetry.cost).toBe(null);
  });

  it('reproduces neural output and the primary receipt for the same fixture and model version', async () => {
    const director = createScanDirector({ env: {}, parcelCount: 8, now: () => new Date('2026-08-22T12:00:00Z') });
    const first = await director.run(videoFixture());
    const second = await director.run(videoFixture());
    expect(first.neural).toEqual(second.neural);
    expect(first.receipt.id).toBe(second.receipt.id);
    expect(first.receipt.inputHash).toBe(second.receipt.inputHash);
    expect(first.receipt.featureHash).toBe(second.receipt.featureHash);
    expect(first.receipt.neuralPredictionHash).toBe(second.receipt.neuralPredictionHash);
  });

  it('continues the deterministic creative scan when no modality can produce features', async () => {
    const director = createScanDirector({ env: {}, parcelCount: 8, now: () => new Date('2026-08-22T12:00:00Z') });
    const result = await director.run({
      source: { type: 'video', filename: 'metadata-only.mp4', durationMs: 1500, mimeType: 'video/mp4' },
      provenance: { userProvided: true },
    });
    expect(result.neural).toBe(null);
    expect(result.neuralStatus.status).toBe('unavailable');
    expect(result.neuralStatus.provenance.generatedPrediction).toBe(false);
    expect(result.scanTrace).toContain('neural.unavailable');
    expect(result.creativeSignals.aggregate.metrics.trust).toBeGreaterThanOrEqual(0);
    expect(result.receipt.disclaimer).toBe(NEURAL_PREDICTION_DISCLAIMER);
    expect(result.computeTrace.some((item) => item.engine === 'brainsnn-cpu-baseline' && item.status === 'failed')).toBe(true);
  });

  it('accepts text-only language input without video, audio, GPU, weights, or TRIBE', async () => {
    const result = await createScanDirector({ env: {}, parcelCount: 8 }).run('A customer pilot processed 12 hours of footage and reported a two-day turnaround.');
    expect(result.modalityStatus.language.status).toBe('available');
    expect(result.modalityStatus.vision.status).toBe('unavailable');
    expect(result.modalityStatus.audio.status).toBe('unavailable');
    expect(result.neural.model.id).toBe('brainsnn-cpu-baseline');
    expect(result.neural.provenance.researchOnly).toBe(false);
  });
});
