# Measured maps and ROS 2 localization

This layer packages an operator-declared registered LiDAR cloud for the real
[`lidar_localization_ros2`](https://github.com/rsasaki0109/lidar_localization_ros2)
runtime, records its ROS messages and displays their source-bound results. It does
not turn generated appearance into measured geometry, certify scan dimensions,
create a safe robot controller or replace the existing 2D Nav2 map export.

Upstream is pinned to `6e21b7ed9e2e5c5ba1452eb63db5c9402862625b` (package 1.11.0)
and ndt_omp_ros2 to `17ce1e19831447a1f5bc5a68a4522fa8087f8933`. The upstream
GitHub release published at implementation time was v1.10.0; the pin deliberately
identifies the newer reviewed source rather than claiming a published 1.11 tag.
This is CPU ROS 2 software, with no learned weights. The container uses Jazzy.

## Map preparation

`python robotics/world_worker/localization_job.py --input-manifest adapter.json`
implements the `localization-map` adapter. The worker supplies a standard
`brainsnn.adapter.v1` object, `output_dir`, and exactly two inputs:

- `survey`: an original registered PLY, at most 64 MiB / 2 million vertices.
- `localization`: JSON with this exact request shape:

```json
{
  "schema": "brainsnn.localization-request.v1",
  "action": "prepare-map",
  "sceneSha256": null,
  "scanSha256": "SHA256_OF_EXACT_PLY_BYTES",
  "sourceFrame": "right-handed-z-up",
  "sourceToScene": [[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],
  "declaration": {"kind":"registered-lidar","units":"m","registered":true},
  "baseFrame": "base_link",
  "voxelMeters": 0.05
}
```

The scan-local default needs no existing scene. The transform above turns a Z-up
scan into World Builder's Y-up display convention; converting that scene to ROS
`[x,-z,y]` composes to identity, so ROS retains the scan's coordinates. For Y-up
scan input, `sourceToScene` is identity. A scan-local request cannot introduce an
undocumented translation or rotation.

Advanced scene-bound mode supplies the exact `scene.json` byte hash and the
worker's completed scene source job. The adapter verifies its component revision
and source-cloud point hash. `sourceToScene` is the explicitly reviewed registered
scan-to-scene transform; it must be a proper rigid 4x4 matrix in metres. Scale,
shear and reflections are refused. The adapter composes `sceneToMap × sourceToScene`
and stores the full chain. No registration algorithm or alignment confidence is
invented by this packaging step.

PLY input supports scalar ASCII and binary little/big-endian XYZ. Mesh elements,
Gaussian opacity/scale/rotation/SH properties, nonfinite points and mismatched
counts are refused. One original point is retained per voxel, with a 250,000-point
output limit; there is no interpolation, densification or automatic coarse fallback.
The declared voxel size is 1–50 cm. Very dense inputs require a coarser explicit
choice or a smaller registered region. PCD intensity is a neutral zero, not an
invented sensor measurement.

Outputs are `localization-map.pcd`, `localization-map.ply`, `localization-map.json`,
`localization-edge.json`, a short README and `localization-edge.zip` containing
the exact runtime map/configuration. The manifest is `brainsnn.localization-map.v1`:

- `source.mode`: `scan-local` or `scene-bound`; exact `scanSha256` in both modes.
- `source.sceneSha256`, `componentRevision`, `cloudPointsSha256`: exact in scene mode,
  explicitly null in scan-local mode.
- `mapSha256`: PCD byte hash; `artifacts` hashes/sizes both map files.
- `revisionSha256`: canonical manifest hash excluding that field itself.
- `frames`: source/display/map/base frame names and the three 4x4 transforms.
- `measurement`, `sampling`, `bounds`, immutable upstream pins and false
  `metricVerified`, `physicalRobotValidated`, `localizationValidated` flags.

The raw scan is retained by the worker's original upload storage. The bundle does
not duplicate it or modify the source scene, source measurements, drawings or Nav2
occupancy map. Operator declarations are not independent survey attestation.

## Real upstream execution on Linux

Build from the BrainSNN repository root:

```sh
docker build -f robotics/localization/Dockerfile -t brainsnn-localization .
```

The image fetches both exact commits, installs ROS dependencies and compiles the
actual NDT/GICP localizer. It includes no dataset and no robot command publisher.
On a robot, keep its LiDAR driver, calibrated TF tree and odometry running locally.
Use the same ROS domain/RMW and a network configuration appropriate to that host.
To record existing edge topics for five minutes:

```sh
docker run --rm --network host --ipc host \
  -e ROS_DOMAIN_ID=84 \
  -v /absolute/map-bundle:/map:ro -v /absolute/results:/results \
  brainsnn-localization python3 -m robotics.localization.ros2_runner \
  --bundle /map --output /results/new-run --duration 300 \
  --cloud-topic /livox/lidar --imu-topic /livox/imu \
  --lidar-frame livox_frame --profile mid360
```

`baseFrame` is fixed in the map bundle. Real sensor-to-base extrinsics must already
be present; the runner disables invented identity LiDAR TF. If the sensor itself
is the chosen base frame, use that same frame in the request and runner. The
upstream quickstart owns initialization and recovery. It starts without a saved
pose; `--initial-pose X Y Z QX QY QZ QW` is an explicit, recorded alternative.
Nav2 normally uses `map→odom` with an external `odom→base` owner. This integration
does not launch Nav2 or send goals, velocity commands, resets or hardware commands
from the browser. The upstream localizer may initialize/reset its own estimate.

For an actual recorded ROS bag, add a read-only bag mount and `--bag /bag`. The
runner starts `ros2 bag play --clock` and the real upstream node and records their
outputs; it does not treat supplied CSV poses as localization. Playback whitelists
the selected cloud/IMU topics, `/odom`, `/twist`, `/tf`, `/tf_static`, excluding old
pose/diagnostic outputs. Use a clean sensor bag without another map TF authority.
The 5–3600-second duration bounds the process groups. Runs require a fresh output
directory and preserve logs plus `localization-run.json`. Caller-provided host
mounts/network access are explicit; no remote hardware is contacted by these tools.

## Recording and live transport

`ros2_bridge` subscribes to actual `/pcl_pose`, `/odom_bridge_pose`, `/path`,
`/alignment_status` and `/reinitialization_requested`. Pose/status subscriptions
match upstream reliable/transient-local/KeepLast(1) QoS. The bridge pairs each pose
with the diagnostic array's exact ROS scan stamp, checks freshness and map frame,
and checks its pose against the bound map-to-base TF. It refuses multiple pose or
diagnostic publishers, stops on `/map_switch`, and rechecks map bytes/revision
each second. It never replays a latched `/path` as new observations. Odometry bridge
estimates remain `odometry-only`. Missing status/TF cannot authorize a tracking pose.
A newer failed alignment or reinitialization request immediately hides a previous
healthy live position. Recovery requires a newly accepted pose; a healthy status
message alone cannot revive an old position. Historical recording samples retain
the diagnostics that accompanied them.

The recording schema is `brainsnn.localization-recording.v1`. `binding` contains
the exact bundle-byte hash, PCD hash, scan hash, source mode, nullable scene/cloud/
revision identity, map frame and base frame. `runtime` identifies the pinned engine
and `recorded-ros2` or explicitly `authored-ros2-test` origin. Samples carry decimal
string `timestampNs` (no JavaScript nanosecond precision loss), relative `t`, XYZ,
XYZW quaternion, 36 covariance values, health state and bounded diagnostics.
The file is limited to 16 MiB/20,000 strictly increasing samples. It cannot claim
independent physical accuracy or cryptographic producer attestation. Importing a
file does not establish that its claimed producer or physical run is authentic.

The same adapter verifies a recording when given one `localization` JSON input
and the exact completed localization-map source job. It preserves the submitted
bytes and returns a contract-verification report. Wrong map/revision/source,
stale diagnostics, contradictory tracking states and invalid transforms are refused.

Optional live endpoint: add `--telemetry-port 8769 --token-file /private/edge-token
--allowed-origin https://www.brainsnn.com` to the runner. The token is separate from
worker credentials, 32–128 printable non-space bytes, supplied through a private
read-only mount and never in URLs. The server binds only `127.0.0.1`; the operator
may expose it through an authenticated HTTPS edge proxy. Browser origins are an
exact allowlist of one origin, never wildcard. No cookie session is used.

`GET /v1/localization` requires `Authorization: Bearer TOKEN`. It returns
`brainsnn.localization-telemetry.v1` with `binding`, `runtime`, `state`, `reason`
and one latest `sample`. HTTP 200 means a fresh sample; 409 has no usable sample
when stale/stopped/empty or recovery has invalidated the previous pose. Invalid
tokens receive 401; another browser origin 403.
Only GET and the exact Authorization CORS preflight exist. There are no control
or upload endpoints. Responses are no-store. A browser must check the exact
binding on every update, retain its token only in memory, and clear the displayed
live status when polling or freshness fails. Hosted worker credentials must never
be forwarded to this independently configured endpoint.

## Validation and evidence boundaries

Local contracts/real HTTP transport:

```sh
python -m pytest tests/world/test_localization.py -q
```

Actual pinned upstream ROS2 test on Linux:

```sh
mkdir -p /absolute/qualification
docker run --rm -v /absolute/qualification:/qualification \
  brainsnn-localization python3 tests/localization/smoke_upstream.py \
  --output /qualification/run
```

That test publishes 60 authored, independently transformed PointCloud2 scans from
an asymmetric room while the true pose translates and rotates. It starts NDT from
a deliberately perturbed seed, verifies at least 20 accepted moving scans and
late-path coverage, then checks translation p95 <12 cm and yaw p95 <0.06 rad.
It stores real ROS pose/status recordings, runtime logs and a result receipt.
This is a software localization test: no physical LiDAR, no automatic map-wide
acquisition qualification, no hardware safety result. Do not claim it passed
until the actual container job completes. Physical qualification additionally
needs independently captured maps/runs, changed scenes, timestamp/extrinsic
calibration, loss/recovery tests, CPU/memory deadlines and independent truth.

Upstream's 2 cm demonstration is a narrow room replay result. Its changed-map
tests also contain incorrect initializations and long tracking errors. Pose
covariance and a good registration score do not independently establish accuracy.
See the pinned upstream `docs/benchmark.md` and `docs/pose_covariance.md`.

## Licences

The localizer and ndt_omp_ros2 are BSD-2-Clause. Optional small_gicp and RKO-LIO are
MIT; neither optional package is bundled here. The separate mapping project is
BSD-2-Clause. The Livox driver is not bundled; its code/third-party notices include
MIT, BSD and Apache terms. JEPLO demo data/media are separately GPL-3.0 according
to upstream provenance: no such assets are downloaded, included or republished by
this integration. The authored test geometry is generated by this repository.
