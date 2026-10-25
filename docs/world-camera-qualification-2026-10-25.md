# Camera/component evidence qualification, 25 October 2026

These runs qualify file, point, camera and projection association. They do not
establish phone-room accuracy, surveyed scale, semantic correctness or robot
execution. No new learned model, paid naming API or GPU inference ran.

## Genuine CPU reconstruction and native compilation

PyCOLMAP 4.2.1 ran on eleven retained ETH Strecha Fountain photographs, with no
renderer poses or metric ground truth supplied. It registered 11/11 images and
reconstructed 6,044 points in about 25.9 seconds. This exterior photographic
test capture is not a phone-room demonstration. The prepared photos and private
model workspace stayed outside published artifacts.

The new readonly verifier compared 1,100 registered observations through the
shared camera loader and actual native PyCOLMAP projection, accounting for the
half-pixel convention. Maximum numerical difference was approximately
2.34e-13 pixels. This is implementation parity, not camera accuracy; fitted
feature reprojection residuals are reported separately.

The handoff used an illustrative entered scale of 0.66 metres per source unit,
not a physical reading. The actual scene worker then ran official native Blender
4.2.23 with normal exit 0, without the unverified-geometry experiment override.
It retained 5,925 points. Its approximate semantic decomposition produced three
wall proxies, two separated object clusters, one floor proxy and nine unknown
cells. Those classes are compiler outputs, not independently validated building
elements.

The final worker run completed in 2.835 seconds. Its component sidecar contained:

| Component | Compiler source membership | Qualifying projected frames |
| --- | ---: | ---: |
| wall_1 | 1,068 | 2 |
| wall_2 | 1,246 | 2 |
| wall_3 | 992 | 2 |
| floor_observed | 870 | 2 |
| object_1 | 576 | 2 |
| object_2 | 112 | 2 |
| unknown_space | Unsupported | 0 |

Memberships may share split-wall boundary points. Frame selection uses the
point-based visibility/occlusion heuristic, not image segmentation truth.
Final raw scene/cloud hashes, graph revision, original source cloud/image/ledger
hashes and artifact registration were checked. Images were not published.

An empty local detector callback separately exercised naming transport on both
eligible clusters, making two callback calls and producing four bound frame
records. Labels remained unknown. That is a software transport test, not an
EfficientDet or VLM inference/recognition result.

Final file SHA-256 values:

- `scene.json`: `931797c7b598ad6d906379d643ea27b677155c290acbbec93ba16ea323411a9e`
- `arena-cloud.json`: `6cc3ee5a6d323cbb9293211e5ad976177ccb3b9c84ac1cd818bf4431b3297cf3`
- `component-evidence.json`: `ece2d650cabf24fce06f8a6e97b9eab175a9d5957374a5b97dc3494a9ea9467d`
- Original camera ledger: `f6468fc316a6f630a00336b466e62d43d9cbd11d401afc16d6046f88117c4bf1`

Hashes identify these particular files, not a promise of bit-identical COLMAP runs.

## Negative and limited results retained

A separate rights-clear procedural office was rendered into twelve 640 by 360
photos with the existing benchmark renderer, using a temporary copy with ordinary
native exit rather than a teardown exit override. Actual CPU COLMAP registered
only 4/12 views, reconstructed 132 points in two fragments and selected model 1.
Its mean fitted reprojection error was 0.383 pixels. All 414 registered
observations checked against native projection agreed numerically within about
1.17e-13 pixels. The generic verifier's bounded sample later compared 378 of them.

This incomplete reconstruction produced no walls or separated objects. Naming
correctly skipped; the detector callback was never called. One floor proxy had
21 support points and two qualifying frame projections; unknown space stayed
unsupported. It is not a complete-room demo, despite valid data association.

Native Blender and worker NumPy versions initially differed by about 4.44e-16
scene units or 2.84e-14 degrees, causing exact-fit comparisons to reject valid
support. A recorded 1e-10 absolute arithmetic allowance now handles those
differences. Source hashes remain exact, authored edits remain unsupported, and
tests reject geometry mismatches larger than this allowance. This change is not
a physical accuracy tolerance.

The FFmpeg resampled video path still has no original source PTS or known
source-video pixel transform. MapAnything's additional model-image crop transform
also remains unavailable. Both are explicit nulls. MapAnything camera/raster
association was checked with shaped API fixtures and pinned source review;
actual CUDA/model execution was not qualified.

## Repeat

Use the existing worker or `sparse_colmap` adapter on rights-cleared overlapping
photographs or a walkthrough, then run the [readonly verifier and component
evidence commands](world-camera-evidence.md#run-and-inspect). Original source
media is not committed. The public software tests cover photo EXIF transforms,
radial distortion, model raster dimensions, crop bytes, source subset/scale/order,
stale receipts, boolean/number distinctions and edited-geometry invalidation.

The next capture-quality experiment should increase overlap and compare the same
reference space, rather than treating numerical projection parity as evidence of
coverage or physical accuracy.

Local combined verification: 523 Python tests passed, 95 subtests passed, two
real-capture opt-ins skipped; all 131 Node contracts passed. Those opt-ins were
not silently enabled by the separate native qualification runs. Read hosted CI at
the exact proposed head before treating the branch as release-validated.
