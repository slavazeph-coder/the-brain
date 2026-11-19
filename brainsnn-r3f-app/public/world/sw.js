// World Builder shell worker. Network first, cache as an offline fallback for the app shell only.
// Remote models, worker-API calls, uploads and cross-origin requests are never cached: fresh code and
// fresh evidence always win; the cache only stores the app shell and its bundled authored example.
const CACHE = 'world-shell-camera-review-v32';
const SHELL = ['./index.html', './world.css', './app.mjs', './sandbox-ui.mjs', './sandbox-session.mjs', './core.mjs', './catalog.mjs', './renderer.mjs', './hero-demo.mjs', './playground-help.mjs', './unified-workspace-ui.mjs', './scene-workspace.mjs', './workspace-results.mjs', './drawing-review-ui.mjs', './drawing-review.css', './world-layer-tools.mjs', './world-layer-tools.css', './layer-preview.mjs', './layer-job-client.mjs', './biomechanics-tool.mjs', './biomechanics-preview.mjs', './camera-calibration-tool.mjs', './camera-calibration-data.mjs', './examples/camera-calibration/camera-setup.toml', './examples/camera-calibration/example-walk.trc', './examples/biomechanics/authored-pendulum.osim', './examples/biomechanics/authored-motion.mot', './examples/biomechanics/kinematics-options.json', './photo-locator.mjs', './share-video.mjs', './demo-replay-ui.mjs', './review-questions.mjs', './visual-viewer.mjs',
  './visual-geometry.mjs', './worker-client.mjs', './artifact-review.mjs', './depth-client.mjs', './depth-worker.mjs', './import-world.mjs', './observation-ui.mjs', './observations.mjs',
  './dimension-review.mjs', './bim-workflow-ui.mjs', './facility-review.mjs', './facility-review-ui.mjs', './facility-review.css', './operational-twin.mjs', './operational-twin-ui.mjs', './operational-twin-view.mjs', './operational-twin.css', './asbuilt-core.mjs', './asbuilt-ui.mjs', './asbuilt-hosted-ui.mjs', './asbuilt-worker.mjs', './asbuilt.css', './omniverse-ui.mjs', './fragments-ui.mjs', './foothold-focus.mjs', './foothold-ui.mjs', './measurement-ui.mjs', './measurement-evidence.mjs', './planner-worker.mjs', './capture-client.mjs', './video-metadata.mjs', './capture-handoff.mjs', './reconstruction-recovery.mjs', './reconstruction-frame-audit.mjs', './native-capture.mjs', './reconstruction-map.mjs', './what-if.mjs', './route-receipt.mjs', './capture-report.mjs', './capture-path.mjs',
  './detections.mjs', './detect-client.mjs', './detect-worker.mjs', './surface-review-ui.mjs', './camera-path.mjs', './camera-tour-ui.mjs', './camera-tour-video.mjs', './objectify-core.mjs', './objectify-ui.mjs', './objectify.css',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', '../arena/site-core.js'];
// The module graph imports one file outside /world/ (RoomPlan/Arena import); without it the shell cannot start offline.
const SHARED = ['/arena/site-core.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldShells = keys.filter(key => key.startsWith('world-shell-') && key !== CACHE);
    await Promise.all(oldShells.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
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
