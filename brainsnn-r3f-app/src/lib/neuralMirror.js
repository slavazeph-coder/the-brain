export const NEURAL_MIRROR_SCHEMA_VERSION = 'brainsnn.neural-mirror.v0.1';
export const NEURAL_MIRROR_MODEL_ID = 'brainsnn-mirror-cpu-baseline';
export const NEURAL_MIRROR_MODEL_VERSION = '0.1.0';
export const DEFAULT_PARCEL_COUNT = 1000;

const FEATURE_KEYS = [
  'responseChange',
  'attentionProxy',
  'loadProxy',
  'visualTone',
  'luminance',
  'stability',
  'audioEnergy',
  'audioChange',
  'speechPresent',
  'claimPresent',
  'proofPresent',
  'ctaPresent',
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(Math.abs(numeric) > 1 ? numeric / 100 : numeric);
}

function hashString(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signedWeight(parcelIndex, featureIndex, seed) {
  let value = (seed ^ Math.imul(parcelIndex + 1, 2246822519) ^ Math.imul(featureIndex + 11, 3266489917)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822519) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489917) >>> 0;
  value ^= value >>> 16;
  return ((value / 4294967295) * 2) - 1;
}

function nearestByTimestamp(items = [], timestamp = 0) {
  if (!items.length) return null;
  let best = items[0];
  let distance = Math.abs((Number(best?.timestamp) || 0) - timestamp);
  for (const item of items.slice(1)) {
    const nextDistance = Math.abs((Number(item?.timestamp) || 0) - timestamp);
    if (nextDistance < distance) {
      best = item;
      distance = nextDistance;
    }
  }
  return best;
}

function semanticFlagsAt(beats = [], timestamp = 0) {
  const beat = beats.find((item) => {
    const start = Number(item?.start ?? item?.timestamp ?? item?.startTime) || 0;
    const end = Number(item?.end ?? item?.endTime ?? start + 1) || start + 1;
    return timestamp >= start && timestamp <= end;
  }) || null;
  const tags = new Set((beat?.tags || beat?.types || []).map((item) => String(item).toLowerCase()));
  const text = String(beat?.text || beat?.label || '').toLowerCase();
  return {
    speechPresent: beat ? 1 : 0,
    claimPresent: tags.has('claim') || /\b(claim|promise|save|reduce|increase|improve|will|can)\b/.test(text) ? 1 : 0,
    proofPresent: tags.has('proof') || /\b(result|pilot|customer|tested|measured|benchmark|\d+(?:\.\d+)?%)\b/.test(text) ? 1 : 0,
    ctaPresent: tags.has('cta') || /\b(click|book|buy|send|start|try|contact|apply|subscribe)\b/.test(text) ? 1 : 0,
  };
}

export function extractNeuralMirrorFeatureSequence(input = {}) {
  const temporal = input?.temporalReadout || input?.multimodal?.temporalReadout || input?.multimodal?.temporal || input?.temporal || {};
  const points = Array.isArray(temporal?.points) ? temporal.points : [];
  const audioPoints = input?.audio?.points || input?.multimodal?.audio?.points || input?.multimodal?.audioEnvelope?.points || [];
  const beats = input?.transcriptBeats || input?.multimodal?.transcript?.beats || input?.multimodal?.semanticTimeline || input?.semanticTimeline || [];

  return points.map((point, index) => {
    const timestamp = Number(point?.timestamp) || 0;
    const audio = nearestByTimestamp(audioPoints, timestamp) || {};
    const semantic = semanticFlagsAt(beats, timestamp);
    const features = {
      responseChange: normalizeScore(point?.responseChange),
      attentionProxy: normalizeScore(point?.attentionProxy),
      loadProxy: normalizeScore(point?.loadProxy),
      visualTone: normalizeScore(point?.visualTone),
      luminance: normalizeScore(point?.luminance),
      stability: normalizeScore(point?.stability),
      audioEnergy: normalizeScore(audio?.energy ?? audio?.rms ?? audio?.value),
      audioChange: normalizeScore(audio?.change ?? audio?.delta),
      ...semantic,
    };
    return {
      index,
      timestamp,
      features: FEATURE_KEYS.map((key) => normalizeScore(features[key])),
      featureMap: features,
    };
  });
}

function projectFeatureVector(features, parcelCount, seed) {
  const output = new Array(parcelCount);
  for (let parcel = 0; parcel < parcelCount; parcel += 1) {
    let sum = 0;
    let norm = 0;
    for (let feature = 0; feature < features.length; feature += 1) {
      const weight = signedWeight(parcel, feature, seed);
      sum += (features[feature] - 0.5) * weight;
      norm += Math.abs(weight);
    }
    const projected = norm ? Math.tanh((sum / norm) * 3) : 0;
    output[parcel] = Number(projected.toFixed(5));
  }
  return output;
}

function summarizeTimeline(timeline = []) {
  if (!timeline.length) return { meanAbsoluteActivation: 0, peakAbsoluteActivation: 0, peakTimestamp: null, temporalVariance: 0 };
  const perFrame = timeline.map((frame) => frame.activations.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, frame.activations.length));
  const mean = perFrame.reduce((sum, value) => sum + value, 0) / perFrame.length;
  const variance = perFrame.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / perFrame.length;
  const peakIndex = perFrame.reduce((best, value, index) => value > perFrame[best] ? index : best, 0);
  return {
    meanAbsoluteActivation: Number(mean.toFixed(5)),
    peakAbsoluteActivation: Number(perFrame[peakIndex].toFixed(5)),
    peakTimestamp: timeline[peakIndex]?.timestamp ?? null,
    temporalVariance: Number(variance.toFixed(6)),
  };
}

export function neuralMirrorModelMetadata(overrides = {}) {
  return {
    id: NEURAL_MIRROR_MODEL_ID,
    version: NEURAL_MIRROR_MODEL_VERSION,
    device: 'cpu',
    trained: false,
    validatedAgainstNeuralData: false,
    modelStatus: 'baseline_untrained',
    commercialUse: true,
    representation: 'abstract-parcel-index',
    atlas: null,
    ...overrides,
  };
}

/**
 * Deterministic CPU architecture baseline. This proves the production contract
 * and dense temporal data path only. Its projection weights are NOT learned
 * from human neural recordings and must never be presented as neuroscience
 * validation or as a measured brain response.
 */
export function predictNeuralMirror(input = {}, options = {}) {
  const parcelCount = Math.max(8, Math.min(4000, Math.round(Number(options.parcelCount) || DEFAULT_PARCEL_COUNT)));
  const model = neuralMirrorModelMetadata(options.model || {});
  const sequence = Array.isArray(options.featureSequence) ? options.featureSequence : extractNeuralMirrorFeatureSequence(input);
  const seed = hashString(`${model.id}:${model.version}:${parcelCount}`);
  const timeline = sequence.map((item) => ({
    timestamp: Number(item?.timestamp) || 0,
    activations: projectFeatureVector(item?.features || [], parcelCount, seed),
    confidence: 0,
  }));

  return {
    schemaVersion: NEURAL_MIRROR_SCHEMA_VERSION,
    mode: 'predicted',
    model,
    referenceSpace: {
      type: 'abstract-parcel-index',
      atlas: null,
      parcelCount,
      anatomicalRegistration: false,
    },
    input: {
      temporalFrames: sequence.length,
      featureDimensions: FEATURE_KEYS.length,
      featureNames: [...FEATURE_KEYS],
    },
    timeline,
    summary: summarizeTimeline(timeline),
    evidence: {
      method: 'deterministic untrained CPU projection',
      benchmarkId: null,
      benchmarkMeanPearson: null,
      validatedAgainstNeuralData: false,
      confidenceMethod: 'none-until-neural-validation',
    },
    provenance: {
      projectionSeed: seed,
      sourceSchema: input?.multimodal?.schemaVersion || input?.schemaVersion || null,
      rawMediaRetained: false,
    },
    disclaimer: 'Modelled architecture baseline only. These values are not learned from recorded neural data, are not a measured brain scan, and are not a medical assessment.',
  };
}

export function buildNeuralMirrorEmbedding(prediction = {}, dimensions = 16) {
  const timeline = Array.isArray(prediction?.timeline) ? prediction.timeline : [];
  const parcelCount = Number(prediction?.referenceSpace?.parcelCount) || timeline[0]?.activations?.length || 0;
  const size = Math.max(4, Math.min(64, Math.round(Number(dimensions) || 16)));
  if (!timeline.length || !parcelCount) return null;
  const means = new Array(parcelCount).fill(0);
  for (const frame of timeline) {
    for (let index = 0; index < parcelCount; index += 1) means[index] += Number(frame?.activations?.[index]) || 0;
  }
  for (let index = 0; index < means.length; index += 1) means[index] /= timeline.length;
  const embedding = new Array(size).fill(0);
  const counts = new Array(size).fill(0);
  means.forEach((value, index) => {
    const bucket = Math.min(size - 1, Math.floor((index / Math.max(1, means.length)) * size));
    embedding[bucket] += value;
    counts[bucket] += 1;
  });
  return embedding.map((value, index) => Number((value / Math.max(1, counts[index])).toFixed(5)));
}

export function neuralMirrorCanInfluenceOutcomeSimilarity(prediction = {}) {
  return Boolean(
    prediction?.model?.trained
    && prediction?.model?.validatedAgainstNeuralData
    && prediction?.evidence?.validatedAgainstNeuralData
    && prediction?.referenceSpace?.anatomicalRegistration,
  );
}
