# As-built IFC comparison and reviewed updates

The November 2026 Agent2BIM reference demonstrates a useful missing workflow: bring a prior IFC, specify the modeling task, inspect capture evidence beside old and new models, and evaluate component positions separately from recognition. BrainSNN now implements a bounded version of that workflow using its existing compiler scene, source-bound component graph, WebIfc and IfcOpenShell.

Research: [original post](https://www.linkedin.com/posts/boyu-wang-baab071aa_scantobim-bim-digitaltwin-activity-7525973589678956544-XVsG), [paper](https://arxiv.org/abs/2611.10644). The authors tested seven capture configurations in two scenes, once per configuration. Their phone example includes iPhone Pro LiDAR and posed photos, so it does not establish phone RGB video accuracy. Detection and position results differ substantially. A reference refined from one tested configuration, excluded poorly observed surfaces, and single runs limit interpretation. Code, data and modeling scripts are available on request, not as a public reproducible package. BrainSNN has not reproduced these results or copied those assets.

| Capability | BrainSNN implementation | Boundary |
| --- | --- | --- |
| Prior BIM | Direct local IFC import, declared length units, source-byte hash, GlobalIds and original component IDs | Review slice of 1,024 represented elements, 16 MiB IFC, two million evaluated vertices |
| Evidence and changes | Four linked views: prior IFC bounds, current compiler envelopes, matching source points, proposed prior placements | Bounds are proxies. No textured panorama/photo reprojection |
| Modeling brief | Targets, intended use, requested accuracy and observed-component detail | Requested accuracy does not certify achieved accuracy or a BIM LOD |
| Prior update | Explicit reviewed correspondences and rigid frame, bounded placement-only IFC copy | No inferred additions, deletions, resizing, structural edits or coordinated MEP repair |
| Evaluation | Separate component recognition and position checks, reference uncertainty and leakage declarations | Operator declarations are not authenticated survey evidence; physical flags remain false |

## Open and review

Open `/world/asbuilt.html` or **Prior IFC and as-built review** inside a compiled World Builder scene. The standalone page starts with explicitly authored regression data. It is not a phone reconstruction, Agent2BIM reproduction or physical accuracy demonstration.

1. Load the original metric compiler `scene.json`, then an existing IFC. The reader uses the file's declared length unit. Unknown units are rejected. WebIfc's geometry is already SI and right-handed Y-up; it is not scaled twice.
2. Supply the original point-cloud JSON when available. Its ordered Float64 XYZRGB digest must equal `scene.cloudPointsSha256`. The cloud preview is decimated for rendering only. Unmatched clouds cannot become capture evidence.
3. Review the prior-to-capture rigid frame. Enter metre offsets and planar yaw, describe the method, check the review declaration and apply. There is no fitted scale. A same-frame declaration is valid only with zero offsets and yaw. Georeferencing/map conversion is not automatically applied.
4. Inspect all four synchronized views. Prior IFC geometry is shown as evaluated bounds; the current view uses compiler component envelopes. Registration rotates the tessellated footprint rather than a loose bounding box.
5. Match identities explicitly. Matching source-scoped component IDs are suggestions. Unmatched prior elements are not evidence of demolition; unmatched current elements are not automatically authored into IFC.
6. Approve individual translation candidates. Current objects must have compatible extents and an eligible prior IFC class. Floors, walls, openings and unknown-space proxies are excluded. Changing alignment settings clears approvals and requires applying the frame again.
7. Download the reviewed request and comparison report. Files stay local. The browser does not modify an IFC or run a worker. Close/reload discards session state unless review files were exported.

The default shape compatibility limit is 5 cm; maximum accepted limit is 25 cm. The maximum shift is 2 m, with at most 32 selected objects. These are implementation bounds, not measurement accuracy claims. A 60 cm cabinet size difference in the example is deliberately blocked even though a chair translation can be approved.

## Write an actual updated IFC

Use the existing Python scene-compiler environment with NumPy and IfcOpenShell. Run from the repository root on Linux. Publication reuses the existing atomic no-replace directory helper and fails closed where that capability is unavailable.

```sh
python -m robotics.scene_compiler.asbuilt_update inventory \
  --ifc prior.ifc --output prior-inventory.json

python -m robotics.scene_compiler.asbuilt_update apply \
  --ifc prior.ifc \
  --scene scene.json \
  --review asbuilt-review.json \
  --output-dir output/asbuilt-reviewed-001
```

The output directory must not already exist. The command recomputes hashes, component revision, units, frame, extents and eligibility from the original files. It writes `updated.ifc`, `asbuilt-review.json` and `asbuilt-update-report.json`. The original IFC is retained.

Only the selected local placements change. The writer preserves GlobalIds, native units, existing geometry and properties, and checks the bounds of every represented element after reopening the output. Hosted, nested, connected and shared-placement objects are rejected; this is not an MEP network editor. Unevaluable prior geometry blocks writing because unchanged geometry cannot then be checked. Each changed object receives `Pset_BrainSNN_AsBuiltReview` with source/review hashes and placement provenance. Metric and physical-robot validation remain false. Existing IFC/Rhino exports and capture provenance are not replaced by these review sidecars.

The new IFC can be opened by BIM tools and Rhino's IFC workflow. No native Rhino placement-edit adapter was added. USD/robot collision scenes must be regenerated from the accepted source using the existing compiler; a translated IFC is not evidence that a robot route is physically safe.

## Component benchmark

The component scorer separates class-conditioned recognition from centre-position agreement. It uses global one-to-one minimum-cost assignment within each class, with no position cutoff that would hide a badly located detection. Unplaced detections remain detections and count as unlocated. Floors may be excluded from position evaluation. Horizontal and three-dimensional position modes are explicit.

A reference must identify its source, method, instrument, date, uncertainty, exact scene hash and reviewed frame. `usedForModeling`, `usedForRegistration` and `isPriorModel` must be false, and `derivedFromSha256` must be null. It cannot reuse the candidate scene/point hash or known prior IFC hash. Supply `--prior-ifc` when scoring a prior-based workflow so this leakage guard is active. Declared independence alone is not external verification.

```sh
node brainsnn-r3f-app/scripts/world-bim-benchmark.mjs \
  --scene scene.json \
  --reference component-reference.json \
  --prior-ifc prior.ifc \
  --output component-benchmark.json
```

The complete reference schema is illustrated in `brainsnn-r3f-app/public/world/fixtures/asbuilt-reference.json`. The committed example has 100% recognition recall but only 80% position recall within 20 cm among five eligible components. One authored chair is one metre from the declared reference and the floor is excluded from position scoring. These are deterministic software results, not camera, tape, laser or survey accuracy measurements. The report includes uncertainty but does not subtract it from observed error or certify geometry, thickness, topology or MEP connectivity.

## Reproduce the checks

```sh
npm --prefix brainsnn-r3f-app ci --no-audit --no-fund
node brainsnn-r3f-app/scripts/build-fragments-export.mjs
node brainsnn-r3f-app/scripts/build-twin-renderer.mjs
npm --prefix brainsnn-r3f-app run test:world
python -m pytest -q tests/world/test_asbuilt_update.py
node --test tests/world/asbuilt.test.mjs
WORLD_BROWSERS=chromium,webkit python tests/world/asbuilt_browser_smoke.py
WORLD_BROWSERS=chromium,webkit python tests/world/operational_twin_browser_smoke.py
```

Browser tests require Playwright browsers. When using an installed Chromium, set `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`. Tests import the actual IFC with the pinned WebIfc WASM, link cameras, approve a placement, export a request, execute the real Python writer, reopen the IFC, reject stale approvals and reference leakage, and verify desktop WebGL and phone software layouts. All assets are authored fixtures. The fixture generator is `tests/world/asbuilt_fixture.py`.

## Next physical experiment

Capture one room twice with the existing phone-only pipeline. Keep the prior IFC and first capture frozen. Move one freestanding object by a separately measured amount and include one unchanged object and one changed-size negative case. Obtain independent held-out object-centre/room measurements with a recorded instrument, uncertainty and coordinate-frame procedure. Keep those held-out measurements out of scale calibration, registration and modeling. Use separate control measurements for scale/frame.

Review and export the changed object, reopen the IFC in an independent BIM viewer, and score the frozen held-out reference. A proposed acceptance target is correct change identification with no false update of unchanged/size-mismatched objects, preserved identities/properties/unselected geometry, and centre errors within a preregistered tolerance appropriate to the instrument. This target is not a result. Estimate: one to two engineering days plus two to four capture/measurement hours, existing CPU tooling and optional GPU reconstruction time. Main blocker: independently measured real capture evidence. GB10/RTX 4090 capability does not establish that evidence.
