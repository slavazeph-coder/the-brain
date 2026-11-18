---
type: project
description: Four World Builder tools deployed and hosted acceptance passed; API service and SAM3D/ENABLE boundaries
---

# World Builder four-tool release — 2026-11-18

Completed and verified at 18:05 UTC. User requested that the unified playground retain its features, be easier to understand, and incorporate the supplied research layers while building. Public entry: https://www.brainsnn.com/world/index.html → Change things → Make it yours. Four new processing engines are owner/authorized-tenant only; original visitor allowlist remains unchanged.

## Exact live releases

- Website main `5b165df39632127720222d2a73e42c1ebbf59e86`; Railway `fb2fee54-0ec3-45b1-b247-3743539cee92`, SUCCESS 17:50:49 UTC. PR313 merged as `c162194efb4dda38ce9cc906b6419fef55339a3f`; PR316 merged as final main above.
- Worker `deploy/world-worker-20261027` at `eb4a6846e4bda1c3b73517691057902f206435c2`; Railway `8f4719a6-7ee7-4d29-8c5f-5ba0e9900bc9`, SUCCESS 18:00:52 UTC. PR314 merged as `290e7e26696bb31ee9c4ef997a03cd2adff429fc`; PR317 merged as final worker above. Earlier deployments are removed, so no older pending promotion remains.
- All four candidate PRs passed required checks before merge. Exact reviewed heads: PR313 `1040751`, PR314 `4b6f676`, PR316 `5a3a932`, PR317 `31f3b1f`.

## What works

1. Repair appearance: pinned upstream CPU Fast Fill on Gaussian PLY, preserves original bytes/properties and maps generated regions. Appearance completion only; no promotion to measured geometry. Deep Fill is not enabled.
2. Find my robot: measured PLY to metric/frame-bound PCD and ROS2 edge bundle, checked recordings/read-only telemetry; separately pinned ROS2/NDT localizer tested on authored moving scans. Live localization needs a robot-side Linux runtime and LiDAR; no driving/control or physical accuracy certification.
3. Try a movement: actual NVIDIA SOMA v0.2.1 CPU IK, authorized SOMA BVH to 29-DOF G1 reference CSV and human/robot preview. Source/runtime hashes and timing retained. Minimal allowlist avoids distributing the restricted example motion corpus. No executable controller or video-to-policy claim.
4. Understand movement: native pinned OpenSim 4.6 build2 CPU with isolated Python3.12 environment, exact platform wheel SHA and runtime verification. Self-contained .osim + coordinate .mot/.sto + explicit options; optional supplied ground-frame loads. Body/joint/COM geometry, coordinates, muscle lengths/moment arms, and real inverse dynamics for supplied loads or an explicit applicable no-contact assumption. Authored example stays local until consent and Run. No capture, clinical qualification, muscle activation, predicted ground reaction forces or forward dynamics.

PR307 source-bound offline edits and PR309 Scan/Model/Overlay remain. The earlier unified workspace retains capture, original media, measured points, models, drawings, robots, all17 advanced destinations and12 source/client-bound result contexts in the current tab. This is not durable customer project storage. PDF/JSON/SVG drawings remain source/revision bound.

## Verification

- All13 public asset hashes match final main; Chromium and WebKit exercised all4 panels/local example at1360/390/320 pixels without errors or overflow; no uploads/jobs in that public smoke.
- Actual private website proxy shows12 available owner engines, original3 visitor engines;7 tested private upload kinds denied403. No secrets logged.
- Existing scene compiler/IFC startup acceptance passed18:02:58; explicit manual acceptance followed an all-owner idle guard with exact final commit/deployment arguments.
- Hosted repair/map/SOMA suite passed18:04:07: actual192 generated fill vertices,208 authored map points and31 real CPU IK frames,0.631774rad maximum excursion.17 artifact downloads hash-verified.
- Hosted native OpenSim suite passed18:04:43:3 actual API jobs (kinematics/no-contact ID/supplied-load ID),31frames each. Analytic torque error≈1.35e-9Nm.27 artifact downloads hash-verified. Authored mechanical evidence is not human/physical qualification.
- Final retained-results verifier physically rehashed all31 artifacts from3 pre-release jobs: bytes/sizes/metadata unchanged.12 total jobs complete,0prepared/queued/running.
- Local frontend492 tests, native worker304 tests/6 optional skips, actual Linux SOMA/OpenSim/ROS2 and two-browser job flows passed. PR317 first unchanged legacy WebKit phone seek timed out;11 assets/tests identical to green314,8/8 local reruns passed, one same-head failed-job retry passed. Original failure retained; no assertions weakened. Strict software-WebGPU skipped, not qualified.

## Still separate

Existing private v1 already supplies tenant auth/ownership, resumable uploads, prepared/start/poll/cancel/delete jobs, quotas, SQLite WAL metadata/artifact persistence and signed downloads. Public customer API readiness still needs durable customer/project/session ownership, restart-safe queue claims/recovery/idempotency, published accurate schemas/client examples, compute entitlement/reservation/settlement and operational readiness/isolation/retention/backup-restore proof. These releases add real tools; they do not complete public paid API readiness.

SAM3D Objects is not installed: official Linux x86-64/≥32GB NVIDIA VRAM baseline, gated checkpoints, GB10 ARM qualification and specific included Inria helper commercial rights remain unresolved. The4090 is24GB. Top-level licence is not a blanket commercial ban; resolve exact dependencies. Generated completion cannot supply PR307's missing measured observations.

The latest LinkedIn link is SwRI ENABLE, proprietary licensed multi-camera markerless capture. No public redistributable SDK contract was found; no purchase/outreach/license acceptance occurred. Our implemented layer is native OpenSim analysis of appropriately authorized exports, not ENABLE capture.

## Evidence and workspace

Full report: `/Users/slavaz/brainsnn-research/2026-11-18/world-builder-release-status.md`. Receipts: `four-layer-live/website/website-receipt.json`, `private-proxy-receipt.json`; `four-layer-live/worker/layers-acceptance.json`, `biomechanics-acceptance.json`, `retained-results-final.json`; `four-layer-live/deployments-final.json`; `qualification-ci/eb4a684/railway/startup-passed-idle.json`. Earlier API audit: `/Users/slavaz/brainsnn-research/2026-11-17/api-service-readiness.md`.

Dirty `/Users/slavaz/the-brain` and GPU/physical-robot sessions preserved. Implemented in isolated three-layer and biomechanics worktrees. Separate robot-first PR315 was not changed or merged. Documentation receipt branch `codex/world-four-layer-receipts-20261118` is based on final website main; it changes memory only and does not require production redeployment. Global canonical note: `brainsnn-biomechanics-build-2026-11-18.md`.
