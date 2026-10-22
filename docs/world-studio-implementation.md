# BrainSNN World Builder: implementation and validation

Development branch: `feature/world-builder-flagship`. This is a working development build, not a deployed or fully qualified real-to-sim product. The full objective remains in [the flagship specification](world-builder-flagship.md).

## What works now

The flagship homepage preserves the near-black, cyan and violet identity and uses the requested headline. `/` and `/world` embed the local workspace; `/?classic=1`, Arena and research routes remain accessible. The frame now fits short landscape screens. The same-site [API guide](../brainsnn-r3f-app/public/world/api.html) describes private operator-provisioned access and its limits.

A selected photo can run Depth Anything V2 Small on-device after explicit approval to download the runtime and model. It produces an explorable relative-depth point cloud, with source comparison, cancellation, binary PLY export and provenance. It does not create unseen surfaces, establish metric scale or create collision geometry. Model files are downloaded; the source image is not uploaded. The model is pinned to `onnx-community/depth-anything-v2-small@4472b7362082ad9968fee890ca0f1e5aca36b93d`, q8, whose model card declares Apache-2.0. This is distinct from the still-unqualified Lyra pipeline.

The first-party viewer handles bounded PLY and SPLAT files, classifying ordinary points separately from Gaussian parameters. It displays up to 100,000 uniformly sampled points, uses DC colour for Gaussian assets, and supports touch orbit/pan/zoom and keyboard controls. GLB remains available in the separate same-site asset viewer using the existing Arena loader with synthetic floor and robot objects disabled. SPZ and KSPLAT require conversion. No remote rendering code is needed to view local assets.

The private worker performs authenticated resumable uploads, explicit job preparation/start, status polling, cancellation, retention and short-lived artifact downloads. Completed PLY/SPLAT outputs can load directly in the workspace after bounded streaming and SHA-256 verification. Real COLMAP CPU reconstruction now processes overlapping photos or decoded video into sparse points and camera poses. It is not dense reconstruction or verified collision geometry. See [the reconstruction report](world-reconstruction-validation.md) for actual evidence and the bounded MapAnything GPU qualification.

An optional private tenant registry maps random credential hashes to server-owned identities, engine allowlists and upload/job/storage allowances. Every API record and download ticket is owner-bound; the legacy operator identity cannot read tenant jobs through HTTP. Removing or rotating credentials revokes access and tickets, and queued work rechecks authorization. Existing data migrates only to the reserved operator owner. The registry is not public signup, metered compute or process isolation: adapters still share the worker's service account and filesystem.

RoomPlan CapturedRoom JSON and existing BrainSNN Arena maps import through the established Arena parser. World Builder preserves the floor polygon, including concave and rotated floors; it never fills the capture's bounding rectangle with traversable space. Imported scale and geometry require renewed review. Polygon dimensions are locked in this interface to prevent accidental distortion. The planner uses conservative robot envelopes and keeps unknown regions blocked. Arena export preserves the polygon; static USDA export currently rejects nonrectangular floors explicitly.

The World panel also records independent distance readings, uncertainty, instrument/date and floor/start/object review decisions in a local worksheet. Its canonical geometry SHA-256 binds records to the exact map. Edits mark prior evidence stale; imports reset it to reference-only. Proof export snapshots the map, assumptions, sources, events and optional worksheet before asynchronous hashing. These self-reported records do not change geometry, planning approval or reconstructed-artifact metric flags.

The optional local vision-model adapter accepts one photo or a bounded MP4/MOV video, strips derivative metadata, and submits up to four 512-pixel frames to the operator’s loopback model server. It requests a strict response schema and checks the returned model alias. Generation is limited to six concise, partial frame-bound labels within 1,024 output tokens; box generation remains unqualified and is disabled. Outputs retain original/source-frame SHA-256, exact decoded video PTS/time base, uncertainty text and model/prompt provenance. The import/review format also validates optional normalized 2D boxes from earlier evidence. A separately verified frame index binds the proposals to the displayed PNG bytes. The Understand panel supports accept, edit and reject without changing map objects, scale or geometry review. Pending edits survive navigation but enter proof exports only after explicit review. Empty model output does not prove free space. Model revisions are operator-declared, not remotely attested signatures.

## Verified on October 19, 2026

- Production build and the existing app regression suite: 1,083 checks plus 73 paid-analysis tests passed.
- World core/import/viewer/client/observation/capture/measurement tests: 75 passed.
- Actual HTTP desktop and phone-sized Chromium and WebKit tests passed, including root iframe routing, landscape sizing, keyboard tabs, Classic/Lab/Arena links, RoomPlan import/review/planning/export, file boundaries and provenance.
- Real photograph inference passed in both Chromium and WebKit, with cancel/retry, source comparison and proof export. Captured request traces contain only GET/HEAD requests and no request bodies for the on-device inference journey. One observed Mac run produced 98,304 points in 2.1 seconds of inference; this is not an iPhone or end-to-end latency guarantee.
- PLY/SPLAT parser and WebGL rendering tests passed. GLB rendering, external-resource rejection, and clearing all synthetic geometry passed in desktop/mobile Chromium and WebKit.
- The separate real browser-to-worker journey also passed: 11 photo uploads, COLMAP execution, signed artifact retrieval, embedded viewing, binary PLY export and a provenance proof pack.
- Actual MapAnything Apache GPU runs produced 72,125 points from one photograph, 86,593 from three, 98,735 from eleven and 98,345 from a photograph-sequence MP4. Peak allocation stayed below 5.9 GiB. Actual outputs rendered in Chromium and phone-sized WebKit; production LLM health remained normal under the trial watchdog. These bounded trials do not qualify physical phone captures, geometric accuracy or collision surfaces.
- Actual local vision-model runs on GB10 produced one selected photo label in 8.1 seconds and four frame-bound video labels in 26.3 seconds. Exact artifacts replayed in Chromium and WebKit with unchanged source/frame/timestamp provenance and all reviews pending. The video is a photograph-sequence fixture, not a phone walkthrough; labels remain partial and unverified. Earlier schema, timeout and box failures are preserved in the reconstruction report.
- A separate HTTP observation test passed in Chromium and WebKit using distinct scoped credentials for the two browsers, the real worker, media decoder and CLI connected to an explicitly synthetic local VLM fixture. Each credential sees only its granted engine; the operator HTTP identity cannot list either tenant’s jobs. It checks upload consent, verified PNG evidence, inert model text, accept/edit/reject, draft persistence, proof export and source removal while keeping map geometry/review flags unchanged. Additional regressions cover a delayed connection response after session clearing and a stalled artifact stream; neither may restore cleared credentials or wait indefinitely. This test does not claim model inference.
- The complete default World backend suite now passes 127 tests with two optional COLMAP dataset skips, including 29 tenant regressions. They cover foreign-ID routes, mixed-owner inputs, migration/restart, credential/ticket rotation and revocation, delayed-body admission, lowered quotas, concurrent reservations and legacy operator behavior. The private browser observation flow also passed using distinct scoped credentials for Chromium and WebKit.
- Worker tests: 46 passed with the real fixture, including actual 11-photo and decoded-video COLMAP jobs through upload, processing and signed artifact downloads. The default CI run passes 44 tests and skips the two dataset-dependent qualification cases. The separate observation backend suite passes 54 tests covering actual media decoding, exact source PTS, bounded HTTP, constrained response validation and model identity. Its transport responses are fixtures. See the reconstruction report for actual GPU/model execution and fixture limitations.

At commit `c82e2baa81701f704cc53af327d0565d8c8f8e2d`, direct logs show clean completion of all eight hosted jobs, including [World contracts](https://github.com/slavazeph-coder/the-brain/actions/runs/39280409824) at 15:48:15 UTC and [Arena contracts](https://github.com/slavazeph-coder/the-brain/actions/runs/39280409732) at 15:54:03 UTC. The GitHub summary API still reported queued jobs when these completed logs were inspected. World passed 75 Node and 127 Python checks with two explicit dataset skips, the production build and both browser engines. Arena passed its native inspector, actual worker/UI tests and regenerated worker ZIP drift gate. This evidence applies to that exact commit.

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

The [World Builder contracts workflow](../.github/workflows/world-builder-checks.yml) runs on relevant pull requests and is a prerequisite of the existing Railway deployment workflow. It runs `npm run test:world`, pinned CPU worker tests (including real FFmpeg decoding and COLMAP failure handling), a production build, HTTP Chromium/WebKit workspace tests standalone PLY/GLB rendering tests, and the complete observation worker/review contract. CI does not download model weights. Its separate observation review contract test uses an explicitly named local response fixture; no live model output or quality is claimed. Python Playwright 1.64.0 installs the browser binaries; both Python and npm test drivers use those explicit executables, avoiding a second incompatible browser download. Root and standalone World Builder markers, Classic pricing and Arena pricing are also checked by the deployment boot/live gates. Workflow validation and local execution of its boot and browser commands passed. The [GitHub-hosted World contracts run](https://github.com/slavazeph-coder/the-brain/actions/runs/39268374210) also passed on Ubuntu 24.04 at commit `715ce8b14e2e278ba656e62d562e6f643f94c8d0`: all 37 Node contracts, 44 worker tests (two explicit fixture-dependent skips), the production build and both browser suites. The [observation follow-up run](https://github.com/slavazeph-coder/the-brain/actions/runs/39274565591) passed at `f905006cb12413b6c5bb2725ac364d682a2da515`: 56 Node contracts, 97 Python tests (two dataset-dependent skips), the production build, desktop/mobile HTTP flows and the separate observation-worker review regression in Chromium and WebKit.

A separate browser-to-worker reconstruction test starts disposable local HTTP servers and requires real overlapping photographs plus installed COLMAP:

```sh
WORLD_COLMAP_TEST_CAPTURE=/absolute/path/to/permitted-overlapping-photos \
  WORLD_COLMAP_PYTHON=/absolute/path/to/colmap-venv/bin/python \
  WORLD_SERVER_PYTHON=/absolute/path/to/python-with-fastapi-and-uvicorn \
  python tests/world/worker_browser_smoke.py
```

For the observation HTTP contract (fixture model response, real worker and UI):

```sh
WORLD_BROWSERS=chromium,webkit python tests/world/observations_browser_smoke.py
```

`WORLD_SERVER_PYTHON` and `WORLD_OBSERVATIONS_PYTHON` can select separate installed environments. Both default to the test interpreter.

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

The observation adapter additionally needs `requirements-observations.txt` (Pillow and PyAV), FFmpeg/FFprobe, and an already running local image-capable model server. Enable the example engine only after qualification. Supply these through the private worker service environment:

```sh
export WORLD_VLM_ENABLED=1
export WORLD_VLM_BASE_URL=http://127.0.0.1:11435/v1
export WORLD_VLM_MODEL=qwen3.8:27b
# Optional, only after checking the installed checkpoint:
export WORLD_VLM_REVISION=482ca0f3832238542f8f5295dde86b5f22711d80
```

`WORLD_VLM_API_KEY` is optional for a local server that requires it; it is never sent to the browser. The adapter accepts loopback HTTP only and has no proxy, redirect, retry or hosted-provider fallback. MP4/MOV decoding supports the bounded Arena software H.264, HEVC, MPEG-4 and libdav1d AV1 decoders. Synthetic 8-bit SDR HEVC passed exact-timestamp and native pixel-limit tests on Mac and GB10 CPU; HDR, display orientation and physical-phone behavior remain unqualified. WebM observation inputs require prior compatible conversion; they are not silently transcoded with invented source timestamps. Remote worker upload consent remains separate from local depth-model download consent.

Adapters receive bounded local files and write a validated manifest. They cannot accept browser-supplied executable commands or arbitrary output paths. API outputs keep `metric_verified:false`. The process boundary is not a complete host sandbox: run reviewed executables under a non-root service account with an external disk quota and resource limits. Never log short-lived download ticket URLs. Authentication supports legacy operator access and optional provisioned tenant credentials; it does not provide public account registration or qualified process isolation.

### Report receipts (signed verification)

Report signing is optional and disabled unless `WORLD_REPORT_SIGNING_KEY` names an existing absolute path outside `WORLD_WORKER_DIR` to a 32-byte Ed25519 private key in a mode-0600 regular file. Creating the key pair requires `robotics/world_worker/requirements-report-receipts.txt` (pinned `cryptography`); a configured worker fails startup when the dependency, key bytes, permissions, or location are invalid. Never reuse an authentication or ticket credential as the signing key.

Generate the pair once with the module CLI:

```sh
python -m robotics.world_worker.report_receipts init-key \
  --private-key /operator-secrets/world-report-key \
  --public-key /operator-secrets/world-report-key.pub
```

`init-key` refuses existing paths and never prints private bytes; it prints the public key document (`brainsnn.world.report-key.v1`: `algorithm`, `keyId`, base64url `publicKey`). The only unauthenticated worker endpoint, `GET /v1/report-key`, returns that same public key document; it discloses no private material and is 503 while signing is disabled.

A completed job's authenticated principal can request `POST /v1/jobs/{id}/report-receipt` with the job's exact artifact names and SHA-256 digests plus an owner-declared scenario hash. The worker re-hashes only the selected artifacts (256 MiB total cap, one-hash-task slot, 429 while another verification runs, 409 for missing or changed evidence, 504 past its time budget), re-authenticates and re-checks job evidence after the IO, then signs a canonical-JSON `brainsnn.world.report-receipt.v1` payload as a `brainsnn.world.signed-report-receipt.v1` envelope (Ed25519 over schema domain + payload bytes). Signed receipts are limited to 64 KiB and always keep `metricVerified`, `policyExecuted`, `safetyCertified` and `independentHostAttestation` false; they authenticate worker-verified bytes and the exact scenario hash only, not measurements, model truth, or host independence.

Verification uses an independently trusted public key and the exact local scenario file:

```sh
python -m robotics.world_worker.report_receipts verify \
  --receipt receipt.json --trusted-public-key key.json --scenario scenario.json
```

Exit 0 prints `verified:true`; exit 2 means the key fingerprint, signature, schema, byte limits, or scenario bytes were rejected. `GET /v1/capabilities` exposes `reportSigning.available/algorithm/keyId` so clients can discover support without the unauthenticated endpoint.

## Browser recording qualification

The capture controller owns each permission request and stream independently. Cancelling a pending request, clearing the session, leaving the page or hiding it prevents a late permission result from restarting capture. Recorder errors, empty output and the byte limit discard partial files. Normal stop, the 90-second limit and track interruption release the camera and retain a completed recording. The recorder selects MP4; browsers without native MP4 recording use the native-camera upload fallback instead of producing a worker-incompatible WebM recording.

Seven lifecycle contracts and HTTP Chromium/WebKit permission fixtures passed. Both local Mac browser engines also recorded an actual animated 128×96 canvas as H.264 MP4; independent PyAV decoding found seven frames with increasing original timestamps in each file. Hosted Linux WebKit reported native MP4 recording unavailable. A separate unsupported-codec UI case verifies that Record opens the native-camera file chooser without starting a camera request or recorder. These are synthetic browser recordings and permission fixtures, not camera or physical-phone evidence. Receipts are under ignored `output/playwright/world/capture/`. The regression entry point is `tests/world/capture_browser_smoke.py` and is included in hosted World checks.

The [generative qualification review](world-generative-qualification.md) records the Lyra 1 commercial-use candidate, Lyra 2 production restriction, checkpoint/dependency terms and unresolved GB10 port/resource gates. Neither Lyra version has run here.

## Full objective still open

These are release requirements, not optional polish:

1. Extend the successful bounded reference-photo and photograph-sequence GPU trials to actual indoor phone walkthroughs, establish reconstruction quality and qualify service scheduling. Qualify the chosen generative world model and checkpoint licenses separately. Lyra has not run here.
2. Build public signup/session verification and API-key issuance, qualified process/storage isolation, metered compute limits, durable object storage/queueing and billing authorization. Private API ownership checks and per-owner admission limits are implemented; public hosted processing remains disabled. On-device photo processing needs no account.
3. Test physical iPhone Safari camera permissions, recording/codecs, interruptions and upload fallback on real device captures. Phone-sized WebKit is not that evidence.
4. Complete the geometry handoff from reconstructed camera/point evidence to proposed floor/obstacles, independent scale confirmation and robot-specific motion constraints. Sparse visual points are not a substitute for collision surfaces.
5. Benchmark the connected video-language observation adapter on target captures, including omissions and incorrect labels. Frame/time provenance and human review are implemented; uncertainty text is not a calibrated confidence score. Qualify localization before enabling model-generated boxes. Extend supported phone codecs with preserved source timing before claiming broad capture compatibility.
6. Validate one measured gym with one cleaner, compare predicted clearances/routes/time against a supervised physical run, and calibrate editable operating assumptions. Current planning is conservative planar traversal, not robot dynamics, optimized cleaning or a learned policy.
7. Add authenticated report signatures and scenario evidence linkage. Current SHA-256 export detects byte changes and explicitly does not authenticate authorship.
8. Finish production privacy/retention/access checks, then release and verify the real public domain, app/API journeys and rollback. This branch has not been merged or deployed.

The original app remains at `/?classic=1`. Reverting the WorldHome selection in `src/App.tsx` restores the earlier homepage. Existing Arena and production credentials are preserved.
