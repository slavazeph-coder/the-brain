# Camera and component evidence across reconstruction engines

Implementation and primary-source review: 25 October 2026. This builds on the
[editable component and Nav2 layer](world-component-robotics.md).

The four supplied research briefs point toward reusable source-linked semantics.
The immediate implementation gap was concrete: naming could read only COLMAP's
private files, while MapAnything's poses and intrinsics lacked a common image
identity and pixel-frame contract. This layer connects the existing engines to
one projection/naming path and associates unchanged components with their source
points and camera frames. It does not replace reconstruction or validate physical accuracy.

## Implemented

`robotics/world_worker/camera_frames.py` defines `brainsnn.camera-frames.v1`:

- Recorded original-source names, types and SHA-256 values, checked against the
  exact reconstruction receipt. Original uploads need not remain in the job;
  this is a binding to that receipt, not an independent attestation of capture.
- Exact published cloud artifact bytes, hashes and coordinate frames. Sparse and
  dense clouds can share one camera record without losing which cloud was used.
- Private camera raster path, SHA-256, byte size and dimensions; stable frame ID
  bound to source, raster, camera and pose.
- Original photo dimensions, EXIF orientation and source-to-prepared pixel-centre
  transform where known. Exact original PTS/time base only when actually available.
- PINHOLE or SIMPLE_RADIAL calibration and a proper source-world-to-OpenCV-camera
  rigid pose. Fitted radial distortion remains part of the projection.

Paths stay inside the retained reconstruction job. Symlinks, traversal, stale
images/clouds/receipts, invalid matrix geometry and incompatible dimensions are
rejected. Worker artifacts contain the JSON ledger, not private images.

COLMAP keeps its fitted parameters unchanged and explicitly records its native
half-pixel convention. The shared projector subtracts 0.5 to return integer-centred
raster coordinates. MapAnything's intrinsics are paired with its exact model-sized
RGB raster, not the original upload. Its camera-local axes remain OpenCV while
world coordinates follow the Y-up point cloud. The processed raster is checked
against the loaded model input before its association is accepted.

The current FFmpeg video path resamples and removes duplicates. It records accepted
resampled frame ordinals, exact prepared-image hashes and camera associations;
original source-video PTS and the source-video pixel transform remain unavailable.
MapAnything's additional crop/resize transform is also explicitly unavailable.
Its original/prepared and model raster identities remain bound. No timestamp or
original-image pixel coordinate is fabricated from a frame index.

`object_names.reconstruction_views()` consumes either engine. It verifies that the
Arena handoff is an ordered, colour-preserving subset of the declared source PLY
through one proper rotation, uniform positive scale and translation. Numeric
association tolerances account for similarity-inversion roundoff and are checked
again in handoff coordinates; discarded outliers and large scales cannot excuse
moved geometry. These tolerances are data-lineage checks, not accuracy results.

New naming records retain frame IDs, raster/cloud/ledger hashes, projected boxes,
and exact transmitted crop hashes and crop rectangles. The existing external-crop
consent still applies. Local detection caches use frame/path/raster identity and
recheck bytes before attaching cached results. A legacy job without a ledger can
use its old COLMAP path, explicitly labelled unbound. A present invalid ledger
cannot fall back to legacy cameras.

## Component evidence

`component-evidence.json` is bound to the final raw scene/cloud bytes, ordered
XYZ/RGB fingerprint and component-graph revision. The existing deterministic
compiler supplies wall and separated-object memberships; floor support uses actual
near-floor points. Geometry must match the compiler result before receiving support.
The sidecar records a 1e-10 absolute arithmetic allowance in scene units/degrees
for native Blender versus worker numerical roundoff. The source hash remains exact;
this allowance is not a physical measurement tolerance or accuracy claim.

Each entry contains its stable component ID, full support count, at most 256
sampled source indices, and at most two qualifying frame projections. Evaluation
is limited to 50 components and 60 cameras. Memberships can overlap at split-wall
boundaries and are not an independent classification of every point.

Edited geometry, reviewed openings/reference door leaves, unknown space,
unplaced detections and unattributed detector boxes are explicitly unsupported.
Original wall-fit support does not detect an authored opening. Heuristic point
depth buffers estimate occlusion; they do not establish image-ground-truth visibility.
Sparse/occluded components may have valid point membership and no qualifying frame.

The scene worker emits this sidecar automatically for metric component graphs.
Controlled rebuilds regenerate it too, so an edited wall cannot inherit a source
support claim from its original geometry. Recomputed point-pair reports still
compare the source points, not independently validate edited BIM dimensions.

## Run and inspect

Existing worker requests need no new public endpoint. COLMAP and MapAnything jobs
add `camera-frames.json`; metric scene jobs add `component-evidence.json` to the
existing signed, byte-hashed artifact downloads. Private rasters follow job retention.

Read-only verification of a retained reconstruction:

```bash
python scripts/world-demo/verify_camera_frames.py \
  --job /absolute/path/to/reconstruction-job \
  --cloud /absolute/path/to/arena-cloud.json
```

If a selected COLMAP model remains and PyCOLMAP is installed, the verifier compares
up to 100 registered tracks per view with native lens/pose projection. It reports
native reprojection residuals separately. This comparison is unavailable for a
MapAnything-only job and is never described as an independent accuracy benchmark.
For a nonstandard artifact directory, use `--ledger` with a job-relative or contained
absolute ledger path. The Python loader also accepts the actual artifact directory.

Generate a standalone sidecar without a model call or image publication:

```bash
python -m robotics.world_worker.component_evidence \
  --scene /absolute/path/to/scene.json \
  --cloud /absolute/path/to/arena-cloud.json \
  --source-job /absolute/path/to/reconstruction-job \
  --out /absolute/path/to/fresh-evidence-directory
```

The controlled rebuild CLI also accepts `--source-job` for retained frame evidence:

```bash
python -m robotics.scene_compiler.rebuild_components \
  --scene original/scene.json --cloud original/arena-cloud.json \
  --edits component-edits.json --out edited-revision-1 \
  --blender /usr/bin/blender --source-job /absolute/path/to/reconstruction-job
```

Original files and names remain preserved. Missing cameras produce an explicit
unavailable projection status rather than invented frame links. Neither CLI
executes a naming model. MapAnything inference remains behind the existing pinned
code/checkpoint, local-only installation and CUDA qualification gates.

## How the supplied research changes the next build

| Source | Useful implementation direction | Boundary |
| --- | --- | --- |
| [COLMAP camera models](https://colmap.github.io/cameras.html) and [output conventions](https://colmap.github.io/format.html) | Preserve each fitted lens and explicit pixel/pose convention | Projection parity is separate from scene dimensions or complete coverage. |
| [Pinned MapAnything image loader](https://github.com/facebookresearch/map-anything/blob/3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9/mapanything/utils/image.py), [inference](https://github.com/facebookresearch/map-anything/blob/3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9/mapanything/utils/inference.py) and [geometry](https://github.com/facebookresearch/map-anything/blob/3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9/mapanything/utils/geometry.py) | Pair intrinsics with the actual processed raster and its input order | Prepared-to-model pixel transform remains unavailable; no new GPU inference was executed. |
| [Cloud2BIM paper](https://arxiv.org/html/2503.11498v2) | Architectural decomposition, room zoning and export evaluation are useful future comparisons | It avoids RANSAC, does not support curved walls, and compares processing speed with competing software. Its paper does not prove BrainSNN phone accuracy or sevenfold manual-labour savings. |
| [CoTracker repository](https://github.com/facebookresearch/co-tracker) | Pixel tracking can help future cross-frame evidence | Tracks are 2D, not metric 3D reconstruction; the main repository's noncommercial terms preclude adopting it by assumption. No new tracking model was installed. |
| [Physical Intelligence human-to-robot paper](https://www.physicalintelligence.company/download/human_to_robot.pdf) and [DreamDojo](https://github.com/NVIDIA/DreamDojo) | Calibrated observations and explicit action/state data matter for later robot learning | Ordinary site videos are not robot joint/action records, and predicted video is not physical collision or metrology truth. |

The next useful experiment is a geometry-frozen, source-bound mask/semantic
comparison. Use the same capture, poses, scale and component IDs; compare manual
review with tracked masks on touching objects. Measure split/merge errors and review
time without altering dimensions. Estimated effort: 2 to 4 engineering days;
local test/API spend target below US$20, with actual GPU/model access still the
main blocker. These are estimates, not measured costs or achieved accuracy.
