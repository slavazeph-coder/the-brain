import { describe, expect, it } from '../test/tinyVitest.js';
import {
  buildNeuralMirrorEmbedding,
  extractNeuralMirrorFeatureSequence,
  neuralMirrorCanInfluenceOutcomeSimilarity,
  predictNeuralMirror,
} from './neuralMirror.js';

function fixture() {
  return {
    multimodal: {
      temporalReadout: {
        points: [
          { timestamp: 0, responseChange: 20, attentionProxy: 35, loadProxy: 30, visualTone: 45, luminance: 55, stability: 80 },
          { timestamp: 1, responseChange: 70, attentionProxy: 74, loadProxy: 62, visualTone: 54, luminance: 60, stability: 30 },
          { timestamp: 2, responseChange: 40, attentionProxy: 52, loadProxy: 48, visualTone: 50, luminance: 58, stability: 60 },
        ],
      },
      audio: {
        points: [
          { timestamp: 0, energy: 0.2, change: 0.1 },
          { timestamp: 1, energy: 0.7, change: 0.5 },
          { timestamp: 2, energy: 0.4, change: 0.2 },
        ],
      },
      semanticTimeline: [
        { start: 0, end: 0.8, text: 'This can reduce review time', tags: ['claim'] },
        { start: 1, end: 1.8, text: 'A pilot measured a 30% reduction', tags: ['proof'] },
        { start: 2, end: 2.8, text: 'Book a demo', tags: ['cta'] },
      ],
    },
  };
}

describe('Neural Mirror V0.1', () => {
  it('extracts a deterministic multimodal temporal feature sequence', () => {
    const first = extractNeuralMirrorFeatureSequence(fixture());
    const second = extractNeuralMirrorFeatureSequence(fixture());
    expect(first).toEqual(second);
    expect(first.length).toBe(3);
    expect(first[0].features.length).toBe(12);
  });

  it('produces a dense deterministic CPU contract without pretending neural validation', () => {
    const first = predictNeuralMirror(fixture(), { parcelCount: 32 });
    const second = predictNeuralMirror(fixture(), { parcelCount: 32 });
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('brainsnn.neural-mirror.v0.1');
    expect(first.timeline.length).toBe(3);
    expect(first.timeline[0].activations.length).toBe(32);
    expect(first.model.trained).toBe(false);
    expect(first.model.validatedAgainstNeuralData).toBe(false);
    expect(first.referenceSpace.anatomicalRegistration).toBe(false);
    expect(first.evidence.benchmarkMeanPearson).toBe(null);
    expect(first.disclaimer.includes('not a measured brain scan')).toBe(true);
  });

  it('creates a compact embedding but blocks unvalidated neural features from outcome similarity', () => {
    const prediction = predictNeuralMirror(fixture(), { parcelCount: 64 });
    const embedding = buildNeuralMirrorEmbedding(prediction, 8);
    expect(embedding.length).toBe(8);
    expect(embedding.every((value) => Number.isFinite(value))).toBe(true);
    expect(neuralMirrorCanInfluenceOutcomeSimilarity(prediction)).toBe(false);
  });

  it('only permits commercial similarity after every validation gate is explicit', () => {
    const prediction = predictNeuralMirror(fixture(), {
      parcelCount: 16,
      model: { trained: true, validatedAgainstNeuralData: true },
    });
    prediction.evidence.validatedAgainstNeuralData = true;
    prediction.referenceSpace.anatomicalRegistration = true;
    expect(neuralMirrorCanInfluenceOutcomeSimilarity(prediction)).toBe(true);
  });
});
