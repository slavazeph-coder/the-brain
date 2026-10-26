# World Builder demo recorders

These scripts record the product demos on the real site against a real worker: nothing on screen is mocked.
They are reference tools, not part of CI.

**Replacing the affected tilted demos:** use [REGENERATE.md](REGENERATE.md) for the asset inventory, original-capture
requirements, corrected-job archive and fresh rendering commands. `regenerate_reference.py` fails closed when source
hashes, scale or corrected floor evidence are missing. Existing film filenames in this README are examples.

| Script | What it records |
|---|---|
| `record_scan2model.py` | Scan to model, about 2 minutes at 1920 × 1080: test walkthrough → CPU reconstruction → illustrative entered distance → observed clusters as scaled boxes (with suggested names, if offered) → planar robot route → `scene.ifc` opened in a web-ifc viewer. Touching objects can remain grouped; the fixture has no independent physical readings. |
| `record_demo.py` | The earlier photo → depth → map demo. It also holds the caption, cursor and title-card overlay (`OVERLAY`) that `record_scan2model.py` reuses |
| `feed_cut.sh` | A 4:5 feed version (1080 × 1350) of a 16:9 recording, with a title band and footer |
| `short_cut.sh` | A short 4:5 feed clip from chosen moments of a recording (hard cuts), with your own subtitle and footer |
| `ifc-viewer/` | The small web-ifc page used for the BIM step. It is not part of brainsnn.com |

## Running the scan-to-model recording

1. **A worker.** Start a worker with `colmap-dense-cpu` and `scene-usd` (see `robotics/world_worker/deploy/README.md` and
   `adapters.example.json`). For object names, set `ANTHROPIC_API_KEY` in the worker's environment and install
   `requirements-naming.txt`. The live site only talks to an HTTPS worker; a worker on `127.0.0.1` works from a local
   headless browser.
2. **The IFC viewer.** Put `three.module.js`, `three.core.js` and `OrbitControls.js` from `three@0.180.0`, plus
   `web-ifc-api.js` and `web-ifc.wasm` from `web-ifc@0.0.77`, in `ifc-viewer/vendor/`. Then serve the folder, for
   example `python3 -m http.server 4190`.
3. **Record.**
   ```sh
   WORKER_URL=http://127.0.0.1:8040 WORKER_TOKEN=... ENGINE=colmap-dense-cpu \
     python scripts/world-demo/record_scan2model.py https://www.brainsnn.com/world/index.html walkthrough.mp4 \
     http://127.0.0.1:4190/ out/scan-to-model.mp4            # add --dry-run to check every step without recording
   sh scripts/world-demo/feed_cut.sh out/scan-to-model.mp4 out/scan-to-model-4x5.mp4
   ```
4. **A short clip.** The recorder ends by printing where each caption lands in the output video. Pick the moments
   from that list and pass them as `start+seconds`. Add `@W:H:X:Y` to crop a region of the 1920 × 1080 source so it fills
   the frame: full-width UI is unreadable on a phone, and a 4:3 crop fills the 1080 × 810 window exactly.
   ```sh
   sh scripts/world-demo/short_cut.sh out/scan-to-model.mp4 out/short.mp4 'subtitle' 'footer' 4.2+2 30+3.5@1200:900:360:140 ...
   ```

`ENGINE` sets the captions as well as the engine: `colmap-sparse` and `colmap-dense-cpu` each describe their own points.
Naming captions appear only when the worker offers naming. `feed_cut.sh` says "A real run on brainsnn.com", so use it
only for a recording made on the live site.

The worker URL and token are typed under a title card, and an init script blurs the worker host wherever the page
shows it, so neither appears in the video. Never commit a recording's proof JSON: it contains the worker URL.

## The feed film (`film/`)

A designed 4:5 film (1080 × 1350, about 33 s) built from one finished run, not a screen recording. It shows:
- the walkthrough;
- the points;
- the measured model with names;
- a dimensioned plan;
- the IFC, 3DM, DXF and CSV files with their SHA-256 hashes;
- the quantity takeoff;
- the robot route in the same model.

| Script | What it does |
|---|---|
| `film/plan_route.mjs` | Runs the site's own `worldFromScene` and `planWorld` (robot vacuum) on a `scene.json`, so the route and its numbers match the browser |
| `film/bl_shots.py` | Renders the 3D shots in Blender (Cycles, CPU) from the run's `scene.glb`, `arena-cloud.json`, `scene.json` and route. The shots are `points`, `scene`, `route`, `bim` and `check` (a sweep recolours every point by the job's `fit-heatmap.ply`; misfits from `fit-check.json` glow), at about 9 s a frame on 4 cores. Only high-confidence names count as named. Styling, light and camera are the only additions |
| `film/compose_film.py` | Draws the titles, the plan (from `cad_export.elements`, the geometry of `scene-plan.dxf`), the file cards and the takeoff over the renders, then encodes H.264. Pass `--cut commercial` to leave out the robot route, or `--cut check` to leave it out and add the fit check (per-kind medians, the share within 5 cm, the flagged misfits and the worker's processing time); `--still SECONDS ...` renders stills |

```sh
J=worker-data/jobs/<scene job>/output             # a metric scene-usd job with the CAD exports
node scripts/world-demo/film/plan_route.mjs $J/scene.json route.json brainsnn-r3f-app/public/world
for s in points scene route bim check; do            # the bpy module (Python 3.11) or Blender's own Python; check needs the fit check
  python scripts/world-demo/film/bl_shots.py -- $J/scene.glb $J/arena-cloud.json $J/scene.json route.json $s film/shot_$s
done
python scripts/world-demo/film/compose_film.py film <walkthrough photos> $J route.json film.mp4 \
  --reconstruction worker-data/jobs/<reconstruction job>/output/reconstruction.json \
  --capture-kind photo-sequence-fixture \
  --capture-credit 'Mip-NeRF 360 room photographs, Barron et al.; photograph-sequence test video'
```

Pass the actual source kind and credit for every run. The renderer shows that credit and the entered scale caveat in
every cut. A bound `scene-measurements.json` adds held-out results, including failures, separately from internal fit.
Phone-labelled jobs require that report. It is recomputed and checked against the exact scene/cloud hashes and worker
summary before rendering. Capture descriptions and physical readings remain self-reported; matching spans do not
certify the BIM model. The 3D shots are renders of exported files, and the film says so. See [the saved phone-job
workflow](REGENERATE.md#render-a-new-phone-run-from-its-preserved-worker-artifacts) for measured capture and rendering.

## Honesty rules the recordings follow

Component-authoring software qualification is separate from footage. `component_fixture.py` generates an explicitly
authored room for native compiler/edit tests; `verify_component_bundle.py` checks a rebuilt bundle against its saved
source using real IFC/Rhino parsers and exact hashes. See [the reproducible qualification](../../docs/world-component-qualification-2026-10-25.md)
and [component editing and Nav2 commands](../../docs/world-component-robotics.md). These fixtures are not phone footage.
`verify_camera_frames.py` validates retained source rasters/clouds and, when present, compares the shared projector with
the actual selected COLMAP model. [Camera/component evidence commands and limits](../../docs/world-camera-evidence.md)
explain its source binding, private-frame retention and unavailable timestamps. Projection parity is not physical accuracy.

- **Only real numbers.** Every number on screen comes from the run itself.
- **Typed distances are labelled.** A distance typed for the demo (the test captures were not measured) is said to be
  typed on the closing card.
- **Speed-ups are captioned.** Sped-up segments say so ("sped up 60×"). Frames during a layout jump under full CPU
  load are cut, not sped.
- **Test captures are named.** The Mip-NeRF 360 "room" walkthrough is credited (Barron et al.) as a test capture.
- **Suggestions are not results.** Model names are shown as suggestions, not reviewed.

## Recording lessons

- **Captions inside dialogs.** The scene `<dialog>` is in the top layer, so the captions and cursor move inside it
  while it is open.
- **Wait in place under CPU load.** When a co-located COLMAP worker saturates the CPU, CDP screencast frames show
  stale tiles. Wait with the view already on the workspace, and cut the frames around the layout jump.
- **Captions ignore the pointer.** Captions need `pointer-events:none`, or orbit drags select their text.
- **Use an implied phone height near 1.3–1.6 m.** On the Mip-NeRF room, a typed scale of 0.66 m per unit keeps
  walls inside the 1.3–2.3 m band the wall finder uses; 0.41 drops them below it.

## Repeatable private video qualification

`qualify_video.py` tests a supplied video through real local worker HTTP endpoints. It checks a partial upload,
retained offset, rejected stale chunk, resumed bytes and source SHA-256. The full mode then runs CPU COLMAP,
validates its camera ledger, compiles an unscaled GLB in native Blender and verifies every signed download.
It records the checkout commit/tree, dirty state, tracked diff hash, runner hashes and actual adapter versions.
No video, extracted frames, credentials or derived artifacts belong in git or ordinary CI.

From the repository root, prepare Python using the existing pinned worker dependencies. Install FFmpeg/FFprobe
and Blender 4.2 LTS separately; the runner does not download tools or model weights.

```sh
python3 -m venv /tmp/brainsnn-video-venv
/tmp/brainsnn-video-venv/bin/python -m pip install \
  -r robotics/world_worker/requirements.txt -r robotics/world_worker/requirements-colmap.txt

# Upload/resume/integrity only, with no reconstruction or geometry acceptance.
/tmp/brainsnn-video-venv/bin/python scripts/world-demo/qualify_video.py \
  --video /absolute/path/walkthrough.mp4 --out ../private-upload-001 --upload-only

# Full real run. Use a fresh output directory outside the checkout.
/tmp/brainsnn-video-venv/bin/python scripts/world-demo/qualify_video.py \
  --video /absolute/path/walkthrough.mp4 --out ../private-video-001 \
  --blender /absolute/path/blender

# Recheck saved bytes and geometry without another reconstruction or Blender run.
python3 scripts/world-demo/qualify_video.py \
  --review ../private-video-001 --out ../private-review-001
```

Videos must contain a video stream, last 2–300 seconds and fit the 2 GiB worker limit. Optional
`--expected-video-sha256` admits one exact source. Optional `--expected-head` guards the full checkout SHA for
execution, including a feature branch; it does not assume the branch is merged. The default interpreter is the
invoking Python, preserving virtual environments. `--timeout` is a 60–3600-second budget per adapter job.
The worker is private, bound to loopback, with random ephemeral credentials, redirects/proxies disabled,
access logs off and model-offline flags. Those flags are not an OS network sandbox. Ctrl-C and SIGTERM request
cancellation and stop the worker process group. Outputs retain the uploaded video and worker intermediates;
delete the private run directory when no longer needed. Do not publish the directory wholesale.

The runner writes `status.json`, `progress.jsonl`, `summary.json`, `geometry-quality.json`, verified downloads
and their hash manifests. A review requires both reconstruction and scene manifests, except when the original
reconstruction is folded and scene generation was skipped. A deleted scene manifest cannot downgrade a full
review into a reconstruction-only pass. Review verifies saved artifacts and bindings; it does not execute or
revalidate the original upload, native projection parity or physical measurements.

`softwareWorkflowPassed` and `geometryQuality.screeningPassed` are separate. Geometry screening defaults to
at least 90% registered selected frames, one discovered model, an actually checked consistent fold test,
bounded gaps in the extracted image sequence, at least 20 supporting points per wall primitive and at least
20% fitted-floor inliers with floor alignment. Missing/malformed evidence requires review. The fraction and
wall-support thresholds can be changed explicitly; all thresholds are heuristics, not measured tolerances.
Extracted indices are not original video PTS or elapsed-time coverage. Small reprojection error alone cannot
establish accurate geometry. COLMAP results, selected fragments and fold status can vary across runs; there is
no golden point count. Repeated runs that alternate between incomplete and folded output are not accepted.

Exit codes: **0** requested workflow and screening passed (upload-only leaves geometry unevaluated),
**2** geometry requires review, **1** execution/integrity failure, **130** interrupted. Folded reconstructions
are never compiled. Without a measured reference, units remain arbitrary and metric BIM/CAD/USD/Nav2 exports
and component fitting stay gated. Even an exit-0 full run does not validate physical accuracy or robot safety.
This is a worker test, not physical iPhone picker or public hosted-service qualification. For the independent
browser journey, see the opt-in `tests/world/worker_video_browser_smoke.py`.

Ordinary CI runs `test_video_qualification.py` and `test_qualify_video_cli.py`: synthetic evidence, integrity and
binding failures, malformed GLB, cancellation cleanup and a real HTTP upload-only run from a generated clip.
Private walkthrough reconstruction remains an explicit operator-run test.
