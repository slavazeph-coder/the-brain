import express from 'express';
import {
  createModelRegistry,
  createScanDirector,
  discoverComputeDevice,
  normalizeMultimodalInput,
  readExperimentIndex,
  segmentMultimodalInput,
} from '../lib/neuralMirror/index.js';

const EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTEXTS = new Set(['paid_ad', 'social_post', 'founder_post', 'landing_page', 'sales_email', 'video_script']);

function errorResponse(res, status, code, message, details) {
  return res.status(status).json({
    schemaVersion: 'brainsnn.error.v1',
    error: code,
    message,
    ...(Array.isArray(details) && details.length ? { details: details.slice(0, 20).map(String) } : {}),
  });
}

function requestInput(body) {
  if (body?.input && typeof body.input === 'object' && !Array.isArray(body.input)) return body.input;
  if (body?.schemaVersion === 'brainsnn.multimodal.v1') return body;
  throw new Error('Request must contain a brainsnn.multimodal.v1 input object.');
}

function finiteOption(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function presentFinite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

// Only expose scientifically meaningful, bounded prediction controls. Routing,
// research access, extractor injection, and creative-analysis limits remain
// server policy and cannot be selected by an HTTP caller.
export function normalizePublicPredictionOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.ablation === 'string') result.ablation = value.ablation.slice(0, 40);
  const segmentDurationMs = finiteOption(value.segmentDurationMs);
  const overlapMs = finiteOption(value.overlapMs);
  const maxLatencyMs = finiteOption(value.maxLatencyMs);
  if (segmentDurationMs !== undefined) result.segmentDurationMs = segmentDurationMs;
  if (overlapMs !== undefined) result.overlapMs = overlapMs;
  if (maxLatencyMs !== undefined) result.maxLatencyMs = Math.max(100, Math.min(60_000, maxLatencyMs));
  if (CONTEXTS.has(value.context)) result.context = value.context;
  return result;
}

function publicDevice(value) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    id: String(value.id || 'unknown').slice(0, 120),
    type: ['cpu', 'cuda', 'remote'].includes(value.type) ? value.type : 'cpu',
    name: String(value.name || value.type || 'unknown').slice(0, 160),
    ...(presentFinite(value.memoryMb) ? { memoryMb: Math.max(0, Math.floor(Number(value.memoryMb))) } : {}),
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.slice(0, 50).map((item) => String(item).slice(0, 120)) : [],
    ...(value.connection === 'remote' ? { connection: 'remote' } : {}),
  };
}

function publicBenchmark(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of ['id', 'dataset', 'split']) {
    if (typeof value[key] === 'string') result[key] = value[key].slice(0, 200);
  }
  for (const key of ['meanPearson', 'medianPearson', 'positiveParcelFraction', 'latencyMs']) {
    if (presentFinite(value[key])) result[key] = Number(value[key]);
  }
  return Object.keys(result).length ? result : undefined;
}

export function publicModelMetadata(value = {}) {
  return {
    id: String(value.id || 'unknown-model').slice(0, 160),
    version: String(value.version || 'unknown').slice(0, 120),
    status: String(value.status || 'unavailable').slice(0, 80),
    ...(value.reason ? { reason: String(value.reason).slice(0, 240) } : {}),
    commercialUse: value.commercialUse === true,
    researchOnly: value.researchOnly === true,
    trained: typeof value.trained === 'boolean' ? value.trained : null,
    validated: typeof value.validated === 'boolean' ? value.validated : null,
    modelStatus: String(value.modelStatus || 'not_reported').slice(0, 120),
    ...(value.referenceSpace ? { referenceSpace: String(value.referenceSpace).slice(0, 120) } : {}),
    ...(presentFinite(value.parcelCount) && Number.isInteger(Number(value.parcelCount)) && Number(value.parcelCount) > 0
      ? { parcelCount: Number(value.parcelCount) }
      : {}),
    ...(publicDevice(value.device) ? { device: publicDevice(value.device) } : {}),
    ...(publicBenchmark(value.benchmark) ? { benchmark: publicBenchmark(value.benchmark) } : {}),
    ...(typeof value.integrityVerified === 'boolean' ? { integrityVerified: value.integrityVerified } : {}),
    health: {
      status: String(value.health?.status || value.status || 'unavailable').slice(0, 80),
      ...(value.health?.reason ? { reason: String(value.health.reason).slice(0, 240) } : {}),
    },
  };
}

export function createNeuralApiRouter(options = {}) {
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const registry = options.registry || createModelRegistry({ env, fetchImpl });
  const director = options.director || createScanDirector({ env, fetchImpl, registry, now: options.now, clock: options.clock });
  const limiter = options.limiter || ((_req, _res, next) => next());
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  router.post('/multimodal/ingest', limiter, (req, res) => {
    try {
      const input = normalizeMultimodalInput(requestInput(req.body));
      const predictionOptions = normalizePublicPredictionOptions(req.body?.options);
      const segments = segmentMultimodalInput(input, predictionOptions);
      return res.json({
        schemaVersion: 'brainsnn.multimodal-ingest-result.v1',
        input,
        segments,
        segmentCount: segments.length,
        processingStatus: 'normalized',
      });
    } catch (error) {
      return errorResponse(res, 400, 'invalid_multimodal_input', error?.message || 'Multimodal input is invalid.');
    }
  });

  router.post('/neural/predict', limiter, async (req, res) => {
    try {
      const input = requestInput(req.body);
      const predictionOptions = normalizePublicPredictionOptions(req.body?.options);
      return res.json(await director.run(input, predictionOptions));
    } catch (error) {
      const message = String(error?.message || 'Neural prediction failed.').slice(0, 500);
      const invalid = /schema|input|mime|filename|duration|segment|timestamp|ablation|url|transcript/i.test(message);
      return errorResponse(res, invalid ? 400 : 503, invalid ? 'invalid_prediction_request' : 'neural_prediction_unavailable', message);
    }
  });

  async function models() {
    const items = await registry.list();
    return items.map(publicModelMetadata);
  }

  router.get('/neural/models', limiter, async (_req, res) => {
    try {
      return res.json({ schemaVersion: 'brainsnn.model-registry.v1', models: await models() });
    } catch {
      return errorResponse(res, 503, 'model_registry_unavailable', 'Model registry status is temporarily unavailable.');
    }
  });

  router.get('/neural/status', limiter, async (_req, res) => {
    try {
      return res.json({
        schemaVersion: 'brainsnn.neural-status.v1',
        status: 'available',
        pipelineVersion: 'brainsnn.neural-mirror-pipeline.v1',
        device: discoverComputeDevice(),
        models: await models(),
        commercialRoute: ['brainsnn-neural-mirror', 'remote-neural-worker', 'brainsnn-cpu-baseline', 'brainsnn-deterministic-projection-fallback'],
        excludedFromCommercialRoute: ['tribe-reference'],
      });
    } catch {
      return errorResponse(res, 503, 'neural_status_unavailable', 'Neural Mirror status is temporarily unavailable.');
    }
  });

  router.get('/neural/experiments', limiter, async (_req, res) => {
    const index = await readExperimentIndex(env.NEURAL_EXPERIMENTS_PATH || env.NEURAL_EXPERIMENT_INDEX);
    return res.json(index);
  });

  router.get('/neural/experiments/:id', limiter, async (req, res) => {
    if (!EXPERIMENT_ID.test(req.params.id)) {
      return errorResponse(res, 400, 'invalid_experiment_id', 'Experiment ID contains unsupported characters.');
    }
    const index = await readExperimentIndex(env.NEURAL_EXPERIMENTS_PATH || env.NEURAL_EXPERIMENT_INDEX);
    const experiment = index.experiments.find((item) => item.experimentId === req.params.id);
    if (!experiment) return errorResponse(res, 404, 'experiment_not_found', 'Experiment was not found.');
    return res.json({ schemaVersion: 'brainsnn.experiment-record.v1', experiment });
  });

  return { router, registry, director };
}
