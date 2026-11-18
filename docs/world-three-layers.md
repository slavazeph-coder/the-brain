# World Builder: repair, localization and motion

The existing `/world/` playground has three optional tools under **Make it yours**.
They use the same processing connection and session result library. The capture,
building model, drawings, route tools and source files remain available.

- **Repair appearance** opens an original Gaussian PLY, selects source vertices by
  a dragged or keyboard-entered rectangle, runs pinned Splat Repair CPU Fast Fill,
  and compares the original with the repaired copy. Complete Gaussian properties
  and source-to-result mappings are retained. It does not create measured surfaces.
- **Find my robot** packages an original registered LiDAR scan as a measured ROS
  map. A source may use its own coordinates or a reviewed rigid transform bound to
  an exact building model. Open a map-bound recording or connect the read-only ROS
  position bridge. The viewer distinguishes tracking, weak tracking, prediction,
  lost tracking and stale data. It does not change a route or issue commands.
- **Try a movement** sends a compatible SOMA BVH to the pinned NVIDIA retargeter,
  retaining the original source, actual FPS, G1 reference CSV and synchronized
  articulated human/G1 preview. This is a movement reference; a tracking policy,
  physical simulation and hardware execution are separate capabilities.

Each upload requires the tool's explicit consent. Owner processing sessions have
access when the three engines are configured; public visitor grants are unchanged.
Result files use their original authenticated worker client. Session clear cancels
active processing and releases previews; credentials are not placed in saved UI
state. Results remain tab-session history, not cross-device project storage.

## Runtime and contracts

- [Splat Repair runtime and limits](world-splat-repair.md)
- [ROS 2 map, recording and edge deployment](world-localization.md)
- [SOMA runtime, source requirements and reference outputs](world-motion-retarget.md)

Worker engine IDs are `splat-repair`, `localization-map`, and `motion-retarget`.
They share the existing `/v1/uploads`, `/v1/jobs`, start/status/cancel and signed
artifact-download API. Their CLI adapters run in isolated job directories; the
SOMA numerical environment is separate from reconstruction/CAD dependencies.
The Railway image verifies vendor hashes and must complete actual authored SOMA
CPU IK qualification before it can build successfully. ROS runs in its dedicated
Linux edge container; hosted map packaging does not claim to have run a robot.

## Verification

`tests/world/three_layers_browser_smoke.py` exercises all three actual worker jobs
from Chromium and WebKit, preserves an edited map, checks synchronized playback,
rejects mismatched recordings, connects real authenticated loopback telemetry, and
checks 320/390px larger-text layouts. Inputs are explicitly authored; its telemetry
poses test transport rather than localization quality. The separate
`tests/localization/smoke_upstream.py` executes the real pinned ROS localizer against
independently transformed moving scans. The test does not qualify physical sensors
or global unknown-pose acquisition.

The exact Railway image, focused worker/tenant contracts, upstream CPU runtime,
frontend unit contracts and original unified workspace browser checks are release
gates. No upstream restricted motion examples are published by this integration.

Durable customer projects, restart-safe job recovery, billing and a versioned
public customer API remain broader service work, as recorded in the API audit.
