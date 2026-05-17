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

export async function getCached(hash) {
  await migrateLegacy();
  try {
    const row = await store().get(hash);
    if (!row || !row.vec) return null;
    // Refresh lastAccessed in the background; don't block the read.
    const refreshed = { vec: row.vec, t: Date.now() };
    store().set(hash, refreshed).catch(() => { /* noop */ });
    // IDB returns plain typed arrays directly; if a structured-clone
    // path ever boxes it, restore the Float32Array view.
    return row.vec instanceof Float32Array ? row.vec : Float32Array.from(row.vec);
  } catch {
    return null;
  }
}

export async function setCached(hash, vec) {
  try {
    await store().set(hash, { vec, t: Date.now() });
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
