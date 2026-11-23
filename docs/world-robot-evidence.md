# Robot capability: frames, telemetry, arm checks and drive evidence

The Robot capability workbench connects a robot profile, a recorded simulation and optional imported measurements. Its results describe the supplied model and evidence. They do not qualify a physical robot or send commands to hardware.

This guide describes the executable core in:

| Module | Responsibility |
| --- | --- |
| `brainsnn-r3f-app/public/world/robot-frames.mjs` | Named rigid transforms, canonical poses and explicit coordinate conversions |
| `brainsnn-r3f-app/public/world/robot-telemetry.mjs` | Bounded CSV/JSON ingestion, reviewed pose comparison and a proposed wheel-radius fit |
| `brainsnn-r3f-app/public/world/robot-arm.mjs` | Serial-chain forward kinematics, pose IK, joint limits and geometric collision/path checks |
| `brainsnn-r3f-app/public/world/robot-drive-analysis.mjs` | Mechanical work and parameter-dependent motor, driver and thermal estimates |

The profile, controller and MuJoCo runner live in `robot-capability.mjs`, `robot-capability-controller.mjs` and `robot-capability-physics.mjs` in the same directory. Their simulation output supplies explicit wheel state to the drive analysis. A motion command alone does not supply measured wheel motion or torque.

## 1. Coordinate and time contract

Canonical coordinates are right-handed, Z up, in metres. A robot body frame uses X forward and Y left. Canonical quaternions have named components `{x, y, z, w}`; anonymous canonical arrays use **XYZW**. Joint angles and angular rates use radians and radians per second.

Every pose names its parent `frameId` and child `childFrameId`. A transform maps child coordinates into the parent:

```text
point_in_parent = rotate(orientation, point_in_child) + position
```

The parent frame name identifies an origin and axes. Two files using the name `map` are not, by that fact alone, spatially registered. Sensor poses must be transformed to the same robot body origin before position errors are compared.

```js
import {
  normalizePose, importPose, exportPose,
  composeTransforms, invertTransform, transformPoint,
  quaternionFromEuler,
} from './brainsnn-r3f-app/public/world/robot-frames.mjs';

const mapToBase = normalizePose({
  frameId: 'map',
  childFrameId: 'base_link',
  position: [1, 2, 0.2],
  orientation: quaternionFromEuler(0, 0, Math.PI / 2),
  timestampSeconds: null, // A declared static transform.
});
const point = transformPoint(mapToBase, [1, 0, 0]);
// Approximately {x: 1, y: 3, z: 0.2}.
const identity = composeTransforms(mapToBase, invertTransform(mapToBase));
const native = exportPose(mapToBase, {convention: 'mujoco'});
const restored = importPose(native, {convention: 'mujoco'});
```

`normalizePose` returns schema `brainsnn.robot-pose.v1`. It accepts finite position arrays or objects, normalizes nonzero quaternions and rejects invalid frame names, nonfinite coordinates and zero quaternions. It does not replace an invalid rotation with identity. A transform from a frame to itself must be identity. Composition requires matching intermediate names; two timestamped transforms must refer to the same time. A static transform has `timestampSeconds: null`.

| Import convention | Position | Anonymous quaternion array | Yaw |
| --- | --- | --- | --- |
| `ros` | Canonical Z-up XYZ | XYZW | Right-handed about +Z |
| `mujoco` | Canonical Z-up XYZ | WXYZ | Right-handed about +Z |
| `world-y-up` | World Builder XYZ, Y up | XYZW | Right-handed about +Y |

World Builder conversion is the proper rotation `[x, y, z] → [x, -z, y]`, including quaternion basis conversion. A World Builder position `[1, 2, 3]` becomes canonical `[1, -3, 2]`. A right-handed positive yaw about world Y becomes a positive yaw about canonical Z.

The legacy room-path `headingRad` has a different definition: positive X towards positive room Z. Its canonical yaw is **negative** `headingRad`. The simulation-recording adapter handles that convention explicitly. Do not copy that sign rule to right-handed imported `yaw` or `commandYawRateRps`.

Named quaternion components always retain their names. In a CSV with `qx,qy,qz,qw`, the columns are XYZW even when the selected anonymous-array convention is MuJoCo. Roll, pitch and yaw inputs use fixed-axis roll/pitch/yaw, composed as `Rz(yaw) Ry(pitch) Rx(roll)`.

## 2. Telemetry import

### Bounds and source identity

`parseRobotTelemetry(text, options)` accepts CSV, a JSON sample array, a JSON object with `samples`, or a supported native localization document. The core limit is 16 MiB, 20,000 samples, 64 CSV columns and a recording duration of one day. The current workbench file picker imposes a smaller 8 MiB limit. CSV headers must be distinct simple names; quoted cells are supported within bounded cell sizes.

A source ID and parent frame are required. Use a content-bound source identity when integrating the API, and retain the file hash separately from its display name. A hash detects changed bytes; it does not establish measurement quality, producer authenticity or independence.

The parser returns `valid`, `issues`, canonical `samples`, `inputUnits`, `inputConvention`, `timestampOriginNs` and `provenance`. Invalid rows do not make the rest of a file valid: any error marks the whole import invalid for comparison. Warnings include gaps and unusable source health. Out-of-order or duplicate timestamps are errors; the parser does not silently sort them.

### CSV example

This is an authored format example, not measured robot data:

```csv
t,x,y,z,qx,qy,qz,qw,leftEncoderRad,rightEncoderRad,commandSpeedMps,commandYawRateRps,state
0,0,0,0.2,0,0,0,1,0,0,0.2,0,tracking
0.1,0.02,0,0.2,0,0,0,1,0.24,0.24,0.2,0,tracking
0.2,0.04,0,0.2,0,0,0,1,0.48,0.48,0.2,0,tracking
```

```js
import {parseRobotTelemetry} from './brainsnn-r3f-app/public/world/robot-telemetry.mjs';

const log = parseRobotTelemetry(csvText, {
  format: 'csv',
  sourceId: 'sha256:<actual-file-digest>',
  frameId: 'robot_map',
  childFrameId: 'base_link',
  convention: 'ros',
  timeUnit: 's',
  lengthUnit: 'm',
  angleUnit: 'rad',
});
```

Position requires all three coordinates. `z` is the height of the measured body origin, not automatically the floor. The v2 differential simulation records its actual body origin in `positionXYZ`; compare a corresponding physical body origin or supply the appropriate sensor-to-body conversion first.

| Channel | Accepted fields | Units and treatment |
| --- | --- | --- |
| Time | `t`, `timeSeconds`, `time`, `timestamp` | Uses declared `s` or `ms`; converted to seconds |
| High-precision time | `timestampNs` | Decimal string; relative seconds are derived using integer nanoseconds |
| Position | `x,y,z` or JSON `position: [x,y,z]` / `{x,y,z}` | Uses declared `m` or `mm` |
| Orientation | `qx,qy,qz,qw`, JSON `quaternion`, or JSON `orientation` | Named components or declared array order; nonzero rotations normalized |
| Yaw-only orientation | `yaw`; `yawRad` | `yaw` uses declared `rad` or `deg`; `yawRad` always uses radians |
| Wheel angle | `leftEncoderRad,rightEncoderRad`; JSON `wheelPositionRad: [left,right]` | Always radians; both wheel values required |
| Wheel velocity | JSON `wheelVelocityRadS: [left,right]` | Always radians per second |
| Command | `commandSpeedMps,commandYawRateRps`; JSON `command: {speedMps,yawRateRps}` | Always m/s and rad/s; retained as commanded, not measured |
| Electrical observation | `currentA` / `motorCurrentA`; `voltageV` / `supplyVoltageV` | Amperes and volts; retained as supplied measurements |
| Source health | `state` | `tracking`, `weak`, `odometry-only`, `lost`, `stale`, `stopped` or `unknown` |

The angle selector does not change fields whose names already specify radians. Encoder counts/ticks are not accepted as radians: convert them using the actual encoder resolution, gearing, sign and unwrapping convention before import. The parser does not invent an encoder resolution, infer motion from commands, run an IMU filter or fuse measurements.

Positions can exist without orientation; orientation then remains `null`, so no orientation error is reported. Encoder-only and command-only files can be imported, but do not establish position accuracy. Optional JSON `encoder` may contain `wheelPositionRad`, `wheelVelocityRadS` or paired `leftRad`/`rightRad`.

### JSON metadata and independence

Generic JSON can declare `sourceId`, `frameId`, `childFrameId`, `units: {time,length,angle}`, `convention`, `datasetRole`, `poseSource` and `referenceIndependent`. Explicit API options take precedence over generic document units, convention and parent frame. Review the actual workbench controls after loading a file; the interpretation retained in the evidence bundle is the one used for calculations.

The supported native schemas are `brainsnn.localization-recording.v1` and `brainsnn.localization-telemetry.v1`. Native imports retain `binding.mapFrame`, `binding.baseFrame`, source binding and their canonical metres/seconds/XYZW convention. Their samples require positive decimal-string `timestampNs`, an already normalized quaternion and a finite 36-value covariance with nonnegative diagonal terms. A `tracking` claim must agree with diagnostic level, pose source and reinitialization state. Diagnostic timestamps more than 0.5 seconds from the pose are rejected. See `robotics/localization/contracts.py` for the producer's complete contract.

Nanosecond stamps are reduced relative to the first supplied stamp without converting the epoch to a floating-point number first. If a sample supplies both `t` and `timestampNs`, they must agree to 10 microseconds. Do not subtract the full nanosecond epoch using ordinary JavaScript `Number` values.

`nowSeconds` is optional and must use the same relative clock as the imported samples. It enables a stale-stream warning, with a default threshold of one second. An old offline recording is not stale merely because its capture date is in the past; do not pass the current Unix time as the age of a relative-time recording.

## 3. Comparing a recording with imported poses

`compareRobotTelemetry(recording, log, options)` requires an explicit source-bound spatial registration and an explicitly reviewed time alignment. Equal frame names and two timestamps starting at zero are insufficient by themselves.

```js
import {compareRobotTelemetry} from './brainsnn-r3f-app/public/world/robot-telemetry.mjs';

const comparison = compareRobotTelemetry(episode, log, {
  registration: {
    confirmed: true,
    sourceId: log.sourceId,
    frameId: 'map',
    evidence: 'Replace with the actual registration method and retained evidence.',
    transform: {
      frameId: 'map',
      childFrameId: 'robot_map',
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      timestampSeconds: null,
    },
  },
  timeAlignmentConfirmed: true,
  timeOffsetSeconds: 0,
  maxGapSeconds: 0.5,
  heldOut: false,
  calibrationSourceIds: [],
});
```

The zero transform above is a syntax example. Replace it with the reviewed alignment. The transform maps telemetry-frame points into the prediction's frame. A registration is static; this API does not interpolate time-varying registration transforms. If both frames already coincide, omit `transform` and still supply the source-bound confirmation. A nonidentity transform requires distinct frame names.

The time relationship is:

```text
reference_time = telemetry_time + timeOffsetSeconds
```

Prediction positions are linearly interpolated, orientations use shortest-path quaternion interpolation, and errors are computed at eligible telemetry times. No extrapolation occurs. The default maximum reference interpolation gap is 0.5 seconds; an exact existing endpoint remains usable even beside a long gap. Reference samples must retain the same parent frame, child frame and dimensional interpretation throughout the recording, with strictly increasing bounded times and a duration of at most one day.

Native capability episodes provide canonical `positionXYZ` and `quaternionWxyz`. The adapter prefers those values over the room-view `position: [x,z]`. Legacy two-coordinate recordings receive planar XY errors and are explicitly labelled `planar-xy`; they cannot provide vertical accuracy. The adapter rejects a mixture of planar and XYZ frames within one reference recording.

`lost`, `stale` and `stopped` poses are excluded. `odometry-only` is excluded unless `includeOdometryOnly: true` is supplied. `weak` and `unknown` can enter exploratory errors and retain their source state; they are not thereby promoted to reliable localization. Covariance is retained as evidence but is not used to weight these metrics.

Results contain:

- `status`, such as `needs-registration`, `registration-source-mismatch`, `needs-time-alignment`, `invalid-telemetry`, `no-comparable-samples`, `compared` or `calibration-reuse`;
- `matchedSamples`, the number of included position samples;
- `coverage`, included positions divided by all imported samples containing a position, including excluded unhealthy positions in the denominator;
- `metrics.positionErrorM` and, when available, `metrics.orientationErrorRad`, each with mean, RMS, maximum and p95;
- `metrics.orientationSamples`, because orientation coverage can differ from position coverage;
- `pairs`, containing the actual registered observed/predicted coordinates and per-sample errors;
- exclusion counts, issues and explicit registration/time provenance.

Plot `pairs` when displaying the scored comparison. Plotting every input pose would also display samples that were excluded from the metrics. Break traces across missing intervals. Coverage is a sample ratio, not a fraction of the entire task duration, and a few matching samples do not demonstrate complete execution accuracy.

`heldOut: true` records an operator declaration. The caller must retain IDs of all sources used for tuning and pass them as `calibrationSourceIds`. A matching source or `datasetRole: 'calibration'` produces `calibration-reuse` when held-out status is requested. These fields detect declared reuse; they cannot establish genuine experimental independence or authenticate a producer. All comparisons retain `physicalAccuracyVerified: false`.

## 4. A wheel-radius proposal from an independent reference

`calibrateWheelScale` fits one symmetric wheel-radius scale from paired encoder travel and independent straight-line body motion. It does not fit wheel separation, left/right asymmetry, slip, gearing or an entire drivetrain model.

A usable workflow is:

1. Record unwrapped left/right wheel angles and synchronized body poses from a separate measured reference. Do not use wheel odometry derived from the same encoders as that reference.
2. Put the declarations in a JSON document: `referenceIndependent: true`, `poseSource: 'independent-reference'` and `datasetRole: 'calibration'`. Retain the actual measurement method and source evidence alongside the document.
3. Import the file and explicitly confirm the independent-reference declaration in the UI, or pass `referenceIndependent: true` at both API stages below.
4. Inspect the proposed radius. The module never changes the profile automatically.
5. If an operator adopts a change, evaluate it on a separate run not used in the fit. Retain the calibration source ID/hash and original radius in the test evidence.

This authored JSON demonstrates the format and a deliberately constructed 1.2 scale factor; it is not a real calibration result:

```json
{
  "sourceId": "authored-calibration-format-example",
  "frameId": "robot_map",
  "childFrameId": "base_link",
  "units": {"time": "s", "length": "m", "angle": "rad"},
  "convention": "ros",
  "datasetRole": "calibration",
  "referenceIndependent": true,
  "poseSource": "independent-reference",
  "origin": "authored-format-example-not-measured",
  "samples": [
    {"t": 0.0, "position": [0.00, 0, 0.2], "quaternion": [0, 0, 0, 1], "wheelPositionRad": [0, 0]},
    {"t": 0.5, "position": [0.24, 0, 0.2], "quaternion": [0, 0, 0, 1], "wheelPositionRad": [2, 2]},
    {"t": 1.0, "position": [0.48, 0, 0.2], "quaternion": [0, 0, 0, 1], "wheelPositionRad": [4, 4]},
    {"t": 1.5, "position": [0.72, 0, 0.2], "quaternion": [0, 0, 0, 1], "wheelPositionRad": [6, 6]}
  ]
}
```

```js
import {parseRobotTelemetry, calibrateWheelScale}
  from './brainsnn-r3f-app/public/world/robot-telemetry.mjs';

const calibrationLog = parseRobotTelemetry(jsonText, {referenceIndependent: true});
const proposal = calibrateWheelScale(calibrationLog, {
  wheelRadiusM: 0.1,
  referenceIndependent: true,
});
// Format example only: status 'calibration-proposal', scale 1.2,
// proposedWheelRadiusM approximately 0.12, applied false.
```

A checkbox alone does not verify the data. CSV has no document-level independent-reference declaration, so the current API intentionally does not produce a fit from CSV plus only the UI checkbox. Use the JSON wrapper with retained provenance. The declarations remain operator supplied and unverified.

The default fit requires at least three usable intervals and 0.5 m of observed travel. An interval must be no more than one second, have position/orientation and both encoder angles at both endpoints, avoid unusable or odometry-only states, have orientation change at most 0.02 rad, near-equal wheel increments within a 2% test, lateral displacement at most 0.02 m, and consistent travel direction. Wheel scale outside 0.5–2 is rejected as implausible. These checks reduce obvious bad fits; they do not establish the absence of slip or reference error.

## 5. Arm pose and path checks

The supported arm is a generic 3D serial chain with 2–8 revolute joints. Each joint has a local axis, a fixed origin transform and lower/upper angle limits. The origin is applied before the joint's axis rotation. A final tool offset defines the end-effector pose. Metres, radians and canonical named frames apply throughout.

`GENERIC_ARM_PROFILE` is an authored six-joint example. It is not a Panda, ROKAE or other manufacturer model. Clone it before editing:

```js
import {
  GENERIC_ARM_PROFILE, DEFAULT_ARM_TARGET,
  normalizeArmProfile, forwardArmKinematics, solveArmTarget,
  checkArmConfiguration, checkArmPath,
} from './brainsnn-r3f-app/public/world/robot-arm.mjs';

const arm = structuredClone(GENERIC_ARM_PROFILE);
const result = solveArmTarget(arm, DEFAULT_ARM_TARGET, {
  startJoints: arm.homeJoints,
  obstacles: [],
});
// The supplied example finds a pose and geometric path under this authored model.

const blocked = solveArmTarget(arm, DEFAULT_ARM_TARGET, {
  startJoints: arm.homeJoints,
  obstacles: [{id: 'example-box', min: [0.25, -0.2, 0.1], max: [0.6, 0.2, 0.7]}],
});
// Collision evidence is reported; reaching a pose is separate from clearing a path.
```

A joint has this shape:

```json
{
  "name": "shoulder",
  "axis": [0, 1, 0],
  "origin": {"position": [0, 0, 0.1], "orientation": [0, 0, 0, 1]},
  "limits": {"lower": -2.2, "upper": 2.2}
}
```

The profile also needs `kind: 'serial-revolute'`, a named `basePose`, `joints`, optional `homeJoints`, a tool transform and `linkRadiusM`. `normalizeArmProfile` bounds and normalizes this model; it does not load URDF, mesh geometry, passive joints or coupled mechanisms. Target and base must share a parent frame. The workbench uses a generic arm in `base_link`; callers using the module directly may use another explicitly named common frame.

Pose IK uses a damped least-squares solve with a geometric Jacobian and position plus quaternion orientation residual. Defaults are 10 deterministic attempts, 180 iterations per attempt, 0.002 m position tolerance and 0.01 rad orientation tolerance. Search budgets are bounded. An exhausted search returns `reachable: null`, not proof that the target is impossible. A position outside the chain-length upper bound returns `reachable: false` with the bound.

Configuration checks use uniform-radius link capsules, pairwise nonadjacent link distance, and conservative axis-aligned box proxies. Adjacent links are excluded because their modelled segments meet at joints. Boxes accept canonical `{id,min:[x,y,z],max:[x,y,z]}`. The adapter also accepts World Builder `{x,z,w,d,h,y?}` boxes and explicitly converts the axes. At most 256 boxes are supported.

Path checking interpolates joint angles from the supplied start to an IK solution. It checks the start and every interval, using midpoint capsule inflation from a conservative angular-motion bound. The default bound per interval is 0.015 m, with a maximum 2,048 intervals. The reported `pathMotionBoundM` states the actual padding bound. A blocked straight joint-space path does not prove that no alternative path exists; this is not a general collision-avoidance planner.

Results distinguish `reachable`, `configurationValid`, `pathValid`, `dynamicsValidated` and `physicalValidated`. Typical statuses are `geometric-path-found`, `pose-only`, `pose-collision`, `outside-reach-bound` and `no-solution-within-budget`. Inspect `reasons`, errors and the retained model. A generic successful IK result supplies no evidence about motor torque, payload, contact force, grasp quality, balance or hardware execution.

Map rectangles extruded to an assumed height are only proxies. Their origin and robot heading must be declared when expressed in a body frame. A translated map rectangle is not automatically rotated into the physical robot's forward axis. Floors, ceilings, self geometry outside the capsules and objects missing from the supplied boxes are not implicitly checked.

## 6. Motor, MOSFET conduction and thermal estimates

`analyzeDrive(profile, recording, options)` needs 2–100,000 monotonically ordered samples within one day. Wheel measurements are paired in left/right order:

```js
import {analyzeDrive} from './brainsnn-r3f-app/public/world/robot-drive-analysis.mjs';

const authoredProfile = {
  motor: {
    voltageV: 24, currentLimitA: 3,
    torqueConstantNmPerA: 0.1, resistanceOhm: 0.5,
    gearRatio: 20, efficiency: 0.8,
    backEmfVPerRadPerSecond: 0.1, noLoadCurrentA: 0,
    driverResistanceOhm: 0.01, auxiliaryPowerW: 5,
    thermalResistanceKPerW: 4, thermalCapacityJPerK: 50,
    ambientC: 20, temperatureLimitC: 80,
  },
};
const authoredRecording = {
  provenance: {origin: 'authored-format-example-not-measured'},
  frames: [
    {time: 0, wheelTorqueNm: [1, 1], wheelVelocityRadS: [2, 2]},
    {time: 1, wheelTorqueNm: [1, 1], wheelVelocityRadS: [2, 2]},
  ],
};
const drive = analyzeDrive(authoredProfile, authoredRecording);
// This constructed example models 0.625 A per motor and 4 J of positive wheel work.
```

This code demonstrates the API without asserting a real motor's constants. The integrated capability profile requires its six basic motor fields together: supply voltage, current limit, torque constant, motor resistance, gear ratio and transmission efficiency. Its thermal fields must be supplied together when used. The lower-level analysis can still describe missing metrics for partial parameter objects.

| Quantity | Model or required evidence |
| --- | --- |
| Mechanical power | Per-wheel torque × angular speed; positive work and braking work kept separately |
| Motor current magnitude | `abs(wheelTorque) / (gearRatio × efficiency × torqueConstant) + noLoadCurrent` |
| Motor terminal demand | Current × motor resistance + absolute motor speed × back-EMF constant |
| Supply demand check | Terminal demand plus supplied driver conduction resistance × current |
| Copper loss | Sum of per-motor current² × motor resistance |
| Driver conduction loss | Sum of per-motor current² × supplied driver resistance |
| Auxiliary energy | Supplied auxiliary power × covered duration |
| Temperature | First-order motor thermal resistance/capacity model, initialized at supplied ambient, heated by copper loss |

`efficiency` means mechanical transmission efficiency and must be greater than zero and at most one. It is not an assumed electrical efficiency or a battery efficiency. Supply voltage, current and temperature are checked against their supplied limits, and exceedances include sample time and wheel index. Missing values remain `null` with an explanation in `unavailable`. Omitting no-load current is explicitly reported as a lower bound on total motor current.

The default maximum integrated gap is one second. Missing wheel channels and large gaps are excluded from energy integration, and covered duration is reported. Once a temperature history has an unobserved interval, later temperatures and the overall maximum temperature become unavailable; the model does not invent heating or cooling during that interval. Peak current or voltage is a maximum over available samples, not proof of the peak between them.

V2 differential `action` contains wheel **velocity targets in rad/s**. The analysis uses `wheelTorqueNm` and `wheelVelocityRadS`, never `action`. Its optional `torqueSource: 'wheel-actuator'` accepts `actuatorForce` only when the caller explicitly confirms that it contains wheel torque. Holonomic slide-actuator recordings have no wheel torque model; empty wheel arrays produce unavailable wheel accounting.

Results separate `mechanicalEnergyWh`, `brakingEnergyWh`, `copperLossWh`, `motorTerminalEnergyWh`, `driverConductionLossWh` and `auxiliaryEnergyWh`. Motor terminal input is a model estimate, not measured battery draw. Regenerative energy is not credited. The model does not reproduce PWM switching loss, MOSFET transients, commutation, speed-dependent efficiency, core loss, detailed enclosure heat transfer or battery behaviour. Supplying a conduction resistance covers only that specific MOSFET/driver loss term.

The analysis returns `unavailable`, `partial`, `limits-exceeded` or `modelled-within-limits`. Even a fully supplied model with no detected exceedance retains `physicalValidated: false`.

## 7. Evidence retention and verification

Keep the original robot and arm profiles, exact map/scene snapshot, complete simulation episode, telemetry bytes and hash, import settings, source-bound registration, clock offset, fit inputs, source IDs used for calibration and the resulting metrics together. A compact project summary intentionally omits dense arrays; retain the complete downloadable evidence bundle for detailed review.

Re-running with edited parameters creates a new model result. It does not revise earlier evidence or make a calibration source independent. Imported observations, simulation state, authored examples and inferred motor values must retain their separate origins.

Run the core numerical checks from the repository root:

```sh
node --test tests/world/robot-frames.test.mjs tests/world/robot-arm.test.mjs tests/world/robot-drive-analysis.test.mjs tests/world/robot-telemetry.test.mjs
```

These tests cover frame/quaternion round trips, transform composition, successful and impossible pose targets, self/environment collisions, collisions during a path with clear endpoints, motor current/voltage/thermal equations, missing wheel evidence, parsing bounds and units, native timestamp precision, reference-frame/clock consistency, sparse interpolation, registration requirements and calibration reuse. They verify those implementations against constructed inputs. They are not hardware experiments.
