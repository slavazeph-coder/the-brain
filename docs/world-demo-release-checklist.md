# Phone video to reviewed BIM: demo acceptance

This checklist separates software validation from a real capture demonstration. A synthetic room, authored GLB or replayed artifact can validate transport and UI behavior; none is a physical phone-capture result.

## One complete demonstration

Record one continuous, identifiable phone video of a static room, including floor texture, corners, wall boundaries and a doorway. Keep the original file, device/lens settings and SHA-256. Measure one identifiable calibration span and at least three other lengths in different directions. Lock the calibration versus held-out assignment before processing, with instrument, units, uncertainty and endpoint descriptions.

The demonstrated path is capture/upload → actual reconstruction → entered metric scale → held-out checks → reviewed BIM opening → downloadable IFC → import and inspection in a BIM application. Preserve the actual failing or missing checks rather than selecting only successful numbers.

## Required evidence

| Gate | Evidence to retain | Acceptance and scope |
|---|---|---|
| Reachable worker | Capability response, source and environment version, authenticated upload/job/artifact receipts | The required engines actually execute. A configured adapter label alone is insufficient. Keep credentials and private URLs out of public recordings. |
| Real phone input | Original video and capture hash | A photograph sequence or synthetic fixture is labelled as such and cannot satisfy this gate. |
| Reconstruction | Source hash, registered frames, poses, PLY, transforms, worker job ID and elapsed time | Finite outputs, adequate registered views and visible coverage of the room. Missing surfaces stay explicit. |
| Calibration | Picked endpoints, entered length, scale provenance | Metres are self-reported until independently checked; a preset or typical door size is not a measured anchor. |
| Independent checks | `scene-measurements.json` and original readings | Review per-check errors and calibration failures separately. Proposed demo policy is the greater of 5 cm or 2%, declared before the run. Matching a few point pairs does not certify every BIM element. |
| Review persistence | Cloud hash, reviewed opening input, host wall snapshot and revised scene | New capture, changed scale or incompatible host geometry invalidates stale review. No approval is invented by a recorder. |
| BIM geometry | IFC, scene JSON and related exports with hashes | Separate wall/slab elements, correct hosted void relationships, valid units and provenance. If one output has only approximate geometry, label its scope rather than implying every format is identical. |
| BIM application | Exact application/version, imported IFC, selected wall/properties and opening | Open, select individual elements, inspect dimensions, edit one intended dimension, save and reopen. Confirm void/filling attachment and keep the edited file separate from the original evidence. |
| Robot route, if shown | Scene hash, robot envelope, planner version and route receipt | Unknown space is blocked. Closed doors stay conservative. A planar simulation is not physical robot execution. |
| Recording | Master, feed and short files with hashes; readable captions | Input credit, entered scale, measurement scope, uncertainty and inferred geometry remain visible. Render into a fresh directory; failed encodes are not completed films. |

## Software checks before the physical run

- Run the World geometry/client contracts, worker contracts, BIM-review/export contracts, type check and production build.
- Exercise the actual HTTP worker in Chromium and a phone-sized WebKit viewport. Check capture/scale/review/export, cancellation, a failed held-out span, changed source/scale and a rejected stale review. Inspect page errors and mobile overflow.
- Verify artifact downloads by the worker-provided size and SHA-256. Load measurement evidence only from its own job/cloud/scene and discard late or mismatched responses.
- Parse and validate the IFC, including all references, metre units, host/void/filling relationships and a geometry check that the opening actually cuts its intended wall. An EXPRESS pass alone is not the native BIM editing test.
- Keep fixture tests explicitly labelled. Do not record fixture screenshots as proof of real reconstruction or physical accuracy.

`tests/world/scene_browser_smoke.py` exercises the actual local HTTP worker with an authored scene fixture. Set `WORLD_BROWSERS=chromium WORLD_PHONE_VIEWPORT=1` for both desktop and a 390 × 844 touch viewport. This includes a deliberately failing withheld reading, explicit opening review and upload consent, a fresh IFC download, changed-scale invalidation and rejection of a stale review. This remains software validation. A phone-sized Chromium run does not establish Safari or physical-phone compatibility.

## Local browser receipts, 24 October 2026

The six flows below passed with the current local Chromium executable: each row ran once at desktop size and once at 390 × 844 with touch input. The worker API, uploads, job execution, short-lived artifact access and hash verification ran over HTTP. The fixture authored the scene geometry; it did not reconstruct a captured room.

| Flow | Desktop Chromium | Phone-sized Chromium | Scope |
|---|---|---|---|
| Image to scene preview, reopen and clear | Passed | Passed | Authored GLB transport and viewer lifecycle |
| Synthetic reconstruction to entered scale, metric scene and reviewed route | Passed | Passed | Diagnostic PLY before the GLB cannot displace model preview; real upload and planning code; no physical route |
| Held-out check to reviewed opening, revised IFC and stale-review rejection | Passed | Passed | Real measurement report and IFC writers on authored geometry; failed check stays visible; changed scale cannot reuse review |

The report labels point-cloud distances as **reconstruction**, separate from the entered reference length, instrument, date and uncertainty. Calibration remains excluded from held-out status. Both views reported no page errors or horizontal page overflow. The phone screenshot keeps the close control and validation status visible while the long dialog scrolls.

Ignored software-test screenshots are in `output/playwright/world/`: `scene-chromium.png`, `scene-chromium-phone.png`, `scene-metric-chromium.png`, `scene-metric-chromium-phone.png`, `bim-report-chromium.png`, `bim-report-chromium-phone.png`, `bim-review-chromium.png` and `bim-review-chromium-phone.png`. They are diagnostics and must not become reconstruction demonstration footage.

Local WebKit could not launch: its first reported missing dependency was `libgstreamer-1.0.so.0`. A hosted WebKit CI result and an actual iPhone run remain separate gates. No local result here establishes Safari compatibility, native BIM editability or physical accuracy.

The full existing scan-to-model recorder also completed a 39.904 s dry run with real CPU reconstruction, real Blender
compilation, hash-checked IFC download and IFC4 parsing in the web-ifc viewer. Its input was the credited ETH Fountain
photograph sequence, with illustrative entered scale and no independent physical references. No frames or film were
recorded. The robot envelope did not fit a route, and the recorder preserved the `ROUTE NOT PLANNED` outcome.
See [the worker qualification receipt](world-worker-qualification-2026-10-24.md) for inputs, timings, export checks and
environment limitations. This does not satisfy the phone-input or replacement-footage gates.

## Status at the start of this implementation

PR #230's World Builder contracts and PR #231's general and World Builder CI passed on their respective heads. Both had no submitted reviews or inline review threads at the check. Those runs validate their software contracts, not the new combined flow or the physical run above.

The current environment has not supplied a real phone-room capture with independent readings, a current external worker endpoint or a demonstrated native BIM editing session. Those gates remain open until their actual receipts are obtained. Do not describe the product as fully qualified from this checklist or from newly added scripts alone.
