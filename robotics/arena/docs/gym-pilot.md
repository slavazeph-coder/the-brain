# One gym floor: capture to operating estimate

## What a visitor can do

The Arena accepts a supported single-floor RoomPlan CapturedRoom JSON or an
editable BrainSNN scenario. A visitor can also draw a measured map and use local
photos, video or a 3D visual as a reference. After checking the dimensions and
equipment footprints, **Estimate gym cleaning** chooses a generic cleaning
envelope and coverage task while preserving the Arena robot/model selection.

The estimate uses the actual route on that reviewed map to show robot run
minutes, modelled human help, uncovered floor and a cost breakdown. Cost stays
unavailable until the visitor supplies labour/hour, robot/hour and consumables
per square metre. Explicit zero rates are allowed. The page does not invent a
price or treat an illustrative robot envelope as an OEM specification.

An arbitrary phone video is not a ready floor map. Local references stay in the
browser. Reconstruction needs a configured private scan worker; its sparse
points remain unscaled visual context until a person establishes dimensions,
orientation and collision geometry. There is no shared public reconstruction
service configured by this website release.

## First real gym intake

Use one level, one floor zone, while the gym is empty. Obtain:

1. A supported measured map, or a walkthrough plus a dimensioned floor sketch.
   RoomPlan is a native Apple capture SDK. The capture app must export its
   CapturedRoom JSON, including one level floor polygon; a USDZ-only export is
   not sufficient for the current map importer.
2. A measured long edge and a second cross-check dimension. Confirm metres.
3. Every machine base, rack, mat, free-weight area, mirror, glass boundary,
   stair and ramp. Mark unsuitable cleaning zones as exclusions/obstacles.
4. A dock/start position with enough clearance. Review passage widths against
   the actual cleaner, including its squeegee and attachments.
5. The cleaner's measured width, depth, cleaning width and working speed.
6. Setup and finish minutes, expected assistance events, manual cleaning
   productivity, service capacity, and the operator's actual cost inputs.

In **Capture**, import the map or choose **Draw my floor map**. In **Review**,
check geometry, start and obstacles and confirm scale. In **Test**, choose
**Estimate gym cleaning**, enter the body and operating assumptions, then run.
Inspect the uncovered area and replay the route before exporting the report.

Changing money inputs recalculates the operating estimate without changing the
route. Changing floor geometry or the robot body invalidates the route and
estimate together. Imported scenarios always require scale confirmation again.

## Calculation contract

`site-operations.js` consumes the current complete coverage plan and validates
its scene digest. Navigation-only, stale, blocked or unscaled plans cannot
produce a cleaning estimate. The generic cleaner must be selected.

- Travel minutes = planned distance / working speed / 60 × passes.
- Turn minutes = heading changes above 15 degrees × entered seconds/turn / 60
  × passes. Repeated passes do not include a separately planned transition.
- Service stops = max(0, ceil(worked area / entered area capacity) − 1).
  Capacity zero disables this assumption rather than claiming no refills are
  needed. Service duration is entered by the operator.
- Manual follow-up area = estimated open floor − route-covered floor, when the
  operator elects to include it. Obstacle footprints are excluded. Review
  remaining edges and equipment zones, rather than treating all gaps as safe.
- Human help = setup + finish + entered interventions + service labour +
  modelled manual follow-up minutes.
- Robot run = travel + turns + service. Sequential completion adds preparation,
  finishing, interventions and manual follow-up once; service is not counted
  twice. These are serial planning assumptions, not a staff scheduling model.
- Cost = human hours × entered labour/hour + robot run hours × entered
  robot/hour + worked area × entered consumables/m². The robot rate must include
  any lease, depreciation, maintenance or energy allowance the operator wants
  counted. Tax, profit margin, financing and unentered costs are not inferred.

The browser planner traverses a bounded grid. It is a conservative route preview,
not an optimized commercial cleaning controller. Cleaning width affects the
estimated swath, not the row spacing of this release. Time is not a cleaning
quality guarantee. Human help is a model with entered assumptions, not a learned
intervention prediction. Reports retain those assumptions and explicit
`policyExecuted:false`, `physicsExecuted:false` and source provenance.

## Components worth adding next

These are researched integration candidates, not newly installed backends.

| Component | Proposed job | Prerequisite / limitation |
| --- | --- | --- |
| [Apple RoomPlan](https://developer.apple.com/augmented-reality/roomplan/) | Capture dimensions and structured room elements on a LiDAR iPhone/iPad. | Native capture app and supported JSON export. Review gym equipment, mirrors and glass. |
| [COLMAP](https://colmap.github.io/tutorial.html) + [Open3D](https://www.open3d.org/docs/release/tutorial/geometry/pointcloud.html) | Extend the current reconstruction worker with a proposed floor plane and obstacle clusters. | Dense/adequate points, measured scale and user review. Missing points never establish free space. |
| [DA3-BASE + DA3METRIC-LARGE](https://github.com/ByteDance-Seed/Depth-Anything-3) | Prototype depth/pose proposals from ordinary phone images. | An adapter, camera intrinsics and scale validation are still needed. The listed BASE and METRIC checkpoints use Apache 2.0; LARGE/GIANT/NESTED weights use CC BY-NC. Do not silently substitute them. |
| [SAM 3](https://github.com/facebookresearch/sam3) | Propose floor, mat and equipment masks in source images from text or visual prompts. | Image masks must be registered with depth/poses and reviewed before becoming floor exclusions. Access and deployment follow Meta's custom SAM licence; this is not an Apache checkpoint. |
| [Nav2 coverage + Fields2Cover](https://github.com/open-navigation/opennav_coverage) | Replace grid traversal with swaths, better row ordering and feasible turning paths. | Validate indoor boundaries, voids, dock transitions and actual controller constraints. Its ROS server is not a browser drop-in. |
| [NVIDIA nvblox](https://nvidia-isaac-ros.github.io/repositories_and_packages/isaac_ros_nvblox/index.html) | Build a robot-oriented mesh/distance field/navigation layer from depth and poses. | Registered metric depth and camera poses, plus a compatible ROS/navigation worker. An MP4 alone is insufficient. |
| [3DGUT / gsplat](https://github.com/nv-tlabs/3dgrut) | Improve the reconstructed space's appearance. | Gaussian appearance must remain separate from reviewed collision geometry. |

Apple documents capture issues with mirrors, glass, very dark surfaces and high
ceilings in its [RoomPlan capture guidance](https://developer.apple.com/videos/play/wwdc2022/10127/).
For an initial gym pilot, scanning smaller reviewed zones is a practical choice.
AI geometry should propose a map for review rather than silently publish a safe
navigation map.

Depth Anything's [streaming benchmarks](https://github.com/ByteDance-Seed/Depth-Anything-3/blob/main/da3_streaming/README.md)
vary by sequence and chunk size. Start with short bounded captures and measure
actual 4090 memory use before increasing capacity. No new weights or paid
compute were provisioned for the operating-estimate release.

## Acceptance for the first gym

The software contract tests use authored geometry and test inputs, not a
customer gym scan. A real pilot remains incomplete until an actual gym map has
been imported, cross-checked against measurements, reviewed and run with that
cleaner's configuration. Record the observed first cleaning run and compare its
time, assistance and costs with the exported estimate. Use those observations to
calibrate the next run. A GR00T selection does not establish learned-policy
execution on that site.
