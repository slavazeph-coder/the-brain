/**
 * Layer 24 — Real embeddings via transformers.js (CDN-loaded)
 *
 * Provider pattern: trigram Jaccard fallback by default, opt-in to real
 * semantic embeddings via @xenova/transformers loaded dynamically from
 * esm.run CDN. No build-time dep — first call fetches the library +
 * `Xenova/all-MiniLM-L6-v2` model (~25MB).
 *
 * Cached embeddings live in memory and are persisted to localStorage
 * (scoped by text hash) so repeat queries are instant.
 */

const CDN_URL = 'https://esm.run/@xenova/transformers@2.17.2';
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const CACHE_KEY = 'brainsnn_embeddings_v1';
const CACHE_MAX = 500;

let pipelinePromise = null;
let pipelineInstance = null;
let status = { state: 'idle', error: null, modelId: MODEL_ID, cdn: CDN_URL };
const subscribers = new Set();
const memCache = new Map(); // textHash → Float32Array

// ---------- status broadcast ----------

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const cb of subscribers) {
    try { cb(status); } catch { /* ignore */ }
  }
}

export function subscribeStatus(cb) {
  subscribers.add(cb);
  cb(status);
  return () => subscribers.delete(cb);
}

export function getEmbeddingStatus() {
  return { ...status, cacheSize: memCache.size };
}

// ---------- cache ----------

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const [hash, arr] of Object.entries(parsed)) {
      memCache.set(hash, Float32Array.from(arr));
    }
  } catch { /* ignore */ }
}

function saveCache() {
  try {
    const obj = {};
    let count = 0;
    for (const [hash, vec] of memCache) {
      if (count++ >= CACHE_MAX) break;
      obj[hash] = Array.from(vec);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch { /* quota — ignore */ }
}

export function clearEmbeddingCache() {
  memCache.clear();
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  setStatus({});
}

// Fast non-crypto hash for cache keys
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---------- model loading ----------

/**
 * Load transformers.js from CDN + the embedding model.
 * Idempotent — safe to call multiple times.
 */
export async function initEmbeddings() {
  if (pipelineInstance) return pipelineInstance;
  if (pipelinePromise) return pipelinePromise;

  loadCache();
  setStatus({ state: 'loading', error: null });

  pipelinePromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ CDN_URL);
      setStatus({ state: 'model-loading' });
      pipelineInstance = await mod.pipeline('feature-extraction', MODEL_ID, {
        quantized: true
      });
      setStatus({ state: 'ready', error: null });
      return pipelineInstance;
    } catch (err) {
      setStatus({ state: 'error', error: err.message || String(err) });
      pipelinePromise = null;
      throw err;
    }
  })();

  return pipelinePromise;
}

export function isReady() {
  return status.state === 'ready' && pipelineInstance !== null;
}

// ---------- embedding API ----------

/**
 * Return a Float32Array embedding for the given text.
 * Uses cache, falls back to error if not initialized.
 */
export async function embed(text) {
  if (!text || typeof text !== 'string') throw new Error('embed: text required');
  const hash = hashText(text);
  if (memCache.has(hash)) return memCache.get(hash);

  if (!pipelineInstance) await initEmbeddings();
  if (!pipelineInstance) throw new Error('Embeddings not ready');

  const output = await pipelineInstance(text, { pooling: 'mean', normalize: true });
  // transformers.js returns a Tensor; .data is a Float32Array
  const vec = new Float32Array(output.data);
  memCache.set(hash, vec);
  if (memCache.size % 10 === 0) saveCache();
  return vec;
}

/**
 * Batch embed — returns array of Float32Array in order of input.
 * Serializes calls for pipeline safety but with cache short-circuits.
 */
export async function embedBatch(texts) {
  const out = [];
  for (const t of texts) {
    out.push(await embed(t));
  }
  saveCache();
  return out;
}

// ---------- similarity ----------

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  // Vectors are already L2-normalized (normalize: true in pooling),
  // so dot product == cosine similarity
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
