/**
 * Layer 91 — BrainSNN Service Worker (Beast #11: offline-first + sync queue)
 *
 * Strategy:
 *   - SHELL precache on install (root + index.html + manifest)
 *   - Hashed /assets/* cache-first with stale-while-revalidate update
 *   - Workspace chunks fetch + cache lazily on first hit so every
 *     workspace works offline after one visit
 *   - API + dynamic share routes network-first, but POST/PUT/DELETE
 *     get enqueued via Background Sync when offline
 *   - SPA navigation falls back to cached index.html
 *   - Skip-waiting + clients.claim so updates take effect on next nav
 */

const CACHE_VERSION = 'brainsnn-v2';
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest'];
const QUEUE_TAG = 'brainsnn-write-queue';
const QUEUE_DB = 'brainsnn-sw';
const QUEUE_STORE = 'queue';

// ---------- precache ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(PRECACHE_URLS))
      .catch(() => { /* offline first-install — fine */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---------- helpers ----------
function isApi(url) {
  return url.pathname.startsWith('/api/') ||
         /^\/[rqidaxntvwb]\//.test(url.pathname);
}

function isAsset(url) {
  return url.pathname.startsWith('/assets/');
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request);
  const fetchPromise = fetch(request).then((resp) => {
    if (resp && resp.status === 200) cache.put(request, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => hit);
  return hit || fetchPromise;
}

// ---------- IDB for background sync queue ----------
function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function enqueueRequest(request) {
  try {
    const db = await openQueueDb();
    const body = await request.clone().text();
    const entry = {
      url: request.url,
      method: request.method,
      headers: Array.from(request.headers.entries()),
      body,
      ts: Date.now()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      const req = tx.objectStore(QUEUE_STORE).add(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    if ('sync' in self.registration) {
      try { await self.registration.sync.register(QUEUE_TAG); } catch { /* noop */ }
    }
  } catch { /* swallow — degrade gracefully */ }
}

async function replayQueue() {
  const db = await openQueueDb();
  const entries = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  for (const entry of entries) {
    try {
      const headers = new Headers(entry.headers);
      const resp = await fetch(entry.url, { method: entry.method, headers, body: entry.body });
      if (resp.ok) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(QUEUE_STORE, 'readwrite');
          const req = tx.objectStore(QUEUE_STORE).delete(entry.id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    } catch {
      // Still offline / server unreachable — keep entry for next sync.
      break;
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === QUEUE_TAG) event.waitUntil(replayQueue());
});

// ---------- fetch routing ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Non-GET to known API routes → queue if offline.
  if (request.method !== 'GET' && isApi(url)) {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        await enqueueRequest(request);
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  if (request.method !== 'GET') return;

  // API reads — network first; cache the last response so /a/<hash>
  // share cards still render offline.
  if (isApi(url)) {
    event.respondWith(
      fetch(request).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(request).then((hit) => hit || new Response('offline', { status: 503 })))
    );
    return;
  }

  // Hashed assets → stale-while-revalidate so updated chunks land
  // on the next reload without a hard refresh.
  if (isAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // SPA navigation — network first, cached index.html offline fallback.
  event.respondWith(
    fetch(request).then((resp) => {
      if (resp && resp.status === 200 && url.pathname === '/') {
        const clone = resp.clone();
        caches.open(CACHE_VERSION).then((c) => c.put('/', clone)).catch(() => {});
      }
      return resp;
    }).catch(() => caches.match('/index.html').then((hit) => hit || new Response('offline', { status: 503 })))
  );
});

// ---------- messaging (main thread → SW) ----------
self.addEventListener('message', (event) => {
  if (event.data?.type === 'skipWaiting') self.skipWaiting();
  if (event.data?.type === 'replayNow') event.waitUntil(replayQueue());
});
