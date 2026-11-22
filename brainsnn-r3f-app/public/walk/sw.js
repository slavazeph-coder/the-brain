// Offline shell for BrainSNN Walk. Walks themselves live in IndexedDB, never here.
// Bump CACHE whenever SHELL changes so phones drop the old copy.
const CACHE = 'brainsnn-walk-v1';
const SHELL = [
  './', './index.html', './walk.mjs', './walk-core.mjs', './walk-zip.mjs', './walk-store.mjs', './walk-map.mjs', './walk.css',
  './manifest.webmanifest', '../world/capture-handoff.mjs',
  '../world/icons/mark.svg', '../world/icons/icon-192.png', '../world/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('brainsnn-walk-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' && url.pathname.startsWith('/walk/')) {
    // Fresh page when online, the cached shell when not.
    event.respondWith(fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(hit => hit || fetch(request)));
});
