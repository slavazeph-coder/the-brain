/**
 * Layer 24 — Real embeddings via transformers.js.
 *
 * Facade over the embeddings worker (workers/embeddings.worker.js)
 * and the IDB cache (utils/embeddingsStore.js). Public API matches
 * the original synchronous-style contract so every caller keeps
 * working without changes:
 *
 *   await initEmbeddings()
 *   await embed(text) -> Float32Array
 *   await embedBatch(texts) -> Float32Array[]
 *   isReady() -> boolean
 *   subscribeStatus(cb)
 *   getEmbeddingStatus()
 *   clearEmbeddingCache()
 *
 * Heavy work runs in the worker; cache reads/writes happen on the main
 * thread against IDB. Falls back to inline (main-thread) loading if
 * Workers aren't available (SSR, test env, ancient browsers).
 */

import { createPool } from './workerPool';
import { getCached, setCached, clearCache, cacheSize } from './embeddingsStore';

const CDN_URL = 'https://esm.run/@xenova/transformers@2.17.2';
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let _pool = null;
let _statusPollTimer = null;
let _status = { state: 'idle', error: null, modelId: MODEL_ID, cdn: CDN_URL };
const _subs = new Set();

function broadcast(patch) {
  _status = { ..._status, ...patch };
  for (const cb of _subs) {
    try { cb(_status); } catch { /* noop */ }
  }
}

function ensurePool() {
  if (_pool) return _pool;
  if (typeof window === 'undefined') return null;
  try {
    _pool = createPool(
      () => new Worker(new URL('../workers/embeddings.worker.js', import.meta.url), { type: 'module' }),
      {
        size: 1, // single model instance is fine; embeds are sequential per worker
        fallback: null  // inline path is handled separately in initInline()
      }
    );
    return _pool;
  } catch {
    return null;
  }
}

// ---------- inline fallback (if Worker unavailable) ----------

let _inlinePromise = null;
let _inlineInstance = null;

async function inlinePipeline() {
  if (_inlineInstance) return _inlineInstance;
  if (_inlinePromise) return _inlinePromise;
  broadcast({ state: 'loading' });
  _inlinePromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ CDN_URL);
      broadcast({ state: 'model-loading' });
      _inlineInstance = await mod.pipeline('feature-extraction', MODEL_ID, { quantized: true });
      broadcast({ state: 'ready', error: null });
      return _inlineInstance;
    } catch (err) {
      broadcast({ state: 'error', error: err.message || String(err) });
      _inlinePromise = null;
      throw err;
    }
  })();
  return _inlinePromise;
}

// ---------- status polling (worker path) ----------

function startStatusPolling() {
  if (_statusPollTimer) return;
  _statusPollTimer = setInterval(async () => {
    const pool = ensurePool();
    if (!pool || pool.degraded) return;
    try {
      const s = await pool.call('getStatus', {});
      broadcast({ state: s.state, error: s.error });
      if (s.state === 'ready' || s.state === 'error') stopStatusPolling();
    } catch {
      stopStatusPolling();
    }
  }, 600);
}

function stopStatusPolling() {
  if (_statusPollTimer) {
    clearInterval(_statusPollTimer);
    _statusPollTimer = null;
  }
}

// ---------- public API ----------

export function subscribeStatus(cb) {
  _subs.add(cb);
  cb(_status);
  return () => _subs.delete(cb);
}

export function getEmbeddingStatus() {
  return { ..._status };
}

export function isReady() {
  return _status.state === 'ready';
}

export async function initEmbeddings() {
  const pool = ensurePool();
  if (pool && !pool.degraded) {
    broadcast({ state: 'loading' });
    startStatusPolling();
    try {
      await pool.call('warmup', {});
    } catch (err) {
      broadcast({ state: 'error', error: err.message || String(err) });
    }
    return;
  }
  // Worker unavailable → load on main thread.
  await inlinePipeline();
}

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function embedInline(text) {
  const pipe = await inlinePipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

async function embedViaWorker(text) {
  const pool = ensurePool();
  const { vec } = await pool.call('embed', { text });
  return Float32Array.from(vec);
}

export async function embed(text) {
  if (!text || typeof text !== 'string') throw new Error('embed: text required');
  const hash = hashText(text);

  // Cache hit (IDB)
  const cached = await getCached(hash);
  if (cached) return cached;

  const pool = ensurePool();
  let vec;
  if (pool && !pool.degraded) {
    if (_status.state !== 'ready') {
      // First call against an un-warmed pool — initialize and wait.
      await initEmbeddings();
      // Worker reports ready via polling; wait briefly for the next tick.
      await new Promise((r) => setTimeout(r, 50));
    }
    vec = await embedViaWorker(text);
  } else {
    vec = await embedInline(text);
  }

  await setCached(hash, vec);
  return vec;
}

export async function embedBatch(texts) {
  // Cache short-circuit per text + batched worker call for misses.
  const results = new Array(texts.length);
  const missIdx = [];
  const missTexts = [];

  for (let i = 0; i < texts.length; i++) {
    const hash = hashText(texts[i]);
    const cached = await getCached(hash);
    if (cached) {
      results[i] = cached;
    } else {
      missIdx.push(i);
      missTexts.push(texts[i]);
    }
  }

  if (missTexts.length === 0) return results;

  const pool = ensurePool();
  if (pool && !pool.degraded) {
    if (_status.state !== 'ready') await initEmbeddings();
    const { vecs } = await pool.call('embedBatch', { texts: missTexts });
    for (let j = 0; j < missIdx.length; j++) {
      const v = Float32Array.from(vecs[j]);
      results[missIdx[j]] = v;
      await setCached(hashText(missTexts[j]), v);
    }
  } else {
    for (let j = 0; j < missIdx.length; j++) {
      const v = await embedInline(missTexts[j]);
      results[missIdx[j]] = v;
      await setCached(hashText(missTexts[j]), v);
    }
  }

  return results;
}

export async function clearEmbeddingCache() {
  await clearCache();
  broadcast({});
}

export { cacheSize };

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ---------- idle prefetch (warm the model after first paint if seen before) ----------

if (typeof window !== 'undefined') {
  try {
    const SEEN_KEY = 'brainsnn_embeddings_seen_v1';
    if (localStorage.getItem(SEEN_KEY)) {
      // Returning user — prefetch on idle so the first scan that needs
      // embeddings doesn't pay the ~2-3s cold-load cost.
      const warm = () => initEmbeddings().catch(() => { /* swallow */ });
      if ('requestIdleCallback' in window) {
        requestIdleCallback(warm, { timeout: 8000 });
      } else {
        setTimeout(warm, 4000);
      }
    } else {
      // Mark as seen so next visit prefetches.
      subscribeStatus((s) => {
        if (s.state === 'ready') localStorage.setItem(SEEN_KEY, '1');
      });
    }
  } catch { /* noop */ }
}
