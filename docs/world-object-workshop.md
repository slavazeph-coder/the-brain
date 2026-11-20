# Reviewed appearance objects

Open **Make it yours → Arrange a room** in World Builder, or go directly to `/world/splat.html`. The same editor groups selected PLY/SPLAT samples into named objects. It moves, rotates, hides and copies those actual samples, generates seeded pose variations and exports a separate binary PLY with an edit document and receipt. The original input is immutable. This adds an appearance editing layer alongside the existing component, IFC/Rhino and operational-twin records.

## Try it in the playground

1. The reading room opens with a coral chair. Choose **Tap an object**, then tap the chair. With a keyboard, aim at an object and press Enter in the view. Turn the room to check the highlighted points. Give the chair a name, check the review box, and choose **Keep object selection**.
2. Move or turn the chair with the pose controls. To see the rug underneath, choose **Hide this instance** and **Apply pose**. Both practice rooms are authored examples.
3. Choose **Keep for another room**, then **Try the empty studio**. Under **Place an object from another scan**, choose **Place object**. The shelf lives in the open editor. **Download this object** saves a portable `.brainobject` file that you can reopen in a later session.
4. Choose **Try a preview lamp** and turn it on. Pick a spot on the scan or use the keyboard sliders to change the light. Turning the lamp off restores the original colours. This effect stays in the viewer. Recording is available with the lamp off.
5. Download the combined PLY and its placement receipt. The receipt binds the new file to the destination scan and portable object. The camera studio can record a walkthrough of the saved composite.

For an area that needs appearance repair, choose **Use selection in scan repair** on a reviewed Gaussian PLY group. The playground opens the original file and checks the selection against its hash and vertex IDs. You can inspect it again before choosing whether to send it to the existing processing service. When a captured or authored floor is already visible under a hidden object, no fill is needed.

## Reference and scope

[Niantic Spatial's November 10, 2026 Object Interaction announcement](https://www.nianticspatial.com/blog/introducing-object-interaction) describes automatic candidate identification, extracted appearance/collision information, review and scene rearrangement. It explicitly calls its physical properties simplified estimates. The announcement links no public object-extraction implementation or comparative benchmark. BrainSNN has not reproduced or benchmarked that system.

Eros Carrasco’s SplatLab demonstration showed object reuse and relighting of a scanned room. The BrainSNN workflow uses independently written code and original practice scenes. The local suggestion follows connected samples of similar colour. A single click can miss a thin part or include a nearby surface. The lamp adds a spatial colour effect over captured light. Automatic semantic segmentation, material recovery, shadow simulation and unseen-surface reconstruction remain open. [SplatLab author demonstration](https://www.linkedin.com/posts/eros-carrasco_asusproart-adobemax-gaussiansplatting-ugcPost-7528984969289863168-CoR6)

| Capability | Current BrainSNN implementation | Remaining work |
|---|---|---|
| Object selection | Tap a visible sample for a geometric suggestion, or refine through-depth rectangles and Y limits, then review | Semantic mask proposals and independent whole-object completeness checks |
| Rearrangement | Actual retained point/Gaussian positions, rigid Y rotation of Gaussian covariance axes, hide/copy, exact original reset | Full-resolution extraction and missing-background treatment |
| Variations | Seeded bounded pose changes and replayable edit JSON | Collision feasibility, task coverage and physics evaluation |
| Portable evidence | Original vertex IDs, file/preview hashes, parser/orientation binding, reviewed object shelf and package, two-source composite PLY/receipt and proposed AABBs | Signed provenance and robust cross-capture identity |
| BIM/Rhino/robotics | Existing reviewed component tools remain separate | Explicit registration and human acceptance before transferring an appearance proposal into IFC or collision maps |
| Demo recording | Camera studio binds exact prepared artifact bytes and locks its origin to authored | Real-capture object extraction qualification and physical tests |

## Use your own scan

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
- Cross-scan placement accepts a second source of the same representation. An object from a Gaussian scene goes into another Gaussian scene. A point-cloud object goes into another point cloud. Set position, uniform scale and turn in destination-local units. The composite retains every imported object sample and uniformly thins destination samples only when required by the 100,000-sample cap. The receipt reports both counts.
- AABB proposals cover sample centres, not Gaussian tails or complete physical surfaces. Hidden bounds are conservative transformed base boxes. Mass, friction, inertia and BIM class remain null; metric, collision and physical robot validation remain false.
- Original scale is unverified. Translations and bounds use arbitrary local units. These are neither user-measured scale nor independently surveyed dimensions. Appearance edits never promote new measurements, IFC, occupancy or robot routes.
- No paid API, model download or GPU worker is needed for this local layer. GB10/RTX 4090 execution is not established by browser tests.

Hashes detect inconsistent retained data and bind exported files. They are not signed attestations against someone rewriting the complete history. The UI's authored-origin lock prevents accidental relabelling in this workflow; reopening a standalone derived file still requires the operator to retain its receipt and declare its origin honestly.

## Reproduce software checks

```bash
node --test tests/world/*.test.mjs
python tests/world/scan_workshop_browser_smoke.py
python tests/world/splat_lamp_browser_smoke.py
# In one terminal, serve the existing static app:
python3 -m http.server 8765 --bind 127.0.0.1 --directory brainsnn-r3f-app/public
# In another, with the app's Playwright dependencies and browser binaries installed:
WORLD_URL=http://127.0.0.1:8765/world/index.html WORLD_BROWSERS=chromium,webkit \
  node tests/world/objectify-browser-smoke.mjs
```

The browser test uses explicitly authored point-cloud/Gaussian fixtures. It checks actual WebGL pixels, floor exclusion by selection, transforms/covariance, hiding/copying/reset, original file hash, membership tags, exact-source/orientation refusals, deterministic exports and camera provenance. It does not prove reconstruction quality, full-object segmentation or physical accuracy. CI runs it beside the existing renderer/recording smoke.

## Highest-impact next experiment

Use one corrected real phone capture with retained frames, calibrated camera poses/intrinsics and an independently reviewed chair mask. Freeze original source hashes. Extract a manual baseline in this workshop, move the chair by an authored local offset, and retain the exact export/receipt. Project original membership into two manually labelled held-out frames with visibility/depth checks. Target IoU at least 0.85 and floor contamination below 1%, with unchanged source hash. These are proposed acceptance criteria, not obtained results.

The [offline membership evaluation](world-object-evaluation.md) runs this comparison against frozen camera frames and independently labelled PNG masks. It includes a two-view software fixture with known pixel counts.

Then compare [SAM 2/2.1](https://github.com/facebookresearch/sam2) mask proposals against that same baseline. Its Apache 2.0 code/checkpoints require Python >=3.10, Torch >=2.5.1 and compatible TorchVision. Image masks alone do not establish 3D membership: actual poses, intrinsics, depth visibility and multi-view agreement are required. Do not wholesale import noncommercial Gaussian Grouping dependencies or assume SAM 3 shares SAM 2's license.

Estimated effort: 2–3 engineering days for the retained-frame projection experiment, longer if capture/pose evidence is missing. Estimated additional provider cost: $0 using an accessible existing GPU; local energy/hardware time is not measured. Main blocker: an accessible corrected real capture with frame/pose evidence and independent object annotations. Physical collision, measured scale and BIM classification remain separate acceptance work.
