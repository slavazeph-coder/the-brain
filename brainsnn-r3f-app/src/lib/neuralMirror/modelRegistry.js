import { readFileSync, statSync } from 'node:fs';
import { createCpuBaselineAdapter } from './adapters/cpuBaseline.js';
import { createLearnedMirrorAdapter } from './adapters/learnedMirror.js';
import { createRemoteWorkerAdapter } from './adapters/remoteWorker.js';
import { createTribeReferenceAdapter } from './adapters/tribeReference.js';

function parseArtifact(value) {
  if (!value) return { artifact: null, rawArtifactJson: null, error: null };
  if (typeof value === 'object') return { artifact: value, rawArtifactJson: null, error: null };
  try {
    const rawArtifactJson = String(value);
    return { artifact: JSON.parse(rawArtifactJson), rawArtifactJson, error: null };
  } catch {
    return { artifact: null, rawArtifactJson: null, error: 'model_artifact_json_malformed' };
  }
}

function loadArtifactFromPath(value) {
  if (!value) return { artifact: null, rawArtifactJson: null, error: null };
  try {
    const path = String(value);
    if (!path.toLowerCase().endsWith('.json')) return { artifact: null, rawArtifactJson: null, error: 'model_artifact_path_must_be_json' };
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return { artifact: null, rawArtifactJson: null, error: 'model_artifact_file_invalid_or_too_large' };
    const rawArtifactJson = readFileSync(path, 'utf8');
    return { artifact: JSON.parse(rawArtifactJson), rawArtifactJson, error: null };
  } catch (error) {
    return { artifact: null, rawArtifactJson: null, error: error instanceof SyntaxError ? 'model_artifact_json_malformed' : 'model_artifact_path_unavailable' };
  }
}

export function createModelRegistry(options = {}) {
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const parcelCount = Math.max(1, Math.min(10_000, Number(options.parcelCount || env.NEURAL_PARCEL_COUNT) || 1000));
  const inlineArtifact = options.artifact
    ? { artifact: options.artifact, rawArtifactJson: options.rawArtifactJson || null, error: null }
    : parseArtifact(env.NEURAL_MODEL_ARTIFACT);
  const pathArtifact = inlineArtifact.artifact
    ? { artifact: null, rawArtifactJson: null, error: null }
    : loadArtifactFromPath(options.modelPath || env.NEURAL_MODEL_PATH);
  const artifact = inlineArtifact.artifact || pathArtifact.artifact;
  const rawArtifactJson = inlineArtifact.rawArtifactJson || pathArtifact.rawArtifactJson;
  const configurationError = inlineArtifact.error || pathArtifact.error;
  const adapters = [
    createLearnedMirrorAdapter({ artifact, rawArtifactJson, parcelCount, configurationError }),
    createRemoteWorkerAdapter({
      url: options.workerUrl || env.NEURAL_WORKER_URL,
      token: options.workerToken || env.NEURAL_WORKER_TOKEN,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      delay: options.delay,
    }),
    createCpuBaselineAdapter({ parcelCount, seed: Number(options.seed ?? env.NEURAL_RANDOM_SEED) || 2026 }),
    createTribeReferenceAdapter({
      env,
      enabled: options.enableTribeResearch ?? env.ENABLE_TRIBE_RESEARCH,
      url: options.tribeUrl || env.TRIBE_API_URL,
      token: options.tribeToken || env.TRIBE_API_TOKEN,
      fetchImpl: options.fetchImpl,
    }),
  ];
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const safeMetadata = (adapter) => {
    try { return adapter.metadata(); } catch (error) {
      return {
        id: adapter.id || 'unknown-adapter',
        version: adapter.version || 'unknown',
        status: 'unavailable',
        reason: error?.message || 'metadata_failed',
        commercialUse: false,
        researchOnly: false,
        trained: null,
        validated: null,
      };
    }
  };
  return {
    adapters,
    get(id) { return byId.get(id) || null; },
    metadata() { return adapters.map(safeMetadata); },
    async list() {
      return Promise.all(adapters.map(async (adapter) => {
        const metadata = safeMetadata(adapter);
        let health;
        try {
          health = await adapter.health();
        } catch (error) {
          health = { status: 'unavailable', reason: error?.message || 'health_check_failed' };
        }
        return { ...metadata, status: health.status, health };
      }));
    },
    async status() {
      const models = await this.list();
      return {
        schemaVersion: 'brainsnn.model-registry.v1',
        models,
        commercialRoute: ['brainsnn-neural-mirror', 'remote-neural-worker', 'brainsnn-cpu-baseline', 'brainsnn-deterministic-projection-fallback'],
        excludedFromCommercialRoute: ['tribe-reference'],
      };
    },
  };
}
