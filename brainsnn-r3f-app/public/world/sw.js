// World Builder shell worker. Network first, cache as an offline fallback for the app shell only.
// Remote models, worker-API calls, uploads and cross-origin requests are never cached: fresh code and
// fresh evidence always win; the cache only stores the app shell and its bundled authored example.
const CACHE = 'world-shell-studio-showroom-v46';
const SHELL = ['./index.html', './world.css', './app.mjs', './sandbox-ui.mjs', './sandbox-session.mjs', './core.mjs', './catalog.mjs', './renderer.mjs', './hero-demo.mjs', './playground-help.mjs', './playground-icons.mjs', './playground-controls.mjs', './robot-setup.mjs', './unified-workspace-ui.mjs', './scene-workspace.mjs', './workspace-results.mjs', './drawing-review-ui.mjs', './drawing-review.css', './world-layer-tools.mjs', './world-layer-tools.css', './layer-preview.mjs', './layer-job-client.mjs', './biomechanics-tool.mjs', './biomechanics-preview.mjs', './camera-calibration-tool.mjs', './camera-calibration-data.mjs', './examples/camera-calibration/camera-setup.toml', './examples/camera-calibration/example-walk.trc', './examples/biomechanics/authored-pendulum.osim', './examples/biomechanics/authored-motion.mot', './examples/biomechanics/kinematics-options.json', './photo-locator.mjs', './share-video.mjs', './demo-replay-ui.mjs', './review-questions.mjs', './visual-viewer.mjs',
  './recorded-views.mjs', './recorded-views-ui.mjs', './sense-trial.html', './sense-trial-ui.mjs', './sense-trial.css', './sense-trial-worker.mjs', './sense-room.mjs', './sense-policy.mjs',
  './showroom-walk.mjs', './showroom-walk-ui.mjs', './showroom-walk-appearance.mjs', './assets/showroom-depth.mjs', './showroom-entry.mjs', './showroom-page.mjs', './showroom-view.mjs', './showroom-model.mjs', './showroom-view.css', './showroom-host.css',
  './assets/sense-cart-amber.jpg', './assets/sense-cart-teal.jpg', './assets/sense-cart-purple.jpg', './assets/sense-cart-white.jpg',
  './assets/showroom-views.mjs', './assets/showroom-camera-1.jpg', './assets/showroom-camera-2.jpg', './assets/showroom-camera-3.jpg',
  './robot-task-panel.mjs', './robot-task-authoring.mjs', './robot-task-physics.mjs', './robot-task-worker.mjs', './robot-task.css',
  './showcase.mjs', './showcase.css', './showcase-features.mjs', './studio.mjs', './studio.css', './media/showcase-poster.jpg', './media/showcase-captions.vtt',
  './splat.html', './splat.mjs', './mesh-viewer.mjs', './scan-workspace.mjs', './scan-workshop.css', './scan-examples.mjs',
  './objectify-region.mjs', './portable-object.mjs', './portable-object-ui.mjs', './splat-lamp.mjs', './splat-lamp.css',
  './stereo-export.mjs', './stereo-export-data.mjs', './stereo-depth-data.mjs', './stereo-depth-tool.mjs', './stereo-photo.mjs',
  './examples/stereo/left.png', './examples/stereo/right.png', './examples/stereo/calibration.json',
  './open4dgs-tool.mjs', './open4dgs-data.mjs', './open4dgs-player.mjs', './open4dgs-trigs.mjs', './open4d-capture.mjs', './open4d-capture.css',
  './examples/open4dgs/export_meta.json', ...Array.from({length: 16}, (_, i) => './examples/open4dgs/frame_' + String(i).padStart(6, '0') + '.ply'),
  './visual-geometry.mjs', './worker-client.mjs', './artifact-review.mjs', './depth-client.mjs', './depth-worker.mjs', './import-world.mjs', './observation-ui.mjs', './observations.mjs',
  './dimension-review.mjs', './bim-workflow-ui.mjs', './facility-review.mjs', './facility-review-ui.mjs', './facility-review.css', './operational-twin.mjs', './operational-twin-ui.mjs', './operational-twin-view.mjs', './operational-twin.css', './asbuilt-core.mjs', './asbuilt-ui.mjs', './asbuilt-hosted-ui.mjs', './asbuilt-worker.mjs', './asbuilt.css', './omniverse-ui.mjs', './fragments-ui.mjs', './foothold-focus.mjs', './foothold-ui.mjs', './measurement-ui.mjs', './measurement-evidence.mjs', './planner-worker.mjs', './capture-client.mjs', './video-metadata.mjs', './capture-handoff.mjs', './reconstruction-recovery.mjs', './reconstruction-frame-audit.mjs', './native-capture.mjs', './reconstruction-map.mjs', './what-if.mjs', './route-receipt.mjs', './capture-report.mjs', './capture-path.mjs',
  './detections.mjs', './detect-client.mjs', './detect-worker.mjs', './surface-review-ui.mjs', './camera-path.mjs', './camera-tour-ui.mjs', './camera-tour-video.mjs', './objectify-core.mjs', './objectify-ui.mjs', './objectify.css',
  './project-review.mjs', './project-review-ui.mjs', './project-review.css', './review-page.mjs', './review.html',
  '../arena/site-renderer.js',
  './projects.html', './projects.css', './projects-ui.mjs', './projects-client.mjs', './projects-sha256.mjs', './projects-api.openapi.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', '../arena/site-core.js'];
// The module graph imports one file outside /world/ (RoomPlan/Arena import); without it the shell cannot start offline.
const TASK_RUNTIME = [
  '/arena/deformable/rope-physics.js', '/arena/deformable/vendor/mujoco.js', '/arena/deformable/vendor/mujoco.wasm', '/world/vendor/robot-task-zip.mjs', '/world/vendor/robot-task-3d.mjs',
];
const SHARED = ['/arena/site-core.js', '/arena/site-renderer.js'];
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
  if (e.request.method === 'GET' && url.origin === location.origin && TASK_RUNTIME.includes(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(e.request);
        if (response.status === 200 && !response.headers.get('Content-Type')?.includes('text/html')) {
          await cache.put(e.request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return (await cache.match(e.request)) || Response.error();
      }
    })());
    return;
  }
  // The optional film streams directly so browsers can use native byte-range requests.
  if (['/world/media/world-builder-showcase.mp4', '/world/media/robot-task-comparison.mp4'].includes(url.pathname)) return;
  // In production /world/ is the outer site shell, whose bundles live outside this cache: never store it, and open the
  // World document instead when offline.
  if (e.request.method === 'GET' && url.origin === location.origin && url.pathname === '/world/') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html'))); return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin || !(url.pathname.startsWith('/world/') || SHARED.includes(url.pathname))) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
