# BrainSNN World Builder: implementation and validation

Development branch: `feature/world-builder-flagship`. This is a working development build, not a deployed or fully qualified real-to-sim product. The full objective remains in [the flagship specification](world-builder-flagship.md).

## What works now

The flagship homepage preserves the near-black, cyan and violet identity and uses the requested headline. `/` and `/world` embed the local workspace; `/?classic=1`, Arena and research routes remain accessible. The frame now fits short landscape screens. The same-site [API guide](../brainsnn-r3f-app/public/world/api.html) describes the private operator API and its limits.

A selected photo can run Depth Anything V2 Small on-device after explicit approval to download the runtime and model. It produces an explorable relative-depth point cloud, with source comparison, cancellation, binary PLY export and provenance. It does not create unseen surfaces, establish metric scale or create collision geometry. Model files are downloaded; the source image is not uploaded. The model is pinned to `onnx-community/depth-anything-v2-small@4472b7362082ad9968fee890ca0f1e5aca36b93d`, q8, whose model card declares Apache-2.0. This is distinct from the still-unqualified Lyra pipeline.

The first-party viewer handles bounded PLY and SPLAT files, classifying ordinary points separately from Gaussian parameters. It displays up to 100,000 uniformly sampled points, uses DC colour for Gaussian assets, and supports touch orbit/pan/zoom and keyboard controls. GLB remains available in the separate same-site asset viewer using the existing Arena loader with synthetic floor and robot objects disabled. SPZ and KSPLAT require conversion. No remote rendering code is needed to view local assets.

The private worker performs authenticated resumable uploads, explicit job preparation/start, status polling, cancellation, retention and short-lived artifact downloads. Completed PLY/SPLAT outputs can load directly in the workspace after bounded streaming and SHA-256 verification. Real COLMAP CPU reconstruction now processes overlapping photos or decoded video into sparse points and camera poses. It is not dense reconstruction or verified collision geometry. See [the reconstruction report](world-reconstruction-validation.md) for actual evidence and the bounded MapAnything GPU qualification.

RoomPlan CapturedRoom JSON and existing BrainSNN Arena maps import through the established Arena parser. World Builder preserves the floor polygon, including concave and rotated floors; it never fills the capture's bounding rectangle with traversable space. Imported scale and geometry require renewed review. Polygon dimensions are locked in this interface to prevent accidental distortion. The planner uses conservative robot envelopes and keeps unknown regions blocked. Arena export preserves the polygon; static USDA export currently rejects nonrectangular floors explicitly.

## Verified on October 19, 2026

- Production build and the existing app regression suite: 1,083 checks plus 73 paid-analysis tests passed.
- World core/import/viewer/client tests: 37 passed.
- Actual HTTP desktop and phone-sized Chromium and WebKit tests passed, including root iframe routing, landscape sizing, keyboard tabs, Classic/Lab/Arena links, RoomPlan import/review/planning/export, file boundaries and provenance.
- Real photograph inference passed in both Chromium and WebKit, with cancel/retry, source comparison and proof export. Captured request traces contain only GET/HEAD requests and no request bodies for the on-device inference journey. One observed Mac run produced 98,304 points in 2.1 seconds of inference; this is not an iPhone or end-to-end latency guarantee.
- PLY/SPLAT parser and WebGL rendering tests passed. GLB rendering, external-resource rejection, and clearing all synthetic geometry passed in desktop/mobile Chromium and WebKit.
- The separate real browser-to-worker journey also passed: 11 photo uploads, COLMAP execution, signed artifact retrieval, embedded viewing, binary PLY export and a provenance proof pack.
- Worker tests: 46 passed with the real fixture, including actual 11-photo and decoded-video COLMAP jobs through upload, processing and signed artifact downloads. The default CI run passes 44 tests and skips the two dataset-dependent qualification cases. See the reconstruction report for revisions and fixture limitations.

Screenshots, proof packs and network records are local under `output/playwright/world/` (not committed customer/media assets). Browser tests now require real HTTP. The previous offline HTML/module-rewrite harness was removed; it did not establish real module loading or Safari behavior.

### Safari runtime correction

The initially selected ONNX Runtime JSEP build crashed WebKit during real inference, including without cancellation. The depth worker now explicitly selects the matching plain WASM module and binary from ONNX Runtime `1.22.0-dev.20250409-89f8206ba4`. The complete real-inference tests then passed with the unchanged model. This follows the independently reproduced failure described in [ONNX Runtime issue 26827](https://github.com/microsoft/onnxruntime/issues/26827). It does not replace testing on physical iPhones.

The runtime remains pinned to Transformers.js 3.8.1. Each inference disposes its pipeline and terminates its worker; cancellation terminates the worker immediately. Image decoding and display geometry are bounded. The downloaded weights may remain in the browser's model cache.

## Reproduce

From the repository root, serve the standalone workspace:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory brainsnn-r3f-app/public
node --test tests/world/*.test.mjs
```

Open `http://127.0.0.1:8765/world/index.html`. The authored sample and map editor need no model downloads. Photo inference requests approval before contacting the model/runtime hosts.

For the integrated build:

```sh
cd brainsnn-r3f-app
npm ci
npm run build
npm test
NODE_ENV=production PORT=4181 node dist/server.cjs
```

Browser regression dependencies are Playwright and Pillow in a disposable Python environment, plus Playwright Chromium/WebKit binaries. `PLAYWRIGHT_CHROMIUM_PATH` optionally selects an installed browser. JavaScript viewer tests use `PLAYWRIGHT_WEBKIT_PATH` if the locally installed WebKit revision differs from the app's Playwright dependency.

```sh
WORLD_BROWSERS=chromium,webkit WORLD_URL=http://127.0.0.1:4181/ \
  WORLD_SITE_URL=http://127.0.0.1:4181 \
  WORLD_PHOTO=/absolute/path/to/a/permitted-real-photo.jpg \
  python tests/world/browser_smoke.py
WORLD_BROWSERS=chromium,webkit node tests/world/visual-browser-smoke.mjs
```

`WORLD_PHOTO` opts into a real model download/inference test. It is never replaced with mocked model output. The GPU adapter likewise is not considered qualified from its CPU conversion fixtures.

The [World Builder contracts workflow](../.github/workflows/world-builder-checks.yml) runs on relevant pull requests and is a prerequisite of the existing Railway deployment workflow. It runs `npm run test:world`, pinned CPU worker tests (including real FFmpeg decoding and COLMAP failure handling), a production build, HTTP Chromium/WebKit workspace tests and standalone PLY/GLB rendering tests. CI does not download model weights or substitute inference results. Python Playwright 1.64.0 installs the browser binaries; both Python and npm test drivers use those explicit executables, avoiding a second incompatible browser download. Root and standalone World Builder markers, Classic pricing and Arena pricing are also checked by the deployment boot/live gates. Workflow validation and local execution of its boot and browser commands passed. The [GitHub-hosted World contracts run](https://github.com/slavazeph-coder/the-brain/actions/runs/39268374210) also passed on Ubuntu 24.04 at commit `715ce8b14e2e278ba656e62d562e6f643f94c8d0`: all 37 Node contracts, 44 worker tests (two explicit fixture-dependent skips), the production build and both browser suites.

A separate browser-to-worker reconstruction test starts disposable local HTTP servers and requires real overlapping photographs plus installed COLMAP:

```sh
WORLD_COLMAP_TEST_CAPTURE=/absolute/path/to/permitted-overlapping-photos \
  WORLD_COLMAP_PYTHON=/absolute/path/to/colmap-venv/bin/python \
  WORLD_SERVER_PYTHON=/absolute/path/to/python-with-fastapi-and-uvicorn \
  python tests/world/worker_browser_smoke.py
```

## Worker operation

Use one worker behind TLS with persistent storage and an operator-owned token. Do not put it in public JavaScript or a VITE variable. Install `robotics/world_worker/requirements.txt`, configure reviewed adapters from `adapters.example.json`, then start:

```sh
# Supply WORLD_WORKER_TOKEN through your private service environment.
export WORLD_WORKER_DIR="$PWD/world-worker-data"
export WORLD_ALLOWED_ORIGINS="http://127.0.0.1:8765,https://www.brainsnn.com,https://brainsnn.com"
python -m uvicorn robotics.world_worker.app:create_app --factory \
  --host 127.0.0.1 --port 8010 --workers 1 --no-access-log
```

Connect with Capture → Process a walkthrough / use an API worker. Explicitly approve uploads to the displayed destination. `/v1/capabilities` advertises only available configured engines. Start with `inspect` for an integrity-only receipt. Enable an AI or reconstruction adapter only after its installation, licensing and hardware checks. Example engines are disabled by default.

Adapters receive bounded local files and write a validated manifest. They cannot accept browser-supplied executable commands or arbitrary output paths. API outputs keep `metric_verified:false`. The process boundary is not a complete host sandbox: run reviewed executables under a non-root service account with an external disk quota and resource limits. Never log short-lived download ticket URLs. Authentication is single-operator, not per-tenant.

## Full objective still open

These are release requirements, not optional polish:

1. Extend the successful one/three-photo dense GPU trial to bounded video and larger captures, then establish reconstruction quality and service scheduling. Qualify the chosen generative world model and checkpoint licenses separately. Lyra has not run here.
2. Build public tenant authentication, storage isolation, per-user upload/compute limits, durable object storage/queueing and appropriate billing authorization. Current on-device photo processing needs no account; the remote worker is private.
3. Test physical iPhone Safari camera permissions, recording/codecs, interruptions and upload fallback on real device captures. Phone-sized WebKit is not that evidence.
4. Complete the geometry handoff from reconstructed camera/point evidence to proposed floor/obstacles, independent scale confirmation and robot-specific motion constraints. Sparse visual points are not a substitute for collision surfaces.
5. Connect video-language annotations with frame/time/bbox/confidence provenance and human review. The current Understand panel records human observations only.
6. Validate one measured gym with one cleaner, compare predicted clearances/routes/time against a supervised physical run, and calibrate editable operating assumptions. Current planning is conservative planar traversal, not robot dynamics, optimized cleaning or a learned policy.
7. Add authenticated report signatures and scenario evidence linkage. Current SHA-256 export detects byte changes and explicitly does not authenticate authorship.
8. Finish production privacy/retention/access checks, then release and verify the real public domain, app/API journeys and rollback. This branch has not been merged or deployed.

The original app remains at `/?classic=1`. Reverting the WorldHome selection in `src/App.tsx` restores the earlier homepage. Existing Arena and production credentials are preserved.
