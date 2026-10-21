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
| Upload → viewer wall time | 11.0 s | `output/playwright/world/browser-video-timings.json` |
| Dense GPU reconstruction (MapAnything / VGGT) | not in this path | needs GB10/4090 gate; not fired |
| Scene/sim export (planner, USDA, Arena) | existing, untested here | separate measured-map path, not video-derived |

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
orbit, scroll to zoom, Export PLY, Evidence tab → Proof.

## What the viewer sees

A facade-like slab with a central niche, ~half the frame, orbitable. Labelled
`POINT CLOUD / SCALE UNVERIFIED`. Sparse by nature (6k points): gaps are real
gaps. Before this run the default camera framed the full extent including
far-triangulated outliers, so the subject was a speck in a black void; the
viewer now frames the 2nd–98th percentile core (no points are removed) and uses
a smaller footprint for sparse clouds. Screenshots:
`output/playwright/world/browser-video-reconstruction-BEFORE.png` vs
`browser-video-reconstruction.png`.

## Known limitations (say these out loud in the demo)

- Sparse SfM only on this path. Dense GPU reconstruction (MapAnything on GB10, VGGT on 4090) exists but is gated and was not fired.
- No metric scale, no collision geometry, no sim export from the video output yet. The planner/USDA path consumes measured maps, not this cloud.
- Fixture is a photo sequence, not a phone walkthrough. A real handheld clip with motion blur and rolling shutter will register fewer frames.
- Splat radius is uniform; the viewer's size control helps but there is no depth attenuation yet.

## Next (ranked by demo impact / effort)

1. Record one real 10–20 s handheld phone walkthrough and run this exact journey on it; that is the honest demo input. (owner, 10 min)
2. Depth-attenuated splat size in `visual-viewer.mjs` VERT (small shader change). (1–2 h)
3. Auto-orbit on load for demos (viewer already has `orbit()`; one flag). (30 min)
4. Wire the video-derived cloud into the Arena/planner import as a visual-only layer so "sim" is literally on screen. (half day)
5. GB10 MapAnything on the same clip through this UI for the dense before/after. (needs idle-GPU gate)
