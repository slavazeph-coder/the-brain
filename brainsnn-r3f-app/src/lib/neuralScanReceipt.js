import { BRAIN_REGIONS } from '../features/brain3d/brainRegions.js';
import { mapResultToActivities } from '../features/brain3d/mapResultToBrain.js';

export const NEURAL_SCAN_SCHEMA_VERSION = 'brainsnn.predicted-neural-response.v0.1';

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function confidenceFromResult(result = {}) {
  const candidates = [
    result?.tribeProjection?.confidence,
    result?.neuralPrediction?.confidence,
    result?.multimodal?.beliefReport?.confidence,
    result?.confidence,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value > 1 ? clamp01(value / 100) : clamp01(value);
  }
  return null;
}

function modelVersionFromResult(result = {}) {
  return String(
    result?.tribeProjection?.modelVersion
      || result?.neuralPrediction?.modelVersion
      || result?.modelVersion
      || result?.engineVersion
      || 'BrainSNN 7-region projection v0.1',
  ).slice(0, 160);
}

function availableTimeline(result = {}) {
  const explicit = result?.tribeProjection?.timeline;
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.slice(0, 600).map((point, index) => ({
      t: Number.isFinite(Number(point?.t)) ? Number(point.t) : index,
      regions: Object.fromEntries(BRAIN_REGIONS.map((region) => [
        region.code,
        Math.round(Math.max(0, Math.min(100, Number(point?.regions?.[region.code]) || 0)) * 100) / 100,
      ])),
    }));
  }
  return null;
}

export function neuralProjectionProvenance(result = {}) {
  if (result?.tribeProjection?.regions) {
    return {
      mode: 'predicted-model-projection',
      referenceSpace: 'BrainSNN 7-region conceptual reference projection',
      source: result.tribeProjection?.source || 'model-provided region projection',
      timeResolved: Boolean(availableTimeline(result)),
    };
  }
  return {
    mode: 'metrics-derived-reference-projection',
    referenceSpace: 'BrainSNN 7-region conceptual reference projection',
    source: 'deterministic mapping from current BrainSNN content metrics',
    timeResolved: false,
  };
}

export function buildNeuralScanReceipt(result = {}, { stimulusHash = null } = {}) {
  const activities = mapResultToActivities(result);
  const provenance = neuralProjectionProvenance(result);
  const timeline = availableTimeline(result);
  const regions = BRAIN_REGIONS.map((region) => ({
    code: region.code,
    label: region.name,
    predictedValue: Math.round((activities[region.code] || 0) * 10000) / 100,
  }));

  return {
    schemaVersion: NEURAL_SCAN_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    stimulusHash: stimulusHash || result?.stimulusHash || result?.inputHash || null,
    stimulusHashStatus: stimulusHash || result?.stimulusHash || result?.inputHash ? 'available' : 'not-available-in-result-payload',
    modelVersion: modelVersionFromResult(result),
    predictionMode: provenance.mode,
    referenceSpace: provenance.referenceSpace,
    interpretation: 'Predicted/reference projection only. Not a subject MRI, EEG, biometric measurement, diagnosis, or measured neural recording.',
    confidence: confidenceFromResult(result),
    confidenceStatus: confidenceFromResult(result) == null ? 'not-calibrated-in-result-payload' : 'reported-by-model-pipeline',
    timeAxis: timeline ? timeline.map((point) => point.t) : ['aggregate'],
    regions,
    timeline,
    provenance: {
      source: provenance.source,
      timeResolved: provenance.timeResolved,
      rawMediaUploadedByThisReceipt: false,
      commercialOutcomePredictionIncluded: false,
    },
  };
}

export function assertTruthfulNeuralLabel(text = '') {
  const normalized = String(text).toLowerCase();
  const forbidden = [
    'measured mri',
    'measured fmri',
    'measured eeg',
    'actual mri',
    'actual fmri',
    'actual eeg',
    'subject mri scan',
    'brain measurement',
    'biometric readout',
  ];
  return !forbidden.some((phrase) => normalized.includes(phrase));
}
