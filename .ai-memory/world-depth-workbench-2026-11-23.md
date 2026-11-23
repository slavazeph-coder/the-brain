---
type: project
description: Native photo/video depth review with pinned MoGe baseline and a disabled separately licensed Depth Pro 2 connector
---

# Photo and video depth review

Owner's November 23 “Okay build” approves the preceding concrete request to commit and release the robot capability and scan-to-BIM work together with its compatible worker, and adds https://lnkd.in/p/gv7QkKsD. That reference resolves to Alessandro Ferrari's LinkedIn post about Apple Depth Pro 2. Official source: https://github.com/apple-aiml-research/ml-depth-pro-2. Apple's published model licence excludes product development and commercial exploitation. No Apple weights were downloaded or executed. The optional local connector must remain disabled unless separately appropriate written rights, pinned local source/checkpoints and actual qualification are supplied.

The new `layer:depth` activity lives inside the existing World Builder. Users can run one photo or a video of up to 60 seconds through the existing worker session, inspect matching source/depth grids, scrub retained frames, probe forward camera-Z depth and ray distance, compare one independently measured forward distance, view per-frame points and save raw JSON/PLY or a bounded project summary. Its authored example runs without a worker and explicitly declares no inference. Default video processing retains up to 16 frames; it does not infer every original video frame.

The default `metric-depth-sequence` worker uses the existing pinned MIT MoGe-2 ViT-B ONNX checkpoint and metric focal/scale solve. Each retained frame runs independently. Frame times preserve actual source PTS or remain unavailable; still photos have no video timestamp. Depth, RGB and intrinsics use the same exact integer-stride review grid, at most 160 pixels on either side. Invalid/sky/out-of-range depth stays missing. Point previews use the same optical-Z geometry. There is no camera trajectory, world registration, hidden-surface completion, BIM output or collision qualification from this engine.

New worker output is checked against the exact selected source file's incremental SHA-256 and kind. Imported or reopened output without that in-session binding is labelled producer-declared. Artifact downloads retain the original bytes and existing worker ticket/hash checks. Model inference provenance is a producer declaration, not independent attestation. Estimated metres remain unverified; the one-pixel comparison does not rescale a scene.

`depth_pro2_backend.py` is optional code, not an enabled adapter. It checks trusted operator permission documentation and pinned local source/config/checkpoints before model imports or execution. Its official buffered video path reports configured versus actually applied window/overlap processing and records the sparse retained input sequence. No checkpoint download, Apple inference, published FPS benchmark or measured temporal accuracy has been qualified here. Visitor grants include only the MoGe baseline.

Robot/scan implementation was committed as `919e72f`, and latest main `faacb8e` (Walk, missions, metering, release workflow fixes) was merged as `66457d6`. The website follows main with CI checks; the private worker follows `deploy/world-worker-20261027` without a CI deployment hold. Preserve worker-only `launch.sh`, acceptance, requirements and Railway root configuration when merging main forward. Its actual start command remains `/bin/sh /app/robotics/world_worker/deploy/railway/launch.sh`.

Development verification: 787 World Builder Node tests passed. Chromium exercised exact source matching through the real WorkerClient and a labelled fixture HTTP transport, original evidence bytes, frame/pixel controls, exports, project handoff and 320/390 px layouts. Backend-authored still/video artifacts parsed in the real browser module; the video decoder preserved PTS starting at five seconds. These fixtures declare `inferenceExecuted: false`. The optional actual pinned MoGe test skips when local weights/runtime are absent; qualify real execution on the provisioned worker separately. See `docs/world-depth-workbench.md` and the associated PR/release checks for final status.

The repository's referenced `~/.ai-memory/memory-sync.sh` helper is absent in this environment. Memory changes travel with the reviewed project commits instead.
