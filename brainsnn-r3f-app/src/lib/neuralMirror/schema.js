export const NEURAL_PREDICTION_SCHEMA_VERSION = 'brainsnn.neural-prediction.v1';
export const NEURAL_SPATIAL_FRAME_SCHEMA_VERSION = 'brainsnn.neural-spatial-frame.v1';
export const NEURAL_PREDICTION_DISCLAIMER =
  'Model-predicted neural response on reference representation; not a measured brain scan or medical assessment.';
export const REFERENCE_SPACE_TYPES = Object.freeze(['abstract', 'parcel', 'fsaverage', 'mni152']);

const BROAD_REGION_CODES = Object.freeze(['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL']);

function finite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
  return value;
}

function bounded(value, minimum, maximum, field) {
  const parsed = finite(value, field);
  if (parsed < minimum || parsed > maximum) throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  return parsed;
}

function safeLabel(value, fallback, max = 160) {
  const result = String(value || fallback || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  if (!result) throw new Error('Required metadata label is empty.');
  return result;
}

function validateActivations(values, parcelCount, field) {
  if (!Array.isArray(values) || values.length !== parcelCount) throw new Error(`${field} must contain ${parcelCount} activations.`);
  return values.map((value, index) => {
    const parsed = finite(value, `${field}[${index}]`);
    if (Math.abs(parsed) > 1_000_000) throw new Error(`${field}[${index}] is outside the supported numeric range.`);
    return parsed;
  });
}

export function summarizeTimeline(timeline = []) {
  if (!timeline.length) return { meanActivation: 0, peakActivation: 0, peakTimestampMs: 0, temporalVariance: 0 };
  const windowMeans = timeline.map((frame) => frame.activations.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, frame.activations.length));
  const meanActivation = windowMeans.reduce((sum, value) => sum + value, 0) / windowMeans.length;
  let peakIndex = 0;
  windowMeans.forEach((value, index) => { if (value > windowMeans[peakIndex]) peakIndex = index; });
  const variance = windowMeans.reduce((sum, value) => sum + ((value - meanActivation) ** 2), 0) / windowMeans.length;
  return {
    meanActivation: Number(meanActivation.toFixed(6)),
    peakActivation: Number(windowMeans[peakIndex].toFixed(6)),
    peakTimestampMs: timeline[peakIndex].startMs,
    temporalVariance: Number(variance.toFixed(6)),
  };
}

export function deriveBroadRegionCompatibility(timeline, referenceSpace, options = {}) {
  const parcelCount = Number(referenceSpace?.parcelCount) || timeline?.[0]?.activations?.length || 0;
  const accumulators = Object.fromEntries(BROAD_REGION_CODES.map((code) => [code, []]));
  for (let parcel = 0; parcel < parcelCount; parcel += 1) {
    const code = BROAD_REGION_CODES[parcel % BROAD_REGION_CODES.length];
    const values = timeline.map((frame) => Number(frame.activations[parcel])).filter(Number.isFinite);
    if (values.length) accumulators[code].push(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  const regions = Object.fromEntries(BROAD_REGION_CODES.map((code) => {
    const values = accumulators[code];
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return [code, Number((50 + Math.max(-1, Math.min(1, mean)) * 50).toFixed(3))];
  }));
  return {
    mappingId: options.mappingId || 'brainsnn.parcel-modulo-broad-regions7.v1',
    sourceSpace: referenceSpace?.type || 'parcel',
    derived: true,
    regions,
    provenance: {
      method: 'deterministic parcel-index compatibility aggregation',
      canonicalSource: NEURAL_PREDICTION_SCHEMA_VERSION,
      scientificRole: 'visualization_compatibility_only',
    },
    disclaimer: NEURAL_PREDICTION_DISCLAIMER,
  };
}

export function createNeuralPrediction(value = {}) {
  const referenceType = String(value.referenceSpace?.type || 'parcel');
  if (!REFERENCE_SPACE_TYPES.includes(referenceType)) throw new Error('Unsupported neural reference space.');
  const inferredCount = value.timeline?.[0]?.activations?.length;
  const parcelCount = Math.floor(finite(value.referenceSpace?.parcelCount ?? inferredCount, 'referenceSpace.parcelCount'));
  if (parcelCount < 1 || parcelCount > 100_000) throw new Error('referenceSpace.parcelCount is outside the supported range.');
  if (!Array.isArray(value.timeline) || value.timeline.length < 1 || value.timeline.length > 5000) {
    throw new Error('timeline must contain between 1 and 5000 frames.');
  }
  const timeline = value.timeline.map((frame, index) => {
    const startMs = finite(frame.startMs, `timeline[${index}].startMs`);
    const endMs = finite(frame.endMs, `timeline[${index}].endMs`);
    if (startMs < 0 || endMs <= startMs) throw new Error(`timeline[${index}] has invalid timestamps.`);
    if (index && startMs < value.timeline[index - 1].startMs) throw new Error('timeline must be ordered by startMs.');
    const contribution = frame.modalityContribution || {};
    return {
      startMs,
      endMs,
      activations: validateActivations(frame.activations, parcelCount, `timeline[${index}].activations`),
      confidence: Number(bounded(frame.confidence, 0, 1, `timeline[${index}].confidence`).toFixed(6)),
      modalityContribution: Object.fromEntries(['vision', 'audio', 'language'].map((modality) => [
        modality,
        Number(bounded(contribution[modality] ?? 0, 0, 1, `timeline[${index}].modalityContribution.${modality}`).toFixed(6)),
      ])),
    };
  });
  const disclaimer = value.disclaimer || NEURAL_PREDICTION_DISCLAIMER;
  if (disclaimer !== NEURAL_PREDICTION_DISCLAIMER) throw new Error('Neural prediction disclaimer must use the canonical wording.');
  const validatedAgainstNeuralData = Boolean(value.evidence?.validatedAgainstNeuralData);
  const prediction = {
    schemaVersion: NEURAL_PREDICTION_SCHEMA_VERSION,
    model: {
      id: safeLabel(value.model?.id, 'unknown-model'),
      version: safeLabel(value.model?.version, 'unknown'),
      device: safeLabel(value.model?.device, 'cpu'),
    },
    modelStatus: safeLabel(value.modelStatus, 'unknown'),
    referenceSpace: {
      type: referenceType,
      ...(value.referenceSpace?.atlas ? { atlas: safeLabel(value.referenceSpace.atlas, 'unspecified') } : {}),
      parcelCount,
    },
    timeline,
    summary: summarizeTimeline(timeline),
    evidence: {
      method: safeLabel(value.evidence?.method, 'unspecified'),
      validatedAgainstNeuralData,
      ...(value.evidence?.benchmarkId ? { benchmarkId: safeLabel(value.evidence.benchmarkId, '') } : {}),
      confidenceMethod: safeLabel(value.evidence?.confidenceMethod, 'unspecified'),
    },
    provenance: {
      ...(value.provenance || {}),
      commercialUse: value.provenance?.commercialUse !== false,
      researchOnly: Boolean(value.provenance?.researchOnly),
      disclaimer,
    },
    disclaimer,
  };
  prediction.compatibilityViews = {
    ...(value.compatibilityViews || {}),
    broadRegions7: deriveBroadRegionCompatibility(timeline, prediction.referenceSpace),
  };
  return prediction;
}

export function validateNeuralPrediction(value) {
  try {
    return { valid: true, errors: [], value: createNeuralPrediction(value) };
  } catch (error) {
    return { valid: false, errors: [error?.message || 'Invalid neural prediction.'], value: null };
  }
}

export function createNeuralSpatialFrame(value = {}) {
  const space = String(value.space || 'parcel');
  if (!['parcel', 'fsaverage', 'mni152'].includes(space)) throw new Error('Neural spatial frame space must be parcel, fsaverage, or mni152.');
  if (!Array.isArray(value.values) || !value.values.length || value.values.some((item) => !Number.isFinite(Number(item)))) {
    throw new Error('Neural spatial frame values must be a non-empty finite array.');
  }
  return {
    schemaVersion: NEURAL_SPATIAL_FRAME_SCHEMA_VERSION,
    timestampMs: finite(value.timestampMs, 'timestampMs'),
    space,
    values: value.values.map(Number),
    mappingId: safeLabel(value.mappingId, 'unspecified-predicted-mapping'),
    dataStatus: 'predicted',
    disclaimer: NEURAL_PREDICTION_DISCLAIMER,
  };
}

export function createSpatialExportContract(prediction, target = 'parcel') {
  const validated = createNeuralPrediction(prediction);
  if (!['parcel', 'surface', 'volume'].includes(target)) throw new Error('Spatial export target must be parcel, surface, or volume.');
  const targetSpace = target === 'surface' ? 'fsaverage' : target === 'volume' ? 'mni152' : 'parcel';
  return {
    schemaVersion: 'brainsnn.neural-spatial-export.v1',
    kind: `predicted_${target}_timeline`,
    status: target === 'parcel' ? 'available' : 'mapping_required',
    sourcePrediction: { model: validated.model, referenceSpace: validated.referenceSpace },
    targetSpace,
    frames: target === 'parcel'
      ? validated.timeline.map((frame) => createNeuralSpatialFrame({ timestampMs: frame.startMs, space: 'parcel', values: frame.activations, mappingId: validated.compatibilityViews.broadRegions7.mappingId }))
      : [],
    filenamePolicy: 'Export filenames must include "predicted".',
    disclaimer: NEURAL_PREDICTION_DISCLAIMER,
  };
}
