# Replace the affected World Builder demonstrations

The earlier room demonstration used a browser hand-off that skipped gravity alignment. PR #228 fixed the sparse
height-histogram bug. PR #229 then fixed unstable bin-edge refinement and added model-to-points fit evidence and
explicitly inferred furniture bases. Use the final #229 code or a validated descendant when regenerating.

**No replacement video has been rendered by writing this runbook.** A hash manifest identifies local bytes and
consistency checks; it is not independent proof that a worker ran them or that the physical room is accurate.

## Affected asset inventory

| Demonstration | Evidence identifying it | Status and replacement |
|---|---|---|
| Earlier live scan-to-model / simulation / IFC recording | `.ai-memory/world-builder-2026-10.md` describes a 90 s 1080p recording on brainsnn.com. PR #228 says prior demo films used the tilted run. | Original MP4 filename, hash and location are not recorded in the repository. Recover from the original session; replace the full recording and every derivative made from it. |
| Earlier 4:5 master and commercial films | PR #227 reports both cuts were rendered from the room job with 14 objects and 29.62 m² observed floor. | Original filenames and hashes are not recorded. Both films need fresh renders from the corrected job. |
| Feed and short social derivatives | `feed_cut.sh` and `short_cut.sh` generate these from a parent recording. | Actual output inventory is unavailable. Find derivatives by their parent file/hash or the tilted room visuals; do not silently rename them as corrected. |
| New fit-check film | PR #229 adds `--cut check` and reports a corrected worker run. | Script availability is not proof that a film was rendered. Render and inspect before using it. |

`out/scan-to-model.mp4`, `out/scan-to-model-4x5.mp4`, `out/short.mp4` and `film.mp4` in the README are **example paths**,
not established filenames of published assets. Keep old footage in a separate superseded archive with its original
filename/hash and a note linking its replacement. Do not overwrite the evidence or publish old geometry as corrected.

## Recover the original evidence first

The reference is a video built from Mip-NeRF 360 **room photographs**, credited to Barron et al. It is not a physical
phone capture. Recover these from the original recording/worker environment:

- the exact input video and its original SHA-256 receipt;
- the original reconstruction output, including `reconstruction.json`, PLY points and camera poses, plus
  `colmap-work/images` and the selected COLMAP model (needed to reproduce naming);
- the original selected scale endpoints/span and entered **5.79 m**, plus the corrected `arena-cloud.json` and its
  `fromSource` transform; do not choose new endpoints and call them the same measurement;
- the corrected scene job output with all exports, `scene-usd.json`, `manifest.json`, `object-names.json` when naming
  ran, `fit-check.json` and `fit-heatmap.ply`;
- the original worker job IDs, job receipts and artifact hashes, kept privately alongside the archive.

No original source video, original job receipts, corrected job artifacts or worker credentials are included in this
repository. The persistent worker URL/token must come from the operator's existing private environment. Do not
substitute CI fixtures or reconstruct the dataset again and describe it as the identical 10,925-point run.

PR #228's comparison had 6 objects, 42% floor inliers, a 2.7 cm point-to-model median and 0.8 cm floor-fit median.
PR #229 reports a **different corrected compilation** on 10,925 points: 7 objects (4 named), 63% within 5 cm, and
per-kind model-to-points medians of 0.7 cm floor, 2.7 cm walls and 5.6 cm objects. It flags the sofa at 6.8 cm and
marks the chair base inferred. Keep these receipts separate. Read every displayed count and fit value from the
specific output being filmed. None proves independent physical or survey accuracy.

## Validate and render the preserved corrected run

Run from the repository root. Set these variables to the recovered **existing** files, not newly synthesized inputs:

```sh
CAPTURE=/absolute/path/to/original-room-video.mp4
CAPTURE_SHA256=hash_from_the_original_capture_receipt
RECON=/absolute/path/to/original-reconstruction-job/output
PHOTOS=/absolute/path/to/original-reconstruction-job/colmap-work/images
JOB=/absolute/path/to/corrected-scene-job/output
SOURCE_PLY="$RECON/sparse-preview.ply"  # select dense-preview.ply only if that was the actual source of this hand-off
OUT=output/playwright/world/demo-replacement-20261024

# Verifies required evidence and source hash before creating output; archives without rendering.
python3 scripts/world-demo/regenerate_reference.py \
  --capture "$CAPTURE" --capture-sha256 "$CAPTURE_SHA256" \
  --reconstruction "$RECON" --source-ply "$SOURCE_PLY" --photos "$PHOTOS" --job "$JOB" \
  --expected-points 10925 --entered-distance 5.79 --out "$OUT"
```

The wrapper archives all original reconstruction, source photos, capture and job files; runs the existing
`film/plan_route.mjs` on that scene; and records file hashes, names, inferred bases, scale, floor provenance and fit
evidence in `regeneration.json`. It verifies every retained PLY point and colour through the saved `fromSource`
transform and the site's own framing/thinning rules (1e-5 m numerical comparison tolerance, not physical accuracy),
recomputes the fit report from this scene/cloud, and checks the scene/worker summaries. Add
`--original-route /absolute/path/to/original-route.json` to preserve the old route receipt alongside the newly
computed route; any original route files already inside the supplied source/job folders are also archived unchanged.
The selected PLY is also copied separately as `source-points.ply`; its hash, original filename and supported
sparse/dense caption are retained in the manifest. Do not describe sparse points as a dense reconstruction.
It rejects output/input directory overlap and refuses an existing output directory so the renderer cannot silently reuse stale
PNG frames. The planner's review flags are scripted, and the manifest labels the route as a planar preview rather
than human acceptance or a physical robot trial. Raw artifacts/receipts are private and must not be committed.

For the actual films, choose **another fresh output directory**, add `--render` to the same command, and use a Python
3.11 environment with the existing film dependencies (`bpy==4.2.23`, NumPy, Pillow, CAD requirements, FFmpeg and the
Inter/DejaVu fonts described in the README). IfcOpenShell is optional; validation is claimed only when run. The wrapper
executes the existing tools in this order:

```sh
node scripts/world-demo/film/plan_route.mjs "$JOB/scene.json" route.json brainsnn-r3f-app/public/world
for shot in points scene route bim check; do
  python3 scripts/world-demo/film/bl_shots.py -- \
    "$JOB/scene.glb" "$JOB/arena-cloud.json" "$JOB/scene.json" route.json "$shot" "NEW_EMPTY_DIR/shot_$shot"
done
for cut in master commercial check; do
  python3 scripts/world-demo/film/compose_film.py NEW_EMPTY_DIR "$PHOTOS" "$JOB" route.json "world-builder-$cut.mp4" \
    --cut "$cut" --reconstruction "$RECON/reconstruction.json"
done
```

These commands render exported files, not an end-to-end screen recording. Inspect all films, fit warnings, inferred
bases, name confidence, file hashes and route results before releasing them. The commercial cut omits the route;
the check cut shows the fit evidence. Failure or incomplete output is not a publishable replacement.

## Record a fresh end-to-end product run

First validate the real worker, install the existing IFC viewer vendor files and serve it as in the README:

```sh
python3 -m robotics.world_worker.check_worker --help
python3 -m robotics.world_worker.check_worker --url "$WORKER_URL" --token-env WORKER_TOKEN \
  --require colmap-dense-cpu:video --require scene-usd:cloud --upload-probe
# Separate terminal, from scripts/world-demo/ifc-viewer:
python3 -m http.server 4190 --bind 127.0.0.1
```

Use `record_scan2model.py` first with `--dry-run`, then without it:

```sh
ENGINE=colmap-dense-cpu python3 scripts/world-demo/record_scan2model.py \
  https://www.brainsnn.com/world/index.html "$CAPTURE" http://127.0.0.1:4190/ \
  output/playwright/world/new-run/scan-to-model.mp4 --dry-run
ENGINE=colmap-dense-cpu python3 scripts/world-demo/record_scan2model.py \
  https://www.brainsnn.com/world/index.html "$CAPTURE" http://127.0.0.1:4190/ \
  output/playwright/world/new-run/scan-to-model.mp4
```

The worker must advertise both `dimension_checks` and `bim_review`; update the complete worker checkout and reconnect
if the metric compile button is unavailable. The recorder now downloads IFC through the model-review card, where
the browser checks the actual file bytes and SHA-256, and saves it beside the video as `scan-to-model.scene.ifc`.
It shows the source-bound dimensional status but supplies no physical reference readings and does not tick any BIM
opening approval. The separate planar-route review checkboxes remain explicitly scripted demonstration actions.
A real phone acceptance recording needs the operator's actual held-out readings and opening review before export;
this illustrative fixture recorder cannot substitute for that session.

Set `CAPTURE_CREDIT` to the actual input's credit and capture type before recording a different fixture. The default
explicitly identifies the Mip-NeRF 360 room photograph sequence. For the separate Fountain software test use
`CAPTURE_CREDIT='ETH Strecha Fountain photographs encoded as a video fixture; not a physical phone walkthrough'`.
The printed proof JSON records this credit plus the actual source-video and downloaded-IFC SHA-256 hashes and sizes.
Changing the credit does not turn the recorder's illustrative distance into an independently measured calibration.

`PLAYWRIGHT_CHROMIUM_PATH` may select an installed Chromium executable; otherwise the recorder uses the existing
`/opt/pw-browsers/chromium` when present or Playwright's managed browser. Recording refuses an existing output MP4,
sibling `<video-stem>-frames` directory or recorded IFC. Dry runs save IFC under a unique `.dry-run-<time>.scene.ifc`
name and do not remove or replace recorded frames or recorded IFC. Choose a fresh output directory for a second recording.
For loopback-only software QA, invoke the recorder with `env -u HTTPS_PROXY` if the inherited browser proxy routes local
requests through its upstream; the resulting HTTP 502 page is not evidence that a product selector disappeared.

The recorder starts **a new reconstruction**, auto-selects scale endpoints and enters a distance derived from
0.66 m/unit. It cannot reproduce the preserved reference by itself. Record its actual point count, entered distance,
names, exports and route as a **new run**, not the old 5.79 m / 10,925-point comparison. Confirm the live site's
`visual-geometry.mjs` matches the validated commit before recording. `WORKER_URL` and `WORKER_TOKEN` must already be
exported; do not put credentials in commands, logs or committed proof JSON. A local recording must not use
`feed_cut.sh`'s live-site subtitle without changing it.

```sh
sh scripts/world-demo/feed_cut.sh output/playwright/world/new-run/scan-to-model.mp4 \
  output/playwright/world/new-run/scan-to-model-4x5.mp4
# Substitute actual start+duration moments from this new recorder's caption timeline.
sh scripts/world-demo/short_cut.sh output/playwright/world/new-run/scan-to-model.mp4 \
  output/playwright/world/new-run/short.mp4 'Reconstruction and exported BIM' \
  'Mip-NeRF 360 room test fixture; typed scale; not a survey' ACTUAL_START+ACTUAL_SECONDS
```

Keep the source credit and typed-scale caveat readable in every short derivative. The two `ACTUAL_…` values and the
original capture/hash/job paths are intentionally unresolved until real receipts are recovered. If any is unavailable,
stop that dependent step and report the exact missing input instead of producing a corrected-looking substitute.
