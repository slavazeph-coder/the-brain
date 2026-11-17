# Space Workbench

World Builder now opens a linked source-point / compiled-model workbench in the
scene dialog. The same component is available at `/world/facility.html` for local
`scene.json` and `arena-cloud.json` files from one compiler run. Nothing is
uploaded by that page. Use the existing IFC, Rhino, quantities and robot-route
exports for their respective handoffs; this view does not rewrite them.

## Use it

1. Compile a reconstruction or registered cloud with the existing worker. Open
   the resulting scene in World Builder, or open its two matching JSON files in
   Space Workbench. Each local file is capped at 16 MiB.
2. Switch **Scan / Model / Overlay**. Source points and component envelopes share
   a coordinate frame. Overlay opacity applies to the model. Search by component
   label, source name or stable ID, then select and focus a component.
3. Use **Vertical section** to clip both representations to one source-height
   range. **Isolate envelopes** hides other model components; source points stay
   visible as context. This is not complete object segmentation.
4. **Play assembly** reveals completed components in compiler inventory order.
   This is model assembly playback, not a recording of AI execution or timing.
5. Save up to 12 named camera views and export `facility-review.json`. Saved views
   remain session-only until exported. This release exports the receipt but does
   not import it. The receipt includes source hashes, revision, view settings,
   visible IDs, section bounds, scale metadata and explicit validation limits.

The example button opens six authored components with 2,916 authored surface
samples. It is a software fixture, not a real phone capture or laser scan.

## Source and coordinate contract

Before rendering, `createFacilityReview()` snapshots the inputs and requires the
ordered point digest to match **both** `scene.cloudPointsSha256` and the stable
component graph's source hash. Scene/cloud scale metadata must agree. Existing inventory validation checks IDs, kinds,
source names and revision. The caller supplies the scene's exact original-byte
SHA-256, obtained from the checked worker download or the original local file.
The Python graph content digest is retained; the browser does not independently
reproduce Python's canonical JSON digest. Binding establishes provenance, not
truth of geometry or registration.

The shared frame includes retained points and rotated envelope corners. The
WebGL renderer subtracts a display origin **before** creating Float32 positions.
Camera targets, clipping boxes and posed transforms keep source-coordinate API
semantics; export coordinates do not move. This prevents centimetre differences
from collapsing solely because the source has a large numeric offset. It does
not improve the reconstruction's accuracy.

The existing 50,000-point compiler limit and 1,024-component browser inventory
limit are preserved. The renderer loads this bounded set, not a streamed or
unlimited facility scan. It does not merge multiple captures or register floors.
The software fallback previews at most 5,000 points and explicitly disables
clipping and model transparency. Sections have no caps; envelopes are not exact
CAD solids or hosted openings. Grid lines are display context.

Pending BIM edits, source replacement and disposal block stale actions and
exports. A mismatched or malformed file pair clears the prior view. Receipts do
not include point payloads, credentials or original capture media.

## What this takes from the reference

The [Prevu3D reference](https://www.linkedin.com/posts/prevu3d_ai-agents-build-cad-from-a-scan-time-lapse-activity-7528080153969655809-eklt)
and [official explanation](https://www.prevu3d.com/news/ai-scan-to-cad-reality-data/)
describe linked capture/CAD representations, progressive component assembly and
human review. Prevu3D reports an industrial scene modeled by agents in roughly
24 hours. No reconstruction code, reproducible dimensional benchmark or cost
was provided in those sources. Its proprietary platform is not incorporated
here. This implementation uses the repository's existing renderer and compiler
outputs, with no new inference model, paid API or software dependency.

This release makes the existing output easier to inspect. It does not establish
industrial MEP reconstruction, automatic parametric CAD, fabrication readiness,
survey accuracy or parity with the reference. Camera-derived geometry and
internal fit remain separate from independent metric checks. User-entered scale
remains user entered. Registered-cloud units and registration remain declared
assumptions. Routes remain simulation evidence, not physical robot validation.

## Reproduce the checks

```sh
cd brainsnn-r3f-app
npm ci --no-audit --no-fund
npm run test:world
npm run lint
npm test
npm run build
cd ..
WORLD_BROWSERS=chromium,webkit python tests/world/facility_browser_smoke.py
```

The browser test uses authored fixtures. It checks actual Scan/Model/Overlay
pixels, clipping of both cloud and model, hidden/clipped selection refusal,
source-coordinate camera round trips, large-offset display equivalence, saved
views, receipt downloads, source replacement and stale/dirty guards. It also
opens the existing operational and four-view IFC interfaces to catch shared
renderer regressions. SwiftShader is software WebGL execution, not a GB10,
RTX 4090 or physical-phone performance qualification.

Before presenting a facility-scale production claim, run an actual large
registered scan and an actual phone reconstruction through the compiler, retain
original capture/registration/scale provenance and source hashes, and record
load time, render time, peak memory and section responsiveness on the target
devices. Check independently measured held-out dimensions and component
completeness separately. This feature alone adds no such measurement result.
