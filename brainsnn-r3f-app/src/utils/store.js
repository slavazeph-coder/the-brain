/**
 * Unified persistence layer — IndexedDB-backed, localStorage fallback.
 *
 * Today BrainSNN stores 30+ collections in localStorage (`brainsnn_*_v1`
 * keys), which hits the 5–10 MB browser quota once the user grows their
 * archive / receipts / embeddings cache. This module is the destination
 * for the migration plan in §10.3.
 *
 * API stays intentionally small so any caller (panel, util, worker via
 * BroadcastChannel hop) can read/write without ceremony:
 *
 *   import { openStore } from './store.js';
 *   const archive = openStore('archive');
 *   await archive.set('scan-42', { ts: Date.now(), pressure: 0.7 });
 *   const row = await archive.get('scan-42');
 *   const rows = await archive.values({ limit: 200 });
 *
 * Collections are created lazily on first `openStore(name)`. New
 * collections trigger a DB version bump on next open — this is handled
 * transparently via a re-open path so callers never see a versionchange
 * error.
 *
 * Fallback: if IndexedDB is unavailable (e.g. private mode + Safari),
 * each collection transparently falls back to a namespaced localStorage
 * key prefix (`brainsnn_store/<collection>/<id>`).
 */

const DB_NAME = 'brainsnn';
let dbPromise = null;
const collections = new Set();

function idbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(neededCollections) {
  return new Promise((resolve, reject) => {
    // Bump version when a collection is missing; otherwise keep current.
    const probe = indexedDB.open(DB_NAME);
    probe.onsuccess = () => {
      const db = probe.result;
      const haveAll = neededCollections.every((c) => db.objectStoreNames.contains(c));
      if (haveAll) { resolve(db); return; }
      const nextVersion = db.version + 1;
      db.close();
      const upgrade = indexedDB.open(DB_NAME, nextVersion);
      upgrade.onupgradeneeded = (e) => {
        const target = e.target.result;
        for (const c of neededCollections) {
          if (!target.objectStoreNames.contains(c)) {
            target.createObjectStore(c);
          }
        }
      };
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
    };
    probe.onerror = () => reject(probe.error);
  });
}

async function getDb() {
  if (!idbAvailable()) return null;
  if (!dbPromise) {
    dbPromise = openDb(Array.from(collections));
  } else if (collections.size > 0) {
    const db = await dbPromise;
    const missing = Array.from(collections).filter((c) => !db.objectStoreNames.contains(c));
    if (missing.length) {
      dbPromise = openDb(Array.from(collections));
    }
  }
  return dbPromise;
}

function lsKey(collection, id) {
  return `brainsnn_store/${collection}/${id}`;
}

function lsCollection(collection) {
  const prefix = `brainsnn_store/${collection}/`;
  return {
    async get(id) {
      try { return JSON.parse(localStorage.getItem(lsKey(collection, id)) || 'null'); }
      catch { return null; }
    },
    async set(id, value) {
      try { localStorage.setItem(lsKey(collection, id), JSON.stringify(value)); }
      catch { /* quota — silently drop */ }
    },
    async delete(id) {
      localStorage.removeItem(lsKey(collection, id));
    },
    async keys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out;
    },
    async values({ limit } = {}) {
      const keys = await this.keys();
      const slice = typeof limit === 'number' ? keys.slice(0, limit) : keys;
      return Promise.all(slice.map((k) => this.get(k)));
    },
    async clear() {
      const keys = await this.keys();
      for (const k of keys) localStorage.removeItem(lsKey(collection, k));
    }
  };
}

export function openStore(collection) {
  collections.add(collection);
  if (!idbAvailable()) return lsCollection(collection);

  return {
    async get(id) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(collection, 'readonly');
        const req = tx.objectStore(collection).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(id, value) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(collection, 'readwrite');
        const req = tx.objectStore(collection).put(value, id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async delete(id) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(collection, 'readwrite');
        const req = tx.objectStore(collection).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async keys() {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(collection, 'readonly');
        const req = tx.objectStore(collection).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async values({ limit } = {}) {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(collection, 'readonly');
        const req = tx.objectStore(collection).getAll(undefined, limit);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async clear() {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(collection, 'readwrite');
        const req = tx.objectStore(collection).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  };
}

/**
 * Estimate total IDB+localStorage usage. Surfaces in the Privacy Budget
 * panel (Layer 86) once it's wired to this store.
 */
export async function storageEstimate() {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try { return await navigator.storage.estimate(); } catch { /* noop */ }
  }
  return { usage: 0, quota: 0 };
}
