# Demo video export

Create a private, precomputed reconstruction replay from one completed job.
The final point cloud remains visible throughout. An orange estimated capture
path and selected source-frame inset replay the saved cameras. No point-arrival
times, live SLAM, continuous original video or physical robot motion are invented.

## Product flow

On a private worker configured with `demo-replay`, open **Evidence** after a
reconstruction, or the compiled building-model review. Choose **Export demo
video**, enter its title and actual source credit, select the capture type and
ending, and approve including the retained frames. Download the landscape,
social and short MP4 files and `demo-receipt.json`. Anonymous visitor sessions do
not show this private export. No automatic public publishing occurs.

The reconstruction ending needs retained `camera-frames.json`, its exact rasters,
bound `reconstruction.json` and the original point-cloud artifact. A final PLY
alone is insufficient. Deleted private rasters or expired source jobs stop export.
The browser never supplies server filesystem paths. Recompiled scene jobs may
follow up to eight same-owner job relationships to their retained reconstruction.

The building ending renders the actual `scene.glb` triangles. It does not show
an IFC/Rhino application's interface or claim destination-app qualification.
The robot ending runs the existing website's planar planner and retains its
source hash, robot envelope and automated review flags. It is a simulation;
automated planner flags do not constitute human acceptance or physical validation.
Both endings require a metric scene and recorded floor-alignment evidence.
Scale and independent gravity remain unverified.

Original source hashes, frame/raster identities, selected-frame ordering, source
artifact hashes, warnings, scale limits, withheld-check summary and video hashes
are retained. If all video PTS are available, their exact order and relative timing
are used. Otherwise playback is explicitly selected-frame order with source time
unavailable. Gaps between posed frame ordinals are dashed in the camera path.
Missing poses stay in the displayed input denominator. A folded or partial model
keeps a prominent warning, including when point-pair readings happen to pass.

## Operator setup

Use an isolated CPU environment:

```sh
python -m pip install -r robotics/world_worker/requirements-demo.txt
```

Install FFmpeg with libx264 and DejaVu Sans fonts. The robot ending additionally
needs Node 22+ and the existing `scripts/world-demo/film/plan_route.mjs`, website
`core.mjs`, `scene-preview.mjs` and `arena/site-core.js` at their normal repo paths.
No learned weights, GPU, model API key or network download is used during export.

The generic example adapter stays disabled until its dependencies are installed
and reviewed. The Railway profile enables the reviewed CPU `demo-replay` engine
for the owner after image qualification. Its tenant registry excludes private
engines from visitors, matching the site's existing visitor allowlist. The
Dockerfile stages these dependencies; exact image build and deployed rollout
are separately recorded. This does not enable visitor or public video export.

`World demo runtime image` now builds this exact Railway Dockerfile on relevant
pull requests and runs `scripts/world-demo/qualify_demo_runtime.py` inside it,
offline with a read-only filesystem and a temporary output mount. It checks the
installed fonts, each actual output resolution with 24 encoded H.264 frames,
actual GLB triangle parsing and the existing website planner. Its authored source
has deliberate gaps and unknown source times. Retain the workflow result and
`demo-runtime-qualification` artifact for the exact release head. The smoke also
requires replay in the owner profile and excludes it from visitors. A local run of
the script tests the local runtime only; it does not prove an image build. These
one-second smoke cuts do not replace full-duration replay or live-site acceptance.

```sh
docker build -f robotics/world_worker/deploy/railway/Dockerfile -t brainsnn-world-demo-qualification .
mkdir -p /absolute/private/demo-qualification
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=512m \
  --mount type=bind,src=/absolute/private/demo-qualification,dst=/qualification \
  --entrypoint /opt/worker/bin/python brainsnn-world-demo-qualification \
  /app/scripts/world-demo/qualify_demo_runtime.py --out /qualification
```

Export a reconstruction directly, using a fresh output folder separate from jobs:

```sh
python -m robotics.world_worker.demo_replay \
  --reconstruction /data/worker/jobs/ACTUAL_RECONSTRUCTION_JOB \
  --out /data/demo-export-01 \
  --title 'Walk the space. Keep the evidence.' \
  --credit 'Actual capture owner and permitted source credit' \
  --capture-kind phone-video
```

For a compiled model, add `--scene-job /data/worker/jobs/ACTUAL_SCENE_JOB` and
`--ending bim` or `--ending robot`. These commands use the existing saved outputs;
they do not reconstruct or modify the scene. The original capture kind/credit
remains operator-declared. Use `unknown` when the source type is uncertain.

Outputs are H.264 without audio: landscape 1280×720/35 s, social 1080×1350/35 s,
short 1080×1350/15 s, at 24 fps. All cuts retain the warnings and credit. The
receipt does not certify survey accuracy, BIM geometry or physical robot operation.
No output is published as successful until source/raster hashes are rechecked.

## Qualification

```sh
python -m pytest tests/world/test_demo_replay.py tests/world/test_worker.py \
  tests/world/test_tenant_isolation.py -q
node --test tests/world/demo-replay-ui.test.mjs
python tests/world/demo_replay_browser_smoke.py
```

Browser tests use authored rasters/geometry and the real private HTTP worker,
request upload, encoder, signed movie download and disposal. They do not execute
a reconstruction model. Existing World Builder browser flows cover the app shell.
Renderer tests exercise real H.264, a self-contained GLB, actual planar planning,
input tampering, unknown time, partial coverage and interrupted source bindings.

## November 2 private capture check

The original owner-provided `IMG_9824.mp4` and saved result archives were recovered
without changing them. A fresh CPU COLMAP run of the entire 140.13 s input posed
50 of 140 selected frames and retained 3,132 sparse points. Its consecutive-turn
check reported consistent; registration remains partial and no physical readings
or metric scale were supplied. These facts are not layout or physical accuracy
qualification. Source SHA-256:
`5586218ce0992ae9587a2995c2fe8bf6f77f835b2314c44e3eb58e50438e20d2`.

Three genuine replay cuts were encoded from this new run with explicit partial,
unscaled, source-type-unverified and precomputed-replay labels. They are private
diagnostic previews, not the successful BIM/robot promo. Original media, prepared
rasters, job artifacts and rendered movies stay outside git. The earlier folded
and partial runs remain separate historical evidence.

The remaining input for the polished measured BIM demo is a sufficiently complete
capture with an entered measured calibration span and withheld physical readings,
followed by reviewed scene exports. Rendering cannot repair absent geometry.

## Source-frame audit in World Builder (November 2 follow-up)

Opening a completed reconstruction with a full saved camera ledger now shows a
sample-order registration timeline (cyan = registered pose, red = not registered).
The three longest missing intervals are displayed and the owner can download
`brainsnn-frame-audit.csv` and `brainsnn-frame-audit.json` from Capture.
The export is tied to the reconstruction's own frame and camera lists and refuses
duplicate, missing, inconsistent or contradictory image names or counts.

The CSV deliberately leaves blur, feature-match counts, per-frame reprojection
errors, rejection explanations and original frame timestamps blank unless the
original evidence actually recorded them. The timeline depicts sampled-frame
order, not the physical footage timeline or spatial coverage. No new 3D surface,
scale calibration, pose estimate or robot claim is created by this UI.

For the recovered `IMG_9824.mp4` November 2 diagnostic, the saved frame ledger
contains 50 registered images of 140 sampled, with unregistered runs 27–46,
50–77 and 101–139 (zero-indexed). These are processing recovery targets,
not evidence of missing geometry's exact dimensions. A separate image-health
audit may identify retry candidates, but its ORB and blur signals must not be
mislabelled as COLMAP's actual rejection causes.

Suggested next engine work: preserve per-frame extraction PTS when possible,
save frame-health and match statistics at processing time, retry disconnected
camera components with verified correspondences, and regenerate geometry only
from validated poses. Do not auto-enable calibrated BIM or robot navigation.
