import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '../../test/tinyVitest.js';
import { createCpuBaselineAdapter } from './adapters/cpuBaseline.js';
import { createLearnedMirrorAdapter } from './adapters/learnedMirror.js';
import { createRemoteWorkerAdapter, normalizeWorkerCapabilities } from './adapters/remoteWorker.js';
import { createTribeReferenceAdapter } from './adapters/tribeReference.js';
import { createComputeRouter } from './computeRouter.js';
import { createModelRegistry } from './modelRegistry.js';
import { canonicalJson, sha256Hex } from './receipts.js';
import { createNeuralPrediction } from './schema.js';

function portableArtifact({ commercialUse = true } = {}) {
  const inputDimension = 28;
  const parcelCount = 2;
  const unsigned = {
    schemaVersion: 'brainsnn.neural-model-artifact.v1',
    model: {
      id: 'ridge-v0', version: '0.2.0', kind: 'ridge', status: 'trained_unvalidated',
      trained: true, validatedAgainstNeuralData: false, commercialUse,
    },
    input: {
      featureDimension: inputDimension,
      modalitySlices: { vision: [0, 8], audio: [8, 16], language: [16, 28] },
      extractorVersions: { vision: '1', audio: '1', language: '1' },
      normalization: {
        method: 'train_split_standardization',
        mean: new Array(inputDimension).fill(0.5),
        scale: new Array(inputDimension).fill(2),
      },
    },
    output: { representation: 'parcel', referenceSpace: 'abstract', atlas: 'fixture-atlas', mappingId: 'fixture-map', parcelCount },
    parameters: {
      weights: new Array(inputDimension).fill(null).map((_, feature) => [feature === 0 ? 2 : 0.1, feature === 27 ? -1 : 0.2]),
      bias: [0.25, -0.5], alpha: 1,
    },
    training: { datasets: [{ id: 'licensed-fixture', license: 'fixture' }], seed: 42 },
    provenance: { synthetic: false, experimentId: 'mirror-test' },
    evidence: { method: 'Portable ridge fixture.', confidenceMethod: 'not_available' },
    disclaimer: 'Model-predicted neural response on a reference representation; not a measured brain scan or medical assessment.',
  };
  const artifact = {
    ...unsigned,
    integrity: { algorithm: 'sha256', canonicalJsonSha256: sha256Hex(canonicalJson(unsigned)) },
  };
  return { artifact, raw: canonicalJson(artifact) };
}

function sequence() {
  const fused = new Array(28).fill(1);
  return {
    schemaVersion: 'brainsnn.multimodal-features.v1', inputId: 'fixture', ablation: 'all',
    selectedModalities: ['vision', 'audio', 'language'], embeddingDimension: 28,
    modalityStatus: { vision: { status: 'available' }, audio: { status: 'available' }, language: { status: 'available' } },
    extractorMetadata: {},
    segments: [{
      id: 's0', index: 0, startMs: 0, endMs: 1500, fused,
      features: { vision: new Array(8).fill(1), audio: new Array(8).fill(1), language: new Array(12).fill(1) },
      modalityContribution: { vision: 0.3, audio: 0.3, language: 0.4 },
    }],
  };
}

function remotePrediction({ commercialUse = true, researchOnly = false } = {}) {
  return createNeuralPrediction({
    model: { id: 'remote-model', version: '1', device: 'cuda:0' }, modelStatus: 'trained_unvalidated',
    referenceSpace: { type: 'parcel', parcelCount: 2 },
    timeline: [{ startMs: 0, endMs: 1500, activations: [0.1, 0.2], confidence: 0.2, modalityContribution: { vision: 1, audio: 0, language: 0 } }],
    evidence: { method: 'remote fixture', validatedAgainstNeuralData: false, confidenceMethod: 'not_available' },
    provenance: { commercialUse, researchOnly },
  });
}

async function capturedError(callback) {
  try { await callback(); return null; } catch (error) { return error; }
}

describe('neural model adapters and commercial compute routing', () => {
  it('loads the 28-dimensional Python portable ridge contract with exact linear parity', async () => {
    const { artifact, raw } = portableArtifact();
    const adapter = createLearnedMirrorAdapter({ artifact, rawArtifactJson: raw });
    expect(adapter.metadata().status).toBe('available');
    expect(adapter.metadata().integrityVerified).toBe(true);
    const prediction = await adapter.predict(sequence());
    let expected = artifact.parameters.bias[0];
    for (let feature = 0; feature < 28; feature += 1) {
      expected += ((1 - artifact.input.normalization.mean[feature]) / artifact.input.normalization.scale[feature])
        * artifact.parameters.weights[feature][0];
    }
    expect(prediction.timeline[0].activations[0]).toBeCloseTo(expected, 10);
    expect(prediction.timeline[0].activations[0] > 1).toBe(true);
    expect(prediction.evidence.confidenceMethod).toBe('not_available');
    expect(prediction.timeline[0].confidence).toBe(0);
  });

  it('refuses tampered portable artifacts and reports a truthful not-configured state', () => {
    const { artifact, raw } = portableArtifact();
    artifact.parameters.weights[0][0] = 999;
    const adapter = createLearnedMirrorAdapter({ artifact, rawArtifactJson: raw });
    expect(adapter.metadata().status).toBe('not_configured');
    expect(adapter.metadata().reason).toBe('artifact_raw_payload_mismatch');
    expect(adapter.metadata().commercialUse).toBe(false);
  });

  it('loads NEURAL_MODEL_PATH without exposing its path and survives an unavailable adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brainsnn-model-'));
    const path = join(directory, 'model.json');
    try {
      const { raw } = portableArtifact();
      await writeFile(path, raw, 'utf8');
      const registry = createModelRegistry({ env: { NEURAL_MODEL_PATH: path }, fetchImpl: async () => { throw new Error('worker down'); } });
      const models = await registry.list();
      const learned = models.find((model) => model.id === 'brainsnn-neural-mirror');
      expect(learned.status).toBe('available');
      expect(JSON.stringify(models)).not.toContain(path);
      expect(models.find((model) => model.id === 'brainsnn-cpu-baseline').status).toBe('available');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves a remote CUDA device and submits the universal feature job shape', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      if (url.endsWith('/capabilities')) return {
        ok: true, status: 200, json: async () => ({
          device: { id: 'cuda:0', type: 'cuda', name: 'GPU worker', memoryMb: 98304, capabilities: ['prediction', 'training'] },
          models: [{ id: 'brainsnn-neural-mirror', commercialUse: true }], tasks: ['prediction'],
        }),
      };
      if (url.endsWith('/jobs')) return { ok: true, status: 202, json: async () => ({ result: remotePrediction() }) };
      return { ok: false, status: 404, json: async () => ({ error: 'missing' }) };
    };
    const adapter = createRemoteWorkerAdapter({ url: 'https://worker.example', fetchImpl, timeoutMs: 1000 });
    expect((await adapter.health()).status).toBe('available');
    expect(adapter.metadata().device.type).toBe('cuda');
    expect(adapter.metadata().device.memoryMb).toBe(98304);
    await adapter.predict(sequence());
    const submitted = JSON.parse(calls.find((call) => call.url.endsWith('/jobs')).init.body);
    expect(submitted.schemaVersion).toBe('brainsnn.job.v1');
    expect(submitted.input.segments[0].features).toHaveLength(28);
    expect(submitted.input.segments[0].modalityFeatures.language).toHaveLength(12);
  });

  it('rejects malformed, timed-out, and non-commercial remote responses', async () => {
    const malformed = createRemoteWorkerAdapter({
      url: 'https://worker.example', timeoutMs: 100,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ result: { bad: true, provenance: { commercialUse: true } } }) }),
    });
    expect((await capturedError(() => malformed.predict(sequence()))).message).toContain('malformed');

    const research = createRemoteWorkerAdapter({
      url: 'https://worker.example', timeoutMs: 100,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ result: remotePrediction({ commercialUse: false, researchOnly: true }) }) }),
    });
    expect((await capturedError(() => research.predict(sequence()))).code).toBe('research_only_result');

    const timeout = createRemoteWorkerAdapter({
      url: 'https://worker.example', timeoutMs: 100,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    expect((await capturedError(() => timeout.predict(sequence()))).code).toBe('worker_timeout');
  });

  it('excludes research-only learned models and TRIBE from the automatic commercial route', async () => {
    const { artifact } = portableArtifact({ commercialUse: false });
    artifact.provenance.synthetic = true;
    // Re-sign after explicitly marking this fixture research-only.
    delete artifact.integrity;
    artifact.integrity = { algorithm: 'sha256', canonicalJsonSha256: sha256Hex(canonicalJson(artifact)) };
    const signedRaw = canonicalJson(artifact);
    const learned = createLearnedMirrorAdapter({ artifact, rawArtifactJson: signedRaw });
    const cpu = createCpuBaselineAdapter({ parcelCount: 4 });
    const tribe = createTribeReferenceAdapter({ enabled: true, url: 'https://tribe.example', fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
    const adapters = new Map([
      [learned.id, learned], [cpu.id, cpu], [tribe.id, tribe],
    ]);
    const registry = { get: (id) => adapters.get(id) || null };
    const routed = await createComputeRouter({ registry, parcelCount: 4 }).route(sequence(), { allowRemote: false });
    expect(routed.adapter.id).toBe('brainsnn-cpu-baseline');
    expect(routed.computeTrace.find((item) => item.engine === 'brainsnn-neural-mirror').status).toBe('excluded');
    expect(routed.computeTrace.find((item) => item.engine === 'tribe-reference').reason).toBe('research_only_not_in_commercial_route');
  });

  it('normalizes string and object worker models without losing device identity', () => {
    const capabilities = normalizeWorkerCapabilities({
      device: { type: 'cuda', name: 'future device', memoryMb: 1000 },
      models: ['brainsnn-neural-mirror'], tasks: ['prediction'],
    });
    expect(capabilities.device.type).toBe('cuda');
    expect(capabilities.device.connection).toBe('remote');
    expect(capabilities.models[0]).toBe('brainsnn-neural-mirror');
  });
});
