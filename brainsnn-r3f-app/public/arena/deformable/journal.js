// Full recordings stay on this device. An unavailable/full store is explicit;
// it must never turn a completed simulation into a claim of retained evidence.
const DB_NAME = 'brainsnn.deformable.v1';
let connection;

export async function openJournal() {
  if (connection) return connection;
  if (!globalThis.indexedDB) throw new Error('Local recording storage is unavailable.');
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('episodes')) db.createObjectStore('episodes', { keyPath: 'evidenceId' });
      if (!db.objectStoreNames.contains('campaigns')) db.createObjectStore('campaigns', { keyPath: 'journalId' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('Local recording storage could not open.'));
    request.onblocked = () => reject(new Error('Close older rope-strike tabs before opening recording storage.'));
  });
  return connection;
}

export async function putRecord(store, value) {
  const db = await openJournal();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('Recording storage failed. Export the retained run before continuing.'));
    transaction.onabort = () => reject(new Error('Recording storage is full or unavailable.'));
  });
}

export async function getRecord(store, key) {
  const db = await openJournal();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error('The saved recording could not be read.'));
  });
}
