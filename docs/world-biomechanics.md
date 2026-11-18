# Native model-based movement analysis

The `biomechanics` worker executes **OpenSim 4.6 on CPU**. An authorized model
and matching motion produce body poses, signed joint coordinates, center of
mass, muscle-tendon path lengths and selected moment arms. Inverse dynamics
runs only with supplied external body forces or an explicit applicable
no-contact/no-applied-load declaration. Gravity comes from the model.

This does not capture people from video, establish individual anatomy, estimate
muscle activation or ground reaction forces, run muscle-driven forward
simulation, or provide clinical validation. Existing 2D movement observations
and SOMA robot references remain separate input contracts.

## ENABLE and licensing

SwRI's ENABLE uses proprietary, patented capture algorithms with OpenSim. Its
published requirements are synchronized video from at least two cameras, an
NVIDIA GPU with 2 GB memory, and Windows/Linux. It performs camera calibration
and exports scaled OpenSim models, constrained 3D points, inverse-kinematics
results and segment transforms. Commercial and academic licenses are offered.
The reviewed public pages contain no REST/redistributable SDK contract. Licensed,
authorized OpenSim exports are the useful integration boundary; no ENABLE
software, weights or API are installed here. See
[SwRI capabilities and licensing](https://www.swri.org/markets/biomedical-health/biomedical-devices/biomechanics-human-performance/enable/engine-automatic-biomechanical-evaluation-enable/enable-capabilities-licensing).

The [2026 brochure](https://www.swri.org/sites/default/files/brochures/enable-markerless-biomechanics-software.pdf)
illustrates $15,000 commercial and $10,000 academic licenses plus user-supplied
hardware. These are published example costs, not a current negotiated quote or
hosted-service/redistribution authorization. No purchase, contact or upload to
SwRI occurred. [OpenSim's Apache 2.0 license](https://github.com/opensim-org/opensim-core/blob/4.6/LICENSE.txt)
permits commercial use; preserve its license, notices and third-party component
terms. User models/datasets may have separate licenses. The bundled mechanism
and motion are authored examples, not third-party or medically validated data.

## Inputs and boundaries

Use `brainsnn.adapter.v1`, without a source job:

| Kind | File | Limit |
| --- | --- | --- |
| `biomech-model` | `.osim` | 8 MiB, self-contained OpenSim 4 |
| `biomech-motion` | `.mot`/`.sto` | 8 MiB, 2–1,800 frames, ≤60 seconds |
| `biomech-options` | `.json` | 32 KiB |
| `biomech-loads` (optional) | `.json` | 8 MiB, only supplied-force analysis |

```json
{"schema":"brainsnn.biomechanics-options.v1","analysis":"kinematics","model_up_axis":"Y","length_units":"m","moment_arm_coordinates":["knee_angle_r"]}
```

Motion starts with `time` and provides every model coordinate exactly once,
including unchanged locked coordinates. Full `/jointset/.../coordinate/value`
labels are accepted, not `/speed` or activation columns. Declare angular units
exactly once as `inDegrees=yes` or `inDegrees=no`; only rotations are converted,
translations stay meters. All original timestamps and frames are preserved.
Missing coordinates are never silently filled from defaults.

Limits: 128 bodies/coordinates, 256 muscles, four moment-arm coordinates,
30,000 XML elements, 100,000 body-frames and 500,000 muscle-frame-coordinate
evaluations. An omitted moment-arm selection uses the first four rotational
coordinates and records their names. Preview output is capped at 48 MiB;
the worker profile has a 900-second process timeout.

DTD/entity/external XML, file/plugin/script references, controllers, probes,
analyses and extra components are rejected before native loading. Display
geometry is omitted from an explicitly retained analysis copy, so missing
meshes cannot trigger file access. Original XML is preserved. Joints, body
axes/centers and real native poses remain visible without meshes. Nonfinite
numeric properties and excessive complexity are rejected. Unsupported native
components or disconnected/cyclic body trees fail rather than yielding a
substitute result. Native assembly must preserve supplied coordinates; clamping
or projection changes fail. Prescribed coordinates are unsupported.

## Inverse dynamics

Choose `analysis:"inverse-dynamics"` and `external_loads:"supplied"`, or
`external_loads:"none-declared"` with a 20–500 character
`no_external_loads_reason`. The latter means no contacts/applied forces except
gravity. It is a user assumption, not proof of zero human ground reaction.

```json
{
  "schema":"brainsnn.biomechanics-loads.v1",
  "coordinate_frame":"ground",
  "time_s":[0,0.1,0.2,0.3,0.4],
  "loads":[{"body":"lower_segment",
    "force_N":[[0,10,0],[0,10,0],[0,10,0],[0,10,0],[0,10,0]],
    "point_m":[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
    "torque_Nm":[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]}]
}
```

Forces, absolute application points and free torques are all in the model's
ground frame, explicitly provided at each motion timestamp. At most 32 body
loads are accepted. Native inverse dynamics includes model gravity and these
loads; internal muscle/contact/actuator forces are excluded and listed, avoiding
unprovided muscle-state assumptions.

At least five frames are required. Locked coordinates, explicit constraints
and quaternion coordinate representations are not supported for inverse
dynamics. Native `N` and `NDot` map coordinate derivatives to mobilizer speeds
and accelerations. Cubic interpolation differentiates the original motion with
no filtering. Outputs are model generalized joint loads in N or N m, not muscle
forces or bone-on-bone contact loads. Noise can strongly distort derivatives.

OpenSim's [inverse-dynamics guide](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting+Started+with+Inverse+Dynamics)
requires appropriate inertial parameters and measured/modeled external forces
for accurate joint loads. Its [simulation planning guide](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090652/Planning+an+OpenSim+Simulation)
separately describes additional muscle anatomy/parameters needed for muscle-driven
simulation. Full human contact and forward tracking remain separate work.

## Artifacts and source bindings

Results preserve `original-model.osim`, `original-motion.mot`,
`biomechanics-options.json`, optional `external-loads.json` and the sanitized
`analysis-model.osim`. They include `biomechanics-preview.json`,
`biomechanics-report.json`, coordinate/muscle CSVs and an inverse-dynamics CSV
only when that solver ran.

Preview schema `brainsnn.biomechanics-preview.v1` contains:

```text
bindings: model_sha256, motion_sha256, options_sha256, loads_sha256 (or null),
          analysis_model_sha256, runtime_manifest_sha256
runtime: version, native_build, wheel_sha256
time_s[F]
body_names[B], body_parents[B]  # -1 ground, otherwise an earlier body index
body_positions_m[F][B][3], body_rotations_xyzw[F][B][4]
body_com_positions_m[F][B][3]
joint_names[J], joint_parent_bodies[J], joint_child_bodies[J]
joint_positions_m[F][J][3]
coordinate_names[C], coordinate_units[C], coordinate_values[F][C]
com_positions_m[F][3], mass_kg
muscle_names[M], muscle_lengths_m[F][M]
moment_arm_coordinate_names[K], moment_arms_m[F][M][K]
inverse_dynamics? {coordinate_names, units, generalized_forces[F][C],
                   external_loads_mode, differentiation}
```

The report binds exact preview bytes through `preview_sha256` and repeats
source hashes, runtime identity, load assumptions and explicit evidence limits.
Muscle lengths are path lengths, not fiber lengths or activation estimates.
Model coordinates retain their original signed axes and units.

## Installation and qualification

[Official OpenSim Python wheels](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53085346/Scripting+in+Python)
are available for 4.6. This runtime pins Python 3.12 and exact build-2 wheel hashes
for macOS 15+/Linux x86-64. The wheel's actual native build identifies
`4.6-2026-06-22-85aaf64`; it is not mislabeled as a later Git release commit.
Package hashes and native/dependency versions are checked before each job.

```sh
python3.12 -m venv /opt/biomechanics/venv
/opt/biomechanics/venv/bin/python -m robotics.biomechanics.setup_runtime
/opt/biomechanics/venv/bin/python -m robotics.biomechanics.qualify --out /opt/biomechanics/qualification
/opt/biomechanics/venv/bin/python /app/robotics/world_worker/biomechanics.py --input-manifest /private-job/request.json
```

Jobs download nothing and require no GPU/model weights. The HTTP process only
needs `defusedxml`; native numerical dependencies stay isolated. The
`authored_fixture.write_example(directory)` helper generates a two-segment hinge,
muscle path and 31-frame polynomial motion. `qualify` runs real kinematics and
both inverse-dynamics modes, independently verifying COM, path length, moment
arm, analytic pendulum torque and the expected 2.2 N m applied-load difference.
This proves software mechanics on authored inputs, not human accuracy.

After deployment, the separate explicit operator acceptance command is:

```sh
/opt/worker/bin/python /app/robotics/world_worker/deploy/railway/biomechanics_acceptance.py \
  --confirm-synthetic-deployment-test --expected-commit SHA --expected-deployment UUID \
  --receipt /data/biomechanics-acceptance.json
```

It requires an idle worker and the exact expected deployment, creates only its
own authored test jobs, verifies downloaded hashes and analytic mechanics, and
cleans up those jobs. Native Python defaults to `/opt/biomechanics/venv/bin/python`
(`WORLD_BIOMECHANICS_PYTHON` can override it). This command is manual, not a
startup task. Local HTTP/browser tests do not constitute production acceptance.
