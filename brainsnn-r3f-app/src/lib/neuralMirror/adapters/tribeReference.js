import { createNeuralPrediction, validateNeuralPrediction } from '../schema.js';

export const TRIBE_REFERENCE_ID = 'tribe-reference';

function enabled(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

async function request(fetchImpl, url, init, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || `TRIBE reference returned HTTP ${response.status}.`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLegacyFrames(value, sequence) {
  const frames = Array.isArray(value?.frames) ? value.frames : [];
  if (!frames.length) throw new Error('TRIBE reference returned no compatible prediction frames.');
  const codes = ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL'];
  const timeline = frames.map((frame, index) => {
    const source = sequence.segments[Math.min(index, sequence.segments.length - 1)];
    const regions = frame?.regions || {};
    const activations = codes.map((code) => {
      const number = Number(regions[code]);
      if (!Number.isFinite(number)) throw new Error(`TRIBE reference frame is missing ${code}.`);
      return number > 1 ? (number - 50) / 50 : number;
    });
    return {
      startMs: source.startMs,
      endMs: source.endMs,
      activations,
      confidence: Number.isFinite(Number(frame.confidence)) ? Math.max(0, Math.min(1, Number(frame.confidence))) : 0.25,
      modalityContribution: source.modalityContribution,
    };
  });
  return createNeuralPrediction({
    model: { id: TRIBE_REFERENCE_ID, version: String(value?.meta?.version || 'reference'), device: 'remote-research' },
    modelStatus: 'research_reference',
    referenceSpace: { type: 'abstract', atlas: 'legacy-broad-regions7', parcelCount: 7 },
    timeline,
    evidence: {
      method: 'TRIBE v2 research reference adapter normalization.',
      validatedAgainstNeuralData: false,
      confidenceMethod: 'Provider confidence when present; otherwise conservative adapter default.',
    },
    provenance: {
      provider: 'TRIBE v2 reference',
      commercialUse: false,
      researchOnly: true,
      adapter: TRIBE_REFERENCE_ID,
    },
  });
}

export function createTribeReferenceAdapter(options = {}) {
  const isEnabled = enabled(options.enabled ?? options.env?.ENABLE_TRIBE_RESEARCH);
  const url = String(options.url || options.env?.TRIBE_API_URL || '').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = isEnabled && Boolean(url) && typeof fetchImpl === 'function';
  return {
    id: TRIBE_REFERENCE_ID,
    version: '1.0.0',
    metadata() {
      return {
        id: TRIBE_REFERENCE_ID,
        version: '1.0.0',
        status: configured ? 'configured' : 'not_configured',
        reason: !isEnabled ? 'research_adapter_disabled' : !url ? 'TRIBE_API_URL_missing' : undefined,
        commercialUse: false,
        researchOnly: true,
        trained: null,
        validated: null,
        modelStatus: configured ? 'research_reference' : 'not_configured',
        provider: 'TRIBE v2 reference',
      };
    },
    async health() {
      if (!configured) return { status: 'not_configured', researchOnly: true, commercialUse: false };
      try {
        const health = await request(fetchImpl, `${url}/health`, {}, 4000);
        return { status: health.status === 'ok' ? 'available' : 'unavailable', provider: 'TRIBE v2 reference', researchOnly: true, commercialUse: false, health };
      } catch (error) {
        return { status: 'unavailable', reason: error?.message || 'TRIBE reference unavailable', researchOnly: true, commercialUse: false };
      }
    },
    async predict(sequence, predictionOptions = {}) {
      if (!configured) {
        const error = new Error('TRIBE research reference adapter is not configured.');
        error.code = 'not_configured';
        throw error;
      }
      if (predictionOptions.researchPurpose !== true) {
        const error = new Error('TRIBE reference prediction requires explicit researchPurpose=true.');
        error.code = 'research_approval_required';
        throw error;
      }
      const body = await request(fetchImpl, `${url}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
        body: JSON.stringify({ schemaVersion: 'brainsnn.tribe-reference-request.v1', researchOnly: true, commercialUse: false, input: sequence }),
      }, Number(predictionOptions.maxLatencyMs) || 30_000);
      const canonical = validateNeuralPrediction(body.result || body);
      if (canonical.valid) {
        return createNeuralPrediction({
          ...canonical.value,
          modelStatus: 'research_reference',
          provenance: { ...canonical.value.provenance, provider: 'TRIBE v2 reference', commercialUse: false, researchOnly: true },
        });
      }
      return normalizeLegacyFrames(body, sequence);
    },
  };
}
