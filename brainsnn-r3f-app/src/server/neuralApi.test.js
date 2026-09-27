import { describe, expect, it } from '../test/tinyVitest.js';
import { NEURAL_PREDICTION_DISCLAIMER } from '../lib/neuralMirror/schema.js';

function fixtureRequest(overrides = {}) {
  return {
    input: {
      schemaVersion: 'brainsnn.multimodal.v1',
      id: 'http-integration-fixture',
      source: {
        type: 'video',
        filename: 'fixture.webm',
        mimeType: 'video/webm',
        durationMs: 3000,
      },
      text: { transcript: 'Show the working demo. Teams could save 12 hours each week.', language: 'en' },
      observations: {
        vision: [
          { timestampMs: 0, luminance: 0.3, motion: 0.1, red: 0.2, green: 0.3, blue: 0.4 },
          { timestampMs: 1500, luminance: 0.7, motion: 0.65, red: 0.5, green: 0.4, blue: 0.3 },
        ],
        audio: [
          { timestampMs: 0, audioEnergy: 0.2, speechPresent: true },
          { timestampMs: 1500, audioEnergy: 0.6, speechPresent: true },
        ],
      },
      provenance: { userProvided: true, extractorVersions: { browserSampler: 'integration-v1' } },
      ...overrides,
    },
    options: { ablation: 'all', segmentDurationMs: 1500 },
  };
}

async function read(response) {
  const body = await response.json();
  return { response, body };
}

describe('Neural Mirror HTTP integration', () => {
  it('runs the bounded versioned API end to end without optional engines', async () => {
    process.env.BRAINSNN_SKIP_START = '1';
    for (const key of ['TRIBE_API_URL', 'ENABLE_TRIBE_RESEARCH', 'NEURAL_MODEL_PATH', 'NEURAL_MODEL_ARTIFACT', 'NEURAL_WORKER_URL', 'NEURAL_WORKER_TOKEN']) {
      delete process.env[key];
    }
    const { app } = await import('../../server.ts');
    const server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const models = await read(await fetch(`${origin}/api/v1/neural/models`));
      expect(models.response.status).toBe(200);
      const cpu = models.body.models.find((model) => model.id === 'brainsnn-cpu-baseline');
      expect(cpu.status).toBe('available');
      expect(cpu.trained).toBe(false);
      expect(cpu.validated).toBe(false);
      expect(cpu.commercialUse).toBe(true);

      const fixture = fixtureRequest();
      const ingest = await read(await fetch(`${origin}/api/v1/multimodal/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fixture),
      }));
      expect(ingest.response.status).toBe(200);
      expect(ingest.body.schemaVersion).toBe('brainsnn.multimodal-ingest-result.v1');
      expect(ingest.body.segmentCount).toBe(2);
      expect(ingest.body.segments[0].startMs).toBe(0);
      expect(ingest.body.segments[1].endMs).toBe(3000);

      const predictOnce = await read(await fetch(`${origin}/api/v1/neural/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fixture),
      }));
      expect(predictOnce.response.status).toBe(200);
      expect(predictOnce.body.schemaVersion).toBe('brainsnn.creative-scan.v1');
      expect(predictOnce.body.neural.schemaVersion).toBe('brainsnn.neural-prediction.v1');
      expect(predictOnce.body.neural.model.id).toBe('brainsnn-cpu-baseline');
      expect(predictOnce.body.neural.modelStatus).toBe('baseline_untrained');
      expect(predictOnce.body.neural.evidence.validatedAgainstNeuralData).toBe(false);
      expect(predictOnce.body.neural.disclaimer).toBe(NEURAL_PREDICTION_DISCLAIMER);
      expect(predictOnce.body.neural.provenance.disclaimer).toBe(NEURAL_PREDICTION_DISCLAIMER);
      expect(predictOnce.body.sourceLabels.creativeSignals).toBe('BrainSNN deterministic layer stack');
      expect(predictOnce.body.modalityStatus.vision.status).toBe('available');
      expect(predictOnce.body.modalityStatus.audio.status).toBe('available');
      expect(predictOnce.body.modalityStatus.language.status).toBe('available');
      expect(predictOnce.body.computeTrace.some((entry) => entry.engine === 'tribe-reference' && entry.status === 'excluded')).toBe(true);
      expect(predictOnce.body.computeTrace.some((entry) => entry.engine === 'brainsnn-cpu-baseline' && entry.status === 'completed')).toBe(true);
      for (const frame of predictOnce.body.neural.timeline) {
        expect(frame.endMs).toBeGreaterThan(frame.startMs);
        expect(frame.confidence).toBeGreaterThanOrEqual(0);
        expect(frame.confidence).toBeLessThanOrEqual(1);
        expect(frame.activations.every(Number.isFinite)).toBe(true);
      }

      const predictAgain = await read(await fetch(`${origin}/api/v1/neural/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fixture),
      }));
      expect(predictAgain.body.neural.timeline).toEqual(predictOnce.body.neural.timeline);
      expect(predictAgain.body.receipt.neuralPredictionHash).toBe(predictOnce.body.receipt.neuralPredictionHash);
      expect(predictAgain.body.receipt.featureHash).toBe(predictOnce.body.receipt.featureHash);

      const missingAudio = fixtureRequest({
        observations: { vision: [{ timestampMs: 0, luminance: 0.4, motion: 0.2 }] },
      });
      const partial = await read(await fetch(`${origin}/api/v1/neural/predict`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missingAudio),
      }));
      expect(partial.response.status).toBe(200);
      expect(partial.body.modalityStatus.audio.status).toBe('unavailable');
      expect(partial.body.neural.schemaVersion).toBe('brainsnn.neural-prediction.v1');

      const invalidMime = fixtureRequest({ source: { type: 'video', filename: 'fixture.exe', mimeType: 'application/x-msdownload', durationMs: 3000 } });
      const mimeError = await read(await fetch(`${origin}/api/v1/neural/predict`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalidMime),
      }));
      expect(mimeError.response.status).toBe(400);
      expect(mimeError.body.error).toBe('invalid_prediction_request');

      const traversal = fixtureRequest({ source: { type: 'video', filename: '../../secret.webm', mimeType: 'video/webm', durationMs: 3000 } });
      const traversalError = await read(await fetch(`${origin}/api/v1/multimodal/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(traversal),
      }));
      expect(traversalError.response.status).toBe(400);

      const unsafeUrl = fixtureRequest({ source: { type: 'video', url: 'http://127.0.0.1/private', durationMs: 3000, mimeType: 'video/webm' } });
      const urlError = await read(await fetch(`${origin}/api/v1/multimodal/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(unsafeUrl),
      }));
      expect(urlError.response.status).toBe(400);

      const malformed = await read(await fetch(`${origin}/api/v1/neural/predict`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"input":',
      }));
      expect(malformed.response.status).toBe(400);
      expect(malformed.body.error).toBe('invalid_json');

      const oversized = await read(await fetch(`${origin}/api/v1/neural/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { padding: 'x'.repeat(600_000) } }),
      }));
      expect(oversized.response.status).toBe(413);
      expect(oversized.body.error).toBe('payload_too_large');

      const experiments = await read(await fetch(`${origin}/api/v1/neural/experiments`));
      expect(experiments.response.status).toBe(200);
      expect(experiments.body.status).toBe('not_configured');
      expect(experiments.body.experiments).toEqual([]);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

