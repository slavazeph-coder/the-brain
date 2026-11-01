// World Builder shell worker. Network first, cache as an offline fallback for the app shell only.
// Models, worker-API calls, uploads and cross-origin requests are never cached: fresh code and
// fresh evidence always win; the cache only lets an installed app open without a connection.
const CACHE = 'world-shell-building-sandbox-v10';
const SHELL = ['./index.html', './world.css', './app.mjs', './sandbox-ui.mjs', './sandbox-session.mjs', './core.mjs', './catalog.mjs', './renderer.mjs', './hero-demo.mjs', './photo-locator.mjs', './visual-viewer.mjs',
  './visual-geometry.mjs', './worker-client.mjs', './artifact-review.mjs', './depth-client.mjs', './depth-worker.mjs', './import-world.mjs', './observation-ui.mjs', './observations.mjs',
  './dimension-review.mjs', './bim-workflow-ui.mjs', './omniverse-ui.mjs', './foothold-focus.mjs', './foothold-ui.mjs', './measurement-ui.mjs', './measurement-evidence.mjs', './planner-worker.mjs', './capture-client.mjs', './capture-handoff.mjs', './reconstruction-recovery.mjs', './native-capture.mjs', './reconstruction-map.mjs',
  './detections.mjs', './detect-client.mjs', './detect-worker.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', '../arena/site-core.js'];
// The module graph imports one file outside /world/ (RoomPlan/Arena import); without it the shell cannot start offline.
const SHARED = ['/arena/site-core.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // In production /world/ is the outer site shell, whose bundles live outside this cache: never store it, and open the
  // World document instead when offline.
  if (e.request.method === 'GET' && url.origin === location.origin && url.pathname === '/world/') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html'))); return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin || !(url.pathname.startsWith('/world/') || SHARED.includes(url.pathname))) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
