# BrainSNN World Builder — Flagship Product Specification

Status (October 31, 2026): built on `main` and deployed to brainsnn.com. This branch's work shipped in PR #198, and the homepage items below in PR #263. Evidence, and the requirements still open, are in [current implementation and validation](world-studio-implementation.md) under "Full objective still open". Experimental features must not be advertised as live.

| Milestone | State |
|---|---|
| 1. Hero, sample world, mobile upload, job status, processing states, failure fallback | Done. The hero carries the headline, "Create a world" and "Explore Arena", and an above-the-fold Sample / Generated / Reviewed demo drawn from the real sample and planner. Uploads and jobs run through an operator's private worker; public hosted processing is still off. |
| 2. Single photo to 3D | An on-device relative-depth preview is done and labelled visual only. Since November 1 the worker's `photo-metric` engine turns one photo into a 3D point preview in estimated metres (MoGe-2 ViT-B, MIT), in about 15 s on CPU. Against ETH3D laser truth over 18 photos its depth was off by a median 7.9% (worst 27%, outdoors). It is labelled not measured and not generative, and it never becomes a map. No licensed generative model has run: Lyra 1 waits on GB10 qualification, and Lyra 2 is excluded under its checkpoint terms. |
| 3. Phone walkthrough to reviewed map, path preview and estimates | Done with a connected worker; verified on the live site on October 22 with the operator's CPU worker. Since October 31 the worker estimates each scan's metric scale with MoGe-2 ViT-B (MIT) and the map is proposed at that scale as soon as the scan loads (unless it would replace the person's own map), labelled estimated and unreviewed; a measured distance replaces it. On three ETH3D scenes with laser-measured ground truth it read 6%, 9% and 16% high, where the old fixed 1.35 m phone-height guess was 198% high, 134% high and 37% low. The gym and cleaner field validation is open. |
| 4. Video-model tags, rescan guidance, scenario comparison, signed report | Frame-bound observations with human review are implemented but not benchmarked. Capture guidance, partial-reconstruction recovery and scenario forks exist. Reports carry a SHA-256 hash, not a signature. |
| Acceptance | Phone-sized WebKit runs in CI. Physical iPhone Safari and a supervised robot comparison are still open. |

**Still open, and each needs the owner** (nothing more can be built for these from the repository):

| Item | What unblocks it |
|---|---|
| Lyra generative 3D | GB10 time for Lyra 1 qualification, and a check of the individual checkpoint licences before any commercial use. |
| GPU worker | Update the repository's GPU Remote Validation SSH port variable and host key to the current machine; the last run recorded no markers. |
| Physical iPhone Safari | One walkthrough on a real iPhone through `/scan`. CI covers phone-sized WebKit only. |
| Free visitor processing | On by default since November 1 (the owner could not set the flag): 2 jobs per visitor, 20 a day. `WORLD_SITE_VISITORS=0` on the site service turns it off. |
| Anthropic key | Rotate the key that was pasted in chat, and set it only in the worker environment. |

Branch: feature/world-builder-flagship (historical, last commit 80fae28 on October 22). Its specification and fixes reached
`main` through PR #198 and later. The fixes made after that merge (the untouched-sample guard, resilient job polling, the
MapAnything poses, the Arena floor-estimate guard and the framed install) are on `main` in equivalent form. Build on `main`,
not on this branch.
Goal: turn a photo or iPhone walkthrough into an explorable world, then a reviewed robot planning scenario.

## Brand and landing page
Preserve existing BrainSNN palette, typography, spacing and existing Arena navigation. Do not overwrite the current playground. Landing hero: "Turn any photo into a world. Turn any world into a robot simulation." Subheading: "Start with a picture or walk through your space with your phone. Explore a 3D preview, review its geometry, and test how a robot could work there." Primary CTA: "Create a world". Secondary CTA: "Explore Arena". Above-fold interactive demo with clear SAMPLE / GENERATED / REVIEWED states. Do not claim the generated scene is metric-accurate.

## User journeys
A) One photo: upload image -> request consent to send it to processing -> generate a visually explorable 3D scene via an available licensed backend -> browser splat viewer -> label GENERATED VISUAL ONLY -> optional request to add more photos / video to improve geometry.
B) iPhone camera: record 20–90 seconds via Safari getUserMedia / MediaRecorder with file-upload fallback; show coverage hints, quality and consent; multipart/resumable upload -> extract frames, camera poses, dense reconstruction -> floor and obstacle proposals -> prompt user for scale confirmation and review -> plan route -> estimate coverage, time, intervention and cost with editable assumptions.
C) Existing scan: accept compatible GLB/PLY, RoomPlan JSON and validated floor map formats, preserving present site-workspace behavior.

## Rendering and processing architecture
Browser: React/Three.js or existing R3F app, Gaussian splat viewer (e.g. compatible open-source renderer), scene controls, separate geometry and visual layers.
API: authenticated job creation/status/cancel, object storage with presigned URLs, resumable chunk upload, queue/worker, artifact manifest and TTL/retention controls; avoid buffering multi-GB blobs in browser.
GPU worker: licensed single-image 3D candidate (Lyra 1 pending complete dependency/guardrail and GB10 qualification; Lyra 2 production use excluded under its current checkpoint terms — see [qualification review](world-generative-qualification.md)), Image2Splat only after upstream/repo/license verification; multi-view reconstruction candidates COLMAP / GLOMAP / MASt3R-like alternatives after licensing review; scene segmentation + geometry proxy extraction. Do not assume a specific model runs in 24 GB VRAM without profiling.
Video LLM: asynchronous object/event annotation with provenance (frame/time/bbox/confidence), not a source of measured physical parameters. Attach human-reviewed tags to 3D entities.
Robotics: existing BrainSNN site core for deterministic path/coverage preview; robot-specific dimensions/turning constraints and verified floor map; future ROS2/Isaac Sim bridge isolated from browser. Use verified real-world telemetry for calibration, never use generative splats as collision surfaces.

## Data model
world_id, owner_id, source_type, source_assets, processing_status, artifact_urls, source_frames, pose_graph, visual_scene, metric_scale, scale_confirmation, collision_map, semantic_entities, uncertainties, robot_profile, planning_scenario, assumptions, result, evidence_refs, retention_expiry.

## Product integrity
Photo-only outputs = GENERATIVE VISUAL PREVIEW. Multi-view reconstructions = RECONSTRUCTED / UNVERIFIED until scale and obstacles are reviewed. Planning results = PLANNING PREVIEW, not safety certification or real robot execution. Unobserved areas flagged unknown. Critical clearance must be checked with real measurement.

## Initial build milestones
1. Homepage hero and sample world, working mobile upload, job status, clear processing states, and branded fallback on failure.
2. Single-photo to 3D behind feature flag only after GPU/model license validation; load a real generated asset in splat viewer; source-vs-generated comparison.
3. Phone walkthrough to reviewed map, existing path preview and cost estimates; validate with one gym and one cleaner.
4. Evidence-based video LLM tags, ask-for-rescan guidance, scenario comparison and signed report.

## Acceptance criteria
Homepage matches existing color tokens and passes mobile Safari, desktop and keyboard accessibility tests. Existing Arena navigation and robots remain functional. No unsupported 3D or metric-accuracy claims. Upload cancellation, auth, retention and artifact download tested. Real backend required before marking processing as available; never substitute fake outputs. On-screen source/provenance and explicit scale review. Compare route predictions against supervised robot run.

## References
https://github.com/nv-tlabs/lyra
https://github.com/facebookresearch/map-anything
https://github.com/colmap/colmap
https://github.com/nerfstudio-project/nerfstudio
