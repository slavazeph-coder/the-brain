---
type: project
description: World Builder showroom object selection, verified video timing, and route comparisons
---

PR [327](https://github.com/slavazeph-coder/the-brain/pull/327) adds a local-first showroom viewer under /world/index.html#showroom. One object selection links retained images, bounded observations, attributed point samples and ground footprints. The shipped practice room is authored. Imports can have multiple distinct object-removal comparisons. A movie must match the bundle's SHA-256 to synchronize. A reusable offline decoder-time matcher returns evidence and ambiguous or missing matches. Keep the moving video distinct from boxes drawn on an actual retained frame. Branch codex/world-showroom-map-20261120, feature commit d302d721.

## Camera walkthrough

The showroom's **Preview the walk** opens at `/world/index.html#showroom-walk`. Depth-equipped rooms project two camera pictures to the selected pose. Unsupported pixels are visible until the visitor turns on endpoint fill. Older compatible rooms use the recorded points and approximate cameras. The public practice room uses Blender depth maps. The optional external model prediction format, disjoint photo evaluation and initial eight-photo results are documented in [the evaluation guide](../docs/world-showroom-walk-evaluation.md). ViewNeXt's repository still listed weights and inference code as forthcoming on November 20, 2026.

## Recorded robot episodes

The showroom's `#showroom-run` activity and the current reviewed map's **Route to a spot** panel can simulate and record a 35 cm delivery cart with actual MuJoCo. Both the waypoint controller and the state-only fitted driver use the planner's next waypoint. Exports retain 20 Hz observations, actions, contacts and outcome, executable MJCF and a metric OpenUSD kinematic replay. The separate `#rolling-pin` tabletop activity simulates free-body grip, lift, carry and release onto a tray, including an open-jaw negative control. Offline LeRobot exporters can also run native MuJoCo to generate synchronized overhead or side images, and reopen every transition using the official dataset reader. See the [playground instructions](../docs/world-showroom.md) and [dataset guide](../docs/world-showroom-episode-dataset.md).
