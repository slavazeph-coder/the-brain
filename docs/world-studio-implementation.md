# BrainSNN World Studio: implementation and handoff

## Release scope

This is an implemented **operator beta**, not a claim that every model in the system catalog is integrated. The flagship UI replaces `/` and `/world` through an isolated iframe. The original application is retained at `/?classic=1`; existing Arena, research and other routes are unchanged. The standalone page is `/world/index.html` and requires an HTTP(S) server, not file://.

The original palette is preserved: background #06060a, cyan #00f5ff, violet #a855f7, text #f1f1f6. The app includes a responsive capture/review/test workspace, local image and video references, bounded browser camera recording, object editing, conservative robot-envelope planning in a background worker, route replay, baseline comparison, editable time/cost assumptions, capture-linked human observations, JSON evidence exports, native Arena-map export and static OpenUSD collision proxies. Uploaded/imported maps require renewed scale and geometry review. Generated maps cannot receive reviewed status through the interface.

A searchable 22-system catalog distinguishes local tools, implemented worker/loader interfaces, planned integrations and license/resource-gated candidates. It is not a list of 22 active AI engines.

## Exact readiness

| Component | Implemented | Validated in this delivery |
|---|---|---|
| Local world editor and planning | Yes | Node tests plus desktop/mobile Chromium interaction tests |
| Browser camera and native-camera fallback | Yes | Code inspected; physical iPhone capture still requires testing |
| CPU integrity worker | Yes | Real request/upload/job/artifact cycle tested without AI |
| Auth, resumable upload, cancellation, retention, ticket downloads | Yes | Automated API tests, including real subprocess cancellation and a 70 MiB sparse-artifact range read |
| Spark / Three.js visual viewer | Loader implemented with pinned external scripts | Source/API reviewed; external renderer execution not tested here |
| Depth Anything V2 Small adapter | Real model-loading/inference code, disabled by default | Numerical lifting tested; actual weights and inference were not available |
| Lyra, Image2Splat, MapAnything, video LLM, SAM 2 | Catalog and extension contract | Not installed or executed by this build |
| Fleet simulation, robot hardware, billing/team platform | Planned | Not implemented or advertised as active |

Do not call this a validated photo-to-robot pipeline until a real model and one real site have passed acceptance. A point cloud is not a trained Gaussian splat; a splat is not collision geometry. The local route is a bounded, contiguous depth-first grid traversal with a circumscribed circular footprint, not optimized cleaning, contact dynamics, humanoid balance or a learned policy. Area is navigable centre-grid area, not cleaning quality. Time/cost and help allowances are explicit assumptions, not measured performance.

## Frontend preview

From the repository root:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory brainsnn-r3f-app/public
```

Open `http://127.0.0.1:8765/world/index.html`. No account, model or paid API call is needed for the authored sample and reviewed-map planning tools. Full site integration uses the repository's existing build:

```sh
cd brainsnn-r3f-app
npm ci
npm run build
npm test
```

The original full-site build was not executed in the delivery container because external dependency/repository access was unavailable. Run it in the repository's normal CI or deployment environment before merging to production. The iframe wrapper is deliberately small; no existing server routes or package dependencies were rewritten.

## Worker setup

Use one worker process behind TLS, with a persistent writable data directory. Do not share the operator token with public visitors, put it in a `VITE_` variable, or commit it. This is not tenant-isolated public processing.

```sh
python -m venv .venv-world
. .venv-world/bin/activate
python -m pip install -r robotics/world_worker/requirements.txt
export WORLD_WORKER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export WORLD_WORKER_DIR="$PWD/world-worker-data"
export WORLD_ALLOWED_ORIGINS="http://127.0.0.1:8765,https://www.brainsnn.com,https://brainsnn.com"
python -m uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port 8010 --workers 1
```

Use an HTTPS reverse proxy for a remote deployment. Configure request timeouts and per-IP throttling at the edge, a disk quota and a non-root service account. The worker does not replace a host/container sandbox. Only operator-reviewed executables can be adapters. Its executable configuration is trusted administrative input and never accepted from the browser.

In World Studio, choose Capture → Connect processing worker; supply the base URL and token. The token stays in page memory. `/v1/capabilities` advertises only configured engines. Start with **Capture integrity (no AI)**, select a real image, explicitly approve its destination and run a job. Confirm the returned SHA-256 receipt and download before enabling any model.

The request flow is:

1. Create an upload with filename, supported kind and declared byte size.
2. PUT chunks with explicit offsets; query the offset to resume. Browser resumption is within the same session and selected File object, not across reloads.
3. Create a **prepared** job with explicit consent. It does not execute until its ID is received and `/start` is called.
4. Poll status, cancel if necessary, and download artifacts with a short-lived signed ticket. The operator bearer token never enters the download URL.

The server enforces 200 MiB per input, 4 MiB chunks, 2 GiB reserved uploads, 50 upload records, 50 jobs, queue length 8, one executing job, per-adapter time limits, 4 GiB job-output budget, 3 GiB individual artifacts and 24-hour retention. The browser preview limit is intentionally smaller than artifact download limits. Binary downloads use the browser's normal download path and range-capable FileResponse, not multi-gigabyte JavaScript buffers. Download tickets are bearer capabilities valid for 60 seconds; do not log or share them.

Only the operator can upload, inspect job metadata, cancel or delete data. `/healthz` is public and exposes no customer artifacts. There are no user-supplied URLs, executable commands or arbitrary output paths. Inputs receive signature checks; adapter manifests reject symlinks, unsafe names and oversized files. Jobs interrupted by restart are marked failed rather than silently replayed.

## Enabling the first real depth adapter

Install the Apache-2.0 `depth-anything/Depth-Anything-V2-Small-hf` snapshot into an immutable local directory after reviewing and recording its exact revision and model licence. Use a separate GPU/ML virtual environment with compatible pinned torch, transformers, safetensors, Pillow and NumPy versions; this delivery does not invent an untested GPU dependency lock.

Edit the absolute Python/script paths in `robotics/world_worker/adapters.example.json`, set `WORLD_DEPTH_MODEL_DIR` to the pinned snapshot, and point `WORLD_ADAPTERS_FILE` at the edited configuration. Only after rights and hardware checks should `enabled` and `license_reviewed` become true. No model download happens automatically. The adapter uses local files, `trust_remote_code=False` and safetensors, and receives no operator token.

Its output is an unscaled, at-most-256-by-256 coloured point cloud plus an evidence sidecar. It assumes a 60-degree horizontal field of view and a relative depth convention; these are visualization assumptions, not measured camera calibration or metres. Open the resulting PLY in a compatible point-cloud viewer. Do not claim a trained splat or robotic clearance result from it.

## Other engine integration contract

A trusted executable receives `--input-manifest` pointing to a `brainsnn.adapter.v1` JSON document with bounded local input paths and an output directory. It writes `manifest.json` with an `artifacts` array of safe filenames and kinds. The API validates the outputs, hashes the bytes and returns `metric_verified:false`. New models must retain that state until independent geometry review; they must not generate successful test outcomes when inference fails.

Primary sources checked for the proposed stack:

- NVIDIA Lyra: https://github.com/nv-tlabs/lyra . Source code and checkpoint licences are separate. Benchmark actual model/runtime on the available GPU; no 24 GB compatibility promise is made.
- Image2Splat: https://github.com/romanpillai/Image2Splat . The workflow includes paid fal.ai video generation and separate Brush splat training. Its upstream unauthenticated local server must not be exposed directly. No paid call is wired by this delivery.
- MapAnything: https://github.com/facebookresearch/map-anything . Select the appropriate Apache checkpoint, not the default noncommercial checkpoint, for a commercial integration.
- Spark: https://sparkjs.dev/docs/loading-splats/ . Viewer pins Three.js 0.180.0 and Spark 2.1.0; third-party scripts load only after a user clicks the loader. Audit/vendor them before an enterprise production rollout.
- Depth Anything V2 Small: https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf . Relative depth is not independently measured metric geometry.
- Video grounding: https://github.com/QwenLM/Qwen3-VL . The user's existing video-model endpoint and benchmarks are still needed before connecting it.
- Segmentation: https://github.com/facebookresearch/sam2 . Cross-frame masks do not by themselves provide an editable physical scene.

## Tests and remaining release gates

Executed successfully in the delivery environment: **15 Node core tests and 13 Python worker tests**. Chromium desktop (1440×1000) and phone-sized (390×844) interaction tests also passed. JavaScript modules passed syntax checks.

The browser environment prohibited HTTP navigation and lacked WebKit. The recorded browser tests therefore used the documented `WORLD_OFFLINE=1` harness: the real source and CSS were loaded into an offline page, a real classic Blob worker ran the same planner, and a test-only SHA bridge supplied cryptographic hashing. Node independently tested native WebCrypto. This establishes UI/algorithm behavior, not production module loading, real Safari camera access or external CDN rendering. No claim of real GPU inference or physical robot validation is made.

```sh
node --test tests/world/core.test.mjs
python -m pip install pytest httpx pillow numpy playwright
python -m pytest tests/world/test_worker.py -q
# With the HTTP preview server running and browser binaries installed:
python -m playwright install chromium webkit
WORLD_BROWSERS=chromium,webkit python tests/world/browser_smoke.py
```

Before production: run the existing full-site build and regressions; test root iframe routing and classic/Arena links on the deployed server; test actual iPhone Safari capture and module workers; run a real input through each enabled model; open resulting splats on target devices; compare a measured gym map and supervised robot trial against predicted clearances/time. Public uploads additionally require tenant authentication, per-user storage/compute budgets, abuse controls and billing authorization.

## Rollback

The original homepage remains available at `/?classic=1`. A code rollback only needs to restore `brainsnn-r3f-app/src/App.tsx` to render `AppShell` unconditionally; standalone `/world/index.html` can remain a development preview. No existing Arena files, original data or production secrets are modified by this change set.
