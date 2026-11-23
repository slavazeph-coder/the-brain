---
type: project
description: Native batch registered scan projects, actual scene-usd queue, local recovery, source-bound review and shared Saved projects handoff.
---

# Batch scan project workbench

Implemented on the isolated `codex/robot-capability-bim-workbench-20261122` branch after main `9c17a77`, inspired by the user’s Moving Atoms/LinkedIn scan-to-BIM batch reference. No publication, merge or deployment is implied by this memory.

Files: `brainsnn-r3f-app/public/world/bim-workbench.mjs`, `bim-workbench-ui.mjs`, `bim-workbench.css`; detailed workflow and limits in `docs/world-bim-workbench.md`.

`bimWorkbenchMarkup()` and `mountBimWorkbench({root|host,getConnection,rememberResult,connect,status,onOpenResult,saveToProject})` integrate in the native `bimworkbench` layer. `suspend` is UI-only, so navigation does not pause an authorized processing queue. `saveToProject` hands selected project metadata `{name:'brainsnn-bim-project-summary.json',content_text}` to the shared Saved projects chooser; the summary is capped at 512 KiB and contains hashes/job/review metadata, no blobs or credentials.

One registered PLY or survey `arena-cloud.json` per worker job, with original/prepared SHA-256 hashes, 1–3 requested concurrent jobs limited by advertised worker/account capacity, actual resumable WorkerClient uploads, remote job IDs, actual artifacts, cancellation/retry and human review. Source files and manifests persist atomically in IndexedDB. Reload requires explicit reconnect/resume. Uncertain create responses reconcile by exact upload ID, never blind resubmission; lost job observation pauses fresh submissions. Reviews bind to source/cloud/job/artifact hashes and reset on changed outputs.

Browser PLY preparation rejects coordinates whose float32 representable spacing exceeds 1 mm after declared unit conversion; metre-based UTM origins near 500,000 m are rejected with a specific 31.25 mm/CLI remedy. Accepted spacing is recorded in provenance. Prepared survey JSON preserves its numeric coordinates without a float32 PLY round-trip. The threshold is a preparation precision budget, never a survey/model accuracy claim.

Found and fixed a missing remote contract: the existing survey CLI emitted `survey-scan-point-cloud` / `survey-scan` / `scan-file` scale, but `geometry.load_arena_cloud` and `scene_usd.handoff_input` rejected it. They now accept only the validated paired survey kind/frame with declared metres and selfReported true/verified false, without fabricating multiview cameras. Compatible configured scene adapters explicitly advertise `registered_survey_cloud:true`; supplied examples/GB10/Railway config updated. Single-view reconstruction gates remain unchanged.

WorkerClient request errors now expose their HTTP status so a definite 4xx job-creation refusal can be retried, while transport/5xx uncertainty stays visible for reconciliation. No native RVT or delivery-time/scale claims are made. IFC/DXF/3DM buttons require actual worker artifacts; optional format dependencies can be absent.

Validation: scheduler/source/capacity/cancel/retry/reload/review/summary tests; actual browser/WorkerClient/IndexedDB fixture with source hashes, partial-byte uploads, explicit resume/no duplicate job, navigation, ticket downloads, reviews and shared handoff; backend survey admission and existing cloud regressions. Also ran the actual authenticated worker with Blender 4.3.2 on an authored 5,053-point room: genuine IFC4 with four walls, GLB/USDA/DXF/drawing PDF/measurement/component/Nav2 outputs; downloaded IFC/DXF hashes verified. Rhino3DM was absent, so no 3DM was returned. This is execution evidence on an authored fixture, not verified user scan accuracy or a deployed worker assertion.
