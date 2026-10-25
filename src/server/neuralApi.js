import express from 'express';
import { analyzeContentLocally } from '../lib/analysisEngine.js';
import { runLayerRouter, getEngineStatusSnapshot } from '../lib/layerRouter.js';

export function createNeuralApiRouter({
  env = process.env,
  fetchImpl = globalThis.fetch,
  limiter = (_req, _res, next) => next(),
} = {}) {
  void fetchImpl;
  const router = express.Router();

  router.get('/neural/health', (_req, res) => {
    res.json({
      schemaVersion: 'brainsnn.neural.v1',
      status: 'ok',
      mode: 'cpu-deterministic',
    });
  });

  router.post('/multimodal/ingest', limiter, (req, res) => {
    const { text = '', transcript = '', metadata = {} } = req.body || {};
    const content = String(text || transcript || '').trim();
    if (!content) {
      return res.status(400).json({
        schemaVersion: 'brainsnn.error.v1',
        error: 'invalid_input',
        message: 'A non-empty text or transcript field is required.',
      });
    }
    const analysis = runLayerRouter({
      content,
      contentType: 'multimodal',
      baseResult: analyzeContentLocally({ content, contentType: 'multimodal', forceFallback: true }),
      engineStatus: getEngineStatusSnapshot(env),
    });
    return res.json({
      schemaVersion: 'brainsnn.multimodal.v1',
      metadata,
      analysis,
    });
  });

  router.post('/neural/predict', limiter, (req, res) => {
    const { text = '', content = '' } = req.body || {};
    const input = String(text || content || '').trim();
    if (!input) {
      return res.status(400).json({
        schemaVersion: 'brainsnn.error.v1',
        error: 'invalid_input',
        message: 'A non-empty text or content field is required.',
      });
    }
    const analysis = runLayerRouter({
      content: input,
      contentType: 'text',
      baseResult: analyzeContentLocally({ content: input, contentType: 'text', forceFallback: true }),
      engineStatus: getEngineStatusSnapshot(env),
    });
    return res.json({
      schemaVersion: 'brainsnn.neural.v1',
      prediction: {
        firingRateHz: analysis.metrics.firingRate,
        plasticity: analysis.metrics.plasticity,
        coherence: analysis.solitonField?.coherence ?? 0.75,
        riskRating: analysis.riskRating,
      },
      analysis,
    });
  });

  return { router };
}
