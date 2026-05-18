/**
 * embeddings.worker.js — MiniLM-L6 in a dedicated worker.
 *
 * Loads transformers.js from CDN once on spawn, instantiates the
 * `Xenova/all-MiniLM-L6-v2` pipeline, and exposes embed / embedBatch
 * over the standard workerPool envelope. The main thread never blocks
 * on model load.
 *
 * Cache is intentionally NOT here — IDB lives on the main thread (the
 * worker has its own IDB but cross-thread coherence is messy). The
 * facade in src/utils/embeddings.js checks the cache before calling
 * the worker.
 */

import { handleRequests } from '../utils/workerPool.js';

const CDN_URL = 'https://esm.run/@xenova/transformers@2.17.2';
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let pipelinePromise = null;
let pipelineInstance = null;
let status = { state: 'idle', error: null, modelId: MODEL_ID };

async function ensurePipeline() {
  if (pipelineInstance) return pipelineInstance;
  if (pipelinePromise) return pipelinePromise;

  status = { ...status, state: 'loading', error: null };
  pipelinePromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ CDN_URL);
      status = { ...status, state: 'model-loading' };
      pipelineInstance = await mod.pipeline('feature-extraction', MODEL_ID, { quantized: true });
      status = { ...status, state: 'ready', error: null };
      return pipelineInstance;
    } catch (err) {
      status = { ...status, state: 'error', error: err?.message || String(err) };
      pipelinePromise = null;
      throw err;
    }
  })();
  return pipelinePromise;
}

handleRequests({
  // Kick off model load without blocking. Main thread polls getStatus.
  warmup: async () => {
    ensurePipeline().catch(() => { /* status reflects the error */ });
    return { ok: true, status };
  },

  getStatus: async () => status,

  embed: async ({ text }) => {
    if (!text || typeof text !== 'string') throw new Error('embed: text required');
    const pipe = await ensurePipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    // Return as a plain Array for now; transferring Float32Array via
    // structured clone would also work but adds boilerplate around
    // detached buffers when the consumer also caches the vector.
    return { vec: Array.from(output.data) };
  },

  embedBatch: async ({ texts }) => {
    const pipe = await ensurePipeline();
    const out = [];
    for (const t of texts || []) {
      const o = await pipe(t, { pooling: 'mean', normalize: true });
      out.push(Array.from(o.data));
    }
    return { vecs: out };
  }
});
