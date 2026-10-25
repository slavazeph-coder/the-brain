import { readFile, stat } from 'node:fs/promises';

const MAX_INDEX_BYTES = 5 * 1024 * 1024;
const EXPERIMENT_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);
const MODEL_STAGES = new Set(['experimental', 'candidate', 'champion', 'archived']);

function safe(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeConfig(value, depth = 0) {
  if (depth > 5) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return safe(value, 1000);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeConfig(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).slice(0, 200)
    .filter(([key]) => !/(?:path|token|secret|password|credential|authorization)/i.test(key))
    .map(([key, item]) => [safe(key, 120), sanitizeConfig(item, depth + 1)]));
}

function normalizeMetrics(metrics = {}) {
  const result = {};
  for (const key of ['meanPearson', 'medianPearson', 'positiveParcelFraction', 'latencyMs', 'modelSizeBytes']) {
    const value = finiteOrNull(metrics[key]);
    if (value !== null) result[key] = value;
  }
  const memoryMb = finiteOrNull(metrics.memoryMb ?? metrics.memoryPeakMb);
  if (memoryMb !== null) result.memoryMb = memoryMb;
  for (const key of ['validParcelCount', 'excludedParcelCount']) {
    const value = finiteOrNull(metrics[key]);
    if (value !== null) result[key] = Math.max(0, Math.floor(value));
  }
  if (metrics.benchmarkValid !== undefined) result.benchmarkValid = metrics.benchmarkValid === true;
  if (metrics.dataLeakageDetected !== undefined) result.dataLeakageDetected = metrics.dataLeakageDetected === true;
  if (metrics.synthetic !== undefined) result.synthetic = Boolean(metrics.synthetic);
  if (metrics.device) result.device = safe(metrics.device, 80);
  if (metrics.split) result.split = safe(metrics.split, 40);
  if (Array.isArray(metrics.warnings)) result.warnings = metrics.warnings.slice(0, 50).map((item) => safe(item, 500));
  if (Array.isArray(metrics.perParcelPearson)) {
    result.perParcelPearson = metrics.perParcelPearson.slice(0, 10_000).map(finiteOrNull);
  }
  return result;
}

function modelLabel(value) {
  if (value && typeof value === 'object') {
    const id = safe(value.id || 'unknown-model', 120);
    const version = value.version ? safe(value.version, 80) : null;
    return { id, version };
  }
  return { id: safe(value || 'unknown-model', 120), version: null };
}

function datasetLabel(value) {
  if (value && typeof value === 'object') {
    return {
      id: safe(value.id || 'unknown-dataset', 160),
      ...(value.version ? { version: safe(value.version, 80) } : {}),
      ...(value.synthetic !== undefined ? { synthetic: value.synthetic === true } : {}),
    };
  }
  return { id: safe(value || 'unknown-dataset', 160) };
}

function deviceLabel(value) {
  if (value && typeof value === 'object') {
    return {
      id: safe(value.id || 'unknown', 120),
      type: safe(value.type || 'unknown', 40),
      name: safe(value.name || value.id || 'unknown', 160),
      memoryMb: finiteOrNull(value.memoryMb),
      capabilities: Array.isArray(value.capabilities) ? value.capabilities.slice(0, 50).map((item) => safe(item, 80)) : [],
    };
  }
  return { id: safe(value || 'unknown', 120), type: 'unknown', name: safe(value || 'unknown', 160), memoryMb: null, capabilities: [] };
}

function normalizeExperiment(value = {}, index = 0) {
  const id = safe(value.experimentId || value.id || `experiment-${index + 1}`, 120);
  const modelInfo = modelLabel(value.model);
  const datasetInfo = datasetLabel(value.dataset);
  const deviceInfo = deviceLabel(value.device);
  const metricsSource = value.metrics && typeof value.metrics === 'object' ? value.metrics : {};
  const metricsBySplit = Object.fromEntries(Object.entries(metricsSource)
    .filter(([split, metrics]) => ['train', 'validation', 'test'].includes(split) && metrics && typeof metrics === 'object')
    .map(([split, metrics]) => [split, normalizeMetrics(metrics)]));
  const benchmarkMetrics = Object.keys(metricsBySplit).length
    ? (metricsBySplit.test || metricsBySplit.validation || metricsBySplit.train || {})
    : normalizeMetrics(value.benchmarkMetrics || value.metrics);
  return {
    experimentId: id,
    parentExperiment: value.parentExperiment ? safe(value.parentExperiment, 120) : null,
    model: modelInfo.id,
    modelInfo,
    gitSha: safe(value.gitSha || value.gitSHA || 'unknown', 64),
    dataset: datasetInfo.id,
    datasetInfo,
    featureConfig: value.featureConfig && typeof value.featureConfig === 'object' ? sanitizeConfig(value.featureConfig) : {},
    hyperparameters: value.hyperparameters && typeof value.hyperparameters === 'object' ? sanitizeConfig(value.hyperparameters) : {},
    seed: Number.isInteger(Number(value.seed)) ? Number(value.seed) : null,
    device: deviceInfo.id,
    deviceInfo,
    startTime: safe(value.startTime || value.startedAt || '', 64) || null,
    endTime: safe(value.endTime || value.endedAt || '', 64) || null,
    status: EXPERIMENT_STATUSES.has(value.status) ? value.status : 'failed',
    stage: MODEL_STAGES.has(value.stage) ? value.stage : value.promotedChampion ? 'champion' : 'experimental',
    benchmarkScope: value.benchmarkScope ? safe(value.benchmarkScope, 160) : null,
    benchmarkSignature: value.benchmarkSignature ? safe(value.benchmarkSignature, 128) : null,
    benchmarkMetrics,
    metricsBySplit,
    notes: safe(value.notes || '', 2000),
    promotedChampion: Boolean(value.promotedChampion || value.champion),
    failureReason: value.failureReason ? safe(value.failureReason, 1000) : null,
    checkpointAvailable: Boolean(value.checkpointPath || value.checkpointAvailable),
  };
}

export function normalizeExperimentIndex(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.experiments) ? value.experiments : null;
  if (!source) throw new Error('Experiment index must contain an experiments array.');
  const experiments = source.slice(0, 10_000).map(normalizeExperiment);
  const champions = experiments.filter((experiment) => experiment.promotedChampion || experiment.stage === 'champion');
  return {
    schemaVersion: 'brainsnn.experiment-index.v1',
    status: 'available',
    experiments,
    champion: champions.at(-1) || null,
    count: experiments.length,
    updatedAt: safe(value?.updatedAt || '', 64) || null,
    promotionDecisions: Array.isArray(value?.promotionDecisions) ? value.promotionDecisions.slice(-1000).map((decision, index) => ({
      decisionId: Number.isInteger(Number(decision?.decisionId)) ? Number(decision.decisionId) : index + 1,
      candidateExperiment: safe(decision?.candidateExperiment || '', 120) || null,
      previousChampion: safe(decision?.previousChampion || '', 120) || null,
      approved: decision?.approved === true,
      decidedAt: safe(decision?.decidedAt || '', 64) || null,
      reason: safe(decision?.reason || '', 1000),
      checks: Array.isArray(decision?.checks) ? decision.checks.slice(0, 100).map((check) => ({
        name: safe(check?.name || '', 120),
        passed: check?.passed === true,
        requirement: safe(check?.requirement || '', 240),
        observed: typeof check?.observed === 'boolean' || Number.isFinite(check?.observed)
          ? check.observed
          : safe(check?.observed ?? '', 240),
      })) : [],
    })) : [],
  };
}

export async function readExperimentIndex(path) {
  const resolved = path || (typeof process !== 'undefined'
    ? process.env.NEURAL_EXPERIMENTS_PATH || process.env.NEURAL_EXPERIMENT_INDEX
    : '');
  if (!resolved) return { schemaVersion: 'brainsnn.experiment-index.v1', status: 'not_configured', experiments: [], champion: null, count: 0 };
  try {
    const info = await stat(resolved);
    if (!info.isFile() || info.size > MAX_INDEX_BYTES) throw new Error('Experiment index is not a bounded JSON file.');
    return normalizeExperimentIndex(JSON.parse(await readFile(resolved, 'utf8')));
  } catch (error) {
    return {
      schemaVersion: 'brainsnn.experiment-index.v1',
      status: error instanceof SyntaxError ? 'malformed' : 'unavailable',
      experiments: [], champion: null, count: 0,
      error: error instanceof SyntaxError ? 'Experiment index JSON is malformed.' : 'Experiment index is unavailable.',
    };
  }
}
