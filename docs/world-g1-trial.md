# BrainSNN bounded G1 trial

This is an **experimental offline evaluation runner**, not a website walking button or a robot controller.
It consumes an extracted BrainSNN Omniverse pack and a reviewed scenario, prepares one static triangle mesh,
then runs the matched ETH Watch Your Step policy and predictor in their original Isaac Lab stack.
A successful CPU qualification is explicitly **not** a walking result.

## Exact software and scope

- ETH source: `leggedrobotics/foothold-prediction-model` at `20009c33639a55c100c21e0c4747bec13b22f161`.
- Policy: `demo/model_10000.pt`; predictor: `demo/foot_model_10002.pt`. Both are checked against immutable Git blobs before loading.
- Isaac Sim 5.1, Isaac Lab 2.3.0, `rsl-rl-lib==3.3.0`, Linux x86-64, one isolated NVIDIA GPU.
- First trial: one G1, one straight commanded segment, maximum 30 simulated seconds and 900 wall-clock seconds.
- No training, automatic resets, physical robot transport, background worker or cloud provisioning.
- No other GPU process is stopped. Admission requires at least 12000 MiB free and utilization <=20%; this is a conservative local operating limit, not a vendor performance guarantee.
- Simulator execution is **unqualified until an actual GPU receipt exists**. CPU CI exercises the real checkpoint pair, geometry conversion and failure contracts only.

Primary source contracts:
https://github.com/leggedrobotics/foothold-prediction-model/tree/20009c33639a55c100c21e0c4747bec13b22f161
https://github.com/isaac-sim/IsaacLab/tree/v2.3.0
https://github.com/leggedrobotics/rsl_rl/tree/v3.3.0

## Prepare a scene

Use a separate preparation environment with `usd-core==25.8`, NumPy and Pillow. Do not replace Isaac's bundled USD libraries.
Start with the synthetic fixture provided in the qualification artifact before using a captured room.
The fixture is a 6 x 4 m floor with an 8 cm threshold, not a measured physical room.

```bash
python -m robotics.g1_trial prepare \
  --pack /data/extracted-omniverse-pack \
  --spec /data/reviewed-g1-scenario.json \
  --out /data/prepared-g1-trial
```

The scenario uses schema `brainsnn.g1-trial.v1`. Its source hashes bind `source/scene.json`, `source/arena-cloud.json`
and `source/scene.usda`. Select exact Cube or already triangulated Mesh paths under `/World/`, not a parent group.
The output is a separate, metre-authored Z-up terrain mesh using `(x,y,z) -> (x,-z,y)`; original files are unchanged.
Transform signs and winding are preserved. No infinite plane or gap filling is added. NVIDIA library bodies are deliberately
not part of this first static-terrain trial. Include only reviewed terrain and low static obstacles; do not silently treat
ceilings as foot-support surfaces. Geometry is compiled evidence/proxies, not surveyed truth.

Required scenario fields (see the generated synthetic `scenario.json` for actual values):

- `reviewed: true`, `source_kind: synthetic|captured`, exact `source_sha256` map;
- `collision_prims`, `reviewed_bounds_xz_m: [minX,minZ,maxX,maxZ]`;
- `start_ground_y_up_m`, `goal_ground_y_up_m`, and `yaw_rad` toward the straight goal;
- `duration_s`, `speed_m_s`, `goal_tolerance_m`;
- `friction: {static, dynamic, basis: simulation-assumption}`.

For **captured** data, provide one calibration and at least three withheld checks in different directions:
`measurements: [{role, point_indices:[i,j], distance_m, tolerance_m, method, independently_measured:true}, ...]`.
These reference the original cloud point indices. Reusing calibration as a withheld check, failed distances,
missing methods and single-direction checks are rejected. A passing user-entered check still does not certify physical accuracy.

## Run on the existing 4090, in an isolated environment

Use the authors' documented Isaac Sim 5.1 / Isaac Lab 2.3.0 environment. Do not install a different simulator into the
production worker. Review upstream MIT and the original Unitree BSD-3-Clause asset license before using the robot model.
The pinned source predates the repository's later explicit dependency-license inventory; the original Unitree terms still apply.

```bash
git clone https://github.com/leggedrobotics/foothold-prediction-model.git /workspace/g1-fpm
git -C /workspace/g1-fpm checkout 20009c33639a55c100c21e0c4747bec13b22f161
# Run from the BrainSNN checkout using the matched Isaac Lab Python interpreter:
python -m robotics.g1_trial preflight
python -m robotics.g1_trial run \
  --bundle /data/prepared-g1-trial \
  --upstream /workspace/g1-fpm \
  --out /data/g1-trial-run-001 \
  --wall-seconds 600 --video
```

No `pip install -e` of FPM is required: the runner imports only the verified clean checkout. Install the upstream
runtime requirements in the isolated Isaac environment. The runner refuses unexpected source revisions, dirty source,
extra predictor files, changed prepared bytes and insufficient hardware. All output directories must be new and outside
both the source checkout and immutable scene package.

## What the runner records

`receipt.json` distinguishes blocked admission, failure, timeout and a completed episode. `result.json` records actual
policy-forward count, physics calls, observed substeps, stop reason, joint names and source hashes. `trace.jsonl` records
base motion, tilt, contact checks, actions and foothold observations. `--video` asks Isaac for an actual rendered recording;
no animation is substituted when rendering is unavailable.

Goal success requires a live episode reaching the goal before a fall, body contact or departure from reviewed bounds.
Termination/reset machinery is disabled after the single initial reset to prevent an auto-reset from hiding a fall.
The terrain wrapper checks the exact patch selected by the upstream predictor before the policy can use it. Missing rays,
invalid observations and out-of-grid patches stop the trial; they are not flattened or clamped into artificial ground.
Friction, static colliders and initial pose remain explicit simulation assumptions.

The static terrain's height raycaster preserves the upstream 693-ray grid and 102-value policy observation. The simulator
runs the authors' policy through their RSL runner, rather than substituting scripted foot motions. The CPU-only qualification
runs actual policy inference on a synthetic 201-value observation and expects 29 actions; it does not evaluate the gait.

## Current boundary

No connected GPU or matched simulator was available in the authoring session, and no captured scene with withheld
physical measurements was supplied. Therefore no completed walking episode, real-room traversal, physics validation or
hardware safety claim is made. The exact missing-runtime report is retained as evidence rather than a success receipt.
