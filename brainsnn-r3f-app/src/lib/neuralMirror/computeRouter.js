import { createCpuBaselineAdapter } from './adapters/cpuBaseline.js';
import { createNeuralPrediction } from './schema.js';

export const COMMERCIAL_ROUTE_PRIORITY = Object.freeze([
  'brainsnn-neural-mirror',
  'remote-neural-worker',
  'brainsnn-cpu-baseline',
  'brainsnn-deterministic-projection-fallback',
]);

function createLegacyProjectionAdapter(parcelCount = 1000) {
  const baseline = createCpuBaselineAdapter({ parcelCount, seed: 103 });
  return {
    id: 'brainsnn-deterministic-projection-fallback',
    version: '0.1.0',
    metadata: () => ({
      id: 'brainsnn-deterministic-projection-fallback', version: '0.1.0', status: 'available', commercialUse: true,
      researchOnly: false, trained: false, validated: false, modelStatus: 'legacy_fallback', referenceSpace: 'parcel', parcelCount,
    }),
    health: async () => ({ status: 'available' }),
    async predict(sequence, options) {
      const prediction = await baseline.predict(sequence, options);
      return createNeuralPrediction({
        ...prediction,
        model: { ...prediction.model, id: 'brainsnn-deterministic-projection-fallback', version: '0.1.0' },
        modelStatus: 'legacy_fallback',
        evidence: { ...prediction.evidence, method: 'Legacy deterministic projection fallback for continuity; untrained and unvalidated.' },
        provenance: { ...prediction.provenance, adapter: 'brainsnn-deterministic-projection-fallback', trained: false, validated: false },
      });
    },
  };
}

function elapsed(start, clock) {
  return Number(Math.max(0, clock() - start).toFixed(3));
}

export function createComputeRouter({ registry, clock = () => Date.now(), parcelCount = 1000 } = {}) {
  if (!registry?.get) throw new Error('Compute router requires a model registry.');
  const legacy = createLegacyProjectionAdapter(parcelCount);
  return {
    async route(sequence, options = {}) {
      const trace = [{
        engine: 'tribe-reference',
        status: 'excluded',
        reason: 'research_only_not_in_commercial_route',
      }];
      const adapters = [
        registry.get('brainsnn-neural-mirror'),
        options.allowRemote === false ? null : registry.get('remote-neural-worker'),
        options.allowCpu === false ? null : registry.get('brainsnn-cpu-baseline'),
        legacy,
      ].filter(Boolean);
      for (const adapter of adapters) {
        const started = clock();
        let health;
        try {
          health = await adapter.health();
        } catch (error) {
          trace.push({ engine: adapter.id, status: 'unavailable', reason: error?.message || 'health_check_failed', latencyMs: elapsed(started, clock) });
          continue;
        }
        if (health.status !== 'available') {
          trace.push({ engine: adapter.id, status: health.status || 'unavailable', reason: health.reason, latencyMs: elapsed(started, clock) });
          continue;
        }
        let metadata;
        try {
          metadata = adapter.metadata();
        } catch (error) {
          trace.push({ engine: adapter.id, status: 'unavailable', reason: error?.message || 'metadata_failed', latencyMs: elapsed(started, clock) });
          continue;
        }
        if (metadata.commercialUse !== true || metadata.researchOnly === true) {
          trace.push({
            engine: adapter.id,
            status: 'excluded',
            reason: metadata.researchOnly === true ? 'research_only_not_in_commercial_route' : 'commercial_use_not_permitted',
            latencyMs: elapsed(started, clock),
          });
          continue;
        }
        try {
          const prediction = await adapter.predict(sequence, options);
          if (prediction?.provenance?.commercialUse !== true || prediction?.provenance?.researchOnly === true) {
            trace.push({
              engine: adapter.id,
              status: 'excluded',
              reason: prediction?.provenance?.researchOnly === true ? 'research_only_result' : 'commercial_use_not_permitted_by_result',
              latencyMs: elapsed(started, clock),
            });
            continue;
          }
          trace.push({ engine: adapter.id, status: 'completed', latencyMs: elapsed(started, clock) });
          return { prediction, computeTrace: trace, adapter };
        } catch (error) {
          trace.push({ engine: adapter.id, status: error?.code === 'worker_timeout' ? 'timeout' : 'failed', reason: error?.message || 'prediction_failed', latencyMs: elapsed(started, clock) });
        }
      }
      const error = new Error('No neural prediction adapter completed successfully.');
      error.computeTrace = trace;
      throw error;
    },
  };
}
