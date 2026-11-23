---
type: project
description: Shared robot capability, native drivetrain, arm and telemetry workbenches connected to scan projects
---

# Robot capability and scan projects

Owner asked to build every robotics layer from the Ari Bryant reel and make World Builder more useful using Ahmad Saroya / Moving Atoms' batch scan-to-BIM workflow. Work starts from main `9c17a77` on branch `codex/robot-capability-bim-workbench-20261122`.

Native `layer:robotcapability` and `layer:bimworkbench` activities are integrated in the existing studio, not separate landing pages. Shared profile edits update the main planner envelope and custom robot name. The reviewed-map recorder accepts the optional capability; old showroom callers retain v1 behavior.

`brainsnn.robot-capability.v1` carries body dimensions/mass/payload, limits, drivetrain, optional motor/driver/thermal constants, sources and unknowns. Generic dynamics are authored assumptions. Differential v2 recording uses real MuJoCo free-body + wheel hinges, waypoint/MPPI feedback, actuator limits and latency. Native frames preserve position, quaternion, encoders, torque and contacts. Exact profile/scene hashes and executable MJCF accompany JSON and OpenUSD body replay.

`robot-frames`, `robot-arm`, `robot-telemetry` and `robot-drive-analysis` implement explicit Z-up/XYZW transforms, generic serial-arm pose IK + swept capsule/box checks, bounded log import/comparison and parameter-driven DC motor/RC heating. No SNN policy, legged gait, hardware execution, electrical measurement or survey accuracy is implied. Missing motor constants remain unavailable.

The robot panel provides route recording, arm targets, actual encoder channels, spatial/time registration, held-out comparison and unapplied wheel-radius proposals. Fitted sources are tracked by source hash; chart pairs match scored evidence. Arm obstacles use the frozen trial's initial body transform when available; default base and 0.5 m obstacle heights are explicit assumptions. Recorder reset clears parent results.

Both panels hand bounded JSON summaries to the existing Saved projects chooser, where the user chooses the retained destination. Full recordings and source files remain separate downloadable evidence. The scan queue persists local files/real worker IDs and requires reconnect/resume after reload; see `world-bim-workbench-2026-11-22.md`.

Implementation guide: `docs/world-robot-capability-workbench.md`. Numeric contracts: `docs/world-robot-evidence.md`. Scan workflow: `docs/world-bim-workbench.md`.

Final application gate: 739 World/street Node tests passed; 15 combined survey-worker/OpenUSD Python tests passed. Production build and TypeScript checking passed (the TypeScript process needed a 6 GiB Node heap in this runtime). Native physics, numerical/queue tests and real Chromium smoke cover shared profile selection, actual successful MPPI route, reachable/unreachable arm, registration-gated telemetry, calibration-source reuse after renaming, both Saved projects handoffs, IndexedDB recovery and 320/390 px layouts. A separate recorder lifecycle smoke passed completion, reset, restart, cancel, error and disposal checks. A real local worker/Blender compiled the authored 5,053-point room into IFC, DXF, GLB, USD and drawings. Synthetic comparisons establish software plumbing only. Production website/worker and real hardware remain separate qualification steps.

No commit, push, merge or deployment was performed during implementation. Keep the browser and compatible `registered_survey_cloud:true` scene adapter changes together when preparing a release.

November 23 continuation: the owner approved the concrete commit/coordinated release request with “Okay build” and added a Depth Pro 2 reference. The robot/scan implementation is now committed as `919e72f`; main `faacb8e` is integrated via `66457d6`. See `world-depth-workbench-2026-11-23.md` for the additional depth layer and release constraints.
