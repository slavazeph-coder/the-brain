---
type: project
description: Owner-only IFC execution and retained component photos through the actual World Builder worker
---

## Owner instruction

After PR #298 the owner said "Next all". Finish the queued release, connect the IFC action to the private worker and expose actual retained capture photos before expanding autonomous remodeling claims. #298 deployment 4887e183-1dac-4a22-837f-d563dcac12ad reached SUCCESS; canonical www /world/asbuilt.html and vendor IFC reader returned 200.

## Implementation

- `asbuilt_jobs.py` provides `asbuilt-update` and `asbuilt-evidence` adapters. They read the exact source job's metric scene and same-owner retained reconstruction ancestry. No client-selected server path or external URL is accepted by the HTTP contract.
- New bounded upload kinds IFC (16 MiB) and asbuilt JSON (1 MiB). Visitor proxy and worker tenant authorization deny these. Existing quotas, retention, cancellation, tickets and artifact hashing are reused. IfcOpenShell 0.9.0 pinned in a dedicated CPU requirements file and worker image.
- Embedded review can create/download a separate actual updated IFC after reviewed frame/identity/placement and explicit upload consent. Original prior IFC, scene bytes, review and provenance sidecars are preserved. Hosted functionality requires the original worker/source client; standalone local scene files retain the CLI path.
- Component selection plus retrieval consent recomputes existing compiler point memberships and ledger projections. Up to two actual retained frames are resized, displayed with projected point bounds, and retain original raster/ledger hashes, lens/pose/source-time metadata. Missing/stale/foreign camera evidence produces no substitute image. Bounds are not segmentation; visibility is heuristic, not measured truth.
- Source/review changes clear results and cancel allocated jobs. Side-effecting create responses are retained during cancellation. No panorama generation, MEP network remodeling, physical robot execution or metric-certification promotion.

## Execution and deployment

Local 356 World Builder Node tests passed; worker/tenant/IFC/profile selection: 166 passed, 2 optional skips. Actual Chromium desktop/phone proxy-to-worker browser tests passed IFC readback, original raster/overlay, consent, hash downloads, visitor denial and disposal. CI must confirm WebKit and exact final head; record results in the PR.

Website follows main. Private worker follows deploy/world-worker-20261027. Its root railway.toml is deliberately worker-specific and must not be replaced with website main's root config. Preserve WORLD_WORKER_HOST=0.0.0.0, one replica, volume and model pins. Deployment branch has additional profile tests and requirements-dense comments. Update it by merging the reviewed main release while retaining those differences; never merge worker root config back into website main.

No independently measured real room/camera change experiment has been executed by these authored fixtures. See docs/world-builder-asbuilt-review.md for the next held-out experiment and commands. Memory sync helper remains absent; persist notes through the normal feature PR.
