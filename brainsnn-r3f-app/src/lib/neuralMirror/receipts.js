import { createHash } from 'node:crypto';

export const PIPELINE_VERSION = 'brainsnn.neural-mirror-pipeline.v1';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256Hex(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

const VOLATILE_KEYS = /^(?:latencyMs|processedAt|generatedAt|exportedAt|timestamp|telemetry|metrics|memoryMb|gpuSeconds|vramPeakMb|watts|cost)$/i;

function semanticValue(value, depth = 0) {
  if (depth > 30) return null;
  if (Array.isArray(value)) return value.map((item) => semanticValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !VOLATILE_KEYS.test(key))
    .map((key) => [key, semanticValue(value[key], depth + 1)]));
}

export function semanticFeaturePayload(features = {}) {
  return semanticValue({
    schemaVersion: features.schemaVersion,
    inputId: features.inputId,
    ablation: features.ablation,
    selectedModalities: features.selectedModalities,
    featureLayout: features.featureLayout,
    embeddingDimension: features.embeddingDimension,
    segments: features.segments,
    modalityStatus: features.modalityStatus,
    extractorMetadata: features.extractorMetadata,
    provenance: features.provenance,
  });
}

export function semanticPredictionPayload(prediction = {}) {
  return semanticValue({
    schemaVersion: prediction.schemaVersion,
    model: prediction.model,
    modelStatus: prediction.modelStatus || prediction.status,
    referenceSpace: prediction.referenceSpace,
    timeline: prediction.timeline,
    summary: prediction.summary,
    evidence: prediction.evidence,
    provenance: prediction.provenance,
    compatibilityViews: prediction.compatibilityViews,
    disclaimer: prediction.disclaimer,
  });
}

export function createScanReceipt({ input, features, prediction, now = () => new Date(), seed = 2026 } = {}) {
  const inputHash = sha256Hex(input);
  const featureHash = sha256Hex(semanticFeaturePayload(features));
  const neuralPredictionHash = sha256Hex(semanticPredictionPayload(prediction));
  const model = prediction?.model || {};
  const extractorVersions = Object.fromEntries(Object.entries(features?.extractorMetadata || {}).map(([modality, metadata]) => [modality, metadata?.version || 'unknown']));
  const deterministicFingerprint = sha256Hex({
    inputHash,
    featureHash,
    neuralPredictionHash,
    model: { id: model.id, version: model.version },
    extractorVersions,
    seed,
    pipelineVersion: PIPELINE_VERSION,
  });
  return {
    schemaVersion: 'brainsnn.scan-receipt.v1',
    id: `mirror-${deterministicFingerprint.slice(0, 20)}`,
    inputHash,
    featureHash,
    neuralPredictionHash,
    deterministicFingerprint,
    model: { id: model.id || 'unknown', version: model.version || 'unknown' },
    extractorVersions,
    device: model.device || 'unknown',
    generatedAt: now().toISOString(),
    randomSeed: seed,
    pipelineVersion: PIPELINE_VERSION,
    disclaimer: prediction?.disclaimer,
  };
}
