# Reachy Mini motion workspace: third-party material

All files here are redistributed unmodified under the Apache License 2.0.

| Files | Source | Licence |
|---|---|---|
| `reachy-mini.urdf`, `default_state.json`, `meshes_optimized/*.glb` | [8bitkick/reachy_mini_3d_web_viz](https://huggingface.co/spaces/8bitkick/reachy_mini_3d_web_viz), as shipped in [pham-tuan-binh/reachy-motion-generator](https://github.com/pham-tuan-binh/reachy-motion-generator) `visualizer/assets` at commit `96497d69a31cc89da209f224bd9c1fee1834b864` | Apache-2.0, `LICENSE-reachy_mini_3d_web_viz.txt` |
| `../examples.json` | pre-generated outputs of the reachy-motion-generator 27B planner, `visualizer/examples/examples.json` at the same commit (whitespace removed) | Apache-2.0, `../LICENSE-reachy-motion-generator.txt` |
| `src/arena/reachy/StewartIK.js`, `src/arena/reachy/Kinematics.js` (bundled into `../renderer.js`) | reachy-motion-generator `visualizer/src` at the same commit; the IK is a port of [pollen-robotics/reachy_mini_rust_kinematics](https://github.com/pollen-robotics/reachy_mini_rust_kinematics) with the SDK's kinematics data, the passive-joint kinematics come from reachy_mini_3d_web_viz | Apache-2.0 |
| `draco/` (generated at build time) | the Draco decoder distributed with three.js | Apache-2.0 |

Reachy Mini is a robot by Pollen Robotics. BrainSNN is not affiliated with Pollen Robotics, Hugging Face or the
authors above.
