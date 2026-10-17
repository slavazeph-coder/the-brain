---
type: project
description: TViz source audit and proposed native Arena inspection layer; research only, no ROS or model runtime installed
---

# Arena inspection research — 2026-10-16

Owner supplied a screenshot of Nathan Shankar's terminal_rviz and requested a
deep dive into integrating a similar layer. Full source-grounded proposal:
`robotics/arena/docs/arena-inspection-layer.md`.

- Recommendation is **proposed**, not an owner-approved implementation:
  native Inspect run inside Arena after a run, same timeline/evidence contract;
  optional terminal reader, optional TViz only for existing ROS deployments.
  Do not expand the public nav or add a separate product.
- Upstream inspected at `74f5b5e7499560945fb194594b69d2608b6ecf0b`; main/devel
  identical. CMake defaults WITH_GPU ON, runtime use_gpu false. package.xml
  declares BSD-3-Clause but no root license text. Latest four ROS CI builds
  passed; no upstream runtime test performed.
- TViz includes command-capable Nav2, teleop and MoveIt modules; no generic
  read-only switch found in node entry. Image/cloud default reliable QoS can
  mismatch best-effort sensors. Cloud/scan/odometry use latest TF; precise
  replay needs capture-time transforms.
- Current Arena Python worker already has MuJoCo bodies, images, action/state
  traces and authenticated `/v1/sessions/{id}/evidence`. Browser does not fetch
  full evidence; keeps at most180 frames/24million image URL chars and exports
  metadata only. Future geometry needs its own decoded-memory bounds.
- `last_inference_images` are actual processed arrays, but previews are lossy
  JPEG quality85. Exact input evidence needs lossless recording and hashes.
- Body quaternions wxyz; policy observation quaternions xyzw; site renderer
  Y-up/XZ floor, ROS Z-up. RoomPlan recenters source origin. Explicit conventions
  and reviewed site registration are required; unscaled COLMAP is not metric.
- Existing worker is Python3.10/Debian Bookworm, not ROS. Keep ROS optional and
  isolated from it. Do not touch ops/gpu inference services for this research.
- No feature code, dependency installation, ROS/hardware operation or named
  model GPU execution occurred in this research pass.
