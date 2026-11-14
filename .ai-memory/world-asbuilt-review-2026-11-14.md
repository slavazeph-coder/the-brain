---
type: project
description: Agent2BIM comparison, local prior IFC review, bounded placement copies and separate component position benchmarks
---

## Owner intent and reference

November 14 owner asks to compare https://lnkd.in/p/gBy5r39g and build useful gaps. Resolves to Boyu Wang's Agent2BIM post, https://arxiv.org/abs/2611.10644 (Nov 7). Seven capture configurations, two scenes, single runs. Phone demo includes iPhone Pro LiDAR. Code/data/modeling scripts are on request, not publicly released. Prior/reference bias and excluded poorly observed surfaces limit accuracy interpretation. No author outreach or copied assets.

## Implemented workflow

- `/world/asbuilt.html` and embedded BIM workflow section accept local prior IFC, original compiler scene, optional exact hash-matching source point cloud. Four synchronized GPU/SVG views: prior bounds, current envelopes, source points, proposed placements.
- Pinned existing WebIfc 0.0.79, no new JS dependencies. Explicit IFC length units, SI Y-up native output verified. Actual tessellation convex footprint handles rotated registration without rotating loose AABBs.
- One-to-one correspondences, source component IDs suggested only, explicit reviewed rigid frame with no scale, requested modeling brief. Draft settings invalidate approvals.
- `python -m robotics.scene_compiler.asbuilt_update apply --ifc prior.ifc --scene scene.json --review asbuilt-review.json --output-dir NEWDIR` writes an actual separate IFC and audit sidecars. Local/Linux CLI, not a hosted worker job. Atomic no-replace publication reuses nav2 helper.
- Bounded placement-only updates: 32 objects, 2 m shift, default 5 cm extent compatibility. Preserves GlobalIds, properties, geometry, unselected placements; rejects structural/floor, connected/hosted/nested/shared placements, skipped geometry, stale hashes/revisions and unreviewed identities/frame. Adds hash-bound review pset. No inferred additions/deletions/resizing or automatic MEP network reconstruction.
- `world-bim-benchmark.mjs` CLI plus standalone browser scorer: recognition separately from class-conditioned globally matched position, no distance cutoff, unlocated detections retained, floor exclusions and uncertainty explicit. Modeling/registration/prior leakage declarations and exact-hash reuse rejected. Pass `--prior-ifc` for that hash guard. Declarations are not authenticated physical evidence.

## Validation and boundaries

Local 353 World Builder Node tests and 19 IFC pytest tests passed. Production build/lint passed. Native Chromium desktop WebGL and phone SVG tests pass the actual browser-to-IFC flow; existing operational-twin motion controls also pass. IFC schema validation on the updated test fixture reports zero issues. CI results belong in the PR and must be checked on its exact final head before merging.

Fixtures are authored software data only. Negative case deliberately reports 100% recognition vs 80% within 20 cm position recall. No phone/survey accuracy, physical route validation, Agent2BIM reproduction, hosted worker update or public live-route confirmation follows from these tests. Capture/user-entered scale and existing IFC/Rhino/robot evidence remain separate. Photographic panorama reprojection and coordinated MEP changes remain future work.

See `docs/world-builder-asbuilt-review.md` for commands and an independent real-room change experiment. Memory-sync script is absent in this environment; persist these notes in the normal feature PR.
