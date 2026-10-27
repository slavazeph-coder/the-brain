# World Builder handoff (October 25, 2026)

The state of BrainSNN World Builder after #226–#229 and the synthetic benchmark in #233, written so the owner, or the
next agent (Claude, Codex or Hermes), can use it and carry on without the session.

Deeper notes:
- `docs/world-studio-implementation.md`: how each part works, with measured numbers;
- `.ai-memory/world-builder-2026-10.md`: history and decisions;
- `docs/hermes-gpu-tasks.md`: GPU work;
- `scripts/world-demo/README.md`: demo recorders and the film;
- `scripts/world-demo/benchmark/README.md`: the synthetic meeting room, its results and how to rerun it.

## In one paragraph

A phone walkthrough becomes a measured, checked building model:
1. **Reconstruct.** COLMAP poses the frames and reconstructs points on a CPU worker.
2. **Measure.** The person taps one known distance to set the scale.
3. **Compile.** The scene compiler levels the floor, finds the walls (split at doorways) and separates every object into
   a measured box.
4. **Export.** It writes GLB, OpenUSD and IFC4, plus a DXF plan, a Rhino 3DM model and a quantities CSV.
5. **Check.** It measures every point against the model (`fit-check.json` and a heatmap) and flags the parts that don't
   fit.
6. **Route.** A robot can plan a route in the same model.

On the room test it took 135 s of reconstruction and 5 s of scene building on a CPU, for a 62 s video.

What it is not:
- It is not a survey: the scale is one typed distance, and the fit is model to points.
- It is not an Xactimate integration.
- It does not write native Revit families.

## Review, dimension and demo guides (from #232)

Since #232, World Builder has:
- guided capture, scale, review and export;
- source-bound independent dimension checks;
- reviewed hosted IFC openings, with matching visual and CAD geometry;
- same-source reuse of object names.

It is deployed with main, but not physically qualified. Use [BIM review](world-bim-review.md),
[dimensional evidence](world-dimension-checks.md) and [demo acceptance](world-demo-release-checklist.md) for this flow.
The local worker qualification records software execution separately from an actual phone-room demonstration.
Original tilted footage and its derivatives still require recovery and replacement using the
[regeneration runbook](../scripts/world-demo/REGENERATE.md).

## What is live on brainsnn.com

Railway deploys main after "BrainSNN app release checks". "Verify BrainSNN live deploy" then checks that the World Builder
and Arena files are byte-identical to the commit.

Deploy state on October 24:
- **#227** passed both, plus the GT3 and sponsor checks.
- **#228's merge failed the release checks** on its own new test, which was flaky (17 of 40 runs). It was never verified
  live.
- **#229** fixes that test's cause and passed the release checks at 21:11 UTC. "Verify BrainSNN live deploy" passed
  at 21:15 UTC, so #228 and #229 are both live on brainsnn.com.

Before assuming any deploy, check that main is green.

- **One photo.** It gives an on-device depth preview (Depth Anything V2 Small, Apache-2.0) and on-device COCO label
  suggestions. **Visitors get dots, not separated objects.** Separation needs a worker.
- **Walkthrough, with a worker connected** (Capture → Worker connection): see "Use it" below.
- **No worker is connected to brainsnn.com yet** (see Blocked). Every run in this handoff used a local worker.

**PRs merged on October 24:**
- **#223:** dense CPU points, object separation, scene route, doorway split.
- **#224:** Claude object names.
- **#226:** COLMAP mapping retries seeds 0–2 until 90% of frames join one model. One walkthrough had split 33 + 26 frames.
  It also brought honest demo captions, a 4:5 cutter and the filming research.
- **#227:** on-worker object names; `scene-plan.dxf`, `scene.3dm` and `quantities.csv`; and the feed-film scripts.
- **#228:** the site's floor fit read empty height bins as `undefined`, so one stray point under the floor left a capture
  tilted. The room run had gone to the compiler 16.3° off level.
- **#229:**
  - the fit check;
  - furniture standing on floor nobody saw;
  - the floor plane through the floor layer itself;
  - `--cut check`.

Earlier: #219 ETH3D benchmark, #220 IFC export, #221 Lyra decision record, #222 worker stable-host kit and `check_worker`.

## #232 (Codex, merged October 25): measured review, doors and strict film admission

Merged as `1643653`. It consolidated #230 and #231 on top of main; CI was green on its head `4c2ceb9`: 265 worker tests,
129 Node contracts, 45 compiler/IFC tests, and Chromium and WebKit review flows. It adds:
- **A Capture → Scale → Review → Export flow.** It records reference picks in 3D, with instrument, date and uncertainty.
  A changed source, worker or scale invalidates a stale review.
- **`scene-measurements.json` on every metric job** (`measurement_check.py`):
  - one **calibration** span, plus **held-out** tape or laser readings checked point to point;
  - the requested tolerance is the larger of 5 cm and 2%, and failed checks stay visible;
  - its status is `no-held-out`, `within-requested-tolerance` or `outside-requested-tolerance`, and never "certified".
- **Reviewed hosted openings.** Doors become IFC voids with door fills, consistent across GLB, USD, CAD and quantities.
  They are operator edits, not automatic detections.
- **Strict film admission** (`demo_evidence.py`, `regenerate_reference.py`):
  - every number is recomputed and hash-checked before rendering;
  - `--capture-kind` and `--capture-credit` are required, and credit plus unverified scale stay on screen in every cut;
  - a phone-labelled job needs its measurement report;
  - the capture's original filename and hash are kept;
  - a fixed bug: when several objects share a label, each now shows its own dimensions.

**The original room evidence is recovered.** #232's runbook (`scripts/world-demo/REGENERATE.md`) called it unavailable.
This session still holds all of it, and it passed `regenerate_reference.py` on `4c2ceb9`
(`status: archived-not-rendered`):
- the input `room-walkthrough.mp4`, whose SHA-256 `083923eec2afbfd9cc1cd0dd5f3f5643289e707f9f45476103480237701c26ab`
  matches the reconstruction's own receipt;
- the reconstruction job with `colmap-work/images`;
- the 5.79 m scale;
- the scene job compiled with main's final floor code.

The three cuts (master 33.4 s, commercial 29.6 s, check 34.4 s) were rendered from it with that wrapper. The wrapper stopped
at its IFC check until pytest was installed in the film environment (IfcOpenShell's rule checker imports it). The cuts
were then composed from its rendered shots. They and the raw archive are private: they go to the owner, not into the repo.
**Don't post them.** The Mip-NeRF 360 photographs state no licence for commercial reuse. The LinkedIn film is the
synthetic one below.

**What #232 still needs:** a real phone capture of one measured room, with one calibration span and at least three
withheld readings in different directions. Run it three times. Until then, no film shows physical accuracy.

## The synthetic meeting-room benchmark (#233)

A real capture can't separate model error from tape error. So `scripts/world-demo/benchmark/` defines a 6.0 × 4.8 ×
2.7 m meeting room in code, renders a 60-frame walkthrough, runs it through the real worker, and scores every compiled
wall and object against the exact room. The scale still comes from one calibration span (the table's long edge), as a
person types it. Seven withheld spans go in as #232 measurement checks, and a rigid camera fit places the model in the
true room. Details and commands are in that folder's README.

It found four defects in the shipped pipeline, all fixed on this branch with tests in both the browser and the worker:
1. **The hand-off's outlier trim cut the walls.** The 2nd–98th percentile box dropped 11% of the wall points. It is now
   widened by 15%.
2. **A floor the cameras barely saw was fitted 9.4° off level, at table height.** A weak floor is now squared to the
   room's own planes, and up is the cloud's +y side. The floor is then the room's lowest points, and the heading
   turns to the walls.
3. **Sparse furniture stayed points.** The object minimum is now 0.3% of the candidate points, not of the whole cloud.
4. **The truth score could not see a model standing on its head.** A rigid fit matches the walls either way. The
   score now checks level and floor height.

| On the same rendered room | before | after (merged with #232) |
|---|---|---|
| Model's up against true up | 9.4° | 0.3° |
| Model floor against true floor | +58 cm | +4.0 cm |
| Walls matched | 2 of 4 | 4 of 4 |
| Room width, depth error | not measurable | −1.7, −1.5 cm |
| Wall faces, median offset | 6.7 cm | 0.7 cm |
| Furniture matched | 2 of 10 | 5 of 10 (sizes off by 40 cm, median) |
| Withheld spans within tolerance, worst error | 5 of 7 usable, 4.1 cm | 7 of 7, 1.9 cm (1.1%) |

A local merge of #232 into this branch passes all of #232's tests, along with this branch's. Only the docs, the
memory notes and the CI test list conflict. Keep both test lists when merging.

**The LinkedIn film** is made from the "after" run through #232's `regenerate_reference.py`. The truth chapter
(`truth_card.py --seconds 6`) is spliced in before the end card with `film_with_truth.py`, which also writes captions and a
thumbnail. Every frame says "synthetic test room" or "Synthetic test room rendered in Blender".

## Scale from standard-size references (#233)

`robotics/world_worker/reference_scale.py` sets or checks the scale without a tape. It works in four steps:
1. Claude finds objects whose size a standard fixes, from a closed list: ISO 216 A4 and A3 and US Letter sheets, a
   595 mm lay-in ceiling tile, and a EUR pallet. Pillows, mugs and posters have no standard size and are not on the
   list. A 355 ml can is recognised but not measured.
2. The corners Claude gives are found again in the image to a fraction of a pixel.
3. Each face is measured on the plane of the reconstruction's own points.
4. A face whose proportions are more than 3% off the standard's is rejected.

The status is `cross-checked` when two or more references agree within 2%, `single-reference` for one, and
`conflicting` otherwise. It is never "verified".

- **Worker engine:** `reference-scale` (in `adapters.example.json`, disabled). Its input is the hand-off cloud, its
  source job is the reconstruction, and it needs `ANTHROPIC_API_KEY` in the worker's environment. It also reports how
  far a typed scale is from the references, so a typed span gets an automatic independent check.
- **Measured on the rendered room** with an oracle stand-in for detection: cross-checked by two sheets, −0.45% from the
  true scale at 0–5 px of corner error. One sheet survives at 10 px, none at 15 px. Sheets across a room are only
  40–70 px. **Capture rule:** film each reference from about a metre for a second.
- **Not run yet: Claude itself.** The key in this environment was a key ID (`apikey_…`, rejected with a 401), not the
  secret (`sk-ant-…`). With a real key set as `ANTHROPIC_API_KEY`, a new session runs
  `run_reference_benchmark.py OUT --claude`, which scores Claude's pointing in pixels.
- **Site UI:** a "Find scale references" step with its own consent line (frames go to Anthropic). It belongs on top of
  #232's Scale step after #232 merges; building it now would conflict with #232's `app.mjs`.

## Use it: a commercial space, start to finish

### 1. Film it (about 10 minutes on site)

- **What to film:** one room or zone per video, lights on, a modern phone at 1080p or 4K, 30 fps.
  - **Length:** 60–90 s for one room. Up to 5 minutes for a suite of rooms or a long space, walked in one go.
  - **File size:** at most 2 GiB. Five minutes is about 0.3 GB at 1080p and about 1 GB in 4K30 (HEVC).
  - **Past a minute,** the worker takes one frame a second, so a five-minute walk gives 300 frames. Each frame is
    matched with its next 15 and with up to 60 keyframes spread over the walk, which reconnects a wall seen again later.
    The vision-model observations engine (`world-observations`) still takes 120 s at most.
- **How to walk:**
  - Walk **along the walls first**: about 1 m from each wall, camera level, so every wall is seen floor to ceiling.
  - Then cross the middle once.
  - Move slowly, about a step a second, and never spin in place.
- **Overlap:** every surface should appear in several frames from different positions. Blank walls give COLMAP nothing,
  so include corners, doors and fixtures in every view.
- **Tape measurements (this is what makes the film credible):** write down 3–5 tape or laser measurements:
  - one long wall;
  - one doorway width;
  - one fixed object (a counter or desk);
  - the room's length and width.

  The first is the **calibration** span you type. Keep the others **withheld**: enter them only in #232's reference-check
  step after the scale, and never use them to re-scale. Record the instrument, the date and the reading's uncertainty.
  Tape or laser readings count; a model estimate does not.
- **Avoid:** mirrors and glass walls, moving people, a capture that orbits one object. The Mip-NeRF room used in this
  session orbits a table, which is why its walls are partial.

### 2. Reconstruct and scale (site)

1. Open `/world/`. In Capture → Worker connection, enter the worker URL and token. Only the owner holds them; they are
   never in the repo.
2. Add the walkthrough video, choose `colmap-sparse` (or `colmap-dense-cpu` for denser, less accurate points) and run
   it.
   - About 2–4 minutes on a 4-core CPU.
   - `reconstruction.json` reports how many frames were posed, for example "57 of 60".
3. Open the reconstruction, tap the two ends of your measured wall, and type the tape distance.

### 3. Build the scene and get the files

1. Press **"Build metric simulation scene (GLB, USD, IFC) →"**. This runs `scene-usd` on the measured cloud.
2. **Naming is optional:**
   - **Claude** names objects only after a second consent box ("Also send crops of each separated object …").
   - **The on-worker detector** (EfficientDet-Lite2, COCO) names sofas, chairs, plants and the like with no key, and
     sends nothing out.
3. The worker returns every file with its SHA-256, and the scene dialog states the facts:
   - observed, unknown, units;
   - separated objects;
   - inferred bases;
   - the fit.
4. Download what each team needs (see "What each file is").

### 4. Read the fit before trusting a number

The scene dialog's "Fit" line and `fit-check.json` say how closely the boxes follow the points. On the room run:
- floor 0.7 cm, walls 2.7 cm, objects 5.6 cm median;
- 63% of 10,925 points within 5 cm;
- the sofa flagged (6.8 cm), because its box takes in floor in front of it.

What to do with it:
- **Review anything flagged** against the video before quoting it.
- **Read the heatmap.** `fit-heatmap.ply` opens in CloudCompare or MeshLab: green on a surface, yellow at 5 cm, red at
  15 cm, grey for points nothing models.
- **Check against the tape.** The fit says nothing about the scale. Check your other tape measurements against the plan.

### 5. Plan a robot route (optional)

"Plan a robot route in this scene" builds an unreviewed map from `scene.json`. Unknown floor stays blocked, and the robot
plans only after a person reviews the scale and the map.

### The same thing through the worker API

Use the site for the measurement. The API alone gives arbitrary units: no IFC, CAD or fit.

```sh
# $W is the worker URL, $T the token (both from the owner; never commit them).
# 1. Upload: kind is video, image or cloud. PUT the bytes from offset 0, in chunks if large.
curl -s -X POST "$W/v1/uploads" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"name":"walk.mp4","kind":"video","size":123456789}'            # -> {"id": U, ...}
curl -s -X PUT "$W/v1/uploads/$U?offset=0" -H "Authorization: Bearer $T" --data-binary @walk.mp4
# 2. Reconstruct.
curl -s -X POST "$W/v1/jobs" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"engine":"colmap-sparse","upload_ids":["'$U'"],"consent":true}'   # -> {"id": R}
curl -s -X POST "$W/v1/jobs/$R/start" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}'
curl -s "$W/v1/jobs/$R" -H "Authorization: Bearer $T"                    # poll until "complete"
# 3. Metric scene. Export the measured cloud from the site with "Open in Arena sim (point cloud JSON)", which saves
#    brainsnn-point-cloud.json. Upload it as kind "cloud", then run scene-usd with the reconstruction as source_job
#    (it lets naming read that job's frames).
curl -s -X POST "$W/v1/jobs" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"engine":"scene-usd","upload_ids":["'$C'"],"consent":true,"source_job":"'$R'"}'   # then start and poll
# 4. Download: the job lists artifacts by index. A ticket is valid 60 s and needs no header.
curl -s -X POST "$W/v1/jobs/$S/ticket" -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"artifact":2}'
curl -s -o scene.ifc "$W<url from the ticket>"
```

`/world/api.html` documents every engine and limit.

## What each file is

A metric `scene-usd` job returns twelve files. All are in metres in the scene's frame, except the plans: plan X is the
scene's x and plan Y is minus its z, as in the IFC.

| File | For | What is in it |
|---|---|---|
| `scene.ifc` | BIM: Revit (IFC import), Archicad, BlenderBIM/Bonsai, Solibri | IFC4. `IfcWall` per wall, `IfcSlab` for the observed floor, `IfcFurniture` or a named `IfcBuildingElementProxy` per object, unknown space as a proxy. Provenance, label confidence, `LabelReviewed` and `Base` in `Pset_BrainSNN`; the scale source and `MetricVerified false` on the project. IfcOpenShell 0.9 reports 0 issues on the room run, EXPRESS rules included |
| `scene.3dm` | Rhino | One named solid per element on four layers. Measurements, IFC class, provenance and `base` as user text; the scale note in the document. Written and read back with McNeel's rhino3dm, not yet opened in Rhino itself |
| `scene-plan.dxf` | AutoCAD, any CAD | Layers FLOOR, WALLS, OBJECTS, UNKNOWN (hatched), DIMENSIONS and LABELS, in metres. Every wall dimensioned; the scale note on the sheet |
| `quantities.csv` | Estimating, real estate | A summary first (observed floor area, floor extent, wall length and face area, objects, unknown area, scale source), then one row per wall and object. Notes say what is unreviewed or inferred |
| `fit-check.json` | QA | Share of points within 2, 5 and 10 cm; median and p90 per kind and per element; unmodelled points; misfits |
| `fit-heatmap.ply` | QA, the film | Every point coloured by its distance to the model |
| `scene.glb` | Web, Blender, the site's viewer | The compiled scene |
| `scene.usda` | Isaac Sim, Omniverse | OpenUSD, `metersPerUnit = 1` |
| `scene.json` | Everything above, and the site | Every element: label, box, centre, size, yaw, provenance, base; counts; naming; the fit summary |
| `scene-usd.json` | Audit | Evidence: inputs and their hashes, the hand-off's floor fit, compiler counts, CAD and fit results, warnings, timing |
| `arena-cloud.json` | Robot Arena, re-runs | The measured, leveled hand-off |
| `object-names.json` | Audit | The naming step's answers (detector or Claude) |

The reconstruction job also returns `sparse-preview.ply` and `reconstruction.json`:
- the posed frames and the seed attempts;
- the reprojection error, 0.53 px on the room run.

## Make the demo film

Scripts are in `scripts/world-demo/film/` (see that README). Once #232 merges, render saved runs only through
`scripts/world-demo/regenerate_reference.py`, following `scripts/world-demo/REGENERATE.md`:
- it checks every input first;
- it refuses a used output folder;
- it passes the required `--capture-kind` and `--capture-credit` to the composer.

The commands below are main's tools, before #232.
- **The `check` cut** is about 34 s, 4:5 at 1080 × 1350, 30 fps.
- **Its order:** hook, walk, points, model, check, plan, files, takeoff, uses, end card.
- **Its numbers:** every number comes from the job's files.
- **Render time:** about 9 s a frame in Blender Cycles on 4 CPU cores, so 441 frames take about 70 minutes.

```sh
J=worker-data/jobs/<scene job>/output; R=worker-data/jobs/<reconstruction job>/output
node scripts/world-demo/film/plan_route.mjs $J/scene.json route.json brainsnn-r3f-app/public/world
for s in points scene bim check; do       # bpy 4.2 (Python 3.11) or Blender's own Python
  python scripts/world-demo/film/bl_shots.py -- $J/scene.glb $J/arena-cloud.json $J/scene.json route.json $s film/shot_$s
done
python scripts/world-demo/film/compose_film.py film <walkthrough frames> $J route.json film.mp4 \
  --cut check --reconstruction $R/reconstruction.json
```

- **`<walkthrough frames>`** is any folder of `.jpg`/`.png` frames of the capture.
- **The end card** names the test capture and the typed distance. Change those lines when the capture changes.
- **Names:** films show only high-confidence names.

**Post text for the room film.** It is private only: the Mip-NeRF 360 photographs state no licence for commercial
reuse. Edit the numbers when the capture changes, and do not name competitors.

> A 62-second phone video in. A checked BIM model out, 2.3 minutes later on a CPU.
> World Builder reconstructs the room, separates and measures every wall and object, and writes IFC4, a Rhino model, a
> dimensioned DXF plan and a quantity takeoff.
> Then it checks itself. Every one of 10,925 points is measured against the model: floor 0.7 cm, walls 2.7 cm, objects
> 5.6 cm median, 63% within 5 cm. The one box that doesn't fit is flagged for review, not hidden.
> No scanner. Test capture: Mip-NeRF 360 "room" (Barron et al.); the scale is one typed distance, not a survey.

## What you can and cannot claim

| Say | Don't say |
|---|---|
| "Phone video in, IFC / Rhino / DXF / CSV out, about 2–3 minutes of CPU processing per room" (measured: 135 s + 5 s) | "Survey-grade", "millimetre", or any comparison to a laser scanner's 2 mm |
| "Every point checked against the model; misfits flagged" | "Accurate to X cm" (the fit is model to points; only a tape check gives real error) |
| "Opens in Revit through IFC" | "Native Revit" (no `.rvt` is written) |
| "Open files for estimating" | "Xactimate integration" or "ESX" (ESX needs Verisk's partner programme) |
| "Furniture is measured as boxes" | "As-built LOD 300", "every pipe and fitting" (no MEP, no meshes) |
| "Navigation and coverage scenes for robots" | "Manipulation-ready" (boxes at 3–6 cm cannot support grasping) |
| "Object names are suggestions" | Names as facts (all are unreviewed; the detector called a 6 cm-thick object "oven") |
| "On a synthetic test room with exact dimensions: walls within 2 cm, withheld spans within 1.9 cm" | The same numbers without "synthetic", or as the accuracy on real rooms |
| "5 of 10 pieces of furniture found on a sparse cloud" | "Every object" for sparse captures (that needs the dense engine) |

**Against laser-scan-to-BIM services,** for internal use only:
- They start from a laser scanner, take 48 h and claim about 2 mm.
- This starts from a phone, takes minutes and shows a few centimetres.
- Win on time, cost and self-serve access, and on showing the fit openly. Don't compete on millimetres.

## Running it locally

**Test video on brainsnn.com today** with a worker on your own computer: `scripts/world-demo/local-worker/start.sh`.
Run it on Linux or macOS, or in WSL on Windows. The script:
- installs the worker and Blender's Python module into `~/.brainsnn-worker`;
- starts the worker on `127.0.0.1:8040`, allowing browser calls from brainsnn.com;
- prints the URL and token for the site's Worker connection dialog.

With `--tunnel` it also opens a Cloudflare quick tunnel, which gives an `https://` address a phone can use. Tested
here: the site connected, a 30 s video went up, `colmap-sparse` finished in 162 s, and the points loaded with the
scale step next. A hosted worker (this deploy kit on the 4090, or a service next to the site) is still what makes video
work for visitors.

```sh
# Worker: Python 3.11+ for bpy 4.2; see robotics/world_worker/README.md and robotics/world_worker/deploy/README.md.
# adapters.json lists the engines (copy entries from adapters.example.json). pip install -r
# robotics/world_worker/requirements-cad.txt for DXF and 3DM; requirements-detector.txt for on-worker names (model file
# and sha256 in that file; Linux needs libegl1 libgles2); requirements-naming.txt for Claude names.
WORLD_WORKER_TOKEN=... WORLD_WORKER_DIR=./worker-data WORLD_ADAPTERS_FILE=./adapters.json \
WORLD_ALLOWED_ORIGINS=http://127.0.0.1:4181 ANTHROPIC_API_KEY=... \
python -m uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port 8040
# Site
(cd brainsnn-r3f-app/public && python3 -m http.server 4181)   # open http://127.0.0.1:4181/world/
```

- **Without Blender:** the scene engine runs through `pip install bpy==4.2.23` plus a small `blender` shim (see the
  October 23 notes in `.ai-memory/world-builder-2026-10.md`).
- **Restarts:** after a container restart, start the worker and the site again, each in its own command.

**Checks:**
- `cd brainsnn-r3f-app && npm run test:world && npm run lint`.
- Python, exactly as CI runs it:

  ```sh
  python -m pytest tests/world/test_worker.py tests/world/test_tenant_isolation.py tests/world/test_observations.py \
    tests/world/test_benchmark_eth3d.py tests/world/test_check_worker.py tests/world/test_densify.py \
    tests/world/test_object_names.py tests/world/test_cad_export.py tests/world/test_fit_check.py \
    tests/world/test_benchmark_tools.py -q
  python -m unittest tests.scene_compiler.test_geometry tests.scene_compiler.test_scene_usd tests.scene_compiler.test_ifc_export
  ```

- Browser smokes in `tests/world/*_smoke.py`. CI runs Chromium and WebKit (iPhone 15 emulation).
- **Playwright:** locally the Python package may not match the installed browser; point it there with
  `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## How the pieces fit

| Piece | Where |
|---|---|
| Site (static, no build step for `/world`) | `brainsnn-r3f-app/public/world/`: `app.mjs` (UI), `core.mjs` (World v1 and the planner), `reconstruction-map.mjs` (points → map), `scene-preview.mjs` (scene facts and `worldFromScene`), `visual-geometry.mjs` (PLY, depth, the floor fit, and `toArenaCloud` with `fromSource`) |
| Worker API (FastAPI) | `robotics/world_worker/app.py`: uploads, jobs, download tickets, tenants, per-adapter `secrets`, `source_job`, capabilities |
| Reconstruction | `sparse_colmap.py` (pycolmap 4.2.1; seed retries; the exported model in `sparse/selected.txt`); `densify.py` (dense CPU points) |
| Scene | `scene_usd.py` (adapter: hand-off, naming, compile, CAD, fit) → `robotics/scene_compiler/scene_compiler.py` (Blender `bpy`: floor, walls, objects, grounding, GLB, USD) → `ifc_export.py`. Exports: `cad_export.py`, `fit_check.py`. Names: `object_names.py` (Claude), `detector_names.py` (on-worker) |
| Operator kit | `robotics/world_worker/deploy/` (systemd, env template, Cloudflare tunnel); `python -m robotics.world_worker.check_worker` |
| Demo and film | `scripts/world-demo/` (recorders, `short_cut.sh`) and `scripts/world-demo/film/` (`plan_route.mjs`, `bl_shots.py`, `compose_film.py`) |

## Blocked, and on whom

1. **No GPU worker connected to brainsnn.com (owner and Hermes).**
   - **The 4090:** the owner shared SSH access in chat, deliberately not recorded here. Cloud sessions can't reach it,
     because the network policy allows HTTPS only.
   - **The path:** run the worker on the 4090 with `robotics/world_worker/deploy/` behind a stable HTTPS hostname. Prove
     it with `check_worker --require scene-usd:video,cloud --upload-probe`, then give the URL and token to the owner
     directly.
   - **The GB10** is rented out.
2. **The Anthropic key (owner).** A key was pasted into a session chat on October 24 and must be rotated. Set the new key
   only in the worker's environment file (`ANTHROPIC_API_KEY`), never in the repo, the site or chat.
3. **A commercial capture (owner).** Film one space as in "Film it", with the tape measurements. Until then the films
   show either the residential test room (private) or the synthetic meeting room (public, labelled synthetic).
4. **Licence reviews (owner), before enabling or using commercially:**
   - the detector's model file (no licence notice in the file; MediaPipe itself is Apache-2.0);
   - `facebook/VGGT-1B` (CC BY-NC 4.0; the gated `VGGT-1B-Commercial` has its own licence);
   - Depth Anything V2 Base and Large (CC BY-NC 4.0; Small, which the worker uses, is Apache-2.0);
   - Depth Pro (Apple research licence).
5. **Partnerships (owner):**
   - Xactimate ESX needs Verisk's partner programme.
   - Gemini Robotics 1.5 and On-Device 2 are trusted-tester only. Apply if a robot is in scope.
6. **Unverified on real devices and apps (owner):** a physical iPhone Safari run (WebKit emulation passes in CI), and
   opening `scene.3dm` in Rhino itself.

## Next steps, in order

1. **A commercial capture, then a commercial film (owner, then any agent).**
   - Film as in "Film it", with one calibration span and at least three withheld readings.
   - Run it through #232's flow: Scale, then Review with the withheld checks, then Export.
   - Render with `regenerate_reference.py --capture-kind phone-video --render`. The film then carries a reference-check
     chapter, with failures shown: the first error figure measured against reality rather than against points.
2. **Recapture registration, then IDs across captures.** #234/#237 (merged October 25) give each component an ID
   within one capture, and edits rebuild without recompiling. A new capture of the same room gets new IDs until it is
   registered to the old one. After that, carry IDs over by geometric matching (walls within 10°, 25 cm and half
   their length; objects at 30% plan overlap; the matcher is in `cef5fff`). Porting the matcher before registration
   exists would only loosen #234's strict ID contract.
3. **Walls stand behind the surface they saw** (done October 25). A wall seen from one side is its observed face with
   an assumed 0.1 m behind it; the face of a partition seen from both sides stands toward its partner; a wall whose
   points span both faces keeps its measured thickness. Each record says which (`faceCentre`, `thicknessBasis`).
   - **On the benchmark hand-off:** the room between boxes went from −11.7/−11.5 cm to −1.7/−1.5 cm, the faces'
     own error. The wall fit median went from 4.2 to 0.8 cm. IfcOpenShell reports 0 issues.
   - **Consequence:** a reviewed opening from an older compile no longer matches its host and must be reviewed again.
4. **Qualify LingBot-Map on the 4090** (Hermes or owner; `docs/hermes-gpu-tasks.md` §6). The `lingbot-map-stream`
   engine is built and tested on the CPU without weights. It still needs a GPU run: pin the checkpoint hash, then
   score it against COLMAP on the synthetic room and run the garage video. It is the candidate answer to forward walks
   folding, and to five-minute videos past repeated surfaces, but only once its turn check and truth score say so.
5. **Run the dense CPU engine on the benchmark.** Five of ten pieces of furniture are found on the sparse cloud. The
   dense engine is the intended answer, but its pinned depth model (Hugging Face) can't be fetched from these
   cloud sessions.
6. **Metric LiDAR import.**
   - Accept an iPhone Pro LiDAR export (PLY from Polycam, Scaniverse or 3D Scanner App, or Splatcatcher's COLMAP export)
     as a source with scale "device LiDAR", so no distance is typed.
   - Today the metric scene needs a worker reconstruction (`multiView`, `app.mjs:71`) and a typed distance
     (`app.mjs:64`).
7. **MuJoCo export (`scene.mjcf`).**
   - Floor, walls and objects as static boxes, keeping the fit numbers and inferred marks; tested by loading and stepping
     it with the `mujoco` package in CI.
   - It makes scanned spaces usable as evaluation scenes in DeepMind's simulator and in the Robot Arena, which already
     runs MuJoCo 3.2.3.
   - About a day, all on CPU.
8. **Rooms in IFC.** Doors arrive with #232. Still missing:
   - the room as an `IfcSpace`, with its area in `quantities.csv`;
   - the site button rename: it still says "(GLB, USD, IFC)" though it also writes DXF, 3DM, CSV and the fit check.
9. **Gemini Robotics-ER 2 as a naming option.**
   - Use `gemini-robotics-er-2-preview` through the Gemini API, alongside Claude and the detector.
   - It returns 2D points and boxes; the worker lifts them into 3D with the COLMAP poses.
   - It needs `GEMINI_API_KEY` on the worker, a consent box like Claude naming, and a check of preview pricing and data
     terms.
10. **The GPU stack on the 4090:**
   - splats (splatfacto) and planar meshes (PGSR) for photoreal review;
   - OpenUSD's splat prim;
   - SAM 2 masks to split touching objects.

   Keep IFC as the source of truth.
11. **A review UI for names** (accept, edit or reject per object), then map "door" to `IfcDoor`.
12. **Objects from one photo for visitors**, through a spend-capped server route. It needs a key in Railway and the
   owner's approval for public spend.

## Known weaknesses (room run)

- **A forward walk close to the walls can reconstruct wrong while every frame registers** (found October 25, on
  synthetic walks of the benchmark room).
  - **What happens:** with the camera 0.75 m from the walls, looking 35° in from the direction of travel, 60 of 60
    frames register at a low reprojection error, but the camera path is 20–80 cm off the true one. That holds at the
    benchmark's own render quality and through the unchanged 60-frame, every-pair path. The benchmark's walk is 0.95 m
    out, looking 50° in, and scores 1.1 cm on the same room.
  - **Causes ruled out:** frame spacing (0.23 m and 0.5 m both fail), render quality, the long-video pairing (matching
    every pair is no better), and the lens. One shared camera fits the true focal length exactly, and the path gets
    worse.
  - **Cause, confirmed on the first lap:** `build_office.py`'s materials take their texture coordinates in object
    space. Every wall that shares a material therefore carries the identical pattern, and opposite walls are matched to
    each other, folding the loop. The same walk rendered with world-space texture coordinates (each wall's pattern
    differs) places 45 of 60 frames, 3.8 cm RMS from the true path (median 2.6 cm), against 69 cm with the repeated
    textures. Fewer frames register, but those that do are right.
  - **What it means for real rooms:** a real room rarely repeats a pattern exactly, but repeated finishes (matching
    cabinet fronts, tiles, identical doors) are common, and real phone walkthroughs are filmed forward. The benchmark's
    own orbit survives the repetition (1.1 cm); a forward walk does not.
  - **Five minutes, both ways** (same 5-lap, 300-frame path; both runs used the long-video pairing):

    | Wall textures | Frames placed | Path error, RMS | Worst frame | Reprojection |
    |---|---|---|---|---|
    | Repeated (object space) | 300 / 300 | 109.5 cm | 370 cm | 0.39 px |
    | Distinct (world space) | 300 / 300 | 0.56 cm | 1.9 cm | 0.52 px |

    The five-minute path itself holds: each lap of the good run is 0.45–0.66 cm RMS, so error does not build up.
    Registration and reprojection error do not tell the two runs apart.
  - **Detected since October 25:** for a video, the worker compares the model's turn between every two consecutive
    frames with the turn their own matches give (`capture.consistency` in `reconstruction.json`). A disagreement over
    15° marks the model `folded`, adds a warning and a recapture item, and the site shows it as an error when the
    reconstruction is opened. Over 18 mappings, the four correct models disagreed by at most 5.1° and the 13 folded ones
    by 59° or more. It does not catch every error: a 21-frame partial model 15 cm off passed.
  - **Folding is not repeatable.** Mapping the same matches with eight seeds folded seven times and gave 2.2 cm once,
    so the worker reports a fold for a recapture rather than retrying.
  - **Fixed in the benchmark room (October 26):** `build_office.py` keeps object coordinates, so each pattern stays at
    its object's scale, and moves each object's pattern by the object's own random number. On the same first lap this
    places 45 of 60 frames at 0.88 cm RMS (worst 2.25 cm); the fold check reads consistent. World-space coordinates also
    removed the repetition, but made the wall patterns 3–6 times finer: the benchmark room then gave a quarter of the
    points, and its calibration corner was not reconstructed.
  - **Until a real room is measured:** trust a video's dimensions only after the scale step and some withheld tape
    measurements agree. Reconstructions from videos over a minute carry a warning saying so. The test renders are
    reproducible with a lap-and-inset variant of `build_office.py`'s `path()`.
- **Sofa:** flagged at 6.8 cm. Its 1.25 m-deep box takes in floor in front of it, and part of the capture saw floor under
  the cluster, so its base was not inferred.
- **Walls:** two cross at the far end and one diagonal is false. The capture orbits a table and never walks the walls.
  Walls are not squared: they run at 88°, 24°, 106° and 50°, so snapping would distort them.
- **Touching objects stay one** until SAM 2 masks land. The detector named a 6 cm-thick object "oven" (medium confidence,
  unreviewed; the film hides medium names).

## Measured facts worth keeping

The earlier room geometry and its derived object/route counts were affected by the floor-alignment bug. Keep those
historical receipts, but do not use them as current corrected evidence. PR #228 is merged; #229 adds stable floor-layer
refinement and a newer compilation. Regeneration and asset inventory: [demo replacement runbook](../scripts/world-demo/REGENERATE.md).

| Fact | Value and scope |
|---|---|
| Room walkthrough (Mip-NeRF 360 "room", 62.2 s, 60 frames), `colmap-sparse` on CPU | 135 s; 57 of 60 frames posed (seed 0 joined 33, seed 1 joined 57); 12,007 points; 0.53 px reprojection error |
| Same capture, metric scene (scale typed: 5.79 m) | 5 s. 6 walls (10.50 m), 7 objects (4 named by the on-worker detector in 2.3 s), observed floor 28.64 m² of a 3.96 × 7.79 m extent, 4.5 m² unknown, 12 files. IFC: 0 IfcOpenShell issues |
| Same scene, fit check | Floor 0.7 cm, walls 2.7 cm, objects 5.6 cm median; 63% of 10,925 points within 5 cm; 1 misfit (sofa) |
| Floor fit before #228 | Hand-off 16.3° off level with 0 inliers: 21.8% of points more than 10 cm under the floor, a 7.6 cm median fit, and 14 "objects", several of them floor patches |
| Robot vacuum route, scene map | 110.2 m, 5.52 m² reachable |
| ETH3D office (12 photos), median error / within 5 cm | Sparse: 1.5 cm / 87%. Dense CPU: 3.1 cm / 59% |
| Claude naming (earlier dense run) | 10 objects, 19 crops, 11 s, about $0.03 |
| Synthetic meeting room (60 frames, 960 × 540), `colmap-sparse` | 60 of 60 frames posed; 20,844 points; camera alignment 7.5 mm RMS; about 2.5 min |
| Same room, after the fixes (scale from a 2.4 m span) | Level 0.3°, floor +4.0 cm; walls 4 of 4, width −1.7 cm, depth −1.5 cm, faces 0.7 cm median; furniture 5 of 10; withheld spans 7 of 7, worst 1.9 cm |
| Same room, before the fixes | Level 9.4°, floor +58 cm; walls 2 of 4; furniture 2 of 10; withheld spans 5 of 7 usable, worst 4.1 cm |
| Dense room walkthrough (Mip-NeRF 360 "room", 57 frames), CPU time | About 3.5 minutes (depth pass 80 s on 4 threads) |
| Historical scene before correction | 10–11 walls and 10–11 objects; potentially tilted, not current corrected evidence |
| Historical robot route, point map vs scene map | 0.2 m² vs 3.6 m², 71 m; potentially tilted, recompute from the corrected scene |
| Historical Claude naming | 10 objects, 19 crops, 11 s, 4,029 input and 607 output tokens (about $0.03); retain as a distinct run, not corrected-run names |
| Historical Claude suggestions | sofa and side table, recliner armchair, computer tower, door ×2, piano bench ×2; a bare-floor cluster "unknown" (low, not applied); unreviewed |
These are reported test-dataset measurements, not a physical phone capture or independent proof of room accuracy.
Model-to-points fit measures agreement with the reconstruction; typed scale, missing surfaces and inferred bases carry
their own uncertainty. No corrected route length or replacement video is established by this table.
