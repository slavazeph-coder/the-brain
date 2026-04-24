/**
 * Layer 91 — BrainSNN Service Worker
 *
 * Minimal offline shell: cache the app shell on install, network-first
 * for API routes, cache-first for hashed asset files.
 *
 * Versioned cache key — bumping CACHE_VERSION on release invalidates
 * old shells without needing a separate cache-busting scheme.
 */

const CACHE_VERSION = 'brainsnn-v1';
const SHELL_URLS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/r/') ||
         url.pathname.startsWith('/i/') || url.pathname.startsWith('/q/') ||
         url.pathname.startsWith('/a/') || url.pathname.startsWith('/d/') ||
         url.pathname.startsWith('/x/') || url.pathname.startsWith('/t/') ||
         url.pathname.startsWith('/n/') || url.pathname.startsWith('/v/') ||
         url.pathname.startsWith('/w/') || url.pathname.startsWith('/b/');
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // API / dynamic routes — network first, no cache (we want fresh
  // scores and OG images).
  if (isApi(url)) {
    event.respondWith(fetch(event.request).catch(() => new Response('offline', { status: 503 })));
    return;
  }

  // Hashed assets → cache first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((hit) => {
        if (hit) return hit;
        return fetch(event.request).then((resp) => {
          if (!resp || resp.status !== 200) return resp;
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone)).catch(() => {});
          return resp;
        });
      }),
    );
    return;
  }

  // SPA shell — network first, fall back to cached index.html for
  // offline navigations.
  event.respondWith(
    fetch(event.request).then((resp) => {
      if (resp && resp.status === 200 && url.pathname === '/') {
        const clone = resp.clone();
        caches.open(CACHE_VERSION).then((c) => c.put('/', clone)).catch(() => {});
      }
      return resp;
    }).catch(() => caches.match('/index.html').then((hit) => hit || new Response('offline', { status: 503 }))),
  );
});
