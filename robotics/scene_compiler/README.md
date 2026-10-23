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

Tests (no Blender): `python3 -m unittest tests.scene_compiler.test_geometry`

Stage 2 (planned): reference assets fitted into detected boxes (Objaverse / Blender asset library), and an LLM layout proposal
for unknown cells, emitted as a separate `inferred` layer the planner ignores.
