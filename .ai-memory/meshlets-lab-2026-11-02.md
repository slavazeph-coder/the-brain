---
type: project
description: Isolated pinned r187 rendering lab, source-bound local GLB and measured browser receipts
---

Owner requested the next layer plus a Meshlets Lab. Verified official r187 release
dated October 30 and experimental MeshletDrawingPipeline. Actual utility uses
64-triangle clusters, not 128. Pipeline supports ordinary/instanced meshes with
restrictions; it does not automatically turn logical cognitive layers into draws,
accelerate point clouds/splats or fill missing reconstruction.

Built optional /lab/meshlets/ with its own exact npm alias 0.187.0. Preserve r182
for existing R3F and capture paths. Standalone self-hosted bundle only, no Lucy/CDN
assets. Theme near black, cyan and violet. Procedural shared-geometry field,
actual pipeline debug/culling/LOD, computed counters, capped explicit WebGL fallback.
Local GLB remains private, bound by SHA-256 and object names; only derived preview
is normalized, never BIM or collision outputs. Fixed-view foreground frame-cadence
receipts include samples, settings, viewport and limitations. No 60 FPS promise.

Local typecheck, build, code-split guard and 1,096 app tests + 73 analysis tests
passed. Browser binary download was truncated locally. Hosted browser test added
for real production HTTP, WebGL desktop/phone sizes, actual local authored GLB,
actual WebGPU meshlets and a matched-load standard run on software Vulkan. Only
the hosted result can establish those browser passes. Hardware GPU/mobile speed,
complete real scan geometry, metric accuracy and native BIM editing remain open.
Runbook: docs/meshlets-lab.md. Memory-sync helper unavailable; commit with code.
