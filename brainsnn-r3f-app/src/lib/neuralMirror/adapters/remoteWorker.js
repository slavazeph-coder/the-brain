import { normalizeComputeDevice } from '../device.js';
import { createNeuralPrediction, validateNeuralPrediction } from '../schema.js';

export const REMOTE_WORKER_ID = 'remote-neural-worker';

function normalizeBaseUrl(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(String(value)); } catch { return null; }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

async function fetchJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Remote worker request timed out.')), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => { throw new Error('Remote worker returned malformed JSON.'); });
    if (!response.ok) {
      const error = new Error(body?.error || `Remote worker returned HTTP ${response.status}.`);
      error.code = 'worker_http_error';
      throw error;
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error('Remote worker request timed out.');
      timeout.code = 'worker_timeout';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function workerHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function normalizeCapabilities(value = {}) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.models) || !Array.isArray(value.tasks)) {
    throw new Error('Remote worker returned malformed capabilities.');
  }
  const modelMetadata = value.models.map((model) => {
    if (typeof model === 'string') return { id: model, commercialUse: null, researchOnly: false };
    if (!model || typeof model !== 'object' || !model.id) throw new Error('Remote worker returned malformed model capabilities.');
    return {
      id: String(model.id),
      ...(model.version ? { version: String(model.version) } : {}),
      ...(model.status ? { status: String(model.status) } : {}),
      commercialUse: model.commercialUse === true,
      researchOnly: model.researchOnly === true,
      ...(model.parcelCount !== undefined ? { parcelCount: Number(model.parcelCount) } : {}),
      ...(model.referenceSpace ? { referenceSpace: String(model.referenceSpace) } : {}),
    };
  });
  return {
    schemaVersion: value.schemaVersion || 'brainsnn.worker-capabilities.v1',
    device: {
      ...normalizeComputeDevice({ ...(value.device || {}), id: value.device?.id || 'remote-worker-device' }),
      connection: 'remote',
    },
    models: modelMetadata.map((model) => model.id),
    modelMetadata,
    tasks: value.tasks.map(String),
  };
}

function assertCommercialRemoteResult(value) {
  if (value?.provenance?.researchOnly === true || value?.researchOnly === true) {
    const error = new Error('Remote worker returned research-only output to the commercial route.');
    error.code = 'research_only_result';
    throw error;
  }
  if (value?.provenance?.commercialUse !== true) {
    const error = new Error('Remote worker result does not explicitly permit commercial use.');
    error.code = 'commercial_use_not_permitted';
    throw error;
  }
}

export function createRemoteWorkerAdapter(options = {}) {
  const baseUrl = normalizeBaseUrl(options.url);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const token = options.token || '';
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 30_000);
  const pollIntervalMs = Math.max(0, Number(options.pollIntervalMs) || 100);
  const delay = options.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastCapabilities = null;
  let selectedModel = null;
  const configuredCommercialUse = options.commercialUse !== false;
  return {
    id: REMOTE_WORKER_ID,
    version: '1.0.0',
    metadata() {
      return {
        id: REMOTE_WORKER_ID,
        version: '1.0.0',
        status: baseUrl ? 'configured' : 'not_configured',
        commercialUse: selectedModel ? selectedModel.commercialUse !== false && configuredCommercialUse : configuredCommercialUse,
        researchOnly: Boolean(selectedModel?.researchOnly),
        trained: null,
        validated: null,
        modelStatus: baseUrl ? 'remote_configured' : 'not_configured',
        referenceSpace: 'parcel',
        parcelCount: null,
        device: lastCapabilities?.device || { ...normalizeComputeDevice({ id: 'remote-worker', type: 'remote', name: 'configured remote worker', capabilities: [] }), connection: 'remote' },
      };
    },
    async capabilities() {
      if (!baseUrl || typeof fetchImpl !== 'function') {
        const error = new Error('Remote neural worker is not configured.');
        error.code = 'not_configured';
        throw error;
      }
      lastCapabilities = normalizeCapabilities(await fetchJson(fetchImpl, `${baseUrl}/capabilities`, { headers: workerHeaders(token) }, Math.min(timeoutMs, 5000)));
      selectedModel = lastCapabilities.modelMetadata.find((model) => model.id === 'brainsnn-neural-mirror')
        || lastCapabilities.modelMetadata[0] || null;
      return lastCapabilities;
    },
    async health() {
      if (!baseUrl || typeof fetchImpl !== 'function') return { status: 'not_configured', reason: 'worker_url_missing' };
      try {
        const health = await fetchJson(fetchImpl, `${baseUrl}/health`, { headers: workerHeaders(token) }, Math.min(timeoutMs, 5000));
        const capabilities = await this.capabilities();
        const capable = capabilities.tasks.includes('prediction') && capabilities.models.length > 0;
        const healthReady = ['ok', 'available', 'healthy'].includes(health.status);
        const commerciallyAllowed = this.metadata().commercialUse === true && this.metadata().researchOnly !== true;
        return {
          status: healthReady && capable && commerciallyAllowed ? 'available' : 'unavailable',
          ...(!commerciallyAllowed ? { reason: 'worker_model_not_permitted_for_commercial_route' } : {}),
          health,
          capabilities,
        };
      } catch (error) {
        return { status: error.code === 'worker_timeout' ? 'timeout' : 'unavailable', reason: error?.message || 'worker_unreachable' };
      }
    },
    async predict(sequence, predictionOptions = {}) {
      if (!baseUrl || typeof fetchImpl !== 'function') {
        const error = new Error('Remote neural worker is not configured.');
        error.code = 'not_configured';
        throw error;
      }
      const maxLatencyMs = Math.min(timeoutMs, Math.max(100, Number(predictionOptions.maxLatencyMs) || timeoutMs));
      const jobId = String(predictionOptions.jobId || `job-${sequence.inputId}-${sequence.ablation}`).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 160);
      const payload = {
        schemaVersion: 'brainsnn.job.v1',
        jobId,
        type: 'neural_prediction',
        model: selectedModel?.id || 'brainsnn-neural-mirror',
        input: {
          ...sequence,
          segments: sequence.segments.map((segment) => ({
            ...segment,
            modalityFeatures: segment.features,
            features: segment.fused,
          })),
        },
        constraints: { maxLatencyMs },
      };
      const submitted = await fetchJson(fetchImpl, `${baseUrl}/jobs`, {
        method: 'POST', headers: workerHeaders(token), body: JSON.stringify(payload),
      }, maxLatencyMs);
      if (submitted.result) {
        assertCommercialRemoteResult(submitted.result);
        const direct = validateNeuralPrediction(submitted.result);
        if (!direct.valid) throw new Error(`Remote worker result is malformed: ${direct.errors.join('; ')}`);
        return createNeuralPrediction({
          ...direct.value,
          provenance: { ...direct.value.provenance, remoteWorker: 'configured-worker', commercialUse: true, researchOnly: false },
        });
      }
      const returnedJobId = String(submitted.jobId || '');
      if (!returnedJobId || returnedJobId.length > 200 || !/^[A-Za-z0-9._-]+$/.test(returnedJobId)) throw new Error('Remote worker returned a malformed job ID.');
      const maxPolls = Math.max(1, Math.ceil(maxLatencyMs / Math.max(25, pollIntervalMs || 25)));
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const job = await fetchJson(fetchImpl, `${baseUrl}/jobs/${encodeURIComponent(returnedJobId)}`, { headers: workerHeaders(token) }, maxLatencyMs);
        if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || `Remote worker job ${job.status}.`);
        if (job.status === 'completed') {
          const result = await fetchJson(fetchImpl, `${baseUrl}/jobs/${encodeURIComponent(returnedJobId)}/result`, { headers: workerHeaders(token) }, maxLatencyMs);
          const rawResult = result.result || result;
          assertCommercialRemoteResult(rawResult);
          const validated = validateNeuralPrediction(rawResult);
          if (!validated.valid) throw new Error(`Remote worker result is malformed: ${validated.errors.join('; ')}`);
          return createNeuralPrediction({
            ...validated.value,
            provenance: { ...validated.value.provenance, remoteWorker: 'configured-worker', commercialUse: true, researchOnly: false },
          });
        }
        if (!['queued', 'running', 'accepted'].includes(job.status)) throw new Error('Remote worker returned a malformed job status.');
        if (pollIntervalMs) await delay(pollIntervalMs);
      }
      const error = new Error('Remote worker job timed out.');
      error.code = 'worker_timeout';
      throw error;
    },
    async cancel(jobId) {
      if (!baseUrl || typeof fetchImpl !== 'function') return { status: 'not_configured' };
      return fetchJson(fetchImpl, `${baseUrl}/jobs/${encodeURIComponent(String(jobId))}/cancel`, {
        method: 'POST', headers: workerHeaders(token),
      }, Math.min(timeoutMs, 5000));
    },
    async metrics() {
      if (!baseUrl || typeof fetchImpl !== 'function') return { status: 'not_configured' };
      return fetchJson(fetchImpl, `${baseUrl}/metrics`, { headers: workerHeaders(token) }, Math.min(timeoutMs, 5000));
    },
  };
}

export { normalizeCapabilities as normalizeWorkerCapabilities };
