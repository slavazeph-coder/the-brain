// Same-origin, short-lived capture transfer between /scan and the World Builder document.
// IndexedDB stores portable bytes rather than a File object (WebKit cannot reliably clone Files).
// Media is never sent to a worker by the handoff.
export const HANDOFF_TTL_MS = 20 * 60 * 1000;
// A bounded browser copy avoids huge ArrayBuffer allocations on memory-limited phones.
// Larger videos remain selectable directly within World Builder (up to the worker's own limits).
export const HANDOFF_MAX_BYTES = 128 * 1024 * 1024;
const DB_NAME = 'brainsnn-capture-handoff-v1';
const STORE = 'captures';
const MAX_BYTES = 2 * 1024 ** 3;
const VALID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOALS = new Set(['play', 'room', 'bim', 'robot']);

export function parseHandoffHash(hash = '') {
  const prefix = '#handoff=';
  const id = hash.startsWith(prefix) ? hash.slice(prefix.length) : '';
  return VALID_ID.test(id) ? id : null;
}

export function validateCaptureFiles(input) {
  const files = Array.from(input ?? []);
  if (!files.length || files.length > 8) throw new Error('Choose one video or up to eight photos first.');
  const video = file => /^video\//.test(file.type ?? '') || /\.(mp4|mov|webm)$/i.test(file.name ?? '');
  const image = file => /^image\//.test(file.type ?? '') || /\.(jpe?g|png|webp)$/i.test(file.name ?? '');
  if (!files.every(file => file && typeof file.name === 'string' && Number.isFinite(file.size) && file.size > 0 && (video(file) || image(file))))
    throw new Error('Choose non-empty MP4, MOV, WebM, JPEG, PNG or WebP files.');
  if (files.some(video) && (files.length !== 1 || !video(files[0])))
    throw new Error('Use one video at a time, or up to eight photos.');
  if (files.some(file => video(file) ? file.size > MAX_BYTES : file.size > 200 * 1024 ** 2))
    throw new Error('Videos can be up to 2 GiB; each photo can be up to 200 MiB.');
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES)
    throw new Error('The local handoff is limited to 2 GiB total.');
  return files;
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Local browser storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Local storage is not responding.')); } }, 12000);
    const fail = message => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(message)); };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('expiresAt', 'expiresAt');
      }
    };
    request.onsuccess = () => { if (settled) { request.result.close(); return; } settled = true; clearTimeout(timer); resolve(request.result); };
    request.onerror = () => fail('Local storage could not open.');
    request.onblocked = () => fail('Another tab is blocking local storage. Close it and try again.');
  });
}

function transaction(db, mode, perform) {
  return new Promise((resolve, reject) => {
    let value;
    let tx;
    try {
      tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || new Error('Local storage transaction failed.'));
      tx.onabort = () => reject(tx.error || new Error('Local storage transaction was cancelled.'));
      perform(tx.objectStore(STORE), result => { value = result; });
    } catch (error) { reject(error); }
  });
}

async function withDatabase(callback) {
  const db = await openDatabase();
  try { return await callback(db); }
  finally { db.close(); }
}

const indexedDbStore = {
  put: record => withDatabase(db => transaction(db, 'readwrite', store => { store.put(record); })),
  get: id => withDatabase(db => transaction(db, 'readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result || null);
  })),
  delete: id => withDatabase(db => transaction(db, 'readwrite', store => { store.delete(id); })),
  prune: now => withDatabase(db => transaction(db, 'readwrite', store => {
    const request = store.index('expiresAt').openCursor(IDBKeyRange.upperBound(now));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
  })),
};

export async function stageLocalCapture(input, { goal = 'room', store = indexedDbStore, now = Date.now(), makeId = () => globalThis.crypto.randomUUID() } = {}) {
  const files = validateCaptureFiles(input);
  const size = files.reduce((sum, file) => sum + file.size, 0);
  if (size > HANDOFF_MAX_BYTES) throw new Error('Private handoff supports up to 128 MiB. Use Open without transfer for a larger video; the worker still supports its normal capture limits.');
  if (!GOALS.has(goal)) throw new Error('Choose a supported activity.');
  const id = makeId();
  if (!VALID_ID.test(id)) throw new Error('Could not create a secure local transfer identifier.');
  if (store === indexedDbStore && globalThis.navigator?.storage?.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (Number.isFinite(quota) && Number.isFinite(usage) && quota - usage < size * 1.05)
        throw new Error('This browser does not have enough local space for a private handoff.');
    } catch (error) {
      if (error.message.includes('not have enough')) throw error;
      // Storage estimates can be unavailable; IndexedDB remains the authority.
    }
  }
  await store.prune?.(now);
  // WebKit's IndexedDB File/Blob structured cloning can abort a transaction.
  // Store byte buffers plus verified metadata; never save source filenames in the URL.
  const encoded = store === indexedDbStore
    ? await Promise.all(files.map(async file => ({
        name: file.name, type: file.type || '', size: file.size,
        lastModified: Number.isFinite(file.lastModified) ? file.lastModified : now,
        bytes: await file.arrayBuffer(),
      })))
    : files;
  await store.put({ id, version: store === indexedDbStore ? 2 : 1, goal, createdAt: now, expiresAt: now + HANDOFF_TTL_MS, files: encoded });
  return id;
}

export async function readLocalCapture(id, { store = indexedDbStore, now = Date.now() } = {}) {
  if (!VALID_ID.test(id ?? '')) return null;
  const record = await store.get(id);
  if (!record) return null;
  if (![1, 2].includes(record.version) || record.id !== id || !(record.expiresAt > now) || !GOALS.has(record.goal)) {
    await store.delete(id);
    return null;
  }
  try {
    if (record.version === 2) {
      if (!Array.isArray(record.files) || record.files.some(file => !(file.bytes instanceof ArrayBuffer) || file.bytes.byteLength !== file.size))
        throw new Error('Invalid local file bytes.');
      const reconstructed = record.files.map(file => new File([file.bytes], file.name, {
        type: file.type, lastModified: file.lastModified,
      }));
      validateCaptureFiles(reconstructed);
      return { ...record, files: reconstructed };
    }
    validateCaptureFiles(record.files);
    return record;
  } catch { await store.delete(id); return null; }
}

export async function clearLocalCapture(id, { store = indexedDbStore } = {}) {
  if (VALID_ID.test(id ?? '')) await store.delete(id);
}
