import { discoverComputeDevice } from '../device.js';
import { createNeuralPrediction } from '../schema.js';

export const CPU_BASELINE_ID = 'brainsnn-cpu-baseline';
export const CPU_BASELINE_VERSION = '0.1.0';

function hash32(value = '') {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pseudoWeight(seed, parcel, feature) {
  let value = (seed ^ Math.imul(parcel + 1, 0x9e3779b1) ^ Math.imul(feature + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

function activationFor(vector, parcel, seed, previous = 0) {
  let projection = pseudoWeight(seed, parcel, vector.length + 1) * 0.12;
  for (let feature = 0; feature < vector.length; feature += 1) {
    projection += vector[feature] * pseudoWeight(seed, parcel, feature) / Math.sqrt(Math.max(1, vector.length));
  }
  return Number(Math.tanh(projection + previous * 0.18).toFixed(6));
}

function confidenceFor(segment, sequence) {
  const available = sequence.selectedModalities.filter((modality) => sequence.modalityStatus?.[modality]?.status === 'available').length;
  const nonZero = segment.fused.filter((value) => Math.abs(value) > 1e-9).length;
  const coverage = available / Math.max(1, sequence.selectedModalities.length);
  const density = nonZero / Math.max(1, segment.fused.length);
  return Number(Math.min(0.62, Math.max(0.08, 0.12 + coverage * 0.28 + density * 0.18)).toFixed(6));
}

export function createCpuBaselineAdapter(options = {}) {
  const parcelCount = Math.floor(Number(options.parcelCount ?? 1000));
  if (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 10_000) throw new Error('CPU baseline parcelCount must be between 1 and 10000.');
  const seed = Number.isInteger(options.seed) ? options.seed : 2026;
  const device = discoverComputeDevice(options.device || {});
  return {
    id: CPU_BASELINE_ID,
    version: CPU_BASELINE_VERSION,
    metadata() {
      return {
        id: CPU_BASELINE_ID,
        version: CPU_BASELINE_VERSION,
        status: 'available',
        commercialUse: true,
        researchOnly: false,
        trained: false,
        validated: false,
        modelStatus: 'baseline_untrained',
        referenceSpace: 'parcel',
        parcelCount,
        device,
        architecture: 'deterministic normalized fusion projection with temporal recurrence',
      };
    },
    async health() {
      return { status: 'available', device, modelLoaded: true, trained: false, validated: false };
    },
    async predict(sequence, predictionOptions = {}) {
      if (!Array.isArray(sequence?.segments) || !sequence.segments.length) throw new Error('CPU baseline requires a non-empty multimodal feature sequence.');
      const availableSelected = (sequence.selectedModalities || []).filter((modality) => sequence.modalityStatus?.[modality]?.status === 'available');
      if (!availableSelected.length) {
        const error = new Error('No selected modality has extracted features; CPU baseline will not generate a bias-only prediction.');
        error.code = 'no_modalities_available';
        throw error;
      }
      const effectiveSeed = hash32(`${seed}|${predictionOptions.seed ?? seed}|${sequence.embeddingDimension}|${parcelCount}|${sequence.ablation}`);
      let previous = new Array(parcelCount).fill(0);
      const timeline = sequence.segments.map((segment) => {
        if (!Array.isArray(segment.fused) || segment.fused.length !== sequence.embeddingDimension || segment.fused.some((value) => !Number.isFinite(Number(value)))) {
          throw new Error('CPU baseline received a malformed fused feature vector.');
        }
        const activations = new Array(parcelCount);
        for (let parcel = 0; parcel < parcelCount; parcel += 1) {
          activations[parcel] = activationFor(segment.fused, parcel, effectiveSeed, previous[parcel]);
        }
        previous = activations;
        return {
          startMs: segment.startMs,
          endMs: segment.endMs,
          activations,
          confidence: confidenceFor(segment, sequence),
          modalityContribution: segment.modalityContribution,
        };
      });
      return createNeuralPrediction({
        model: { id: CPU_BASELINE_ID, version: CPU_BASELINE_VERSION, device: device.id },
        modelStatus: 'baseline_untrained',
        referenceSpace: { type: 'parcel', atlas: options.atlas || 'brainsnn-abstract-parcels-v1', parcelCount },
        timeline,
        evidence: {
          method: 'Untrained deterministic projection baseline for pipeline verification.',
          validatedAgainstNeuralData: false,
          confidenceMethod: 'Feature availability and non-zero coverage heuristic; not empirical calibration.',
        },
        provenance: {
          adapter: CPU_BASELINE_ID,
          seed: effectiveSeed,
          featureSchemaVersion: sequence.schemaVersion,
          extractorVersions: Object.fromEntries(Object.entries(sequence.extractorMetadata || {}).map(([key, value]) => [key, value?.version || 'unknown'])),
          commercialUse: true,
          researchOnly: false,
          trained: false,
          validated: false,
        },
      });
    },
  };
}
