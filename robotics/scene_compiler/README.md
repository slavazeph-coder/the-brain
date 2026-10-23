# Scene compiler (stage 1)

Turns a World Builder hand-off into a simulation-ready scene, headless, with Blender 4.0+:

    blender -b --python robotics/scene_compiler/scene_compiler.py -- --cloud brainsnn-point-cloud.json [--detections observations.json --fov 60] --out DIR
    blender -b --python robotics/scene_compiler/render_scene.py -- DIR/scene.blend DIR      # iso/top/front PNGs

Outputs: `scene.glb` (browser Arena), `scene.usda` (Isaac Sim / Omniverse; written directly because Ubuntu's Blender lacks the
USD exporter), `scene.blend`, `scene.json` (every object with label, size, centre, provenance and support-point count).

Provenance is the contract: `observed` (floor footprint, PCA-oriented walls from the points), `detected` (on-device 2D detections
lifted to 3D boxes with the points behind them), `unknown` (floor cells no point touched — exported as a tagged volume, never as
free space). Nothing is inferred in stage 1. Only multi-view clouds (`sourceFrame: colmap`) are accepted; single-photo depth
is refused because it is a perspective wedge, not geometry (`--allow-unverified` for experiments).

Tests (no Blender): `python3 -m unittest tests.scene_compiler.test_geometry tests.scene_compiler.test_scene_usd`

## Worker engine `scene-usd` (GB10)

`robotics/world_worker/scene_usd.py` is a `brainsnn.adapter.v1` adapter that runs the whole chain for one walkthrough video:
`sparse_colmap.run()` → Python port of the browser's `toArenaCloud()` (`arena-cloud.json`, identical output to a browser export
of the same PLY) → this compiler in headless Blender → `scene.glb`, `scene.usda`, `scene.json` (kind `visual`/`evidence`) plus the
reconstruction artifacts. Units stay `arbitrary` unless the request carries `{"scale": {"metres_per_unit": k, "measurement": {...}}}`.
`adapters.gb10.json` registers it on GB10 (pycolmap 4.2.1 from conda-forge in a micromamba env, since PyPI ships no linux-aarch64 wheel;
Blender 4.0.2 at `/usr/bin/blender`):

    WORLD_WORKER_TOKEN=... WORLD_WORKER_DIR=... WORLD_ADAPTERS_FILE=robotics/world_worker/adapters.gb10.json \
      python -m uvicorn robotics.world_worker.app:create_app --factory --host 127.0.0.1 --port 8768

Fountain clip on GB10: 11/11 frames registered, 6,195 points, 0.43 px reprojection, 1 wall, scene.glb ≈ 3 MB, ≈ 18–21 s end to end
(direct adapter run and through the worker HTTP API). COLMAP is not bit-reproducible run to run, so floor/unknown-cell counts vary.

Stage 2 (planned): reference assets fitted into detected boxes (Objaverse / Blender asset library), and an LLM layout proposal
for unknown cells, emitted as a separate `inferred` layer the planner ignores.
