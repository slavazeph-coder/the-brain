# BrainSNN terrain focus and ETH Zurich FPM integration

## Scope

Research integration of **Watch Your Step: Anticipated Perception for Humanoid
Locomotion** (Heyrman, Li, Dadiotis, Hutter; arXiv:2610.29612, 21 October 2026).
Primary project: https://leggedrobotics.github.io/watch-your-step/
Code: https://github.com/leggedrobotics/foothold-prediction-model
Pinned revision: `20009c33639a55c100c21e0c4747bec13b22f161`.
The authors' code/model use MIT; their bundled Unitree model has a separate BSD
license. BrainSNN downloads only the small predictor and its MIT license here,
not the Unitree robot asset or the full locomotion-policy checkpoint.

This is **not a reconstruction improvement or a learned footstep planner**.
The predictor estimates where its trained G1 gait will step. Those estimates
choose which terrain to observe; the walking policy still chooses its actions.
The authors continue to construct a full elevation map. The 693-to-102 reduction
concerns policy inputs, not camera-processing cost or total GPU memory. Their
training-efficiency results have not been reproduced by BrainSNN.

## Implemented paths

1. Building-model review mounts a local terrain inspector on the exact compiled
   `arena-cloud.json`. It does not need another upload. Enter a hypothetical base
   position, yaw and two query positions. The browser shows two 7x7 grids and
   exports source-bound diagnostic evidence. This browser mode uses **operator
   queries, not learned predictions**.
2. `foothold_perception.py` exposes the same point-binning and patch-sampling
   functions and a CLI. Python/JavaScript fixtures check agreement.
3. `fpm_bridge.py` verifies the pinned model bytes **before TorchScript loading**,
   runs CPU inference on supplied robot-state vectors, and optionally connects
   predictions to a specified BrainSNN terrain snapshot. No actuator transport,
   robot command, full actor or physics runtime is included.
4. New Omniverse packages include the two Python tools and instructions under
   `research/`. No model is fetched or executed during packaging.

## Coordinate and observation contract

BrainSNN world: right-handed Y-up, `[X,Y,Z]` metres.
Isaac convention: `[X,-Z,Y]`, right-handed Z-up. Yaw is positive toward left about
Isaac +Z; this is not the same sign as Three.js +Y yaw.
The source grid has 33 forward x 21 lateral samples at 0.05 m spacing, over
[-0.8,+0.8] x [-0.5,+0.5]. Each patch samples offsets [-3,+3] in both directions.
The span between extreme sample centres is **0.30 m**; seven 0.05 m cells have
0.35 m footprint. Do not confuse these two measures.

Layout: `[p1.forward,p1.left,49 heights,p2.forward,p2.left,49 heights]`.
Patch flattening is forward-offset outer, lateral-offset inner; the full map is
indexed `lateral * 33 + forward`. Anchors reproduce upstream float32 arithmetic
and nearest-even rounding. Heights are `sensor_height - surface_height - 0.5`;
raw and [-1,+1]-clipped observations are reported separately.

`sample_patches` accepts separate sensor-frame query coordinates when an
integrator has the actual transforms. The convenience snapshot adapter supports
only an upright body with coincident yaw-only sensor; it rejects tilted state
instead of guessing roll/pitch transforms.

## Evidence gates

The inspector requires explicit metres and coordinate frame, finite bounded
inputs, at most 250,000 points, and by default at least two points per cell with
at most 3 cm vertical spread. It bins only points 0.05–2 m below the hypothetical
base. These are **engineering assumptions for inspection**, not measured sensor
precision or proof of supporting horizontal ground.

Unknown, insufficient and mixed-height cells remain null. Off-map patches do
not clamp to an edge and duplicate ground. If any of the 98 heights is unknown,
no numeric 102-value observation is emitted. The mask is diagnostic metadata;
it is NOT appended to the pretrained policy's observation vector.

Even complete patches retain `checkpoint_compatible=false`,
`metric_verified=false`, `robot_control_enabled=false`, and
`physics_executed=false`. Point-bin averages are not the authors' simulator
raycast observations. Coverage does not establish foot support, friction,
head/torso clearance, moving obstacles, sufficient capture density or stability.

## Run without a learned model

From a repository checkout (or run the matching Python file from an exported pack):

```sh
python -m robotics.world_worker.foothold_perception \
  --cloud /path/to/arena-cloud.json --query /path/to/query.json \
  --out /path/to/new-evidence.json
```

Example query (hypothetical placement; adjust to the captured space):

```json
{"schema":"brainsnn.foothold-query.v1","base_position_brainsnn_m":[0,0.8,0],"yaw_rad":0,"footholds_base_xy_m":[[0,0.1],[0,-0.1]],"min_points":2,"max_spread_m":0.03}
```

## Run the actual pretrained predictor

Use an isolated Python environment with PyTorch. Qualification uses CPU
`torch==2.10.0`; this does not require GPU access or change the production worker.
Review the MIT license, then:

```sh
python -m robotics.world_worker.fpm_bridge download \
  --out /path/to/new-fpm-model --license-reviewed
python -m robotics.world_worker.fpm_bridge predict \
  --model-dir /path/to/new-fpm-model --state /path/to/robot-state.json \
  --cloud /path/to/arena-cloud.json --query /path/to/query.json \
  --out /path/to/new-predicted-terrain-report.json
```

State JSON has `layout: "fpm-system-state-70-v1"`,
`joint_order_reviewed: true`, and `states: [[...70 numbers...]]`.
Use the upstream **unscaled** `SystemStateCfg` order: 3 body linear velocities,
3 body angular velocities, 3 projected-gravity components, 3 velocity commands,
29 joint-position offsets and 29 joint-velocity offsets. Confirm actual joint
ordering against the upstream G1 articulation. Do not feed the scaled actor
observation, invent telemetry from a scan, or apply another normalizer: the
TorchScript wrapper already contains input normalization.

Omit `--cloud` and `--query` to predict a batch of up to 128 states without
sampling. All outputs are created exclusively, never overwritten. Keep models,
query inputs and results outside immutable Omniverse pack directories.

## Full locomotion experiments remain separate

The upstream README specifies Isaac Sim 5.1, Isaac Lab 2.3.0 and
rsl-rl-lib 3.3.0. Keep that GPU environment separate from Railway. Use the pinned
upstream playback on its original terrains first; then validate a static terrain
mesh from BrainSNN before changing its ray-caster and environment configuration.
A USD that opens correctly is not automatically a compatible G1 test course.
Unknown surfaces must not be replaced with a continuous floor for convenience.

Compare repeated falls, distance covered, command tracking and observation
validity on identical terrains/seeds. Keep forward, sideways, reverse and
whole-body-clearance cases. The predictor is gait-specific; new robots or a
changed policy require a matched predictor/co-training and fresh validation.
No physical robot execution is enabled by this change.

## Verification

Local: Python geometry/input tests, Python-JavaScript parity, JavaScript
contracts and Chromium desktop/mobile-sized UI with inline modules (localhost
navigation is blocked by this execution environment). CI separately tests real
HTTP browser loading, exact pinned pretrained inference on a synthetic upright
state, upstream-style tensor-layout parity, real USD package composition and
existing World Builder contracts. Inspect the final CI receipts for outcomes;
no physical-phone, physics, training-speed or hardware claim follows from them.
