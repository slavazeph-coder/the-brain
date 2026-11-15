# Reviewed appearance objects

The local asset viewer at `/world/splat.html` can separate selected retained PLY/SPLAT samples into named, operator-reviewed visual objects. It moves, rotates, hides and copies those actual samples, generates seeded pose variations and exports a separate binary PLY with an edit document and receipt. The original input is immutable. This adds an appearance editing layer alongside the existing component, IFC/Rhino and operational-twin records.

## Reference and scope

[Niantic Spatial's November 10, 2026 Object Interaction announcement](https://www.nianticspatial.com/blog/introducing-object-interaction) describes automatic candidate identification, extracted appearance/collision information, review and scene rearrangement. It explicitly calls its physical properties simplified estimates. The announcement links no public object-extraction implementation or comparative benchmark. BrainSNN has not reproduced or beaten that system.

| Capability | Current BrainSNN implementation | Remaining work |
|---|---|---|
| Object selection | Manual rectangles through all depths, replace/add/subtract and Y slab, operator boundary review | Automatic mask proposals and independent whole-object completeness checks |
| Rearrangement | Actual retained point/Gaussian positions, rigid Y rotation of Gaussian covariance axes, hide/copy, exact original reset | Full-resolution extraction and missing-background treatment |
| Variations | Seeded bounded pose changes and replayable edit JSON | Collision feasibility, task coverage and physics evaluation |
| Portable evidence | Original vertex IDs, file/preview hashes, parser/orientation binding, separate derived PLY/hash and proposed AABBs | Signed provenance and robust cross-capture identity |
| BIM/Rhino/robotics | Existing reviewed component tools remain separate | Explicit registration and human acceptance before transferring an appearance proposal into IFC or collision maps |
| Demo recording | Camera studio binds exact prepared artifact bytes and locks its origin to authored | Real-capture object extraction qualification and physical tests |

## Use it

1. Open the local asset viewer and choose an uncompressed `.ply` or `.splat`. GLB keeps the existing surface inspector and camera tools; this workshop does not edit its triangles.
2. Set lowest/highest Y in local asset units to exclude floor and ceiling. Choose **Select in the view** and drag a rectangle. Selection includes sample centres behind visible surfaces, so orbit and refine using add/subtract. Finish selection to resume normal camera controls.
3. Check the highlighted membership, name it and record the explicit boundary review. Keeping an unreviewed group is allowed; transforming, hiding and copying it requires review. Review does not certify a complete physical object.
4. Apply translation and yaw, hide or copy. Generate seeded layouts if useful. Empty space exposed by a move stays unknown. No background is invented.
5. Download the edit document. **Prepare derived PLY**, then separately download the PLY and receipt. Save all three alongside the immutable source. Reopen edits only against the exact source, retained preview and display orientation.
6. **Use variant in camera studio** stages the exact exported bytes. Save camera views, record, and explicitly download video and recording receipt. New selections, highlights or edits invalidate saved camera paths and clips. An edited variant retains an authored origin, including when importing a camera path.

The vertical-axis control is disabled while object groups exist. Restore the original preview first, then change axis and start new selections. An edit document from the other orientation is rejected.

## Data and resource contract

- Input remains bounded at 64 MiB, with at most 100,000 retained preview samples. Larger input is uniformly sampled. Invalid sampled rows may be omitted. The worker scene compiler's separate 50,000-point limit is unchanged.
- Up to 32 disjoint base object masks, 64 instances and 16 layout variants. Visible samples, including copies and background, cannot exceed 100,000. Hidden instances use conservative transformed AABBs instead of constructing hidden Gaussian buffers.
- IDs are stable within an edit document and bound to one source. They are not IFC GlobalIds or identities across captures. Edit masks index retained preview samples; `source_index` in derived PLY maps each row to its original input vertex. `object_instance=0` denotes background; other tags map to receipt instance order.
- Binary point-cloud PLY writes XYZ and byte RGB. It remains a point cloud. Gaussian PLY writes XYZ, DC colour, opacity, three scales and WXYZ quaternion plus source/instance tags. Rotations transform Gaussian axes as well as centres. Higher-order spherical harmonics are omitted by the existing preview parser, so this is a DC preview export, not full-source appearance preservation. Float encodings can introduce rounding.
- SPLAT scales outside the current PLY parser's `exp(-12)..exp(8)` range cannot be exported as a derived Gaussian PLY. The UI gives an explicit error; the original and edit document remain available. No silent covariance clamp is applied during export.
- AABB proposals cover sample centres, not Gaussian tails or complete physical surfaces. Hidden bounds are conservative transformed base boxes. Mass, friction, inertia and BIM class remain null; metric, collision and physical robot validation remain false.
- Original scale is unverified. Translations and bounds use arbitrary local units. These are neither user-measured scale nor independently surveyed dimensions. Appearance edits never promote new measurements, IFC, occupancy or robot routes.
- No paid API, model download or GPU worker is needed for this local layer. GB10/RTX 4090 execution is not established by browser tests.

Hashes detect inconsistent retained data and bind exported files. They are not signed attestations against someone rewriting the complete history. The UI's authored-origin lock prevents accidental relabelling in this workflow; reopening a standalone derived file still requires the operator to retain its receipt and declare its origin honestly.

## Reproduce software checks

```bash
node --test tests/world/*.test.mjs
# In one terminal, serve the existing static app:
python3 -m http.server 8765 --bind 127.0.0.1 --directory brainsnn-r3f-app/public
# In another, with the app's Playwright dependencies and browser binaries installed:
WORLD_URL=http://127.0.0.1:8765/world/index.html WORLD_BROWSERS=chromium,webkit \
  node tests/world/objectify-browser-smoke.mjs
```

The browser test uses explicitly authored point-cloud/Gaussian fixtures. It checks actual WebGL pixels, floor exclusion by selection, transforms/covariance, hiding/copying/reset, original file hash, membership tags, exact-source/orientation refusals, deterministic exports and camera provenance. It does not prove reconstruction quality, full-object segmentation or physical accuracy. CI runs it beside the existing renderer/recording smoke.

## Highest-impact next experiment

Use one corrected real phone capture with retained frames, calibrated camera poses/intrinsics and an independently reviewed chair mask. Freeze original source hashes. Extract a manual baseline in this workshop, move the chair by an authored local offset, and retain the exact export/receipt. Project original membership into two manually labelled held-out frames with visibility/depth checks. Target IoU at least 0.85 and floor contamination below 1%, with unchanged source hash. These are proposed acceptance criteria, not obtained results.

Then compare [SAM 2/2.1](https://github.com/facebookresearch/sam2) mask proposals against that same baseline. Its Apache 2.0 code/checkpoints require Python >=3.10, Torch >=2.5.1 and compatible TorchVision. Image masks alone do not establish 3D membership: actual poses, intrinsics, depth visibility and multi-view agreement are required. Do not wholesale import noncommercial Gaussian Grouping dependencies or assume SAM 3 shares SAM 2's license.

Estimated effort: 2–3 engineering days for the retained-frame projection experiment, longer if capture/pose evidence is missing. Estimated additional provider cost: $0 using an accessible existing GPU; local energy/hardware time is not measured. Main blocker: an accessible corrected real capture with frame/pose evidence and independent object annotations. Physical collision, measured scale and BIM classification remain separate acceptance work.
