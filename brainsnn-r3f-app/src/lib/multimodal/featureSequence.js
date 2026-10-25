import { createDefaultCpuExtractors } from './extractors.js';
import { segmentMultimodalInput } from './segmentation.js';
import { MULTIMODAL_SCHEMA_VERSION, normalizeMultimodalInput } from './schema.js';

export const FEATURE_SEQUENCE_SCHEMA_VERSION = 'brainsnn.multimodal-features.v1';
export const SUPPORTED_ABLATIONS = Object.freeze([
  'vision', 'audio', 'language', 'vision+audio', 'vision+language', 'audio+language', 'all',
]);
export const FEATURE_LAYOUT = Object.freeze({ vision: 8, audio: 8, language: 12 });

const MODALITIES = Object.freeze(['vision', 'audio', 'language']);

export function normalizeAblation(value = 'all') {
  const normalized = String(value || 'all').toLowerCase().replace(/\s+/g, '');
  if (!SUPPORTED_ABLATIONS.includes(normalized)) {
    throw new Error(`Unsupported ablation "${value}". Use ${SUPPORTED_ABLATIONS.join(', ')}.`);
  }
  return normalized;
}

function selectedModalities(ablation) {
  return ablation === 'all' ? [...MODALITIES] : ablation.split('+');
}

function normalizeVector(vector, dimension) {
  if (!Array.isArray(vector) || vector.length !== dimension || vector.some((item) => !Number.isFinite(Number(item)))) {
    throw new Error(`Extractor returned an invalid ${dimension}-dimensional vector.`);
  }
  const values = vector.map(Number);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? values.map((value) => Number((value / norm).toFixed(8))) : values.map(() => 0);
}

function aggregateModalityStatus(segmentResults, extractors) {
  return Object.fromEntries(MODALITIES.map((modality) => {
    const values = segmentResults.map((segment) => segment.modalities[modality]);
    const available = values.filter((value) => value?.status === 'available').length;
    const failed = values.filter((value) => value?.status === 'failed').length;
    const extractor = extractors.find((item) => item.modality === modality);
    const status = available ? 'available' : failed ? 'failed' : 'unavailable';
    return [modality, {
      status,
      segmentsAvailable: available,
      segmentsTotal: segmentResults.length,
      extractor: extractor?.id,
      version: extractor?.version,
      device: 'cpu',
      ...(status !== 'available' ? { reason: values.find((value) => value?.reason)?.reason || 'modality_unavailable' } : {}),
    }];
  }));
}

function contributionEstimate(modalities, selected) {
  const magnitudes = Object.fromEntries(MODALITIES.map((modality) => {
    const value = modalities[modality];
    const magnitude = selected.includes(modality) && value.status === 'available'
      ? value.vector.reduce((sum, item) => sum + Math.abs(item), 0)
      : 0;
    return [modality, magnitude];
  }));
  const total = Object.values(magnitudes).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(MODALITIES.map((modality) => [modality, Number((total ? magnitudes[modality] / total : 0).toFixed(6))]));
}

export async function extractMultimodalFeatures(value, options = {}) {
  const input = value?.schemaVersion === MULTIMODAL_SCHEMA_VERSION ? value : normalizeMultimodalInput(value, options);
  const segments = options.segments || segmentMultimodalInput(input, options);
  const extractors = options.extractors || createDefaultCpuExtractors(options);
  const byModality = Object.fromEntries(extractors.map((extractor) => [extractor.modality, extractor]));
  for (const modality of MODALITIES) {
    if (!byModality[modality]) throw new Error(`No ${modality} extractor was supplied.`);
  }
  const results = [];
  for (const segment of segments) {
    const modalities = {};
    for (const modality of MODALITIES) {
      const extractor = byModality[modality];
      try {
        const result = await extractor.extract({ input, segment });
        modalities[modality] = {
          ...result,
          vector: normalizeVector(result.vector, extractor.dimension),
        };
      } catch (error) {
        modalities[modality] = {
          status: 'failed',
          reason: error?.message || `${modality}_extraction_failed`,
          vector: new Array(extractor.dimension).fill(0),
          metadata: {
            id: extractor.id,
            version: extractor.version,
            modality,
            device: 'cpu',
            embeddingDimension: extractor.dimension,
          },
        };
      }
    }
    results.push({ id: segment.id, index: segment.index, startMs: segment.startMs, endMs: segment.endMs, text: segment.text, modalities });
  }
  return {
    input,
    segments: results,
    modalityStatus: aggregateModalityStatus(results, extractors),
    extractorMetadata: Object.fromEntries(MODALITIES.map((modality) => {
      const extractor = byModality[modality];
      const first = results.find((segment) => segment.modalities[modality]?.metadata)?.modalities[modality]?.metadata;
      return [modality, first || { id: extractor.id, version: extractor.version, modality, embeddingDimension: extractor.dimension, device: 'cpu' }];
    })),
  };
}

export function buildFeatureSequence(extracted, options = {}) {
  if (!extracted?.input || !Array.isArray(extracted.segments)) throw new Error('Extracted multimodal features are required.');
  const ablation = normalizeAblation(options.ablation || 'all');
  const selected = selectedModalities(ablation);
  const segments = extracted.segments.map((segment) => {
    const blocks = {};
    for (const modality of MODALITIES) {
      const dimension = FEATURE_LAYOUT[modality];
      const result = segment.modalities?.[modality];
      const enabled = selected.includes(modality) && result?.status === 'available';
      blocks[modality] = enabled ? normalizeVector(result.vector, dimension) : new Array(dimension).fill(0);
    }
    return {
      id: segment.id,
      index: segment.index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      ...(segment.text ? { text: segment.text } : {}),
      features: blocks,
      fused: [...blocks.vision, ...blocks.audio, ...blocks.language],
      modalityContribution: contributionEstimate(segment.modalities, selected),
    };
  });
  return {
    schemaVersion: FEATURE_SEQUENCE_SCHEMA_VERSION,
    inputId: extracted.input.id,
    ablation,
    selectedModalities: selected,
    featureLayout: { ...FEATURE_LAYOUT },
    embeddingDimension: Object.values(FEATURE_LAYOUT).reduce((sum, value) => sum + value, 0),
    segments,
    modalityStatus: extracted.modalityStatus,
    extractorMetadata: extracted.extractorMetadata,
    provenance: {
      inputSchemaVersion: extracted.input.schemaVersion,
      fusionMethod: 'l2-normalized-fixed-layout-concatenation',
      contributionLabel: 'Model contribution estimate; not a causal interpretation.',
    },
  };
}

export async function createMultimodalFeatureSequence(input, options = {}) {
  return buildFeatureSequence(await extractMultimodalFeatures(input, options), options);
}
