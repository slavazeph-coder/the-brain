---
type: project
description: Source-bound scan/model facility review, display-origin rebasing and truthful completed-model assembly playback
---

Owner asked to finish/merge and build a simpler large-space workflow inspired by
Prevu3D's November16 industrial agent-CAD reel. PR306 independently reviewed and
merged at a8af59c after exact-head CI and reproduced spawn-clearance regression.
PR308 was already merged and postmerge CI/live checks successful.

New Space Workbench mounts natively in the BIM scene dialog; direct local-file
entry /world/facility.html shares the same component. Scan/model/overlay,
source-bound stable component selection/search, envelope isolation, focus,
shared vertical clipping, completed-model assembly playback, 12 session camera
bookmarks, export-only review receipt. No model/worker defaults changed. Strict
ordered cloud hash must match scene.cloudPointsSha256 and graph.sourceSha256.
Caller supplies exact original scene-byte digest. Graph Python content digest
retained, not independently recomputed by browser. Dirty/stale source blocks
actions; malformed/mismatched local inputs clear previous panel.

Renderer subtracts display origin before Float32 conversion and conjugates world
poses; public camera/clip/pose semantics retain original source coordinates.
This addresses numeric precision only. Fixed compiler50000point/browser1024part
limits stay; no full-facility streaming or multi-capture registration. Fallback
5000point SVG has no clipping/transparency and says so. Source points remain
context when envelopes isolated, not complete object segmentation.

Assembly order is completed compiler inventory, not AI execution/timing. Example
is six authored components/2916 authored points, not phone/laser accuracy proof.
IFC/Rhino/names/quantities/routes remain original. No new model/API/dependency.
Prevu3D source https://www.prevu3d.com/news/ai-scan-to-cad-reality-data/ is proprietary
workflow claims, not reusable reconstruction code or independently verified
24hour metric-MEP benchmark. Follow docs/world-facility-workbench.md for tests
and required real-scan/device qualification. Never call this automatic MEP CAD,
survey-grade or physically validated robot output.
