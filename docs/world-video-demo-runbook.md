# Video → sim demo: verified runbook (Mac, CPU, 2026-10-21)

What the demo shows: a walkthrough video goes through the real World Studio UI,
the private worker API and the CPU COLMAP adapter, then renders as an orbitable
3D point cloud in the first-party viewer. Nothing is mocked. Scale is unverified
by design and the viewer says so.

## Verified run (fresh evidence)

| Stage | Status | Evidence |
|---|---|---|
| Video ingest + frame sampling (3 fps, near-duplicate filter) | real | `sparse_colmap.py` capture report: 11 images, 0 discarded, 6 near-duplicates kept |
| Multi-view reconstruction (PyCOLMAP 4.2.1, CPU) | real | 6,225 points, 11/11 images registered, mean reprojection 0.43 px, 9.1 s |
| Worker API (upload → job → artifact ticket) | real | `tests/world/worker_video_browser_smoke.py` passed, Chromium |
| Viewer (WebGL2 point viewer, PLY export, proof pack) | real | screenshot + `browser-video-points.ply` (93.6 KB) + proof JSON |
| Hand-off to Arena sim (point cloud → robot workspace) | real | "Open in Arena sim" → `brainsnn-point-cloud.json` (5,669 core pts, 556 outliers recorded) → Arena site workspace renders it upright on the floor grid behind the G1 proxy; `browser-video-arena-sim.png` |
| Upload → viewer wall time | 11.0 s | `output/playwright/world/browser-video-timings.json` |
| Dense GPU reconstruction (MapAnything / VGGT) | not in this path | needs GB10/4090 gate; not fired |
| Floor map from the video/photo | suggestion only | hand-off fits a floor plane (RANSAC, lowest dense layer), gravity-aligns the cloud when ≥10% of points sit on it, squares the heading on the floor band's principal axis, then estimates the footprint. Arena offers "Start unscaled floor map from this cloud" when band support ≥ 5% and places the cloud so the floor is on the grid. Synthetic room: grid on floor points, walls on edges. Fountain: 6.8% plane inliers → not rotated (facade). Owner's mezzanine photo: 25° pitch recovered, 55% of points on the floor, floor flat to ±0.02 across the depth; ~20° yaw residual because a single photo's floor is a perspective wedge |

Input: `fountain-clip.mp4` (1,456,188 bytes, SHA256 `7ecfa275…b7f5e`), 11 Strecha
Fountain photographs rendered as a 5.5 s 1280×960 H.264 sequence. It is a test
fixture, not a phone walkthrough.

## Exact commands (Mac)

Interpreters that already exist on this Mac (verify they still do):
`/tmp/brainsnn-world-colmap/bin/python` (fastapi, uvicorn, pycolmap) and
`/tmp/brainsnn-world-browser-venv/bin/python` (playwright, chromium-1248).

Automated journey (the thing to run before a demo, ~25 s total):

    cd /Users/slavaz/.hermes/workspaces/world-builder-validation/the-brain
    WORLD_VIDEO_TEST_CLIP=/Users/slavaz/.hermes/workspaces/world-builder-validation/demo-20261021/fountain-clip.mp4 \
    WORLD_COLMAP_PYTHON=/tmp/brainsnn-world-colmap/bin/python \
    WORLD_SERVER_PYTHON=/tmp/brainsnn-world-colmap/bin/python \
    /tmp/brainsnn-world-browser-venv/bin/python tests/world/worker_video_browser_smoke.py

Live demo in a real browser:

    cd /Users/slavaz/.hermes/workspaces/world-builder-validation/the-brain
    cat > /tmp/demo-adapters.json <<'EOF'
    [{"id":"colmap-sparse","label":"Video reconstruction (CPU)","enabled":true,"license_reviewed":true,
      "input_kinds":["image","video"],"max_inputs":12,"timeout_seconds":600,
      "command":["/tmp/brainsnn-world-colmap/bin/python",
                 "/Users/slavaz/.hermes/workspaces/world-builder-validation/the-brain/robotics/world_worker/sparse_colmap.py",
                 "--input-manifest","{input_manifest}"]}]
    EOF
    export WORLD_WORKER_TOKEN=demo-$(openssl rand -hex 12) WORLD_WORKER_DIR=/tmp/demo-worker-data \
           WORLD_ADAPTERS_FILE=/tmp/demo-adapters.json WORLD_ALLOWED_ORIGINS=http://127.0.0.1:8080
    echo "token: $WORLD_WORKER_TOKEN"
    /tmp/brainsnn-world-colmap/bin/python -m uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port 8765 &
    /tmp/brainsnn-world-colmap/bin/python -m http.server 8080 --bind 127.0.0.1 --directory brainsnn-r3f-app/public &
    open http://127.0.0.1:8080/world/index.html

In the page: drop the MP4 → Processing options → Connection → URL
`http://127.0.0.1:8765`, paste token, Connect → engine "Video reconstruction
(CPU)" → tick consent → Process. ~11 s later the point cloud loads; drag to
orbit, scroll to zoom, Export PLY, Evidence tab → Proof. Then **Open in Arena sim**:
it saves `brainsnn-point-cloud.json`, opens the Arena site workspace in a new tab;
there click Capture → Add 3D visual → pick that JSON. The cloud stands on the
floor grid next to the robot as a visual-only reference.

## What the viewer sees

A facade-like slab with a central niche, ~half the frame, orbitable. Labelled
`POINT CLOUD / SCALE UNVERIFIED`. Sparse by nature (6k points): gaps are real
gaps. Before this run the default camera framed the full extent including
far-triangulated outliers, so the subject was a speck in a black void; the
viewer now frames the 2nd–98th percentile core (no points are removed) and uses
a smaller footprint for sparse clouds. Screenshots:
`output/playwright/world/browser-video-reconstruction-BEFORE.png` vs
`browser-video-reconstruction.png`.

## Phone / installable app (universal, no native build)

- `/world/` is an installable PWA: `manifest.webmanifest`, icons (maskable + apple-touch), `sw.js` shell cache (network first; offline opens the shell; never caches `/v1/` or cross-origin). iOS: Share → Add to Home Screen (the Capture panel shows the hint); Chromium: install prompt.
- Exports on phones go to the native share sheet (Files, AirDrop, Mail) with all files of an export in one share; desktop and any share failure fall back to downloads. Contract: `tests/world/browser_smoke.py::check_app_shell` (Chromium + WebKit).
- Physical-iPhone session: `demo-20261021/phone_session.sh` serves World + Arena + the real COLMAP worker on one local origin and exposes it for 60 min over HTTPS (basic auth). Open `$URL/world/`, connect worker with `$URL` + token from `session.env`, record a walkthrough, process, Open in Arena sim. Record what breaks (HEVC/HDR, orientation, size).

## Known limitations (say these out loud in the demo)

- Single photo (Depth Anything on-device, ~6 s): relative depth, no multi-view; the floor is a wedge, so the footprint box is coarse and the heading can be ~20° off. Good for "photo → explorable 3D → robot on the floor"; not a map.

- Sparse SfM only on this path. Dense GPU reconstruction (MapAnything on GB10, VGGT on 4090) exists but is gated and was not fired.
- No metric scale, no collision geometry. The Arena cloud is a visual reference; the planner still consumes the hand-drawn, measured floor map.
- The Arena hand-off drops the far 2% per axis (recorded in `provenance.outliersDropped`) so the subject sits on the floor; the World viewer and PLY keep every point.
- Fixture is a photo sequence, not a phone walkthrough. A real handheld clip with motion blur and rolling shutter will register fewer frames.
- Splat radius is uniform; the viewer's size control helps but there is no depth attenuation yet.

## Next (ranked by demo impact / effort)

1. Record one real 10–20 s handheld phone walkthrough and run this exact journey on it; that is the honest demo input. (owner, 10 min)
2. Depth-attenuated splat size in `visual-viewer.mjs` VERT (small shader change). (1–2 h)
3. GB10 MapAnything on the same clip through this UI for the dense before/after. (needs idle-GPU gate)

Done in this pass: auto-orbit on load; Arena hand-off; floor estimate → unscaled starting map (still needs one real measurement to scale).
