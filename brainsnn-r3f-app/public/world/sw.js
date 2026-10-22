// World Builder shell worker. Network first, cache as an offline fallback for the app shell only.
// Models, worker-API calls, uploads and cross-origin requests are never cached: fresh code and
// fresh evidence always win; the cache only lets an installed app open without a connection.
const CACHE = 'world-shell-v2';
const SHELL = ['./', './index.html', './world.css', './app.mjs', './core.mjs', './catalog.mjs', './renderer.mjs', './visual-viewer.mjs',
  './visual-geometry.mjs', './worker-client.mjs', './depth-client.mjs', './depth-worker.mjs', './import-world.mjs', './observation-ui.mjs', './observations.mjs',
  './measurement-ui.mjs', './measurement-evidence.mjs', './planner-worker.mjs', './capture-client.mjs', './reconstruction-map.mjs',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', '../arena/site-core.js'];
// Shared Arena modules World imports (site-core, site-renderer) live under /arena/ but belong to this shell.
const inScope = p => p.startsWith('/world/') || /^\/arena\/site-(core|renderer)\.js$/.test(p);
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !inScope(url.pathname)) return;
  // ignoreVary: the app server sends `Vary: Origin`, which would otherwise hide every cached module from a same-origin match.
  const cached = () => caches.match(e.request, { ignoreSearch: true, ignoreVary: true });
  e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
    .catch(() => cached().then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./index.html', { ignoreVary: true }) : Response.error()))));
});
