import { createHash } from 'node:crypto';
import { discoverComputeDevice } from '../device.js';
import { canonicalJson } from '../receipts.js';
import { createNeuralPrediction } from '../schema.js';

export const LEARNED_MIRROR_ID = 'brainsnn-neural-mirror';
export const PORTABLE_MODEL_ARTIFACT_SCHEMA_VERSION = 'brainsnn.neural-model-artifact.v1';

function finiteArray(value, length) {
  return Array.isArray(value)
    && value.length === length
    && value.every((item) => Number.isFinite(Number(item)));
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

/*
 * The Python exporter writes sorted, whitespace-free JSON. Keeping the raw JSON
 * lets Node verify its signature without losing JSON's distinction between 0.0
 * and 0 during JSON.parse. This is important for parity with Python's canonical
 * serializer. Object-only callers use BrainSNN's shared sorted-key convention.
 */
function unsignedPortableJson(rawArtifactJson) {
  if (typeof rawArtifactJson !== 'string') return null;
  const raw = rawArtifactJson.trim();
  const match = raw.match(/"integrity":\{"algorithm":"sha256","canonicalJsonSha256":"[0-9a-f]{64}"\},?/);
  if (!match) return null;
  const start = match.index;
  const end = start + match[0].length;
  let prefix = raw.slice(0, start);
  const suffix = raw.slice(end);
  if (!match[0].endsWith(',') && prefix.endsWith(',')) prefix = prefix.slice(0, -1);
  return `${prefix}${suffix}`;
}

function verifyPortableIntegrity(artifact, rawArtifactJson) {
  const integrity = artifact?.integrity;
  if (!integrity || integrity.algorithm !== 'sha256' || !/^[0-9a-f]{64}$/.test(String(integrity.canonicalJsonSha256 || ''))) {
    return { valid: false, reason: 'artifact_integrity_missing' };
  }
  let unsigned;
  if (rawArtifactJson) {
    try {
      if (canonicalJson(JSON.parse(rawArtifactJson)) !== canonicalJson(artifact)) {
        return { valid: false, reason: 'artifact_raw_payload_mismatch' };
      }
    } catch {
      return { valid: false, reason: 'artifact_raw_payload_invalid' };
    }
    unsigned = unsignedPortableJson(rawArtifactJson);
    if (!unsigned) return { valid: false, reason: 'artifact_integrity_format_invalid' };
  } else {
    const copy = { ...artifact };
    delete copy.integrity;
    unsigned = canonicalJson(copy);
  }
  return hashText(unsigned) === integrity.canonicalJsonSha256
    ? { valid: true }
    : { valid: false, reason: 'artifact_integrity_mismatch' };
}

function validatePortableArtifact(artifact, rawArtifactJson) {
  if (artifact.schemaVersion !== PORTABLE_MODEL_ARTIFACT_SCHEMA_VERSION) return null;
  const integrity = verifyPortableIntegrity(artifact, rawArtifactJson);
  if (!integrity.valid) return integrity;

  const model = artifact.model;
  const input = artifact.input;
  const output = artifact.output;
  const parameters = artifact.parameters;
  if (!model || model.kind !== 'ridge' || model.trained !== true) return { valid: false, reason: 'artifact_model_kind_invalid' };
  const inputDimension = Number(input?.featureDimension);
  const parcelCount = Number(output?.parcelCount);
  if (!Number.isInteger(inputDimension) || inputDimension < 1 || inputDimension > 4096) return { valid: false, reason: 'artifact_input_dimension_invalid' };
  if (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 10_000) return { valid: false, reason: 'artifact_parcel_count_invalid' };
  if (!Array.isArray(parameters?.weights) || parameters.weights.length !== inputDimension
    || parameters.weights.some((row) => !finiteArray(row, parcelCount))) {
    return { valid: false, reason: 'artifact_weights_shape_invalid' };
  }
  if (!finiteArray(parameters.bias, parcelCount)) return { valid: false, reason: 'artifact_bias_invalid' };
  const normalization = input?.normalization;
  if (normalization?.method !== 'train_split_standardization'
    || !finiteArray(normalization.mean, inputDimension)
    || !finiteArray(normalization.scale, inputDimension)
    || normalization.scale.some((value) => Number(value) <= 0)) {
    return { valid: false, reason: 'artifact_normalization_invalid' };
  }
  const modalitySlices = {};
  for (const [modality, bounds] of Object.entries(input.modalitySlices || {})) {
    if (!['vision', 'audio', 'language', 'all'].includes(modality)
      || !Array.isArray(bounds) || bounds.length !== 2
      || !Number.isInteger(bounds[0]) || !Number.isInteger(bounds[1])
      || bounds[0] < 0 || bounds[1] <= bounds[0] || bounds[1] > inputDimension) {
      return { valid: false, reason: 'artifact_modality_slices_invalid' };
    }
    modalitySlices[modality] = [...bounds];
  }
  return {
    valid: true,
    value: {
      schemaVersion: artifact.schemaVersion,
      id: String(model.id || LEARNED_MIRROR_ID),
      version: String(model.version || 'unknown'),
      inputDimension,
      parcelCount,
      // The portable schema is feature-major: [features][parcels].
      weights: parameters.weights.map((row) => row.map(Number)),
      bias: parameters.bias.map(Number),
      featureMean: normalization.mean.map(Number),
      featureScale: normalization.scale.map(Number),
      modalitySlices,
      weightOrientation: 'feature_major',
      modelStatus: String(model.status || 'trained_unvalidated'),
      trained: true,
      validatedAgainstNeuralData: model.validatedAgainstNeuralData === true,
      commercialUse: model.commercialUse === true,
      researchOnly: artifact.researchOnly === true || model.researchOnly === true
        || artifact.provenance?.researchOnly === true || artifact.provenance?.synthetic === true,
      referenceSpace: {
        type: String(output.referenceSpace || 'abstract'),
        ...(output.atlas ? { atlas: String(output.atlas) } : {}),
        ...(output.mappingId ? { mappingId: String(output.mappingId) } : {}),
      },
      trainingDatasets: Array.isArray(artifact.training?.datasets) ? artifact.training.datasets : [],
      training: artifact.training || {},
      sourceProvenance: artifact.provenance || {},
      extractorVersions: input.extractorVersions || {},
      integrityVerified: true,
      artifactHash: artifact.integrity.canonicalJsonSha256,
      evidence: artifact.evidence || {},
      benchmark: artifact.benchmark,
      confidence: artifact.confidence,
    },
  };
}

function validateLegacyArtifact(artifact) {
  const inputDimension = Math.floor(Number(artifact.inputDimension));
  const parcelCount = Math.floor(Number(artifact.parcelCount));
  if (!Number.isInteger(inputDimension) || inputDimension < 1 || inputDimension > 4096) return { valid: false, reason: 'artifact_input_dimension_invalid' };
  if (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 10_000) return { valid: false, reason: 'artifact_parcel_count_invalid' };
  if (!Array.isArray(artifact.weights) || artifact.weights.length !== parcelCount
    || artifact.weights.some((row) => !finiteArray(row, inputDimension))) return { valid: false, reason: 'artifact_weights_shape_invalid' };
  const bias = artifact.bias ?? new Array(parcelCount).fill(0);
  if (!finiteArray(bias, parcelCount)) return { valid: false, reason: 'artifact_bias_invalid' };
  return {
    valid: true,
    value: {
      ...artifact,
      inputDimension,
      parcelCount,
      bias: bias.map(Number),
      weights: artifact.weights.map((row) => row.map(Number)),
      featureMean: new Array(inputDimension).fill(0),
      featureScale: new Array(inputDimension).fill(1),
      weightOrientation: 'parcel_major',
      integrityVerified: false,
      commercialUse: artifact.commercialUse === true,
    },
  };
}

export function validateLearnedModelArtifact(artifact, options = {}) {
  if (!artifact || typeof artifact !== 'object') return { valid: false, reason: 'model_artifact_missing' };
  return validatePortableArtifact(artifact, options.rawArtifactJson) || validateLegacyArtifact(artifact);
}

function activeFeatureMask(artifact, sequence) {
  const available = new Set((sequence.selectedModalities || [])
    .filter((modality) => sequence.modalityStatus?.[modality]?.status === 'available'));
  if (!available.size) return null;
  const entries = Object.entries(artifact.modalitySlices || {});
  if (!entries.length || entries.some(([name]) => name === 'all')) return new Array(artifact.inputDimension).fill(1);
  const mask = new Array(artifact.inputDimension).fill(0);
  for (const [modality, [start, end]] of entries) {
    if (available.has(modality)) for (let index = start; index < end; index += 1) mask[index] = 1;
  }
  return mask;
}

export function createLearnedMirrorAdapter(options = {}) {
  const artifactCheck = validateLearnedModelArtifact(options.artifact, { rawArtifactJson: options.rawArtifactJson });
  const artifact = artifactCheck.valid ? artifactCheck.value : null;
  const configurationReason = options.configurationError || artifactCheck.reason;
  const device = discoverComputeDevice(options.device || {});
  const version = String(artifact?.version || options.version || 'not-configured');
  return {
    id: LEARNED_MIRROR_ID,
    version,
    metadata() {
      return {
        id: LEARNED_MIRROR_ID,
        version,
        status: artifact ? 'available' : 'not_configured',
        reason: artifact ? undefined : configurationReason,
        commercialUse: artifact?.commercialUse === true,
        researchOnly: Boolean(artifact?.researchOnly),
        trained: Boolean(artifact?.trained),
        validated: Boolean(artifact?.validatedAgainstNeuralData),
        modelStatus: artifact ? (artifact.modelStatus || 'trained') : 'not_configured',
        referenceSpace: artifact?.referenceSpace?.type || 'parcel',
        parcelCount: artifact?.parcelCount || Number(options.parcelCount) || 1000,
        device,
        benchmark: artifact?.benchmark,
        integrityVerified: Boolean(artifact?.integrityVerified),
      };
    },
    async health() {
      return artifact
        ? { status: 'available', modelLoaded: true, device, integrityVerified: artifact.integrityVerified }
        : { status: 'not_configured', modelLoaded: false, reason: configurationReason, device };
    },
    async predict(sequence) {
      if (!artifact) {
        const error = new Error('BrainSNN Neural Mirror model artifact is not configured.');
        error.code = 'not_configured';
        throw error;
      }
      if (sequence.embeddingDimension !== artifact.inputDimension) throw new Error('Model artifact input dimension does not match the feature sequence.');
      const mask = activeFeatureMask(artifact, sequence);
      if (!mask) {
        const error = new Error('No selected modality has extracted features; learned model will not generate a bias-only prediction.');
        error.code = 'no_modalities_available';
        throw error;
      }
      const timeline = sequence.segments.map((segment) => {
        if (!finiteArray(segment.fused, artifact.inputDimension)) throw new Error('Learned model received a malformed fused feature vector.');
        const normalized = segment.fused.map((value, feature) => mask[feature]
          ? (Number(value) - artifact.featureMean[feature]) / artifact.featureScale[feature]
          : 0);
        const activations = new Array(artifact.parcelCount).fill(0).map((_, parcel) => {
          let value = artifact.bias[parcel];
          for (let feature = 0; feature < artifact.inputDimension; feature += 1) {
            const weight = artifact.weightOrientation === 'feature_major'
              ? artifact.weights[feature][parcel]
              : artifact.weights[parcel][feature];
            value += weight * normalized[feature];
          }
          if (!Number.isFinite(value)) throw new Error('Learned model produced a non-finite activation.');
          return value;
        });
        return {
          startMs: segment.startMs,
          endMs: segment.endMs,
          activations,
          // Portable ridge artifacts do not carry a calibrated confidence.
          confidence: Number.isFinite(Number(artifact.confidence))
            ? Number(Math.max(0, Math.min(1, Number(artifact.confidence))).toFixed(6))
            : 0,
          modalityContribution: segment.modalityContribution,
        };
      });
      return createNeuralPrediction({
        model: { id: LEARNED_MIRROR_ID, version, device: device.id },
        modelStatus: artifact.modelStatus || 'trained',
        referenceSpace: { type: artifact.referenceSpace?.type || 'parcel', atlas: artifact.referenceSpace?.atlas, parcelCount: artifact.parcelCount },
        timeline,
        evidence: {
          method: artifact.evidence?.method || 'Loaded portable ridge neural encoding model artifact.',
          validatedAgainstNeuralData: Boolean(artifact.validatedAgainstNeuralData),
          ...(artifact.benchmark?.id ? { benchmarkId: artifact.benchmark.id } : {}),
          confidenceMethod: artifact.evidence?.confidenceMethod || 'not_available; schema value is a conservative uncalibrated placeholder',
        },
        provenance: {
          adapter: LEARNED_MIRROR_ID,
          artifactId: artifact.id || 'configured-artifact',
          artifactHash: artifact.artifactHash,
          artifactIntegrityVerified: artifact.integrityVerified,
          trainingDatasets: artifact.trainingDatasets || [],
          featureSchemaVersion: sequence.schemaVersion,
          extractorVersions: artifact.extractorVersions,
          commercialUse: artifact.commercialUse === true,
          researchOnly: Boolean(artifact.researchOnly),
          trained: Boolean(artifact.trained),
          validated: Boolean(artifact.validatedAgainstNeuralData),
          source: artifact.sourceProvenance,
        },
      });
    },
  };
}
