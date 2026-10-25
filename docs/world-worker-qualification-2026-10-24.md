# Local worker qualification, 24 October 2026

The actual CPU reconstruction worker and real Blender scene compiler completed a public photograph-sequence test. This qualifies execution, export structure and a controlled editing path. It does **not** replace the original affected phone demonstration or establish building, survey, collision or robot accuracy. The original 10,925-point reference capture was not available in this environment, so its previously reported before/after measurements were not reproduced here.

## Inputs and provenance

- Official archive: <https://cvg-data.inf.ethz.ch/local-feature-evaluation-schoenberger2017/Strecha-Fountain.zip>.
- Archive SHA-256: `e2bd4f87caec2f7d354e3e09b06c397b4194ed1cb09da029bcbe680dab9c972d`, matching `docs/world-reconstruction-validation.md`.
- Input images: eleven original `Fountain/images/0000.png` through `0010.png`. `sparse_colmap.prepare_photo` produced 1280-pixel JPEG frames. FFmpeg encoded them into a 2 fps H.264 clip solely to exercise the upload/video path. This is an exterior photograph sequence, not a new phone walkthrough.
- Clip: 1,392,986 bytes; SHA-256 `2cbb0cb099f95c986c74cde8902b6e6fdef46d0c7763c0bdaf9d38d4ecd4e4cd`.
- Raw archive, derived media and generated exports remain ignored local QA material under `output/playwright/world/qualification/`. Their redistribution and commercial-demo rights were not established. Do not publish these as product footage.
- The illustrative scale was entered as **0.5 metres/unit**, with a typed 1 metre / 2 unit example. It was not independently measured. Every scene retained `metric_verified: false`; dimensional reports were `no-held-out`.

## Actual runs

Timings are single-run elapsed observations on this CPU environment, not GPU performance claims or benchmarks. Client time includes polling and artifact retrieval. Every downloaded artifact was checked against its worker-reported SHA-256.

| Run | Worker job | Actual result | Adapter time | Client time |
| --- | --- | --- | ---: | ---: |
| COLMAP video reconstruction | `579fc3f919a3ce215836f61abb43fee2` | 11/11 registered frames, 5,414 reconstructed points, 0.368921 px mean reprojection error | 16.634 s | 16.936 s |
| Raw scene from corrected handoff | `6d498d6994836a5f80136deaba574c71` | 4,939 retained points, one wall, one separated unnamed cluster, three unknown cells | 1.130 s | 3.751 s |
| Reviewed scene from identical points | `e5e7a1d49384b1ce9aba2f3ba4fe82bd` | Same retained geometry, one explicitly authored test opening and hosted IFC void | 1.233 s | 4.239 s |

The exterior fixture returned `floorAligned: false`. That is a limitation of this input, not room-floor validation. Its fitted model covered 62.8% of points within 5 cm, with a 3.2 cm median among the 83.7% of points assigned within the modelled-distance cutoff. The nominal floor fit median was 5.3 cm and was flagged as a misfit; the separated object was also flagged. These distances inherit the arbitrary entered scale and compare the model against its own reconstruction. They are not external accuracy measurements. The review opening is an authored software edit, not an automatically detected or observed opening, and does not improve the reconstruction.

The worker returned genuine GLB, USDA, IFC, DXF, Rhino 3DM, quantities, fit heatmap/report and dimensional-report artifacts. No vision naming provider was configured or executed, so no semantic object names or model inference are claimed.

## Export and editing checks

IfcOpenShell **0.9.0** opened both IFC files, ran schema/EXPRESS validation with zero issues, and triangulated the host wall. The reviewed model contains one `IfcOpeningElement` and one `IfcRelVoidsElement`; it does not contain a door filling.

| Independently read representation | Expected removed wall volume | Actual removed wall volume |
| --- | ---: | ---: |
| IFC triangulation in IfcOpenShell | 0.0757848890 m³ | 0.0757849109 m³ |
| Actual GLB imported into Blender and measured with BMesh | 0.0757848890 m³ | 0.0757853757 m³ |

Both volume differences passed a 0.000001 m³ numerical tolerance. This is agreement with the authored rectangular cut, not physical-volume accuracy.

An IfcOpenShell edit increased the wall profile length from 2.937689 to 3.037689 metres, then saved and reopened the IFC. The wall GUID and hosted opening relationship survived, schema validation remained clean, and the triangulated volume increased by the expected amount. This is a direct IfcOpenShell interoperability check, **not a Bonsai GUI edit test**. Existing fit/dimension reports become historical after such an edit and require regeneration.

Receipts: `ifc-roundtrip/receipt.json` and `glb-volume-receipt.json` within the ignored qualification directory.

## Controlled floor and reference-door experiment

A separate deterministic software fixture used `room_cloud(seed=2)` from `tests/scene_compiler/test_geometry.py`: 6,808 authored surface points, one wall, three separated objects and floor points. Its coordinates were tilted by 16.3 degrees around X before calling the corrected `to_arena_cloud`. The illustrative scale was 1 metre/unit.

- Handoff: floor alignment applied; estimated input tilt 16.7 degrees; floor inlier fraction 24.5%.
- On the 1,500 known authored floor samples after alignment: residual plane tilt **0.400 degrees**, median absolute Y **0.00955 m**. These are synthetic-fixture residuals.
- Actual Blender raw compilation: 0.875 s, one wall and three separated objects.
- Reviewed compilation: 1.085 s, one authored 1.0 × 2.1 m reference door; one IFC opening/void relation and one door/filling relation.
- Both IFC files passed schema/EXPRESS validation with zero issues and triangulated. The IFC wall lost exactly 0.210000 m³; actual imported GLB wall volume changed by 0.210000284 m³ against 0.210000 m³ expected. The closed IFC reference leaf volume was 0.105000 m³.
- Raw internal point-to-model median was 0.4 cm, with 96.2% within 5 cm. This is expected for an authored geometric fixture and is not a camera benchmark.

The worker correctly rejected the synthetic cloud because it has no multi-view capture provenance. The direct compiler also refused it by default. The synthetic experiment therefore used the compiler's existing explicit `--allow-unverified` flag. Neither guard was weakened and no multi-view evidence was fabricated. No routes, robot policy, physical passability or collision validation were executed.

Receipt: `synthetic-room-compiler-receipt.json`, plus `synthetic-room-glb-volume-receipt.json`.

## Environment and execution

The reconstruction environment was `/tmp/brainsnn-demo-validation` with Python 3.12, PyCOLMAP 4.2.1, NumPy, Pillow, FastAPI/Uvicorn and IfcOpenShell 0.9.0. Blender was the actual `bpy==4.2.23` LTS wheel in an isolated Python 3.11 environment, `/tmp/brainsnn-demo-blender311`, with NumPy 1.26.4. CAD export dependencies were available. No GPU, paid API, external authentication or naming model was used.

A temporary `/tmp/brainsnn-demo-blender` command shim runs `scene_compiler.py` through `bpy`. Initial normal Python teardown segfaulted **after** scene files were written, so the first scene worker job `7e53454dc59637394e5136844d977594` correctly failed and published no successful output. The isolated shim now flushes streams and uses `os._exit(0)` only after the compiler returns successfully; exceptions still fail. This addresses wheel/interpreter shutdown in this qualification harness, not a production Blender fix. A missing Draco-library warning was nonfatal; no compression is claimed.

Each execution invocation in this managed environment had its own local network namespace. A worker started in a separate invocation could not be reached by another invocation. All successful HTTP runs started the worker and client together in one shell invocation. The worker was bound to loopback port 8040, used a private generated local token, and was stopped after the runs. No persistent worker endpoint is left running.

## Reproduction references

All paths below are exact references to the private, temporary harness used for this run. The harness and tokens are intentionally not committed. For a fresh machine, use the repository's normal worker setup and recording guidance in `robotics/world_worker/deploy/README.md`, `docs/world-reconstruction-validation.md` and `scripts/world-demo/README.md`; replace the private shim with an installed Blender executable.

```bash
# Verify the input before extraction or use.
sha256sum output/playwright/world/qualification/input/Strecha-Fountain.zip

# Existing private harness: starts from the eleven official PNG files,
# generates the labelled photo-sequence clip, uploads it and runs real COLMAP.
/tmp/brainsnn-demo-validation/bin/python /tmp/brainsnn-demo-qualify-reconstruction.py

# Existing private harnesses: upload the raw cloud and the authored-review cloud,
# compile, download, hash-check, schema-validate and triangulate the results.
/tmp/brainsnn-demo-validation/bin/python /tmp/brainsnn-demo-qualify-scene.py raw
/tmp/brainsnn-demo-validation/bin/python /tmp/brainsnn-demo-qualify-scene.py reviewed

# Actual IFC edit/save/reopen and imported-GLB volume checks.
/tmp/brainsnn-demo-validation/bin/python /tmp/brainsnn-demo-qualify-roundtrip.py
/tmp/brainsnn-demo-blender311/bin/python /tmp/brainsnn-demo-qualify-glb.py

# Explicitly synthetic fixture, separate from camera evidence.
/tmp/brainsnn-demo-validation/bin/python /tmp/brainsnn-demo-prepare-room.py
/tmp/brainsnn-demo-validation/bin/python /tmp/brainsnn-demo-qualify-room-compiler.py
/tmp/brainsnn-demo-blender311/bin/python /tmp/brainsnn-demo-qualify-room-glb.py
```

The first three HTTP harnesses require `/tmp/brainsnn-demo-worker-start.py` running in the same execution invocation. The existing private adapter configuration is `/tmp/brainsnn-demo-worker-adapters.json`. Its `scene-usd` configuration advertises source-job linkage, dimensional checks and reviewed BIM openings. Never print, commit or distribute `/tmp/brainsnn-demo-worker-auth.json`.

An equivalent direct synthetic compiler invocation uses only existing repository flags:

```bash
blender -b --python-exit-code 1 \
  --python robotics/scene_compiler/scene_compiler.py -- \
  --cloud output/playwright/world/qualification/input/synthetic-room-authored-review-cloud.json \
  --out output/playwright/world/qualification/scene-room-reviewed-artifacts \
  --allow-unverified
```

The remaining release evidence is a new, rights-cleared indoor phone capture, the original floor regression capture when available, independent held-out dimensions, UI recording, the intended BIM application's edit/reopen check, and any separately scoped simulator or physical-robot validation. This report does not establish production deployment, CI status, full room completeness or replacement demo footage.

## Full recorder dry-run qualification

After the recorder compatibility updates, `record_scan2model.py --dry-run` completed the actual browser workflow in **39.904 seconds**, with **zero recorded frames** and **zero page errors**. This was software QA on the same ETH Fountain photo-sequence fixture. `CAPTURE_CREDIT` explicitly identified the photographs encoded as a video fixture, and the recorder's computed source-video SHA-256 matched `2cbb0cb099f95c986c74cde8902b6e6fdef46d0c7763c0bdaf9d38d4ecd4e4cd`.

The browser performed upload and consent, real COLMAP reconstruction, picking two points, entering an illustrative 2.15 m distance for a 3.2526-unit picked span, real scene compilation, the dimensional-evidence card, SHA-checked IFC download, planar map creation, review gates, a route attempt and opening the downloaded IFC in the real web-ifc parser. This illustrative scale differs from the separate 0.5 m/unit API qualification above; the results must not be combined as one run.

- Reconstruction job: `1d265b9cbe70dd524269e8fe9b067d73`, adapter time 16.897 s; mean reprojection error 0.370099 px.
- Scene job: `f0ebf3ea1ce5cc67255075e9f381b416`, adapter time 1.143 s; 4,944 retained points, three wall boxes, two separated unnamed clusters and twelve unknown floor cells.
- Downloaded IFC: 9,599 bytes, SHA-256 `0770e10f166e58587ae8b0e3e5ede8abcdd3ee8b08f8d047632c6bfd5ea0db2f`. web-ifc parsed IFC4 with one slab, three walls and three proxies.
- The dimensional card correctly reported no independent check. No physical references or opening approvals were supplied, no naming model ran, and no robot policy or physical validation was performed.
- **Negative route result:** no space in this exterior-derived map fit the 0.35 × 0.35 m robot with a 0.1 m margin. The planner reported that its most open spot fit approximately 0.25 × 0.25 m at that margin. The recorder printed `ROUTE NOT PLANNED` and left route metrics empty. No route was forced or represented as successful.

The viewer's pinned README dependencies (`three@0.180.0`, `web-ifc@0.0.77`) were fetched only into `/tmp/brainsnn-demo-ifc-viewer/vendor`; no vendor or media files were added to the repository. Latest viewer files, including the reference-door class, were copied there for the test.

The first recorder attempt stopped before upload because its automatic Playwright `HTTPS_PROXY` configuration returned HTTP 502 `upstream failure` for the loopback page, despite its bypass list. A focused page-state diagnostic confirmed the cause. Removing `HTTPS_PROXY` only from the recorder child environment resolved it; the worker, frontend and viewer all remained local. This was an execution-environment workaround, not a product or capture correction.

Exact private driver: `/tmp/brainsnn-demo-recorder-qa.py`. It starts worker port 8040, frontend port 4181 and viewer port 4190 in one execution invocation, reads the private local credential without printing it, sets `CAPTURE_CREDIT`, runs the existing recorder with `--dry-run`, and terminates its services. It uses `/tmp/brainsnn-browser-stable/bin/python` and the available headless Chromium executable. The redacted log and structured receipt are `output/playwright/world/qualification/recorder-dry-run-fountain.log` and `recorder-dry-run-receipt.json`. No recording or promotional film was generated. The driver's worker/browser processes were confirmed stopped afterward.
