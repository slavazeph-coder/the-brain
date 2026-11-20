# Evaluate reviewed appearance membership on held-out views

The evaluator measures how well one reviewed World Builder group covers a named, visible object in calibrated images. It runs locally with Node 22+, Python 3.10+, NumPy and Pillow. The input is the original workshop asset plus its three downloads and the worker's existing camera ledger. The only added input describes the held-out split and the pixel labels. There is no second 3D object format.

## Prepare one trial

1. Freeze the source bytes, camera ledger and target description. Use the exact camera-world PLY as the workshop source. For a SPLAT, retain the ledger PLY as well. A SPLAT qualifies only if its total vertex count, ordered retained source IDs and every retained original XYZ agree exactly with that PLY. An independently reconstructed, reordered, decimated or transformed asset needs an independently established registration before this harness can use it.
2. Reserve at least two distinct, calibrated views in which the same chair and adjacent floor are visible. Record frame IDs before selection or tuning. The default experiment holds frames out of object selection and tuning. Pose fitting or reconstruction may have seen them. A capture-level generalization test needs a separate split.
3. Give the selector the source and permitted views. In the workshop, make the manual selection, review its boundary, and save the edit JSON. Apply the desired local translation/yaw if testing an authored edit, then download the edit JSON, derived PLY and variant receipt from the **same final revision**. Keep the original source separately.
4. Have a different reviewer label each reserved image at its saved raster dimensions, without seeing the 3D selection, projections or model-generated labels. Record the reviewer, selection operator and actual selection frame IDs. An empty selection-frame list means the operator used the 3D view alone. These fields document human declarations. Human independence and capture origin require external review.
5. Freeze a single-channel 8-bit PNG per frame. Use **0** for other background, **1** for the visible target instance, **2** for all visible floor and **255** for pixels explicitly excluded as ambiguous. Label floor visible through chair gaps as floor. Do not resize, rotate, threshold a model prediction or silently treat unlabelled regions as background. Specify the boundary/ignore rule before scoring and re-use it between runs.

Paths for the ledger and masks are relative to the job root. Keep its bound reconstruction receipt, selected camera cloud and the exact held-out camera rasters at the ledger's relative paths. Prepared/model rasters are also needed when the selected frame record references them. Other registered rasters can stay private or offline. The normal camera loader still verifies the whole job by default.

## Run a known example

Run from the repository root. The fixture builder creates a **new directory**. Its PNG label grids are authored independently of the projection code. It exercises a skipped source vertex, an authored move, a hidden primary and a visible copy. It writes the real native exports through the workshop functions.

```bash
JOB=/tmp/appearance-example
python3 tests/world/fixtures/appearance-holdout/make_fixture.py "$JOB"
python3 scripts/world-demo/evaluate_appearance.py \
  --job "$JOB" --labels "$JOB/labels.json" --source "$JOB/output/fixture.ply" \
  --edits "$JOB/appearance-object-edits.json" --variant "$JOB/authored-variant.ply" \
  --receipt "$JOB/appearance-object-variant-receipt.json" --object object-000001
python3 -m pytest tests/world/test_appearance_holdout.py -q
```

Use `--case incomplete`, `--case floor`, `--case background`, `--case ignored` or `--case occluded` when building a fresh job. `--kind splat --orientation flip-y-z` exercises source registration and display orientation. For a real run, substitute the original asset and workshop downloads. Pass the **base object ID** from the native edit JSON. The complete generated `labels.json` is the template. Set its fields as follows.

| Field | Value |
| --- | --- |
| `schema`, `captureKind` | `brainsnn.appearance-holdout.v1` and either `real-phone` or `authored-fixture` |
| `target` | A description identifying a single physical object across the views |
| `sourceSha256`, `cameraCloudSha256` | Exact workshop source and ledger-bound PLY digests. These coincide for direct PLY evaluation. |
| `cameraLedger` | Object with job-relative `name` and lowercase `sha256` for the frozen camera-frames.json |
| `selectionOperator`, `labelReviewer` | Distinct operator and reviewer identifiers |
| `reviewProtocol` | `blind-image-labels-held-out-from-selection-and-tuning`, after verifying the procedure |
| `selectionFrameIds` | Known ledger frame IDs actually shown during selection or tuning |
| `frames` | One entry per held-out raster with `frameId`, job-relative `mask` filename and exact `maskSha256` |

A new report can be written using `--out new-result.json`. Existing files are refused. Exit 0 means every view met the targets. Exit 1 still writes a complete valid report and means at least one view missed a target. Exit 2 means input, provenance or output validation failed. The tool sends no images, changes no source files and requires no model or worker service.

## What the numbers measure

The actual preview parser retains original source vertex IDs. The evaluator reconstructs the display orientation to validate the original edit document. It replays the export and requires exact edit and derived PLY bytes plus a structurally matching receipt, including source/preview hashes, source-index binding and instance transforms. The report records the ordered selected original IDs as SHA-256 over little-endian uint32 values. A cross-runtime replay discrepancy refuses the input. An unsigned receipt detects inconsistencies but cannot independently attest to capture history.

Only original XYZ enter the camera projector. Moved, duplicated and hidden instances cannot affect the prediction. The worker validates the fitted lens, 3×4 source-world-to-OpenCV pose, image dimensions, byte hashes and pixel convention. Each retained centre that lands in the raster and clears the worker's near-plane cutoff (camera Z greater than 0.000001 in source units) covers one nearest pixel. The entire retained cloud participates in the depth test. The nearest positive camera depth at that pixel wins, with lower original vertex ID breaking exact ties. Empty pixels remain empty. Ignore pixels leave both numerator and denominator.

| Report value | Definition |
| --- | --- |
| IoU | Target intersection / union of prediction and full visible target mask |
| Floor contamination | Predicted visible pixels labelled floor / all predicted visible pixels. An empty prediction yields null and fails. |
| Coverage ceiling | Fraction of labelled target pixels hit by **any** retained sample centre. This upper bound reveals how much IoU is attainable with this cloud and rasterizer. |
| Miss diagnostics | Target pixels with no source centre versus those whose depth winner is unselected. False positives are split into floor and other background. |
| Source preservation | Fresh SHA-256 reads before and after scoring must match the frozen source and the verified native edit/export chain. |

The gate uses integer counts on **every** reserved frame. IoU must be at least 0.85 and floor contamination strictly below 0.01. A good view cannot offset a bad one. A sparse cloud can have low IoU even with correct membership. Treat a low coverage ceiling as a reconstruction or sampling limit. The point depth test estimates visibility only where the retained geometry exists. This protocol scores visible sample centres without Gaussian footprints, surface completion or unknown occluders.

For a new selection, keep the same frozen source, frames, masks, projector and rules. Once a developer or selector uses the held-out results to tune membership, those views become development data. Reserve fresh blind images or captures before reporting generalization. A passing chair trial establishes one object's two-view agreement. Reliable extraction across phone captures needs repeated blind trials across rooms, object instances, occlusion and capture conditions, with failures and coverage reported. Metric scale, IFC classification, collision, physics and physical robot performance require their own evidence.

## Showroom point coverage before independent annotation

The recovered showroom capture has two reserved views of the rightmost blue visitor chair. The selector used views 0082 and 0088. In the 16-view dense reconstruction, inference excluded the two reserved photographs. The archived camera fit had access to the wider sequence. Camera calibration is estimated and the prior correction history remains unverified.

| Original cloud | Retained points | Candidates seen in both selector outlines | Conditional IoU upper bound, 0085 | Conditional IoU upper bound, 0089 |
| --- | ---: | ---: | ---: | ---: |
| Archived baseline | 3,885 | 1 | 2.14% | 1.63% |
| Archived shared-camera run | 3,849 | 1 | 2.31% | 1.63% |
| Fixed-camera dense run | 18,372 | 10 | 4.54% | 3.20% |

For each photograph, the coordinator marked an interior rectangle and an outer envelope before inspecting projections. The bound assumes all interior pixels are scored as visible chair and the envelope contains the chair. If the interior contains K pixels with S distinct source hits, and the envelope contains M distinct hits, the best possible IoU is at most M/(M+K−S). Even perfect selection leaves K−S pixels missing. The dense cloud hits 3 of 550 interior pixels in 0085 and 0 of 726 in 0089. Removing the envelope assumption yields weaker dense bounds of 78.22% and 49.79%.

With the privately shared showroom trial packet extracted, this command replays the dense bound using the same native preview parser, pixel convention and depth test as the scored evaluator. Substitute `baseline` or `shared-camera` for the other runs. The example files freeze the cloud SHA-256, ledger SHA-256, frame IDs and half-open integer rectangles [left, top, right, bottom]. No photographs or vertex data are needed in the repository.

```bash
python scripts/world-demo/appearance_coverage.py --job "$PACKET/dense/job" \
  --regions scripts/world-demo/examples/showroom-coverage/dense.json
```

The native sparse and dense candidate edits in the trial packet are unreviewed. Real chair IoU and floor contamination remain unmeasured. The training outlines and feasibility boxes are unsuitable as independent labels. Use the private offline reviewer to collect independent full-frame masks. These two views have now informed development. Freeze future changes and reserve fresh views before making a validation claim.
