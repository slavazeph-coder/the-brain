# SOMA motion references

The `motion-retarget` worker runs NVIDIA SOMA Retargeter **v0.2.1**, commit
`cbdb2b494a2af82137bf9b6f15122d60167281c4`, with Newton 1.3.0 and Warp 1.14.0.
It converts an authorized, SOMA-compatible BVH animation into a **Unitree G1
29-DOF kinematic reference** and synchronized human/robot articulated previews.
This is real upstream inverse kinematics, scaling, contact/foot-plant processing
and joint-limit clamping. There is no canned or substitute result if it fails.

It does not reconstruct motion from ordinary video, train a controller, perform
physics simulation, establish balance/collision clearance or command hardware.
NVIDIA describes GEM-X as a separate video-to-SOMA stage. Existing BrainSNN
selected-side 2D movement observations are not sufficient input. A compatible
tracking policy and simulation qualification remain separate downstream work.

## Input and timing contract

Exactly two uploads are required:

| Kind | File | Limits |
| --- | --- | --- |
| `motion` | UTF-8 `.bvh` | 8 MiB; 2–1,800 frames; 1–240 FPS; ≤60 s from first to last sample; ≤128 joints; hierarchy depth ≤32 |
| `retarget` | `.json` | 16 KiB; strict known keys; duplicate keys and nonfinite values rejected |

Example options:

```json
{
  "schema": "brainsnn.motion-retarget-options.v1",
  "target": "unitree_g1",
  "source_units": "cm",
  "source_up_axis": "Y",
  "source_facing": "Mujoco",
  "fps": 30
}
```

`source_units` accepts `cm` or `m`; only length values are normalized to the
upstream centimeter BVH contract. The original bytes are retained. This first
profile requires right-handed Y-up SOMA motion and explicit upstream facing
convention `Mujoco` or `Maya`. They name upstream conversion presets, not a
guessed camera direction. Unsupported axes/skeletons are rejected. Source joint
names, order and parent topology must match the pinned SOMA base rig exactly;
same joint counts alone are insufficient. Declaring the schema does not verify
physical scale or the correctness of the performer's reconstruction.

Frame time comes from the BVH. Optional `fps` is an assertion and must agree;
no resampling or default 120 FPS is used. Output preserves every source frame,
including noninteger frame rates. Source/channel values and hierarchy are
validated before native imports. Paths, commands, robot files, solver settings,
devices and postprocessing switches cannot be selected through upload JSON.

## Artifacts

| File | Meaning |
| --- | --- |
| `original-motion.bvh` | Exact uploaded bytes, source hash retained |
| `normalized-soma.bvh` | Canonical line layout and centimeter normalization used by the real solver |
| `retarget-options.json` | Exact uploaded options |
| `robot-reference.csv` | Upstream robot root position/orientation and 29 ordered joint values |
| `motion-preview.json` | Source-bound, synchronized human and robot articulated positions plus joint angles |
| `motion-reference.json` | Timing, units, source/model/config hashes, versions, contact and joint-limit diagnostics |

The CSV has **centimeter translations**, **degree angles**, Newton
**right-handed Z-up coordinates**, extrinsic XYZ root Euler angles, and **no
frame-rate field**. Keep its receipt with it. Browser preview coordinates are
meters in BrainSNN right-handed Y-up, converted as `(x, z, -y)` from Newton.
No separate per-track centering or display separation is baked into the data.

Preview schema `brainsnn.motion-preview.v1`:

```text
role: motion-reference
units: m
coordinate_frame: right-handed-y-up
source_sha256, runtime_commit, model_sha256, configuration_sha256, csv_sha256
fps, frame_count, duration_seconds, frame_times_seconds[F]
human: { joint_names[J], parents[J], positions[F][J][3] }
robot: { target: unitree_g1, joint_names[K], parents[K], positions[F][K][3] }
joint_order[29], joint_angles_rad[F][29]
robot_control_enabled: false
physics_executed: false
```

Parent `-1` denotes a root; other indices refer to earlier entries in the same
track. Robot link transforms come from Newton forward kinematics of the actual
retargeted joint coordinates. They are not a human stick figure relabeled G1.
The renderer may add separate visual offsets, but should keep a shared clock
and avoid implying either track has been registered to a captured building.

Joint-limit checks use the actual model's DOF-to-coordinate mapping, account for
the free root and fail on violations after upstream clamping. Contact weights
come from upstream source-foot velocity/jerk heuristics. They are not measured
contacts or proof of stable support. The receipt explicitly leaves policy,
physics, balance, collisions and actuator dynamics unqualified.

## Reproducible headless installation

Use a separate Python **3.12** environment. The headless requirements deliberately
omit the upstream interactive GUI dependencies, without changing its solver.
No Python dependency from this environment needs to be installed into the main
API process. Example Linux worker-image build steps, run at repository root:

```sh
python3.12 -m venv /opt/soma/venv
/opt/soma/venv/bin/pip install -r robotics/motion_retarget/requirements-headless.txt
/opt/soma/venv/bin/python -m robotics.motion_retarget.setup_runtime \
  --destination /opt/soma/upstream
WARP_CACHE_PATH=/opt/soma/warp-cache OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 \
  /opt/soma/venv/bin/python -m robotics.motion_retarget.qualify \
  --runtime-dir /opt/soma/upstream --out /opt/soma/qualification
```

The installer needs Git and outbound HTTPS **at build time only**. It checks out
the exact commit, verifies source bytes against the Git tree and resolves only
G1/reference-rig Git LFS objects using their committed SHA-256/size. It does not
download the separately licensed example motion corpus. It writes
`brainsnn-runtime.json`, listing all executable package files, relevant robot
assets and installed dependency versions. Jobs verify this manifest and the
fixed dependency versions, import the verified source checkout, and never
download models or assets. Keep the source/runtime directory read-only to jobs.

The qualifier authors a 31-frame arm sweep using the package's Apache-licensed
neutral rig, executes actual upstream CPU IK, checks changing G1 articulation,
finite source/robot tracks, parent indices, frame timing, CSV and limit bounds,
and writes `qualification.json`. It also warms Warp's native compilation cache.
Keep the cache available at the same configured path in the running image,
writable by its worker user if Warp needs an additional specialization. A build
must fail if qualification fails; never advertise an installed-but-unrun engine
as qualified. Pin the host image separately in the owning deployment pipeline.

Run jobs with the isolated interpreter and absolute trusted adapter path:

```text
/opt/soma/venv/bin/python
/app/robotics/world_worker/motion_retarget.py
--input-manifest
{input_manifest}
```

The adapter also supports `python -m robotics.world_worker.motion_retarget` when
the repository is importable. Its absolute-file bootstrap supports the existing
worker's private job cwd without accepting PYTHONPATH from uploads.

Operator environment allowlist:

| Variable | Example/default |
| --- | --- |
| `WORLD_SOMA_RUNTIME_DIR` | Required: `/opt/soma/upstream` |
| `WORLD_SOMA_DEVICE` | `cpu` by default; `cuda:0` is explicit and separately qualified |
| `WARP_CACHE_PATH` | `/opt/soma/warp-cache` |
| `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS` | `2` each by default |

Use the existing owner authorization, finite subprocess timeout and cancellation,
worker concurrency and memory limits. The engine receives exactly `motion` and
`retarget`, max inputs 2. The hosted profile uses a 900-second timeout to cover
longer admitted clips; qualify deployment hardware and adjust its frame budget before
promising throughput. Native CPU execution is useful for short clips and does
not imply real-time performance for the full 1,800-frame limit. CUDA never
silently falls back; missing runtime or solver errors fail without publishing a
manifest. Partial staging files are removed on normal failure, and a successful
existing output is never overwritten.

## Verification and licensing

`tests/world/test_motion_retarget.py` covers malformed hierarchies/frame counts,
nonfinite values, resource bounds, topology mismatches, FPS disagreements,
meter normalization, duplicate/unknown JSON fields, symlinks, input hash changes,
missing runtime and actual absolute-CLI execution with PYTHONPATH removed.

```sh
WORLD_SOMA_RUNTIME_DIR=/opt/soma/upstream \
WORLD_SOMA_TEST_PYTHON=/opt/soma/venv/bin/python \
python -m pytest -q tests/world/test_motion_retarget.py
```

Without the two runtime variables the real execution test is explicitly skipped;
the admission tests are not advertised as solver qualification.

November 18, 2026 local evidence: actual CPU execution on macOS ARM64 with the
pinned packages passed 31 frames / 30 FPS, produced 29 changing G1 joint angles,
source-bound human and robot tracks and zero post-clamp limit violations.
All 22 regressions passed with real execution enabled. This extends the official
Windows/Linux GPU installation guidance only for the tested headless CPU path;
the production Linux image must run the same qualifier. The available RTX 4090
was inspected read-only, with driver 535.230.02 and ongoing workloads. No remote
GPU job, driver/service change or live-workload interruption was made.

NVIDIA-authored source/reference-rig assets use Apache 2.0; Unitree robot assets
have their bundled BSD-3-Clause notice. Preserve these notices when redistributing
an image. The separate `assets/motions` BVH/CSV/optimizer examples have the NVIDIA
Sample Data Evaluation License, restricting use to internal NVIDIA technology
evaluation and prohibiting redistribution of samples or derivatives. They are
not included by this installer, fixture generator or product sample. Inputs must
be owned or appropriately licensed; optional future GEM-X weights/assets have
their own terms.

Primary sources: [pinned upstream](https://github.com/NVIDIA/soma-retargeter/tree/cbdb2b494a2af82137bf9b6f15122d60167281c4),
[batch/CSV contract](https://github.com/NVIDIA/soma-retargeter/blob/cbdb2b494a2af82137bf9b6f15122d60167281c4/documentation/batch-retargeting.md),
[source license](https://github.com/NVIDIA/soma-retargeter/blob/cbdb2b494a2af82137bf9b6f15122d60167281c4/LICENSE),
[sample-motion license](https://github.com/NVIDIA/soma-retargeter/blob/cbdb2b494a2af82137bf9b6f15122d60167281c4/assets/motions/LICENSE.txt),
[video and downstream-policy explanation](https://developer.nvidia.com/blog/adapt-human-motion-for-robots-with-nvidia-soma-retargeter/).
