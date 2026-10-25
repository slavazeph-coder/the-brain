# World Builder handoff (October 24, 2026, evening)

The state of BrainSNN World Builder after #226–#229, written so the owner, or the next agent (Claude, Codex or Hermes),
can use it and carry on without the session.

Deeper notes:
- `docs/world-studio-implementation.md`: how each part works, with measured numbers;
- `.ai-memory/world-builder-2026-10.md`: history and decisions;
- `docs/hermes-gpu-tasks.md`: GPU work;
- `scripts/world-demo/README.md`: demo recorders and the film.

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

## PR #232 (Codex, draft): the next step, and what it needs

`codex/world-bim-demo` consolidates #230 and #231 on top of main. CI is green on head `4c2ceb9`: 265 worker tests,
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

The three cuts (master, commercial, check) are being rendered from it with that wrapper. The raw archive is private: it
goes to the owner, not into the repo.

**What #232 still needs:** a real phone capture of one measured room, with one calibration span and at least three
withheld readings in different directions. Run it three times. Until then, no film shows physical accuracy.

## Use it: a commercial space, start to finish

### 1. Film it (about 10 minutes on site)

- **What to film:** one room or zone per video, 60–90 s, lights on, a modern phone at 1080p or 4K, 30 fps.
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

**Post text for the room film** (edit the numbers when the capture changes; do not name competitors):

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

**Against laser-scan-to-BIM services,** for internal use only:
- They start from a laser scanner, take 48 h and claim about 2 mm.
- This starts from a phone, takes minutes and shows a few centimetres.
- Win on time, cost and self-serve access, and on showing the fit openly. Don't compete on millimetres.

## Running it locally

```sh
# Worker: Python 3.11+ for bpy 4.2; see robotics/world_worker/README.md. adapters.json lists the engines (copy entries
# from adapters.example.json). pip install -r robotics/world_worker/requirements-cad.txt for DXF and 3DM;
# requirements-detector.txt for on-worker names (model file and sha256 in that file; Linux needs libegl1 libgles2);
# requirements-naming.txt for Claude names.
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
    tests/world/test_object_names.py tests/world/test_cad_export.py tests/world/test_fit_check.py -q
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
3. **A commercial capture (owner).** Film one space as in "Film it", with the tape measurements. Until then every film
   shows the residential test room.
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
2. **Review and merge #232** (owner). Doors, measurement review and strict film admission live there.
3. **Metric LiDAR import.**
   - Accept an iPhone Pro LiDAR export (PLY from Polycam, Scaniverse or 3D Scanner App, or Splatcatcher's COLMAP export)
     as a source with scale "device LiDAR", so no distance is typed.
   - Today the metric scene needs a worker reconstruction (`multiView`, `app.mjs:71`) and a typed distance
     (`app.mjs:64`).
4. **MuJoCo export (`scene.mjcf`).**
   - Floor, walls and objects as static boxes, keeping the fit numbers and inferred marks; tested by loading and stepping
     it with the `mujoco` package in CI.
   - It makes scanned spaces usable as evaluation scenes in DeepMind's simulator and in the Robot Arena, which already
     runs MuJoCo 3.2.3.
   - About a day, all on CPU.
5. **Rooms in IFC.** Doors arrive with #232. Still missing:
   - the room as an `IfcSpace`, with its area in `quantities.csv`;
   - the site button rename: it still says "(GLB, USD, IFC)" though it also writes DXF, 3DM, CSV and the fit check.
6. **Gemini Robotics-ER 2 as a naming option.**
   - Use `gemini-robotics-er-2-preview` through the Gemini API, alongside Claude and the detector.
   - It returns 2D points and boxes; the worker lifts them into 3D with the COLMAP poses.
   - It needs `GEMINI_API_KEY` on the worker, a consent box like Claude naming, and a check of preview pricing and data
     terms.
7. **The GPU stack on the 4090:**
   - splats (splatfacto) and planar meshes (PGSR) for photoreal review;
   - OpenUSD's splat prim;
   - SAM 2 masks to split touching objects.

   Keep IFC as the source of truth.
8. **A review UI for names** (accept, edit or reject per object), then map "door" to `IfcDoor`.
9. **Objects from one photo for visitors**, through a spend-capped server route. It needs a key in Railway and the
   owner's approval for public spend.

## Known weaknesses (room run)

- **Sofa:** flagged at 6.8 cm. Its 1.25 m-deep box takes in floor in front of it, and part of the capture saw floor under
  the cluster, so its base was not inferred.
- **Walls:** two cross at the far end and one diagonal is false. The capture orbits a table and never walks the walls.
  Walls are not squared: they run at 88°, 24°, 106° and 50°, so snapping would distort them.
- **Touching objects stay one** until SAM 2 masks land. The detector named a 6 cm-thick object "oven" (medium confidence,
  unreviewed; the film hides medium names).

## Measured facts worth keeping

| Fact | Value |
|---|---|
| Room walkthrough (Mip-NeRF 360 "room", 62.2 s, 60 frames), `colmap-sparse` on CPU | 135 s; 57 of 60 frames posed (seed 0 joined 33, seed 1 joined 57); 12,007 points; 0.53 px reprojection error |
| Same capture, metric scene (scale typed: 5.79 m) | 5 s. 6 walls (10.50 m), 7 objects (4 named by the on-worker detector in 2.3 s), observed floor 28.64 m² of a 3.96 × 7.79 m extent, 4.5 m² unknown, 12 files. IFC: 0 IfcOpenShell issues |
| Same scene, fit check | Floor 0.7 cm, walls 2.7 cm, objects 5.6 cm median; 63% of 10,925 points within 5 cm; 1 misfit (sofa) |
| Floor fit before #228 | Hand-off 16.3° off level with 0 inliers: 21.8% of points more than 10 cm under the floor, a 7.6 cm median fit, and 14 "objects", several of them floor patches |
| Robot vacuum route, scene map | 110.2 m, 5.52 m² reachable |
| ETH3D office (12 photos), median error / within 5 cm | Sparse: 1.5 cm / 87%. Dense CPU: 3.1 cm / 59% |
| Claude naming (earlier dense run) | 10 objects, 19 crops, 11 s, about $0.03 |
