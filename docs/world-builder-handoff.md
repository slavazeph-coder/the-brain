# World Builder handoff (October 24, 2026)

This is the state of BrainSNN World Builder at the end of a Claude cloud session, written so the next agent (Claude,
Codex or Hermes) can carry on without the session. Deeper notes: `docs/world-studio-implementation.md` (how each
part works, with measured numbers), `.ai-memory/world-builder-2026-10.md` (history and decisions) and
`docs/hermes-gpu-tasks.md` (GPU work).

## Demo candidate after this handoff

The consolidated demo branch adds guided capture/scale/review/export, source-bound independent dimensional checks,
reviewed hosted IFC openings with matching visual/CAD geometry, and same-source reuse of object names. It is a
reviewable software candidate, not a deployed or physically qualified release. Use [BIM review](world-bim-review.md),
[dimensional evidence](world-dimension-checks.md) and [demo acceptance](world-demo-release-checklist.md) for this flow.
The local worker qualification records software execution separately from an actual phone-room demonstration.
Original tilted footage and its derivatives still require recovery and replacement using the
[regeneration runbook](../scripts/world-demo/REGENERATE.md).

## What is live on brainsnn.com

Main is deployed by Railway after "BrainSNN app release checks". "Verify BrainSNN live deploy" then checks that the
World Builder and Arena files are byte-identical to the commit.

- **Homepage.** It leads with "Turn any photo into a world. Turn any world into a robot simulation." World Builder is at
  `/world/`, and the operator API guide is at `/world/api.html`.
- **One photo.** On-device depth (Depth Anything V2 Small) produces an explorable point preview, labelled as a preview.
  "Identify objects on this device" runs an 80-category COCO detector and gives label suggestions only. **Visitors get
  dots, not separated objects:** separation needs a worker (below).
- **Walkthrough, with a worker connected** (Capture → Worker connection):
  1. **Reconstruct.** `colmap-sparse` or `colmap-dense-cpu` reconstructs the walkthrough.
  2. **Measure.** The person taps two points and types a distance, so the scale is self-reported.
  3. **Compile.** `scene-usd` compiles a metric scene:
     - walls, split at doorways;
     - the floor;
     - every object separated and measured as an oriented box;
     - floor no point reached marked unknown;
     - GLB, OpenUSD and IFC4 files, plus a DXF plan, a Rhino 3DM model and a quantities CSV (`cad_export.py`).
  4. **Name (optional).** Claude names each object; see #224 below. Without Claude, a detector on the worker
     (`--detector-model`, EfficientDet-Lite2, COCO) names what COCO knows: sofa, chair, potted plant and the like.
  5. **Route.** "Plan a robot route in this scene" builds a reviewed map, and the robot plans after both reviews.
- **PRs merged in this session:**
  - #219: ETH3D benchmark;
  - #220: IFC export;
  - #221: Lyra decision record;
  - #222: worker stable-host kit and `check_worker`;
  - #223: dense CPU points, object separation, scene route, doorway split;
  - #224: Claude object names.

## How the pieces fit

| Piece | Where |
|---|---|
| Site (static, no build step for `/world`) | `brainsnn-r3f-app/public/world/`: `app.mjs` (UI), `core.mjs` (World v1 and the planner), `reconstruction-map.mjs` (points → map), `scene-preview.mjs` (scene facts, `worldFromScene`), `visual-geometry.mjs` (PLY, depth, `toArenaCloud` with `fromSource`) |
| Worker API (FastAPI) | `robotics/world_worker/app.py`: uploads, jobs, tickets, tenants, per-adapter `secrets`, `source_job`, capabilities |
| Reconstruction | `sparse_colmap.py` (pycolmap 4.2.1; records the exported model in `sparse/selected.txt`); `densify.py` (dense CPU points) |
| Scene | `scene_usd.py` (adapter) → `robotics/scene_compiler/scene_compiler.py` (Blender, `bpy`) → `ifc_export.py`; naming in `robotics/world_worker/object_names.py` |
| Operator kit | `robotics/world_worker/deploy/` (systemd, env template, Cloudflare tunnel); `python -m robotics.world_worker.check_worker` |
| Demo recorders | `scripts/world-demo/` (see its README) |

## Running it locally

```sh
# Worker (Python 3.11+ for bpy 4.2; see robotics/world_worker/deploy/README.md). adapters.json lists the engines;
# copy entries from adapters.example.json. For names: pip install -r robotics/world_worker/requirements-naming.txt
# (Claude) and/or requirements-detector.txt (on-worker detector; model file and sha256 in that file)
WORLD_WORKER_TOKEN=... WORLD_WORKER_DIR=./worker-data WORLD_ADAPTERS_FILE=./adapters.json \
WORLD_ALLOWED_ORIGINS=http://127.0.0.1:4181 ANTHROPIC_API_KEY=... \
python -m uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port 8040
# Site
(cd brainsnn-r3f-app/public && python3 -m http.server 4181)   # open http://127.0.0.1:4181/world/
```

Without Blender, the scene engine runs through `pip install bpy==4.2.23` plus a small `blender` shim. See the October 23
notes in `.ai-memory/world-builder-2026-10.md`.

**Checks:**
- `cd brainsnn-r3f-app && npm run test:world && npm run lint`;
- `python -m pytest tests/world/test_worker.py tests/world/test_tenant_isolation.py tests/world/test_object_names.py tests/world/test_densify.py tests/world/test_check_worker.py tests/scene_compiler`;
- browser smokes in `tests/world/*_smoke.py`. CI runs Chromium and WebKit (iPhone 15 emulation).

## Blocked, and on whom

1. **No GPU worker connected to brainsnn.com (owner and Hermes).**
   - **The 4090:** the owner shared SSH access in chat, deliberately not recorded here. A Claude cloud session cannot
     reach it: the environment's network policy allows HTTPS only.
   - **To let a cloud session in:** widen the environment's network access, then authorize that session's SSH
     public key on the host.
   - **The better path:** run the worker on the 4090 with `robotics/world_worker/deploy/` behind a stable HTTPS
     hostname. Prove it with `check_worker --require scene-usd:video,cloud --upload-probe`, then hand the URL and
     token to the owner directly.
   - **The GB10** is rented out for now.
2. **The Anthropic key (owner).** A key was pasted into the session chat on October 24. It must be rotated. Set the
   new key only in the worker's environment file (`ANTHROPIC_API_KEY`); never put it in the repo, the site or chat.
3. **Physical iPhone Safari test (owner).** WebKit as an emulated iPhone 15 passes in CI; a real device run has not
   been done.
4. **Lyra 1 trial receipts on the GB10 (Hermes).** The trial is approved with conditions in `docs/hermes-gpu-tasks.md`
   task 5.
5. **Dense GPU benchmark on the 4090 (Hermes).**

## Next steps, in order

1. **GPU worker live.**
   - Deploy the worker on the 4090 (above) with `colmap-dense-cpu`, `scene-usd` with naming, and the `observations` VLM.
   - Then GPU dense reconstruction (MapAnything is pinned in `mapanything_apache.py`).
   - Then connect brainsnn.com and record the demo below on the live site.
2. **Objects from one photo for visitors, with no worker.**
   - Add a spend-capped route on the site server (`brainsnn-r3f-app/server.ts`). It already has `RateLimiter` and
     `SpendCeiling` for its Gemini route.
   - It sends the photo, after consent, to Claude with the same JSON schema as `object_names.py`, and returns object
     names with rough boxes as suggestions.
   - It needs `ANTHROPIC_API_KEY` in Railway and the owner's approval for public spend; it does nothing without them.
3. **Split touching objects.** SAM 2 masks (Apache-2.0) on the 4090, lifted into 3D with depth and camera poses. Today
   a sofa with a table against it is one object ("sofa and side table").
4. **Review UI for names.** Accept, edit or reject per object, reusing the observation review pattern. Map "door" to
   `IfcDoor`. Names are applied unreviewed today and say so.
5. **Scan-to-model demo with real names.**
   - `scripts/world-demo/record_scan2model.py` is ready and has passed a dry run end to end.
   - Record it on the live site once a worker with naming is reachable, then make the 4:5 cut.

## Measured facts worth keeping

The earlier room geometry and its derived object/route counts were affected by the floor-alignment bug. Keep those
historical receipts, but do not use them as current corrected evidence. PR #228 is merged; #229 adds stable floor-layer
refinement and a newer compilation. Regeneration and asset inventory: [demo replacement runbook](../scripts/world-demo/REGENERATE.md).

| Fact | Value and scope |
|---|---|
| ETH3D office (12 photos), median error / within 5 cm / coverage at 5 cm and 10 cm | Sparse: 1.5 cm / 87% / 2.1% and 5.3%. Dense CPU: 3.1 cm / 59% / 7.6% and 11.4% |
| Dense room walkthrough (Mip-NeRF 360 "room", 57 frames), CPU time | About 3.5 minutes (depth pass 80 s on 4 threads) |
| Corrected compilation reported in #229, 10,925 points | 6 walls, 7 objects (4 named), 28.64 m² observed floor, 4.5 m² unknown; entered scale remains unverified |
| Same #229 compilation, model-to-points fit | 63% within 5 cm; median floor 0.7 cm, walls 2.7 cm, objects 5.6 cm; sofa flagged at 6.8 cm; chair base inferred |
| Historical scene before correction | 10–11 walls and 10–11 objects; potentially tilted, not current corrected evidence |
| Historical robot route, point map vs scene map | 0.2 m² vs 3.6 m², 71 m; potentially tilted, recompute from the corrected scene |
| Historical Claude naming | 10 objects, 19 crops, 11 s, 4,029 input and 607 output tokens (about $0.03); retain as a distinct run, not corrected-run names |
| Historical Claude suggestions | sofa and side table, recliner armchair, computer tower, door ×2, piano bench ×2; a bare-floor cluster "unknown" (low, not applied); unreviewed |

These are reported test-dataset measurements, not a physical phone capture or independent proof of room accuracy.
Model-to-points fit measures agreement with the reconstruction; typed scale, missing surfaces and inferred bases carry
their own uncertainty. No corrected route length or replacement video is established by this table.
