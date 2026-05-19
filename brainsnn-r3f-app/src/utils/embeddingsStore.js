/**
 * embeddingsStore — IndexedDB-backed embedding cache.
 *
 * Replaces the localStorage-bound cache in `embeddings.js` (cap 500
 * entries / ~5MB). IDB happily holds 10k+ Float32Array vectors and
 * runs LRU eviction against `lastAccessed` so the working set stays
 * useful across long browsing.
 *
 * Stored shape: { vec: Float32Array, t: timestamp }
 *   - `t` is updated on read to keep "recently used" accurate.
 *   - 384-dim quantized MiniLM → ~1.5kB per entry; 5000 → ~7.5MB.
 *
 * One-shot migration from the old `brainsnn_embeddings_v1` localStorage
 * blob runs lazily on first read; the old key is deleted after success.
 */

import { openStore } from './store';

const COLLECTION = 'embeddings';
const SOFT_CAP = 5000;        // start pruning above this
const PRUNE_TO = 4500;        // target size after a prune pass
const LEGACY_KEY = 'brainsnn_embeddings_v1';
const MIGRATED_FLAG = 'brainsnn_embeddings_migrated_v1';

let _store = null;
let _migrating = null;
let _writeCount = 0;

function store() {
  if (!_store) _store = openStore(COLLECTION);
  return _store;
}

async function migrateLegacy() {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATED_FLAG)) return;
  if (_migrating) return _migrating;

  _migrating = (async () => {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const now = Date.now();
        const s = store();
        for (const [hash, arr] of Object.entries(parsed || {})) {
          await s.set(hash, { vec: Float32Array.from(arr), t: now });
        }
        // Leave the legacy key in place for one release as a rollback
        // safety net; the migrated flag prevents re-import.
      }
      localStorage.setItem(MIGRATED_FLAG, '1');
    } catch {
      // Migration failures shouldn't break the app — fall through.
    } finally {
      _migrating = null;
    }
  })();
  return _migrating;
}

/** Best-effort LRU prune. Walks all entries, sorts by t asc, drops oldest. */
async function pruneIfNeeded() {
  try {
    const s = store();
    const keys = await s.keys();
    if (keys.length <= SOFT_CAP) return;
    const entries = await Promise.all(keys.map(async (k) => {
      const v = await s.get(k);
      return { k, t: v?.t || 0 };
    }));
    entries.sort((a, b) => a.t - b.t);
    const toDrop = entries.slice(0, entries.length - PRUNE_TO);
    for (const e of toDrop) await s.delete(e.k);
  } catch { /* noop */ }
}

/**
 * Reconstruct a Float32Array from whatever shape store.get returned.
 *   - Float32Array: pass through (IDB structured-clone preserves it)
 *   - Array: cheap typed reconstruction
 *   - Object: localStorage fallback path — JSON.stringify turns
 *     Float32Array into { "0": x, "1": y, ... }, and Float32Array.from
 *     on a plain object returns an empty array because the object has
 *     no .length. Rebuild by reading numeric keys in order.
 */
function normalizeVec(v) {
  if (v == null) return null;
  if (v instanceof Float32Array) return v;
  if (Array.isArray(v)) return Float32Array.from(v);
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => /^\d+$/.test(k));
    if (!keys.length) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return Float32Array.from(keys, (k) => v[k]);
  }
  return null;
}

export async function getCached(hash) {
  await migrateLegacy();
  try {
    const row = await store().get(hash);
    if (!row || !row.vec) return null;
    const vec = normalizeVec(row.vec);
    if (!vec || !vec.length) return null;
    // Refresh lastAccessed in the background; don't block the read.
    // Re-write as plain Array so the next read on a localStorage-fallback
    // engine round-trips through JSON correctly.
    store().set(hash, { vec: Array.from(vec), t: Date.now() }).catch(() => { /* noop */ });
    return vec;
  } catch {
    return null;
  }
}

export async function setCached(hash, vec) {
  try {
    // Always serialize as a plain Array. IDB stores it fine (structured
    // clone) and the localStorage fallback path needs JSON-safe shape —
    // a raw Float32Array there serializes to a numerically-indexed
    // object that won't round-trip back.
    const safe = vec instanceof Float32Array ? Array.from(vec) : vec;
    await store().set(hash, { vec: safe, t: Date.now() });
    _writeCount++;
    // Amortized prune — every ~100 writes check size.
    if (_writeCount % 100 === 0) pruneIfNeeded();
  } catch { /* noop */ }
}

export async function clearCache() {
  try { await store().clear(); } catch { /* noop */ }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* noop */ }
  try { localStorage.removeItem(MIGRATED_FLAG); } catch { /* noop */ }
}

export async function cacheSize() {
  try {
    const keys = await store().keys();
    return keys.length;
  } catch { return 0; }
}
