---
type: project
description: World Builder flagship development, real browser inference and reconstruction evidence; full public real-to-sim release still open
---

# World Builder — October 19, 2026

- Branch `feature/world-builder-flagship`, PR198; working tree `/Users/slavaz/the-brain-world-builder`. Preserve other branches/worktrees. No merge or deployment from this session.
- Root and `/world` use the cyan/violet flagship workspace. Classic remains `/?classic=1`, Arena `/arena/`. Exact requested hero leads; API guide `/world/api.html` describes private operator API only.
- Photo→Depth Anything V2 Small q8→local explorable point cloud works in actual HTTP Chromium and WebKit. Source pixels never uploaded on this path. Model/runtime downloads require product consent. Pin `onnx-community/depth-anything-v2-small@4472b7362082ad9968fee890ca0f1e5aca36b93d`, Transformers.js3.8.1, ONNX1.22.0-dev.20250409-89f8206ba4.
- **WebKit fix:** default JSEP/Asyncify WASM crashed during inference. Explicit matching plain-WASM mjs/binary paths fix observed failure (ORT#26827). Full cancel/retry/source comparison and download-only network checks pass. Phone-sized WebKit is not physical iPhone evidence.
- Local PLY/SPLAT viewer distinguishes points from Gaussian parameters, bounds input64MiB / display100kpoints, supports touch/keyboard. GLB50MiB via existing same-site Arena renderer with visualOnly option, no authored robot/floor. SPZ/KSPLAT conversion required.
- COLMAP CPU adapter really reconstructed11ETH Fountain photos:6041points,11cameras; decoded photograph-sequence MP4:6225points. Worker API tests and full browser→upload→reconstruct→signed ticket→viewer→binary export pass. The MP4 is a test fixture, not a physical phone walkthrough.
- RoomPlan/Arena import reuses existing Arena parser and preserves original concave/rotated floor polygon. Review flags reset. Planner blocks outside-floor and unknown space; exports preserve polygon; USDA rejects unsupported nonrectangles.
- MapAnything Apache adapter pins source, DINO source, model/config hashes and blocks inference-time network. Actual GB10 one/three-photo runs produced 72,125/86,593 points with 5.03/5.17 GiB peak allocation; outputs render in Chromium/WebKit. Exact receipts: `docs/world-reconstruction-validation.md`. Larger follow-up also passed: 11 photos yielded 98,735 points/11 cameras in 18.379 s, and a photograph-sequence MP4 yielded 98,345 points/11 cameras in 17.273 s; peak allocation 5.72/5.84 GiB. Actual video output renders and navigates in Chromium/WebKit but has substantial gaps/outliers. Scale, collision geometry and real phone capture quality remain unverified.
- Local VLM observations execute on GB10 qwen3.8:27b (`nvidia/Qwen3.8-27B-NVFP4@482ca0f3832238542f8f5295dde86b5f22711d80`). Frozen v3 adapter SHA: `6cb6601d9cf18c571b9351b60082746217fef42c20ee1eb17439ed292a729237`. Photo: 1 label in 8.097 s; photograph-sequence MP4: 4 labels/frames in 26.255 s. Exact decoded PTS, PNG/source hashes and prompt/model identities survive recorded-artifact replay in both browsers. Partial unverified suggestions only; generated boxes disabled after invalid-box failure. No physical phone or accuracy claim.
- Observation UI supports pending/accept/edit/reject, preserves model originals and drafts across rerenders, and never changes planning geometry/review flags. Proof JSON references source/frame hashes; download PNGs separately for offline review. Clear/modal close cancel pending worker connections; the 60-second artifact deadline includes stream reads and socket cleanup. Tests: 56 Node, 97 Python plus 2 dataset skips, and HTTP Chrome/WebKit flows. Hosted World contracts at f905006c passed on Ubuntu, including both browser engines; verify later heads separately.
- User steering, October 19: use GB10 where needed to save tokens. Use its existing local model for suitable bounded reviews/checks as well as inference; preserve production services and coordinate idle GPU windows.
- Test entrypoints: `tests/world/*.test.mjs`, `test_worker.py`, `browser_smoke.py`, `visual-browser-smoke.mjs`, `worker_browser_smoke.py`, `observations_browser_smoke.py`, `test_observations.py`. Actual screenshots/proofs under ignored `output/playwright/world/`.
- Current full requirement/remaining gates: `docs/world-studio-implementation.md`, original `docs/world-builder-flagship.md`. Outstanding real indoor capture quality and generative model qualification, public tenant/storage/queue budgets, physical iPhone capture/codecs, geometry extraction/scale review, target-capture VLM quality benchmarking, signed reports, measured gym+cleaner validation and deployment. Do not mark full goal complete from local previews.

- Bounded GB10 text code-review attempt (7,899-byte excerpt, 1,024 output tokens, 55 s HTTP limit) timed out; it produced no review findings. Preserve the private receipt in `/tmp/brainsnn-world-validation/gb10-code-review/`; future local review tasks should be narrower. Existing services stayed healthy; no model process or listener was added.

- HEVC follow-up: software HEVC MP4/MOV decoding now preserves the existing pixel/thread/external-I/O restrictions. Synthetic SDR exact-PTS, probing and changing-resolution tests passed on GB10 CPU (6 cases) and the full local pinned Arena interop suite (24 cases). World observation suite: 54 passes, including hvc1 decode through frame hashing/sidecar output with an explicit fake VLM response; combined World backend: 98 passes plus 2 dataset skips. Decoder SHA `d01eb9ca30b23693c8f652ab0c3fe078ec7949e2e2c9f88aeefab75ebd8ef5b5`. HDR, display rotation and physical iPhone captures remain unqualified; WebM remains unsupported by observations. Local receipt: ignored `output/playwright/world/hevc-qualification/`.

- Follow-up private tenant boundary: optional hashed credential registry, stable server-owned identities, all API records/tickets scoped by owner, engine allowlists and persistent upload/job/storage allowances. Existing data and legacy behavior remain under reserved operator identity. Separate in-memory ticket signing key; restart/rotation/revocation invalidate tickets. Reauthentication after body read closes delayed-revocation admission race. Running jobs retain accepted bounded execution. 29 tenant regressions; full World backend127 passed +2 optional dataset skips. Distinct tenant credentials completed real HTTP browser→observation CLI→artifact/review flows in Chromium/WebKit with explicit fixture VLM. This is not public signup, compute billing, durable hosted storage or process isolation.
- Measurement worksheet:64 readings/132 decisions/256KiB, independent map endpoints/distance/uncertainty/instrument/date and floor/start/object decisions, exact canonical geometry SHA binding. Edits make records stale; imports are reference-only. Proof exports snapshot mutable inputs before asynchronous hashing. Self-reported evidence never rescales geometry or sets metric/planning verification. Full Node75 passed; production HTTP desktop/mobile/worksheet/routes passed Chromium/WebKit.
- Capture lifecycle now guards pending permissions, clear/pagehide/visibility changes and old callbacks; error/empty/over-limit output discarded. MP4-only native recorder with camera-upload fallback.7 lifecycle contracts and browser permission fixtures pass; actual native canvas recordings decoded as seven128×96H264frames in each browser. No physical camera/HDR/orientation claim.
- Lyra rights/port review: Lyra2 checkpoint terms restrict production and default DA3 adds noncommercial terms. Lyra1 core checkpoints support commercial-use investigation, but guardrail dependency rights/behavior and ARM64/GB10 port remain incomplete. Official source disables guardrails; do not copy that setting. Documented full-offload43GB observed peak exceeds current20GiB guard; it is not a proven minimum. No Lyra weights/packages installed or model executed. Exact pinned sources and staged plan: docs/world-generative-qualification.md. Bounded GB10 checklist synthesis completed21.4s; corrected unsupported model suggestions.
- HEVC hosted follow-up: World contracts passed at bb1ec8e1; Arena tests also passed but final published ZIP drift gate caught stale bundled decoder/tests. Regenerated only brainsnn-arena-worker.zip with exact HEVC files; deterministic repeat, CRC and source equality passed. Verify new hosted head after committing these follow-ups.

- October 21 (Claude cloud session, sub-branch `claude/world-builder-real-to-sim`): real→sim handoff `public/world/reconstruction-map.mjs` turns points + `reconstruction.json` camera poses into an unreviewed `observed` World map. The steps: up from camera image-down, floor from the lowest dense layer, scale from an editable assumed phone height (1.35 m), wall-aligned axes, walked path (steps ≤1 m) + floor = free, dense points ≤ robot height = obstacles, unseen = unknown. The existing review gate is unchanged. Real CPU COLMAP room video: 57/60 frames, 10,963 points; the proposal ran in 76 ms (8.1 m² free / 8.7 obstacle / 18.1 unknown). Real browser chain: 12 photos → worker → COLMAP → proposed map → gate → proof linked to job and evidence SHA. Merged main #199: `/` World Builder, `/?classic=1` lobby, `/scan` hands off to World Builder. Adapter no-upscale and single-camera were tested and rejected (49–50/60 vs 57/60). Next: measured readings that rescale the map, dense GPU geometry, robot motion constraints, a physical phone capture.
- October 22 (same sub-branch): measured-scale calibration. `proposeWorld({..., measurement:{a,b,distance}})` takes two reconstruction-frame points plus a user-measured metre distance and sets metres per unit exactly. It refuses a pair that implies a phone height outside 0.3–2.5 m. The report adds `scaleSource`, `impliedCameraHeight` and `measurement`; `scaleVerified` stays false. In the UI: "Pick two measured points" in the Real → sim card, then tap the 3D view (a tap under 6 px with the primary button; drags still orbit). `visual-viewer.mjs` adds `pick()` (frontmost point within 4 px of the nearest, 14 px reach) and index-based `setMarkers()`, which follow flips and clear with new points. The proof event records the picked points, span, distance and `selfReported`. Tests: 8 proposal contracts (exact to 1e-9); the browser smoke taps by mouse/touch and recovers the exact 1/K. Not tested locally: WebKit, physical iPhone, keyboard-only picking. CLI for API users: `npm run world:propose` (`brainsnn-r3f-app/scripts/world-propose-map.mjs`) turns worker artifacts into the same unreviewed World JSON plus a report with input SHA-256 values; documented in `public/world/api.html`. The synthetic room fixture is shared at `tests/world/fixtures/synthetic-room.mjs`. Browser-test lesson: `world.css` sets `html{scroll-behavior:smooth}`. WebKit's Playwright scroll-into-view animates, so canvas coordinates read right after scrolling go stale. Scroll with `behavior:'instant'`, wait until scrollY is still, and tap pixels that are actually drawn (the viewer preserves its drawing buffer). A double-tap was not the cause. Oct 22: merged Hermes Mac `hermes/world-builder-demo-flagship` (87d76a1) into the flagship. It adds: video → Arena point-cloud hand-off (gravity-aligned floor), auto-orbit on worker clouds, measured scale for pose-less clouds, and a PWA (manifest + network-first `sw.js`) with share-sheet exports. Follow-ups: picking stops auto-orbit; a 1 m/unit measured scale still exports as metres; the app-shell smoke loads `/world/index.html` directly (the root iframes it); `sw.js` precaches `/arena/site-core.js`, the shell's only module outside `/world/` (production serves it `must-revalidate`, so offline start failed). Oct 22 release: PR #198 was squash-merged as 463eca2. The GitHub Actions deploy failed because Railway rejected `RAILWAY_TOKEN` as Unauthorized (the CLI version was unchanged, so the token itself was bad). The owner then retriggered Railway's GitHub deploy (43d8f8e), and brainsnn.com went live at 13:12 UTC. Live checks passed: the homepage headline in its iframe, `/?classic=1`, `/world/api.html`, and the full real→sim flow incl. measured scale. The served files match main byte for byte. The Actions `RAILWAY_TOKEN` secret may still need replacing. Research on VLM size guesses vs metric depth vs Blender: `docs/research/metric-scale-and-blender-sim-layer.md` (conclusion: MoGe-2/DA3-metric depth cue + log-space fusion + conformal calibration on in-house tape-measured rooms; VLM only as a size-prior sanity flag; Blender only as downstream visual dressing and synthetic test data). On-device object identification (Oct 22, user chose 'Both' = on-device detector + worker later): `detections.mjs`/`detect-worker.mjs`/`detect-client.mjs`, `Xenova/detr-resnet-50@8be7ab59` q8 WASM (base Apache-2.0, COCO-80, threshold 0.7, ≤20, 512 px frame). Output goes through `observation-ui.loadDetections` into the existing frame-bound review/proof; it never changes the map. Opt-in real test `tests/world/detect_browser_smoke.py`: 12 objects in ~10 s on the room photo. The worker half still needs the user's GB10/CPU worker URL + key. Deploy pipeline (Oct 22, user chose verify-only): `brainsnn-app-deploy.yml` is now "BrainSNN app release checks" (checks only, no `railway up`, no secret); Railway's own GitHub deploy (environment `wonderful-charisma / production`, ref = SHA) ships main after those checks pass. `brainsnn-live-verify.yml` runs on Railway's success `deployment_status` (concurrency grouped by state) and byte-compares live World/Arena files plus the old healthcheck markers. `sponsor-live`, `sponsor-launch` (verify-live job) and `gt3-live` follow it via `workflow_run` and match `event == 'deployment_status'`, because a SHA ref has no head branch. Live operator worker (Oct 22): the user's Mac CPU COLMAP worker behind a Cloudflare quick tunnel (URL and key were given in chat and are NOT stored here). It has engines `inspect` and `colmap-sparse` only. On brainsnn.com the room video gave 57 poses and about 10.9k points, and a 4.4 × 7.4 m proposal (8 m² free). No robot preset fits anywhere: the free space is a corridor of about 0.8–1 m and the planner's circumscribed-circle footprint is conservative. The planner now returns `advice` on a blocked start: the nearest fitting spot, or the widest square robot plus spot (about 0.25 m here). Planner grid floor lowered 0.25→0.1 m (inflation = half a cell diagonal), and a `vacuum` preset (0.35 × 0.35) was added. Demo capture: Mip-NeRF 360 garden → 62 s video (scratchpad, not committed) → live worker → 11.2 × 11.2 m map → Cleaning robot 40 m route.

- October 23 (Claude cloud session): #213 merged Hermes's scene compiler plus `scene-usd` worker engine (with the Codex fixes) as 41482e9, and the full deploy chain was green. #214 documented it. Facts that matter:
  - A video job has no measured scale, so its scene is arbitrary units with no `scene.usda`. Metric path (same day): after a measured distance on a multi-view reconstruction, the calibration card uploads the Arena cloud as a new `cloud` upload kind (strict validator `geometry.load_arena_cloud`: no NaN, ≤50k points, ≤16 MiB, metric only with a user-measured, self-reported, unverified scale; single-photo `sourceFrame` refused). `scene-usd` compiles it without COLMAP into a metric `scene.usda`. Real room run: 0.66 m/unit (illustrative) gave a 3.97 × 7.95 m floor in 1.5 s of compile time.
  - The worker engine never passes `--detections`. The compiler lifts every sidecar detection without reading review decisions.
  - The workspace now opens a job's `.glb` in a dialog (`scene-preview.mjs` facts from `scene.json`; mesh viewer loaded on first use; SHA-256 checked).
  - Hosted test `tests/world/scene_browser_smoke.py` uses fixture adapter `tests/world/scene_fixture_adapter.py`, which writes an authored GLB with no Blender.
  - Running the real chain on an x86 container without Blender: `pip install bpy==4.2.23` in a Python 3.11 venv, plus a `blender` shim that runs the `--python` script through runpy and calls `os._exit`. The bpy module segfaults in interpreter teardown after `read_factory_settings`, even though all files are written.
  - Rendered scene colours in the Arena viewer: floor about #e5e2d9, walls about #abbbc6, unknown pink.
  - Ground-truth check of the metric path, Oct 23. ETH3D `office` (`office_dslr_jpg.7z` and `office_scan_clean.7z` from eth3d.net; CC BY-NC-SA, test only, never commit).
    - Setup: 12 photos downscaled to 3024 × 2016 (the worker's limit is 24 MP and the DSLR images are 24.4 MP), run through the site and worker with `colmap-sparse`.
    - Scale: an Umeyama similarity from the reconstructed camera centres to the ground-truth centres in `dslr_calibration_jpg/images.txt` gives metres per unit. Enter `s × picked span` as the measured distance.
    - Laser-scan check: map the scans with the matrices in `scan_alignment.mlp`. In ETH3D's office frame, z is vertical.
    - Result: 0.1361 m per unit; camera RMS 1.5 cm; points a median 1.1 cm from the scan (88% within 5 cm). Sparse coverage gave only one wall.
    - The scripts lived in the session scratchpad (`eth3d/scripts/flow_eth3d.py`, `validate_scan.py`) and are not in the repo.
\n- October 23–24 (Claude cloud session):
  - #219 (265fffa) adds `python -m robotics.world_worker.benchmark_eth3d`, which scores any worker output against ETH3D ground truth. CPU `colmap-sparse` baseline: camera RMS 1.5 cm; completeness 2.1% within 5 cm and 5.3% within 10 cm. `docs/hermes-gpu-tasks.md` lists the GPU work for Hermes.
  - #220 (2d1e16a) makes metric scenes also write `scene.ifc`. The IFC4 file is written directly by `robotics/scene_compiler/ifc_export.py`, with no IfcOpenShell needed.
    - Element mapping: walls → IfcWall; observed floor → IfcSlab `.FLOOR.`; placed detections → IfcFurniture; unknown space → one IfcBuildingElementProxy.
    - Provenance: each element carries `Pset_BrainSNN`. The project's set has `SelfReported` true and `MetricVerified` false.
    - Validation: IfcOpenShell's full validation reports 0 issues on the real ETH3D scene, and web-ifc 0.0.77 opens it.
    - The deploy chain was green, including the live verify.
  - Demo video "phone walkthrough → simulation → BIM" (90 s, 1080p, recorded on live brainsnn.com). The recorder and the web-ifc demo viewer are in the session scratchpad, not the repo.
  - Recording lessons:
    - The scene `<dialog>` is in the top layer, so captions must move inside it.
    - Under full CPU load from a co-located COLMAP worker, CDP screencast frames show stale tiles of whatever was on screen before the panel grew. Wait with the view on the workspace and cut the frames around the layout jump.
    - Captions need `pointer-events:none`.
  - Oct 24 owner decision: Lyra 1 is approved for a measured GB10 trial (safeguards on, isolated batch job, never stopping the 27B; Lyra 2 excluded). Conditions are in `docs/hermes-gpu-tasks.md` task 5.
  - Oct 24 scan to model (#223, branch `claude/scan-to-objects`), after the owner asked for Moving Atoms-style "every object separated and measured":
    - `colmap-dense-cpu`: Depth Anything V2 Small (pinned ONNX) per frame, fitted to each frame's SfM points, kept where 2 of 4 neighbouring frames agree within 2%. ETH3D office: 3.1 cm median, 7.6% / 11.4% coverage (sparse 1.5 cm, 2.1% / 5.3%).
    - Scene compiler separates every object (oriented box, metres) and finds walls by RANSAC above furniture; IFC writes unnamed objects as IfcBuildingElementProxy "Object N" with dimensions.
    - Robot route: the scene dialog's "Plan a robot route in this scene" (`worldFromScene`) makes an unreviewed World map from scene.json. Use it rather than the point-based proposal for dense clouds: dense floor scatter reads as obstacles there (vacuum 0.2 m² vs 3.4 m² and a 67.8 m route on the room walkthrough). Tried and rejected: an obstacle-share rule in the planner (could erase thin legs), depth-edge masks and wide-baseline agreement (little gain).
    - Demo scale: 0.66 m/unit for the Mip-NeRF room. At 0.41 the walls fall below the 1.3 m wall band.
  - #224 (4ec8c95): Claude names separated objects.
    - The scene engine crops each object from the reconstruction's frames. `fromSource` in the hand-off maps it back, `source_job` lets the scene job read the reconstruction job, and the exported COLMAP model is recorded in `sparse/selected.txt`.
    - It asks `claude-opus-5-5` once, with a JSON schema. A second consent box gates sending crops to Anthropic.
    - Names apply at medium or high confidence and are marked unreviewed.
    - The worker passes `ANTHROPIC_API_KEY` only to adapters that list it under `secrets`.
    - Real run: 10 objects in 11 s, about $0.03.
  - Session handoff: `docs/world-builder-handoff.md` (state, how to run, blockers, next steps). The demo recorders moved into `scripts/world-demo/`.
  - Still open:
    - a physical iPhone Safari test (owner);
    - the GPU worker on a stable hostname, on the 4090 while the GB10 is rented (Hermes or the owner; cloud sessions can't reach the 4090);
    - rotating the Anthropic key shared in chat (owner);
    - a dense GPU benchmark on the 4090 (Hermes);
    - Lyra 1 trial receipts.
  - Oct 24 evening (#226–#229), after the owner asked for commercial BIM films "better than Moving Atoms":
    - #226: COLMAP mapping retries seeds 0–2 until 90% of frames join one model (one walkthrough split 33 + 26 frames).
    - #227: on-worker detector names (EfficientDet-Lite2, pinned sha256); `scene-plan.dxf`, `scene.3dm` and `quantities.csv` from scene.json; the feed-film scripts.
    - #228: the site's `fitFloorPlane` read empty height bins as undefined (NaN peak), so a capture with one stray point under the floor stayed tilted. Every film before it was compiled 16.3° off level.
    - #229: fit check (`fit-check.json`, `fit-heatmap.ply`; model to points, metric scenes only), furniture grounded over unseen floor (base "inferred"), the floor plane through the floor layer itself (not a bin centre), and the film's `--cut check`.
    - Main's release checks failed on #228's merge because #228's own new test was flaky (17 of 40 runs). #229 fixed the cause; check that main is green before assuming a deploy.
    - Decisions: don't compete with laser scan-to-BIM on millimetres; win on phone capture, minutes and an open fit check. No "Xactimate integration" claims (ESX needs Verisk's partner programme). VGGT-1B, Depth Anything V2 Base/Large and Depth Pro are not licensed for commercial use. Gemini Robotics-ER 2 (Gemini API) fits as a naming provider; next exports are a MuJoCo scene and doors/rooms in IFC.
    - Handoff: `docs/world-builder-handoff.md` (Oct 24 evening), with capture guide, API steps, file table, claims sheet and next steps.
    - Oct 25: Codex's draft #232 (`codex/world-bim-demo`) adds reviewed measurements (calibration plus withheld checks), hosted openings and strict film admission. The original room evidence #232 called unavailable was recovered from the Claude session (capture SHA-256 `083923ee…26ab`), and passed its `regenerate_reference.py`; the three cuts were rendered from it with that wrapper (the film env needs pytest: IfcOpenShell's rule checker imports it). Private only: the Mip-NeRF 360 photos state no licence for commercial reuse.
    - Oct 25 synthetic benchmark (#233, `scripts/world-demo/benchmark/`): a 6.0 x 4.8 x 2.7 m meeting room in Blender, 60 frames, scored model-to-truth (rigid camera fit, scale from one 2.4 m span, 7 withheld spans as #232 checks). It found and fixed four defects:
      - the hand-off's 2-98% trim cut 11% of the wall points (now widened 15%);
      - a barely-seen floor was fitted 9.4 degrees off level at table height (a weak floor is now squared to the room's planes, up is the +y side, the floor is the room's lowest points);
      - the object minimum counted wall points, so sparse chairs stayed points (now 0.3% of the candidates);
      - the score missed an upside-down model (now checks level and floor height).
    - After the fixes, merged with #232: level 0.3 degrees, floor +4.0 cm, walls 4 of 4 within 1.7 cm, faces 0.7 cm, furniture 5 of 10 (sizes rough on sparse points), withheld 7 of 7 (worst 1.9 cm). The LinkedIn film is this run, labelled synthetic.
    - Fixed Oct 25: wall boxes now stand behind the observed face (`place_behind_faces` in `analyse()`, so component evidence, naming and the benchmark agree); between boxes -11.7/-11.5 cm became -1.7/-1.5 cm, and the wall fit median 4.2 cm became 0.8 cm. Still open: the dense engine's depth model can't be fetched from cloud sessions (Hugging Face blocked).
    - Oct 25 reference scale (#233, `reference_scale.py`): Claude marks standard-size references (A4/A3/Letter, 595 mm ceiling tile, EUR pallet; no pillows or mugs), corners refined from the image, faces measured on the cloud's plane, proportions checked; cross-checked when 2+ agree within 2%, never "verified". Oracle stand-in on the rendered room: -0.45% at 0-5 px corner error, nothing at 15 px; sheets are 40-70 px across a room, so film references from about 1 m. Claude run pending a real key: the owner's `apikey_01...` value is a key ID (401), not the `sk-ant-` secret.
    - #233 merged Oct 25 (`5f6c81d`, release checks green). Codex's one finding was real and fixed before the merge: a sheet in front of a denser wall was measured on the wall (2x scale, proportions still passing); the face is now measured on the front-most surface carrying its own points.
    - Oct 25 component contract: Codex's #234 (componentId, edits, Nav2) and #237 (camera evidence) are the base, by the owner's decision. My building model (`cef5fff`, brainsnn.building.v1) was reverted from #235 to avoid two ID systems.
      - Recompile ID matching deferred until recapture registration exists: #234 derives IDs from (source hash, kind, index) and validates them strictly, and edits rebuild without recompiling, so matching now would only loosen the contract. The matcher stays in `cef5fff`. Wall provenance and the behind-the-face placement are done.
    - Oct 25 iPhone upload: #236 added `video/*` to the upload input; iOS Photo Library had offered photos only, because extensions alone did not register as video.
    - Oct 25 five-minute videos (owner's ask):
      - Limits: 2 s to 5 min; 2 GiB per video (photos stay 200 MiB); worker operator quota 4 GiB, all uploads 6 GiB; site session 4 GiB. The site reads duration from metadata and refuses over 5 min before uploading.
      - Frames: 60 up to a minute, then one a second (300 at 5 min). Past 60 frames, matching is each frame with its next 15 plus all pairs of 60 spread keyframes (5,988 pairs at 300, not 44,850).
      - Timeouts: extraction max(90, 3 x duration) (5 min 1080p30 HEVC decodes in 34 s on 2 threads); video engines 3600 s. `WORLD_CPU_THREADS` (default 2; the local worker uses every core).
      - The observations engine still takes 120 s at most.
      - Oct 25 geometry finding (not caused by the long-video code): a forward walk 0.75 m from the walls, looking 35 degrees in, registers every frame yet is 20-80 cm off the true path, even through the unchanged 60-frame exhaustive path and at benchmark render quality; the benchmark's 0.95 m / 50 degrees walk scores 1.1 cm. Ruled out: spacing, render quality, pairing, lens (CameraMode.SINGLE fitted the true focal and was worse). Cause confirmed on lap 0: build_office.py materials use object-space texture coordinates, so walls sharing a material carry identical patterns and COLMAP folds the loop; with world-space coordinates the same lap places 45/60 frames at 3.8 cm RMS (median 2.6) vs 69 cm. Follow-up: make build_office.py world-space and re-baseline the benchmark. Videos over a minute now carry a warning to confirm with withheld tape measurements.

## October 24: independent demo correction validation

PR #228 and follow-up #229 are merged; use `2f1f38e` or a validated descendant for replacement footage. Both PR CI workflows succeeded, including production build and Chromium/WebKit. Independent local checks: 109 World contracts, lint/build, 125 worker tests (3 skips), and 37 compiler tests passed. A seeded synthetic stray-point regression reproduces the old sparse-histogram failure and passes on current code. This is not reproduction of the original 10,925-point room.

Original room video, picked endpoints, corrected worker artifacts, original film filenames/hashes and private worker access were unavailable in this environment. No replacement footage was rendered. `scripts/world-demo/REGENERATE.md` inventories affected asset families and provides commands; `regenerate_reference.py` preserves and validates recovered evidence before rendering into a fresh directory. Captions distinguish the photograph-sequence test fixture, entered unverified scale, inferred bases, unreviewed names and scripted planar routes. Do not mix #228's six-object result with #229's seven-object/four-name receipt. Validation detail: `docs/world-demo-validation-2026-10-24.md`. Research and DeepMind integration direction: `docs/research/world-builder-2026-10-24.md`.


### Component fitting and reviewed correction, 25 October 2026

On top of #240, metric scenes and saved rebuilds emit source-bound component-fit.json.
Full compiler memberships feed residual distributions and bounded wall-plane suggestions;
recapture guidance remains heuristic. Explicit selected IDs can generate the existing
controlled edit contract and native Blender rebuild through refine_components. Sizes,
hidden thickness and scale stay fixed. No source edit, physical accuracy or robot claim.
See docs/world-component-fit.md and its qualification record. The authored 30 mm
depth-biased wall fixture passed native IFC/Rhino/GLB consistency checks after refinement.
The AGENTS memory-sync helper is absent on this host; memory changes are committed
with the feature branch through ordinary git.


### Repeatable video qualification, 26 October 2026

`scripts/world-demo/qualify_video.py` makes private upload/resume/SHA256, real CPU
reconstruction, source-bound camera ledger and native unscaled GLB checks repeatable.
It has upload-only and retained-review modes; private outputs stay outside git.
Separate workflow success from heuristic geometry screening (registration, fragments,
extracted-sequence gaps, wall support and floor evidence). Exit 2 means review
required, not a transport failure. No measured reference means no physical accuracy,
metric component-fit, BIM/CAD/USD or Nav2 acceptance. Pure screening/integrity and
real HTTP upload-only regression tests run in World Builder CI. SIGTERM follows
cancellation/worker cleanup; a virtualenv Python path must not be resolved through
its symlink to the base interpreter. See scripts/world-demo/README.md for commands.
The memory-sync helper is absent here; this note is committed with the test change.


### brainsnn.com's own processing on Railway, 27 October 2026

Owner: "ignore the GPU, do it all on the website". The website can't run reconstruction in the browser (iOS Safari: no
WebXR or LiDAR; frame-posing models are 1B+ parameters), so the site runs the existing CPU worker itself:
- `robotics/world_worker/deploy/railway/` is a second Railway service (Ubuntu 24.04, COLMAP, bpy 4.2 on a copied Python
  3.11) on a /data volume;
- the site's `src/server/worldWorkerProxy.js` at /api/world holds the worker credentials and gives each browser a
  passcode session (visitor sessions with a daily cap only with WORLD_SITE_VISITORS=1). Each session reaches only its
  own uploads and jobs, and download links get the site prefix from the proxy. Don't use uvicorn --root-path: the
  worker's middleware then sees neither /healthz nor /v1/download/ as public;
- the World Builder dialog shows "Process on BrainSNN".
In the container through the site proxy, an 8 s rendered walk took 105 s for colmap-sparse (24/24 frames, 0.61 px)
and 99 s for scene-usd. CI: tests/world/site_processing_browser_smoke.py (fixture adapter in place of COLMAP).
Live only after the owner creates the Railway service and sets the variables (deploy/railway/README.md).

### LingBot-Map streaming engine, 27 October 2026

`robotics/world_worker/lingbot_map_stream.py` (`lingbot-map-stream`): one video (the same frames as colmap-sparse) or
3-12 ordered photos through LingBot-Map (Apache-2.0 code, robbyant/lingbot-map @ b9dd1b1), streaming, CUDA only,
offline, tensors-only checkpoint load, refuses missing weights. Points come from depth through each predicted camera
(consistent by construction), Y-up like MapAnything, so the site reads it unchanged. Every consecutive pair's
modelled turn is checked against the turn its SIFT matches give (OpenCV essential matrix with the model's
intrinsics). That goes in `capture.consistency`, with the same 15 degree threshold and record shape as COLMAP's fold
check. Synthetic room: true poses median 0.48, worst 1.14 degrees; a 40 degree jump is flagged; an 8 degree one is
not (worst 7.7 against median 0.6 is visible in the record). Pairs that fit a homography as well (flat wall, turning
on the spot) are skipped, not trusted.
Never run with real weights: Hugging Face is blocked from cloud sessions. MODEL_SHA256 is None until GPU qualification
pins it (lingbot-map.pt and lingbot-map-long.pt are the same size). The real architecture with random weights ran on
CPU through the adapter's load/infer code. Qualification steps: docs/hermes-gpu-tasks.md section 6.
`run_benchmark.py --engine lingbot-map-stream` scores it against truth beside COLMAP.

## Outdoor video qualification — 2026-10-27

- The owner requested a real outdoor block video trial, with geographic context if useful. Keep captured geometry distinct from open reference geometry and visual basemaps. A location pin is not a metric scale or camera trajectory.
- `qualify_video.py --reconstruction-only` now exercises real local HTTP upload/resume, exact source hashes, CPU sparse reconstruction and signed downloads without Blender or indoor floor/wall requirements. It retains conservative registration, fragment, sequence and fold checks. Recorded scope is bound to the source for retained replay; a full run cannot silently lose its scene requirement.
- Low-resolution video extraction now preserves native size instead of enlarging to 1280 pixels. Larger videos retain the existing 1280-pixel cap. Real FFmpeg regressions cover both portrait and landscape.
- Production `/api/world/processing` reports available and passcode-enabled, visitors disabled. Railway reports the site and private world-worker healthy. OAuth exposes variable names only, so hosted processing still requires the owner to unlock with the passcode. Do not reset credentials or open visitor processing to work around this.
- The room compiler remains indoor-oriented. An outdoor sparse point cloud is not a complete block, metric BIM, terrain surface, or validated navigation map. Source MP4s, frames and trial artifacts remain private and outside the repository.


### October 28 launch integration

PR252 was merged with main ed7b353 after the native-capture and measurement handoff release, without source conflicts. 119 focused video CLI, quality screening, real FFmpeg native-resolution and native-capture regression tests passed. No additional private captures were submitted. This is an independent video extraction/qualification improvement, not a dependency or proof of full outdoor/physical geometry.

## Layout simplification — 2026-10-31

Branch `claude/photo-path-simpler`. The owner asked for a simpler, more consistent site; these are the rules the pages now follow.
- **One header everywhere.** World Builder (`public/world/index.html`) and the API guide (`api.html`) use the same header as the React pages (`src/app/PublicNav.jsx`): gradient B mark, World Builder / Create a world / Robot Arena / Developers, a More menu (Capture studio, pricing, Review, Evidence, Lab, Classic) and a "Start scanning" button to `/scan`. Change both when the navigation changes. Links in the framed World page keep `target="_top"`.
- **Hero.** The spec's two actions: Create a world (opens the goal chooser) and Explore Arena (`/arena/`, `target="_top"`). The street block, advanced workspace and training floor are text links with the same ids (`#hero-street`, `#hero-capture`, `#hero-sample`) that the smokes click. The headline is back to the owner's brief, "Turn any photo into a world. Turn any world into a robot simulation.", with the brief's intro. Later agent PRs had replaced it (#232 "Walk the space…", the street sandbox "Capture a place…") without an owner request; `routeMeta.js` and the nav already used the brief's line. Keep it unless the owner asks otherwise. The live retirement script waits for any h1, not its wording.
- **Hero demo** (`hero-demo.mjs`, the spec's above-the-fold demo): Sample / Generated / Reviewed tabs. Sample draws `sampleWorld()` with the map renderer (`createRenderer(canvas,{wheelZoom:false})` so the page still scrolls); Reviewed draws the real `planWorld` pass for the cleaning robot (116 m², 1,152 m, about 64 min on the sample); Generated shows no picture, because no generated result exists until someone brings a photo, and links to `/scan?goal=play`. Never put an invented generated scene there. `hero-demo.mjs` is in the service-worker shell (cache v7).
- **System catalog** shows its first 6 cards (3 on phones) with "Show all 23 systems"; search or a filter always shows every match. All 23 cards stay in the DOM, so the smokes' 23-card wait still works.
- **Step tracker** (`#capture-progress`, Phone to BIM) shows only while a walkthrough is under way (video source, job or scene) or on the Capture tab, and never for a single photo. `sandbox-ui.mjs` still hides it with `hidden` for the street; app.mjs uses the `off-path` class.
- **Readable text.** No visible text under 10 px on desktop. On phones, prose is at least 11 px, and only short uppercase labels and step numbers are 10 px. The phone rules used to shrink text below desktop sizes.
- **Street sandbox.** The accent is the site cyan (`--accent`); mint stays only as the LiDAR legend colour. On a phone, arriving in the street (hero button, scene menu, return from Capture) keeps the scene in view: `setTool(tool,{reveal})` opens the Objects drawer only when the person picks Edit or Evidence while already in the street.
- Measured: World page height on a 390 px phone went from 10,337 to about 6,000 px, and from 5,180 to 3,800 px on desktop.

## Visual positioning: locate a photo in a scan, send the robot — 2026-10-31

Branch `claude/locate-photo`. The owner asked for a demo like Bilawal Sidhu's MultiSet post (a city-block splat scan used
as a shared map that glasses, a robot, a drone and a phone localise against; a waypoint dropped in the glasses sends the
robot). Our honest version: phone photo localises in a COLMAP scan; tap the floor in it; the simulated robot routes there.
- **Worker:** `robotics/world_worker/locate_photo.py`, engine `locate-photo` (`source_job: true`, one image). It reads the
  source job's `colmap-work` (database + `sparse/selected.txt`), so it only works while that job is retained.
  - Matching: SIFT on the photo, ranked against every frame with 1,024 sampled features, then full mutual-NN plus ratio
    0.8 against the 12 best frames, to 2D-3D pairs.
  - Pose: LO-RANSAC PnP with focal refinement, then a second pass with the refined focal.
  - Placed only with 30 or more inliers and at least 20% of the matches; otherwise it says why. `pycolmap.Sift` ignores
    `max_num_features` per orientation: photos come back with about 6,500 features.
- **Measured:**
  - ETH3D office (12 scan photos, 14 held out, metric ground truth): 6 placed, median 1.3 cm, worst 11.1 cm, rotation
    under 1°; 8 refused, none misplaced; about 1.5 s each.
  - Mip-NeRF room video: 31 of 32 other photos placed, median 0.3% of the camera spread against the dataset's 311-photo
    model.
  - Garden: 31 of 31, about 11 s each on 4 CPU threads.
  - Scripts were in the session scratchpad (`eval_eth3d.py`, `eval_room.py`); not committed.
- **Site:** under a map proposed from a worker reconstruction (`mapProposal` keeps `report.transform` and the colmap job),
  the Simulate tab's "Send the robot to a photo" card runs the job. `photo-locator.mjs` reads `localization.json`, places
  the camera through `toMap` ("Photo taken here" cone, `renderer.setMarks`), and turns a tap into a ray to the floor plane.
  `core.routeWorld` plans a 4-connected shortest route on `planWorld`'s shared `planningGrid`. The scene-usd map path is
  not supported yet (different transform).
- **Demo:** `scripts/world-demo/record_locate.py` on the Mip-NeRF 360 garden walkthrough, photos DSC07986 and DSC08064 (not
  video frames), robot vacuum. Taps were chosen with a ranking (every tap that `floorFromTap` + `routeWorld` accept), then
  checked by eye on lawn and paving. The furnished room at the assumed 1.35 m scale leaves no start for even the vacuum;
  the garden works. `feed_cut.sh` now takes TITLE/SUBTITLE/FOOTER/NOTE: its default "A real run on brainsnn.com" is
  wrong for local recordings.

## Estimated metric scale (MoGe-2) — 2026-10-31

Branch `claude/metric-scale`. The owner asked to fix the assumed scale using Hugging Face or Omniverse references.
- **Worker:** `robotics/world_worker/metric_scale.py`, run by `sparse_colmap.py --scale-model <onnx>`. It uses MoGe-2 ViT-B
  ONNX (`Ruicheng/moge-2-vitb-normal-onnx`, revision and SHA-256 pinned in `MODEL`; the weights are MIT, and the ONNX repo
  has no licence tag of its own).
  - On 10 evenly spaced registered frames: the depth shift is solved with COLMAP's focal, then metric depth is divided by
    COLMAP camera depth at each observed 3D point. The median per frame, then the median across frames, is written to
    `reconstruction.json` `scale_estimate` (status `estimated`, `unavailable` or `failed`).
  - A wrong model file is refused before any work. A failed estimate never fails the job. `units` stays arbitrary and
    `metric_verified` stays false.
- **Measured** against ETH3D laser ground truth, 12 DSLR photos per scene:

  | Scene | ViT-B | ViT-S | Old 1.35 m guess |
  |---|---|---|---|
  | office | +6% | +4% | +198% |
  | pipes | +9% | +11% | +134% |
  | terrace | +16% | +32% | −37% |

  - Metric3D ViT-S ONNX was −19% on office, so it was dropped.
  - The frames agree within 1–3%, which understates the true error.
  - Garden: ViT-B 0.555 m/unit, ViT-S 0.638. Room: 0.482.
  - Scripts were in the session scratchpad (`metric/proto.py`, `eth_run.py`); not committed.
- **Hosted worker:** the Dockerfile installs `requirements-dense.txt` (onnxruntime) and downloads the pinned ONNX at build
  with a hash assert (about 420 MB). The Railway `adapters.json` passes `--scale-model`. Runtime is about 15–30 s on
  4 threads.
- **Site:**
  - `readScaleEstimate()` reads the estimate; `proposeWorld` scale order is measured pair, then estimate (`useEstimate`),
    then phone height. `scaleSource: 'estimated-metric-depth'`; the first warning names the model and the ETH3D error.
  - The Real → sim card shows an amber "Scale estimated · 1 unit ≈ X m" chip and one "Make the robot map →" button. The
    phone-height field appears only when there is no estimate.
  - The CLI uses the estimate unless `--camera-height` is passed. The service worker cache is v9.
  - `openArtifact` proposes the map automatically when the reconstruction has an estimate, did not fold, and the map is
    empty or the untouched sample (`untouchedSample`; an edited sample is kept, as Codex caught on PR #265). `reconstruction_fixture_adapter.py` gives the
    hosted-processing smoke a stand-in estimate (1.08/K; model 'transport-fixture').
- **Not done:** the Omniverse/SimReady reference-size cross-check (`reference_scale.py` uses Claude on a closed list of
  standard objects). The estimate is not yet shown on `/scan` or in Arena exports.
- **LinkedIn demo (51 s, 1920×1080 and 4:5):** `record_locate.py` with `SHORT=1` on the garden walkthrough (local
  worker plus the static site). It shows the estimate 0.555 m/unit, "Make the robot map", photo DSC08100 placed (1,086 of
  1,122 points agree), and a 4.2 m vacuum route. The video files and the post draft live in the session scratchpad (`li/`),
  not the repo.

## Metric single-photo preview (`photo-metric`) — 2026-11-01

The owner chose this as the interim for the photo leg while Lyra is blocked.
- **Worker:** `robotics/world_worker/photo_metric.py`, run as `--model <MoGe-2 ViT-B onnx>`, the same pinned file as
  `metric_scale.MODEL`.
  - It prepares the photo like a scan frame. The longer side becomes 644 px.
  - With the camera unknown, the focal length and the depth shift are solved together; the best focal has a closed form for
    each candidate shift, found by golden-section search.
  - Points are dropped where the model marks no geometry and at depth edges (3x3 range over 4% of the depth).
  - Outputs: `photo-metric.ply` (right-handed y-up, camera looking down -z; manifest units stay `arbitrary`) and
    `photo-metric.json` (schema `brainsnn.photo-metric.v1`; measured, metric_verified, generative and collision_ready all
    false).
- **Measured:** 18 ETH3D photos (6 each from office, pipes and terrace). Truth was COLMAP points times the scan's true
  scale. Depth was off by a median 7.9% (worst 27.3%, terrace); the field of view was estimated within about 7°.
  `metric/photo_eval.py` is in the scratchpad.
- **Hosted:** in the Railway `adapters.json` and the example adapters. The site proxy's `VISITOR_ENGINES` gains
  `photo-metric`.
- **Site:**
  - `preferredEngine()` preselects `photo-metric` when the session holds exactly one photo.
  - `openArtifact` reads `photo-metric.json` and shows the depth range, with no map card and no auto-proposal.
  - The photo panel points to it when a worker or BrainSNN processing is available.
  - End to end on the local worker: a room photo took 15 s and showed "most of it 1.3–4.3 m from the camera".
- **Demo (56 s, 16:9 and 4:5):** `scripts/world-demo/record_photo_metric.py` on Mip-NeRF 360 room photo DSCF4766
  (images_4). The worker took 13 s; the preview showed 1.3–4.3 m. The zoom and orbit are time-lapsed (8–16×) because
  headless software WebGL draws a frame in about 1.5 s; the caption says so. PR #266 is merged and live (verify passed).

## Share video (captioned flythrough) — 2026-11-01

Idea from Chaitanya Bharech's "2D to 4D using AI" LinkedIn post: PDF bridge drawings to a Blender model, IFC and a
drone-style flythrough whose captions name each component. In that post the AI also asked questions about drawing
inconsistencies before modelling.
- **Export tab:** "Make a share video ↗" records about 25 s in the browser with `share-video.mjs` (MediaRecorder on a canvas
  stream; no worker or GPU).
  - Scenes: a title card, then an orbit with the size, obstacle count and unknown area, then the 3 largest obstacles
    called out with name and size, then the route replay with the run's numbers, then a closing card.
  - Every scene carries `scaleLabel(world)` (authored / estimated / measured / assumed, plus "checked by you").
  - Format: MP4 (H.264) where the browser offers it, else WebM. The container's Chromium build records VP9 in MP4; real
    Chrome and Safari give H.264.
- **Renderer:** `createRenderer(canvas, {fixed: {width, height}})` for an off-screen canvas, and `setView({yaw, zoom})`.
- **Tests:** `share-video.test.mjs` (storyboard, labels, format choice). `browser_smoke.check_share_video` covers Chromium only,
  cancel then a full record; headless WebKit has no canvas MediaRecorder.
- **Next idea from the same post:** turn the map's warnings into 1–3 plain "check before you plan" questions.

## Visitor processing on by default — 2026-11-01

The owner chose visitors on but could not set `WORLD_SITE_VISITORS=1` on the Railway site service (the live status kept
reading `"visitors":false`). With the owner's explicit approval, `worldWorkerProxy.js` now opens visitor sessions whenever
the passcode derives their tenant credential, unless `WORLD_SITE_VISITORS=0`. The caps are unchanged: 2 jobs per
connection a day, 20 a day in total, and the visitor tenant's 2 GiB of uploads. The worker needed no change:
`tenants.py` already registers `site-visitors` from the same passcode. Proxy tests: the `env()` fixture is owner-only
(`WORLD_SITE_VISITORS: '0'`), and a new test pins the default.
