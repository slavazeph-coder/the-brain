// Walks live in this browser only, in IndexedDB. Media is stored as byte
// buffers rather than Blob/File objects: WebKit can abort a transaction while
// cloning large Blobs, and bytes behave the same in every engine.

const DB_NAME = 'brainsnn-walks-v1';
const WALKS = 'walks';
const FILES = 'files';

function open(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return Promise.reject(new Error('This browser cannot store walks (no IndexedDB). Try Safari or Chrome outside private mode.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    const timer = setTimeout(() => reject(new Error('Walk storage is not responding. Close other BrainSNN tabs and try again.')), 12000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WALKS)) db.createObjectStore(WALKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'key' }).createIndex('walkId', 'walkId');
    };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(new Error('Walk storage could not open. Private browsing can block it.')); };
    request.onblocked = () => { clearTimeout(timer); reject(new Error('Another tab is upgrading walk storage. Close it and try again.')); };
  });
}

function run(db, stores, mode, perform) {
  return new Promise((resolve, reject) => {
    let result;
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error?.name === 'QuotaExceededError' ? new Error('This phone is out of space for walks. Delete an old walk or export and remove its video.') : new Error('Walk storage failed.'));
    tx.onabort = tx.onerror;
    const request = perform(tx);
    if (request) request.onsuccess = () => { result = request.result; };
  });
}

export function createWalkStore({ indexedDB } = {}) {
  let pending = null;
  const db = () => (pending ??= open(indexedDB).catch(error => { pending = null; throw error; }));
  return {
    async list() {
      const walks = await run(await db(), [WALKS], 'readonly', tx => tx.objectStore(WALKS).getAll());
      return (walks ?? []).sort((a, b) => b.startedAt - a.startedAt);
    },
    async get(id) { return run(await db(), [WALKS], 'readonly', tx => tx.objectStore(WALKS).get(id)); },
    async put(walk) { await run(await db(), [WALKS], 'readwrite', tx => tx.objectStore(WALKS).put(walk)); return walk; },
    async putFile(walkId, name, blob) {
      const bytes = await blob.arrayBuffer();
      await run(await db(), [FILES], 'readwrite', tx => tx.objectStore(FILES).put({ key: `${walkId}/${name}`, walkId, name, type: blob.type || '', bytes }));
    },
    async getFile(walkId, name) {
      const record = await run(await db(), [FILES], 'readonly', tx => tx.objectStore(FILES).get(`${walkId}/${name}`));
      return record ? new Blob([record.bytes], { type: record.type }) : null;
    },
    async deleteFile(walkId, name) { await run(await db(), [FILES], 'readwrite', tx => tx.objectStore(FILES).delete(`${walkId}/${name}`)); },
    async remove(walkId) {
      await run(await db(), [WALKS, FILES], 'readwrite', tx => {
        tx.objectStore(WALKS).delete(walkId);
        const index = tx.objectStore(FILES).index('walkId');
        const cursor = index.openKeyCursor(IDBKeyRange.only(walkId));
        cursor.onsuccess = () => { const c = cursor.result; if (c) { tx.objectStore(FILES).delete(c.primaryKey); c.continue(); } };
      });
    },
  };
}

/** Ask the browser to keep walks when space runs low. Harmless if refused. */
export async function askToKeepWalks() {
  try { return await globalThis.navigator?.storage?.persist?.() ?? false; } catch { return false; }
}
