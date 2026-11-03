# Meshlets Lab

Optional standalone `/lab/meshlets/` experiment in the existing website. The
homepage's More menu and Lab index link to it. It loads its own npm-locked
`three-meshlets` alias at **Three.js 0.187.0**, bundled and served locally. The
main R3F/capture stack stays on its existing r182 dependency. No CDN, Lucy model,
research weights or arbitrary remote scan URLs are requested by the lab.

## What it does

- WebGPU meshlet and standard pipelines render the same deterministic procedural
  brain field. Choose 25 to 10,000 shared-geometry instances and about 24k or 98k
  source triangles per instance. Source counts are computed, never hard-coded as
  performance results. These are repeated procedural meshes, not unique scans,
  cognitive layers or executed simulations.
  The GPU field uses individual meshes in a static BundleGroup, following the
  original upstream meshes example; source identity is deterministic-mesh-grid-v2.
- Cluster colouring, occlusion and projected pixel-error controls use the actual
  experimental `MeshletDrawingPipeline`. r187's utility uses **64-triangle**
  clusters, including padding. Its asynchronous counters describe its own draws;
  unsupported objects/materials fall through to the regular pipeline.
- A fixed-view measurement warms up for two seconds, then records ten seconds of
  foreground animation-frame intervals, median, p95 and average frame cadence.
  The downloadable receipt includes raw samples, viewport, browser, camera,
  preparation time, settings, source and scope. No GPU execution duration or
  60 FPS guarantee is inferred. Resizing/hiding the page interrupts measurement.
- WebGL fallback caps procedural count at 100 with lower-detail geometry. Its
  reduced load is disclosed and cannot be presented as a matched-load benchmark.
  Feature detection is per browser/adapter, not an assumption about Safari.
- A local self-contained GLB can be previewed without upload, with source SHA-256
  and object names retained. Limit: 40 MiB, 2M mesh triangles, 2,000 nodes and no
  required extensions, skinning or morph targets. External resource references
  are rejected before GLTFLoader runs. Display recentering/uniform normalization
  is recorded and never establishes metric scale. Animated assets and compressed
  extensions need separate qualification.

The meshlet pipeline is experimental and has material/geometry restrictions.
Transparent, double-sided or otherwise unsupported materials may use regular
draws. This experiment does not accelerate point clouds or Gaussian splats,
complete missing camera geometry, update BIM files or validate robot collisions.
Original GLB bytes, IFC/Rhino exports and planning geometry are never modified.

## Reproduce

```sh
cd brainsnn-r3f-app
npm ci --no-audit --no-fund
npm run build
NODE_ENV=production PORT=4180 node dist/server.cjs
# Open http://127.0.0.1:4180/lab/meshlets/
```

The build assembles an isolated runtime manifest with SHA-256 values and the
upstream MIT license. The static route preserves query strings on its canonical
redirect, sends missing assets as 404, and never serves the SPA for a missing lab
script. Changes require rebuilding; generated runtime files do not belong in git.

```sh
npm run lint
npm test
npx playwright install --with-deps chromium
node scripts/test-meshlets-browser.mjs
# On a workstation with native Vulkan drivers and an actual visible GPU:
MESHLETS_GPU_BACKEND=native node scripts/test-meshlets-browser.mjs
# For an installed system Chromium, including a GB10 ARM64 workstation:
MESHLETS_CHROMIUM_PATH=/usr/bin/chromium MESHLETS_GPU_BACKEND=native node scripts/test-meshlets-browser.mjs
```

`Meshlets lab browsers` exercises the built production server, desktop/phone-sized
WebGL canvases, feature-unavailable fallback, exact local GLB identity, downloaded
receipts, actual WebGPU meshlets and cluster debugging, then a matched-load
standard run. Hosted WebGPU uses **software Vulkan/SwiftShader**, not GB10/RTX
4090 hardware. Test-only browser flags are never instructions to disable security
in a customer's browser. CI snapshots/receipts use authored geometry only.

## Current negative qualification result

Hosted Chromium/WebGL rendered desktop and phone-sized views, loaded the exact
authored local GLB and downloaded correct source-hash/cadence receipts. A tiny
native r187 meshlet control produced 16 clusters / 1,024 drawn (padded) triangles.
However, both a native 25-object instanced control and a native 25-mesh/static
control using shared approximately 24k-triangle spheres lost their WebGPU device
on SwiftShader, with `Device was destroyed` and cancelled `popErrorScope` work.
The native controls run independently of our app. This does not identify the
ultimate driver/library cause and does not prove the app would pass on hardware.
The strict GPU qualification remains failed; do not release or market this lab as
a validated dense-mesh renderer from the WebGL passes or tiny control alone.

Renderer cleanup now awaits r187's asynchronous disposal. The default CI uses
software Vulkan; `MESHLETS_GPU_BACKEND=native` requests the native adapter instead.
Neither that variable nor a passing requestAdapter proves RTX/GB10 execution.
Retain actual adapter/browser information, strict GPU result, source and receipts.
The runner saves `adapter-info.json`; use the actual installed Chromium path when
the bundled browser does not support the workstation architecture.
No performance figures from the reel are reproduced.

## Next hardware experiment

On the available RTX 4090 or GB10 desktop browser, open the same GLB and compare
meshlet and standard modes with the same viewport/camera/settings. Retain both
receipts and source hash. Suggested acceptance target: at least 30 measured FPS
and no missing visible surfaces on the chosen scene; report p95 and visual misses
even if the target fails. Estimate: 1–2 hours, no model/API charge, existing GPU
electricity only. Main blocker: an accessible WebGPU-capable physical browser
and representative complete geometry. This is a rendering target, not physical
accuracy qualification. Mobile hardware and native BIM imports remain separate.

Primary sources checked November 2, 2026:

- [r187 release, October 30](https://github.com/mrdoob/three.js/releases/tag/r187)
- [Official meshlet meshes example](https://github.com/mrdoob/three.js/blob/r187/examples/webgpu_meshlets_meshes.html)
- [Official instanced example](https://github.com/mrdoob/three.js/blob/r187/examples/webgpu_meshlets_instanced.html)
- [Pipeline and restrictions](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/pipelines/MeshletDrawingPipeline.js)
- [64-triangle meshlet utility and LOD generation](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/utils/MeshletGeometryUtils.js)
- [Chrome headless WebGPU testing](https://developer.chrome.com/blog/supercharge-web-ai-testing)
