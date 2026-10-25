import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  buildCurveCoordinates,
  createNeuralMirrorViewModel,
  formatTimestampMs,
  validateNeuralPrediction,
} from './neuralMirrorViewModel.js';

function fixture(overrides = {}) {
  return {
    schemaVersion: 'brainsnn.neural-prediction.v1',
    model: { id: 'brainsnn-cpu-baseline', version: '0.1.0', device: 'cpu' },
    modelStatus: 'baseline_untrained',
    referenceSpace: { type: 'parcel', atlas: 'brainsnn-abstract-v1', parcelCount: 3 },
    timeline: [
      { startMs: 0, endMs: 1500, activations: [0.1, 0.2, 0.3], confidence: 0.6 },
      { startMs: 1500, endMs: 3000, activations: [0.3, 0.5, 0.7], confidence: 0.72 },
      { startMs: 3000, endMs: 4123, activations: [0.2, 0.1, 0.4], confidence: 0.65 },
    ],
    summary: { meanActivation: 0.31, peakActivation: 0.7, peakTimestampMs: 1500, temporalVariance: 0.02 },
    evidence: { method: 'deterministic_projection', validatedAgainstNeuralData: false, confidenceMethod: 'feature_coverage' },
    provenance: {
      modelStatus: 'baseline_untrained',
      disclaimer: 'Model-predicted neural response on reference representation; not a measured brain scan or medical assessment.',
    },
    disclaimer: 'Model-predicted neural response on reference representation; not a measured brain scan or medical assessment.',
    ...overrides,
  };
}

describe('Neural Mirror view model', () => {
  it('ignores payloads that are not the canonical neural schema', () => {
    expect(createNeuralMirrorViewModel({ schemaVersion: 'legacy.v0' })).toBe(null);
  });

  it('preserves exact timestamps and derives only mean absolute response magnitude', () => {
    const prediction = fixture();
    prediction.timeline[0].activations = [-0.1, 0.2, -0.3];
    const view = createNeuralMirrorViewModel(prediction, {
      modalityStatus: { vision: { status: 'available', implementation: 'browser-sampler' } },
    });
    expect(view.valid).toBe(true);
    expect(view.points[1].startMs).toBe(1500);
    expect(view.points[2].endMs).toBe(4123);
    expect(view.points[0].meanActivation).toBeCloseTo(0.2);
    expect(view.points[1].timeLabel).toBe('00:01.500–00:03.000');
    expect(view.model.status).toBe('baseline_untrained');
  });

  it('reports missing modality metadata without inferring availability', () => {
    const view = createNeuralMirrorViewModel(fixture(), {
      modalityStatus: { vision: 'available', audio: { status: 'unavailable', reason: 'no_audio_track' } },
    });
    const byId = Object.fromEntries(view.modalities.map((item) => [item.id, item]));
    expect(byId.vision.status).toBe('available');
    expect(byId.audio.status).toBe('unavailable');
    expect(byId.language.status).toBe('not_reported');
  });

  it('rejects NaN and infinite activation values instead of hiding them', () => {
    const prediction = fixture({
      timeline: [{ startMs: 0, endMs: 1500, activations: [0.1, Number.NaN, Number.POSITIVE_INFINITY], confidence: 0.5 }],
    });
    const validation = validateNeuralPrediction(prediction);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('non-finite activation'))).toBe(true);
    expect(createNeuralMirrorViewModel(prediction).valid).toBe(false);
  });

  it('rejects malformed and backwards timestamps', () => {
    const prediction = fixture({
      timeline: [
        { startMs: 1500, endMs: 1500, activations: [0.1, 0.2, 0.3], confidence: 0.5 },
        { startMs: 1000, endMs: 2500, activations: [0.2, 0.3, 0.4], confidence: 1.2 },
      ],
    });
    const validation = validateNeuralPrediction(prediction);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('invalid end timestamp'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('out of temporal order'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('confidence'))).toBe(true);
  });

  it('does not coerce nulls or numeric strings into valid timeline values', () => {
    const prediction = fixture({
      timeline: [
        { startMs: '0', endMs: 1500, activations: [0.1, 0.2, 0.3], confidence: null },
      ],
    });
    const validation = validateNeuralPrediction(prediction);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('start timestamp'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('confidence'))).toBe(true);
  });

  it('rejects activation vectors that do not match the declared parcel count', () => {
    const prediction = fixture({
      timeline: [{ startMs: 0, endMs: 1500, activations: [0.1, 0.2], confidence: 0.5 }],
    });
    const validation = validateNeuralPrediction(prediction);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('expected 3'))).toBe(true);
  });

  it('requires the canonical disclaimer in both display and machine-readable provenance', () => {
    const wrongDisplay = validateNeuralPrediction(fixture({ disclaimer: 'Predicted response.' }));
    expect(wrongDisplay.valid).toBe(false);
    const wrongProvenance = fixture({ provenance: { disclaimer: 'not measured' } });
    expect(validateNeuralPrediction(wrongProvenance).valid).toBe(false);
  });

  it('builds finite chart coordinates for a constant response', () => {
    const points = [
      { meanActivation: 0.2 },
      { meanActivation: 0.2 },
      { meanActivation: 0.2 },
    ];
    const coordinates = buildCurveCoordinates(points);
    expect(coordinates).toHaveLength(3);
    for (const point of coordinates) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    expect(coordinates[0].y).toBe(coordinates[2].y);
  });

  it('formats millisecond timestamps without discarding precision', () => {
    expect(formatTimestampMs(8200)).toBe('00:08.200');
    expect(formatTimestampMs(3_661_007)).toBe('01:01:01.007');
  });
});
