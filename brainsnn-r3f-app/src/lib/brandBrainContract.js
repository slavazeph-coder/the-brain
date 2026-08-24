export const BRAND_BRAIN_SCHEMA_VERSION = 'brainsnn.brand-brain.v1';
export const BRAND_BRAIN_WORKSPACE_KEY = 'brainsnn.brandBrain.workspace.v1';
export const BRAND_BRAIN_IMPORT_KEY = 'brainsnn.brandBrain.imported.v1';

export const BRAND_BRAIN_METRICS = Object.freeze([
  { id: 'roas', direction: 'higher' },
  { id: 'ctr', direction: 'higher' },
  { id: 'conversionRate', direction: 'higher' },
  { id: 'watchRate', direction: 'higher' },
  { id: 'cpa', direction: 'lower' },
  { id: 'cpc', direction: 'lower' },
  { id: 'revenue', direction: 'higher' },
]);

const METRIC_IDS = new Set(BRAND_BRAIN_METRICS.map((metric) => metric.id));
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,160}$/;

export function normalizeBrandName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function normalizeCreativeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
}

export function normalizeMetricId(value) {
  const metricId = String(value || '').trim();
  if (!METRIC_IDS.has(metricId)) throw new Error('Unsupported Brand Brain outcome metric.');
  return metricId;
}

export function normalizeOutcomeValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e12) {
    throw new Error('Outcome value must be a finite non-negative number.');
  }
  return number;
}

export function normalizeOptionalId(value) {
  if (value == null || value === '') return null;
  const id = String(value).trim();
  return SAFE_ID.test(id) ? id : null;
}

function sanitizePlainObject(value, depth = 0) {
  if (depth > 3 || !value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(key)) continue;
    if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    else if (typeof item === 'boolean') out[key] = item;
    else if (typeof item === 'string') out[key] = item.slice(0, 500);
    else if (item && typeof item === 'object' && !Array.isArray(item)) out[key] = sanitizePlainObject(item, depth + 1);
  }
  return out;
}

export function normalizeOutcomePayload(input = {}) {
  const brandName = normalizeBrandName(input.brandName);
  const creativeLabel = normalizeCreativeLabel(input.creativeLabel);
  if (!brandName) throw new Error('Brand name is required.');
  if (!creativeLabel) throw new Error('Creative label is required.');

  const savedDate = input.savedAt ? new Date(input.savedAt) : new Date();
  if (Number.isNaN(savedDate.getTime())) throw new Error('savedAt must be a valid date.');

  return {
    legacyId: normalizeOptionalId(input.id || input.legacyId),
    brandName,
    creativeLabel,
    metricId: normalizeMetricId(input.metricId),
    actualValue: normalizeOutcomeValue(input.actualValue ?? input.value),
    savedAt: savedDate.toISOString(),
    sourceResultId: normalizeOptionalId(input.sourceResultId),
    signature: sanitizePlainObject(input.signature),
    modelVersion: String(input.modelVersion || 'unknown').trim().slice(0, 120) || 'unknown',
    provenance: sanitizePlainObject(input.provenance),
  };
}

export function brandBrainMaturity(sampleCount = 0) {
  const n = Math.max(0, Number(sampleCount) || 0);
  if (n >= 8) return { id: 'comparative', label: 'Comparative', min: 8 };
  if (n >= 3) return { id: 'directional', label: 'Directional', min: 3 };
  return { id: 'collecting', label: 'Collecting', min: 0 };
}

export function metricUtility(metricId, value) {
  const metric = BRAND_BRAIN_METRICS.find((item) => item.id === metricId);
  const number = normalizeOutcomeValue(value);
  return metric?.direction === 'lower' ? -number : number;
}
