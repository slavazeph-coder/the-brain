import { describe, expect, it } from '../test/tinyVitest.js';
import {
  assertTruthfulNeuralLabel,
  buildNeuralScanReceipt,
  neuralProjectionProvenance,
} from './neuralScanReceipt.js';

describe('Predicted Neural Response scan receipt', () => {
  it('uses the current seven-region reference projection without inventing parcel data', () => {
    const receipt = buildNeuralScanReceipt({
      id: 'scan-1',
      metrics: { urgency: 40, fear: 20, trust: 70, excitement: 55, empathy: 60 },
    });
    expect(receipt.predictionMode).toBe('metrics-derived-reference-projection');
    expect(receipt.regions).toHaveLength(7);
    expect(receipt.timeline).toBe(null);
    expect(receipt.timeAxis).toHaveLength(1);
    expect(receipt.confidence).toBe(null);
    expect(receipt.confidenceStatus).toBe('not-calibrated-in-result-payload');
    expect(receipt.interpretation.includes('Not a subject MRI')).toBe(true);
    expect(receipt.provenance.commercialOutcomePredictionIncluded).toBe(false);
  });

  it('preserves a provided model region projection and available confidence', () => {
    const result = {
      tribeProjection: {
        source: 'test predicted projection',
        modelVersion: 'mirror-v0.3',
        confidence: 0.78,
        regions: { CTX: 70, HPC: 60, THL: 80, AMY: 30, BG: 45, PFC: 65, CBL: 55 },
      },
    };
    const provenance = neuralProjectionProvenance(result);
    const receipt = buildNeuralScanReceipt(result, { stimulusHash: 'sha256:test' });
    expect(provenance.mode).toBe('predicted-model-projection');
    expect(receipt.modelVersion).toBe('mirror-v0.3');
    expect(receipt.confidence).toBe(0.78);
    expect(receipt.stimulusHash).toBe('sha256:test');
    expect(receipt.regions.find((region) => region.code === 'CTX').predictedValue).toBe(70);
  });

  it('rejects labels that falsely imply measured neuroimaging or biometrics', () => {
    expect(assertTruthfulNeuralLabel('Predicted neural response · reference projection')).toBe(true);
    expect(assertTruthfulNeuralLabel('Measured MRI response')).toBe(false);
    expect(assertTruthfulNeuralLabel('Actual EEG biometric readout')).toBe(false);
  });
});
