import { deriveExecutiveVerdict } from './scoreMapping.js';
import {
  buildNeuralMirrorEmbedding,
  neuralMirrorCanInfluenceOutcomeSimilarity,
  predictNeuralMirror,
} from './neuralMirror.js';

export const OUTCOME_KEY = 'brainsnn.outcomes.v1';
export const OUTCOME_STORAGE_VERSION = 1;
export const OUTCOME_SCHEMA_VERSION = 'brainsnn.outcome.v0.1';
export const SIGNATURE_SCHEMA_VERSION = 'brainsnn.signature.v0.2';

export const OUTCOME_METRICS = [
  { id: 'roas', label: 'ROAS', direction: 'higher', unit: 'x', hint: 'Revenue divided by ad spend' },
  { id: 'ctr', label: 'CTR', direction: 'higher', unit: '%', hint: 'Click-through rate' },
  { id: 'conversionRate', label: 'Conversion rate', direction: 'higher', unit: '%', hint: 'Conversions divided by visits/clicks' },
  { id: 'watchRate', label: 'Watch / retention rate', direction: 'higher', unit: '%', hint: 'Use the same platform definition across records' },
  { id: 'cpa', label: 'CPA', direction: 'lower', unit: '$', hint: 'Cost per acquisition' },
  { id: 'cpc', label: 'CPC', direction: 'lower', unit: '$', hint: 'Cost per click' },
  { id: 'revenue', label: 'Revenue', direction: 'higher', unit: '$', hint: 'Use the same attribution window across records' },
];

const FEATURE_WEIGHTS = {
  decisionScore: 0.9,
  trust: 0.75,
  manipulationSafety: 0.45,
  meanSurprise: 0.7,
  surpriseVariance: 0.35,
  agreement: 0.8,
  transitionRate: 0.65,
  reviewSafety: 0.75,
  stateDiversity: 0.4,
  dominantStateShare: 0.4,
  spikeRate: 0.35,
  sparsity: 0.3,
  claimRate: 0.35,
  proofRate: 0.6,
  ctaRate: 0.3,
};

const NEURAL_SIMILARITY_WEIGHT = 0.2;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + safeNumber(value), 0) / values.length;
}

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function flagRate(windows, flag) {
  if (!windows.length) return 0;
  return windows.filter((item) => item?.deterministicFlags?.includes(flag)).length / windows.length;
}

function stateShare(windows = []) {
  if (!windows.length) return 0;
  const counts = new Map();
  for (const item of windows) counts.set(item.stateId, (counts.get(item.stateId) || 0) + 1);
  return Math.max(...counts.values()) / windows.length;
}

function neuralSignatureForResult(result = {}) {
  let prediction = result?.multimodal?.neuralMirror || result?.neuralMirror || null;
  if (!prediction) {
    try {
      prediction = predictNeuralMirror(result);
    } catch {
      prediction = null;
    }
  }
  if (!prediction) return null;
  const embedding = buildNeuralMirrorEmbedding(prediction, 16);
  const canInfluenceSimilarity = Boolean(embedding?.length && neuralMirrorCanInfluenceOutcomeSimilarity(prediction));
  return {
    schemaVersion: prediction.schemaVersion || null,
    modelId: prediction?.model?.id || null,
    modelVersion: prediction?.model?.version || null,
    trained: Boolean(prediction?.model?.trained),
    validatedAgainstNeuralData: Boolean(prediction?.model?.validatedAgainstNeuralData && prediction?.evidence?.validatedAgainstNeuralData),
    referenceSpace: prediction?.referenceSpace?.type || null,
    atlas: prediction?.referenceSpace?.atlas || null,
    anatomicalRegistration: Boolean(prediction?.referenceSpace?.anatomicalRegistration),
    canInfluenceSimilarity,
    embedding: Array.isArray(embedding) ? embedding : null,
    boundary: canInfluenceSimilarity
      ? 'Validated Neural Mirror representation is eligible as one bounded similarity feature.'
      : 'Neural Mirror representation is stored for provenance/research only and is excluded from commercial outcome similarity until validation gates pass.',
  };
}

export function buildCreativeSignature(result = {}) {
  const verdict = deriveExecutiveVerdict(result);
  const belief = result?.multimodal?.beliefReport || {};
  const summary = belief.summary || {};
  const windows = belief.windows || [];
  const windowCount = Math.max(1, windows.length);
  const trust = safeNumber(result?.metrics?.trust, 0);
  const pressure = safeNumber(result?.firewallSignals?.manipulationPressure, 0);

  const features = {
    decisionScore: clamp(safeNumber(verdict?.score, 0) / 100),
    trust: clamp(trust / 100),
    manipulationSafety: clamp(1 - pressure),
    meanSurprise: clamp(summary.meanSurprise),
    surpriseVariance: clamp(Math.sqrt(Math.max(0, safeNumber(summary.surpriseVariance))) * 3),
    agreement: clamp(summary.agreementScore),
    transitionRate: clamp(safeNumber(summary.stateTransitions) / Math.max(1, windowCount - 1)),
    reviewSafety: clamp(1 - safeNumber(summary.reviewWindows) / windowCount),
    stateDiversity: clamp(safeNumber(summary.uniqueStates) / Math.min(24, windowCount)),
    dominantStateShare: clamp(stateShare(windows)),
    spikeRate: clamp(mean(windows.map((item) => item.spikeRateProxy))),
    sparsity: clamp(mean(windows.map((item) => item.sparsityProxy))),
    claimRate: clamp(flagRate(windows, 'claim_present')),
    proofRate: clamp(flagRate(windows, 'proof_present')),
    ctaRate: clamp(flagRate(windows, 'cta_present')),
  };
  const neuralMirror = neuralSignatureForResult(result);

  return {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    features,
    neuralMirror,
    provenance: {
      beliefModelId: belief?.model?.id || null,
      beliefModelVersion: belief?.model?.version || null,
      beliefLearnedWeights: Boolean(belief?.model?.learnedWeights),
      neuralMirrorModelId: neuralMirror?.modelId || null,
      neuralMirrorModelVersion: neuralMirror?.modelVersion || null,
      neuralMirrorEligibleForOutcomeSimilarity: Boolean(neuralMirror?.canInfluenceSimilarity),
      resultId: result?.id || null,
    },
  };
}

function baseSignatureSimilarity(a, b) {
  const left = a?.features || a || {};
  const right = b?.features || b || {};
  const keys = Object.keys(FEATURE_WEIGHTS).filter((key) => Number.isFinite(Number(left[key])) && Number.isFinite(Number(right[key])));
  if (!keys.length) return 0;
  let weightedSquared = 0;
  let weightSum = 0;
  for (const key of keys) {
    const weight = FEATURE_WEIGHTS[key] || 1;
    const delta = clamp(left[key]) - clamp(right[key]);
    weightedSquared += weight * delta * delta;
    weightSum += weight;
  }
  const distance = Math.sqrt(weightedSquared / Math.max(weightSum, 1e-9));
  return clamp(1 - distance);
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = safeNumber(left[index]);
    const b = safeNumber(right[index]);
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denominator = Math.sqrt(normA * normB);
  if (!denominator) return null;
  return clamp((dot / denominator + 1) / 2);
}

function comparableNeuralSignatures(a, b) {
  const left = a?.neuralMirror;
  const right = b?.neuralMirror;
  return Boolean(
    left?.canInfluenceSimilarity
    && right?.canInfluenceSimilarity
    && left.modelId
    && left.modelId === right.modelId
    && left.modelVersion === right.modelVersion
    && left.referenceSpace === right.referenceSpace
    && Array.isArray(left.embedding)
    && Array.isArray(right.embedding),
  );
}

export function signatureSimilarity(a, b) {
  const base = baseSignatureSimilarity(a, b);
  if (!comparableNeuralSignatures(a, b)) return Number(base.toFixed(4));
  const neural = cosineSimilarity(a.neuralMirror.embedding, b.neuralMirror.embedding);
  if (neural == null) return Number(base.toFixed(4));
  return Number(clamp((base * (1 - NEURAL_SIMILARITY_WEIGHT)) + (neural * NEURAL_SIMILARITY_WEIGHT)).toFixed(4));
}

export function getOutcomeMetric(metricId) {
  return OUTCOME_METRICS.find((item) => item.id === metricId) || null;
}

function normalizeRecord(record) {
  if (!record || !record.brandId || !record.metric?.id || !record.signature?.features) return null;
  const definition = getOutcomeMetric(record.metric.id);
  if (!definition) return null;
  const value = Number(record.metric.value);
  if (!Number.isFinite(value) || value < 0) return null;
  return {
    schemaVersion: OUTCOME_SCHEMA_VERSION,
    id: String(record.id || `${record.brandId}-${record.metric.id}-${record.resultId || 'creative'}-${Date.now()}`),
    brandId: String(record.brandId),
    brandName: String(record.brandName || record.brandId),
    creativeLabel: String(record.creativeLabel || 'Untitled creative'),
    savedAt: record.savedAt || new Date().toISOString(),
    resultId: record.resultId || record.signature?.provenance?.resultId || null,
    metric: {
      id: definition.id,
      label: definition.label,
      value,
      direction: definition.direction,
      unit: definition.unit,
    },
    signature: record.signature,
    provenance: {
      beliefModelId: record.provenance?.beliefModelId || record.signature?.provenance?.beliefModelId || null,
      beliefModelVersion: record.provenance?.beliefModelVersion || record.signature?.provenance?.beliefModelVersion || null,
      beliefLearnedWeights: Boolean(record.provenance?.beliefLearnedWeights ?? record.signature?.provenance?.beliefLearnedWeights),
      neuralMirrorModelId: record.provenance?.neuralMirrorModelId || record.signature?.provenance?.neuralMirrorModelId || null,
      neuralMirrorModelVersion: record.provenance?.neuralMirrorModelVersion || record.signature?.provenance?.neuralMirrorModelVersion || null,
      neuralMirrorEligibleForOutcomeSimilarity: Boolean(record.provenance?.neuralMirrorEligibleForOutcomeSimilarity ?? record.signature?.provenance?.neuralMirrorEligibleForOutcomeSimilarity),
    },
  };
}

export function loadOutcomeRecords() {
  const raw = readJson(OUTCOME_KEY, null);
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return items.map(normalizeRecord).filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

export function saveOutcomeRecords(records = []) {
  const items = (Array.isArray(records) ? records : []).map(normalizeRecord).filter(Boolean);
  writeJson(OUTCOME_KEY, { version: OUTCOME_STORAGE_VERSION, items });
  return items;
}

export function createOutcomeRecord({ result, brandName, creativeLabel, metricId, value, id, savedAt } = {}) {
  const cleanBrand = String(brandName || '').trim();
  const metric = getOutcomeMetric(metricId);
  const numericValue = Number(value);
  if (!cleanBrand) throw new Error('Brand name is required.');
  if (!metric) throw new Error('Choose a supported outcome metric.');
  if (!Number.isFinite(numericValue) || numericValue < 0) throw new Error('Outcome value must be a non-negative number.');
  const brandId = slugify(cleanBrand) || 'brand';
  const signature = buildCreativeSignature(result || {});
  const timestamp = savedAt || new Date().toISOString();
  return normalizeRecord({
    id: id || `${brandId}-${metric.id}-${result?.id || 'creative'}-${Date.parse(timestamp) || Date.now()}`,
    brandId,
    brandName: cleanBrand,
    creativeLabel: String(creativeLabel || result?.title || 'Untitled creative').trim(),
    savedAt: timestamp,
    resultId: result?.id || null,
    metric: { id: metric.id, value: numericValue },
    signature,
  });
}

export function appendOutcomeRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) throw new Error('Invalid outcome record.');
  const existing = loadOutcomeRecords().filter((item) => item.id !== normalized.id);
  return saveOutcomeRecords([normalized, ...existing]);
}

export function deleteOutcomeRecord(id) {
  return saveOutcomeRecords(loadOutcomeRecords().filter((item) => item.id !== id));
}

export function recordsForBrand(records = [], brandNameOrId = '', metricId = null) {
  const brandId = slugify(brandNameOrId);
  return records.filter((item) => item.brandId === brandId && (!metricId || item.metric.id === metricId));
}

function utilitySortValue(record, direction) {
  const value = safeNumber(record?.metric?.value);
  return direction === 'lower' ? -value : value;
}

export function outcomePercentiles(records = [], metricId) {
  const metric = getOutcomeMetric(metricId);
  const valid = records.filter((item) => item?.metric?.id === metricId && Number.isFinite(Number(item.metric.value)));
  if (!metric || !valid.length) return new Map();
  const sorted = [...valid].sort((a, b) => utilitySortValue(a, metric.direction) - utilitySortValue(b, metric.direction));
  const result = new Map();
  if (sorted.length === 1) {
    result.set(sorted[0].id, 0.5);
    return result;
  }
  sorted.forEach((item, index) => result.set(item.id, index / (sorted.length - 1)));
  return result;
}

function rank(values) {
  const indexed = values.map((value, index) => ({ value: safeNumber(value), index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length).fill(0);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[cursor].value) end += 1;
    const averageRank = (cursor + end) / 2 + 1;
    for (let i = cursor; i <= end; i += 1) ranks[indexed[i].index] = averageRank;
    cursor = end + 1;
  }
  return ranks;
}

function pearson(a, b) {
  if (a.length !== b.length || a.length < 2) return 0;
  const meanA = mean(a);
  const meanB = mean(b);
  let numerator = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    left += da * da;
    right += db * db;
  }
  const denominator = Math.sqrt(left * right);
  return denominator ? numerator / denominator : 0;
}

export function spearmanCorrelation(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length < 2) return 0;
  return Number(pearson(rank(a), rank(b)).toFixed(4));
}

function featureAssociations(history, percentiles) {
  if (history.length < 8) return [];
  return Object.keys(FEATURE_WEIGHTS)
    .map((feature) => {
      const values = history.map((item) => clamp(item.signature?.features?.[feature]));
      const outcomes = history.map((item) => percentiles.get(item.id) ?? 0.5);
      const rho = spearmanCorrelation(values, outcomes);
      return { feature, rho, strength: Math.abs(rho) };
    })
    .filter((item) => item.strength >= 0.25)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);
}

function maturityForCount(count) {
  if (count < 3) return { id: 'collecting', label: 'COLLECTING', message: `Add ${3 - count} more outcome${3 - count === 1 ? '' : 's'} before BrainSNN calculates a historical fit signal.` };
  if (count < 8) return { id: 'directional', label: 'DIRECTIONAL', message: 'Enough history for nearest-neighbor comparison, but not enough for feature-association reporting.' };
  return { id: 'comparative', label: 'COMPARATIVE', message: 'Enough saved history for nearest-neighbor comparison and descriptive feature associations.' };
}

export function evaluateAgainstBrandHistory({ result, signature, records = [], brandName, metricId } = {}) {
  const metric = getOutcomeMetric(metricId);
  const history = recordsForBrand(records, brandName, metricId);
  const currentSignature = signature || buildCreativeSignature(result || {});
  const maturity = maturityForCount(history.length);
  const percentiles = outcomePercentiles(history, metricId);
  const neighbors = history
    .map((item) => ({
      id: item.id,
      creativeLabel: item.creativeLabel,
      savedAt: item.savedAt,
      actualValue: item.metric.value,
      metric: item.metric,
      similarity: signatureSimilarity(currentSignature, item.signature),
      outcomePercentile: percentiles.get(item.id) ?? 0.5,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.min(5, history.length));

  let historicalFit = null;
  let evidenceWeight = 0;
  if (history.length >= 3 && neighbors.length) {
    const weighted = neighbors.map((item) => ({ ...item, weight: Math.max(0.05, item.similarity ** 2) }));
    const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
    const percentile = weighted.reduce((sum, item) => sum + item.outcomePercentile * item.weight, 0) / weightSum;
    historicalFit = Math.round(clamp(percentile) * 100);
    evidenceWeight = Math.round(clamp(mean(neighbors.map((item) => item.similarity)) * Math.min(1, history.length / 12)) * 100);
  }

  const fitLabel = historicalFit == null
    ? 'Not enough history yet'
    : historicalFit >= 67
      ? 'Resembles stronger saved history'
      : historicalFit >= 40
        ? 'Mixed resemblance to saved history'
        : 'Resembles weaker saved history';

  return {
    schemaVersion: 'brainsnn.brand-history-eval.v0.2',
    brandId: slugify(brandName),
    brandName: String(brandName || '').trim(),
    metric,
    sampleCount: history.length,
    maturity,
    historicalFit,
    evidenceWeight,
    fitLabel,
    neighbors,
    associations: featureAssociations(history, percentiles),
    signature: currentSignature,
    neuralMirror: {
      present: Boolean(currentSignature?.neuralMirror),
      eligibleForOutcomeSimilarity: Boolean(currentSignature?.neuralMirror?.canInfluenceSimilarity),
      boundary: currentSignature?.neuralMirror?.boundary || 'No Neural Mirror representation is attached to this signature.',
    },
    boundary: 'Historical fit is a descriptive similarity signal derived only from this brand’s saved outcomes. It is not a causal estimate, calibrated probability, or guaranteed performance forecast. Neural Mirror features are excluded unless their explicit neural-validation and compatibility gates pass.',
  };
}

export function formatMetricValue(metricId, value) {
  const metric = getOutcomeMetric(metricId);
  const numeric = safeNumber(value);
  if (!metric) return String(value ?? '—');
  if (metric.unit === '%') return `${numeric.toFixed(numeric < 10 ? 2 : 1)}%`;
  if (metric.unit === '$') return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (metric.unit === 'x') return `${numeric.toFixed(2)}x`;
  return String(numeric);
}
