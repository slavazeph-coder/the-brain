# Film the real thing, then upgrade the geometry (October 24, 2026)

Research into better ways to film the World Builder demo and to build the scan-to-model pipeline behind it. Licences
were read from the official model cards and READMEs where reachable; where only a mirror or secondary source was
available, the line says so.

## The weak point is what is on screen, not the editing

The current demo shows:
- a public test dataset (Mip-NeRF 360 "room"), not a BrainSNN capture;
- sparse or depth-model points;
- objects labelled "Object 1" to "Object 8";
- WebGL drawn in software, by SwiftShader in headless Chromium (`--enable-unsafe-swiftshader` in `record_scan2model.py`).

No cut fixes that. The changes that matter most are:
- a real phone walkthrough of a room someone can tape-measure;
- that capture run on the 4090 worker;
- the result recorded on a machine with a GPU.

## Filming

1. **Record on a GPU, headed.** Under COLMAP load, the CDP screencast composites stale tiles (see the recorder README's
   lessons). Running the browser on the 4090 host or the Mac, with the worker elsewhere, removes both problems.
   - On Linux, ANGLE on llvmpipe or a GPU needs an X display even when headless. Without one, WebGL silently degrades,
     so check the frames are really 3D.
2. **Step 3D shots deterministically.** Orbits recorded in wall-clock time stutter when the machine is busy.
   - CCapture.js overrides `requestAnimationFrame` and the clocks, so each frame renders at a fixed rate.
   - Chrome's `--enable-begin-frame-control` lets the harness advance one frame at a time.
   - Either gives 30 or 60 fps orbits whatever the load. CCapture's clock override can break page timing; test it on
     the viewer first.
3. **Lead with the payoff, silent-first.**
   - Seconds 0–2 should show the end state: the robot route over the reconstructed room, or the IFC model.
   - Most feed video is watched muted. One vendor's figure is 85%; it is unverified.
   - Make it 15–30 s, 4:5 or 1:1, MP4 H.264, under about 200 MB, uploaded natively rather than linked.
   - These come from 2026 vendor guides that disagree on details; check LinkedIn's help pages before posting.
4. **Show the phone.** Two seconds of picture-in-picture of a hand walking the room with a phone is the credibility
   shot a screen capture cannot give. It needs a real capture, so it comes with item 1 of the build order.
5. **Beauty shots from the same files.** Blender is already in the pipeline.
   - A turntable render of the exported `scene.glb` (EEVEE on the 4090) is honest if it is captioned as a render of
     the exported file.
   - It reads far better than a software-rendered canvas.
6. **Editing.** `short_cut.sh` (ffmpeg, hard cuts) covers a feed clip.
   - For animated zooms and callouts as code, use Remotion. It is free for organisations of up to three people;
     larger companies need a Company License (Automators: $0.01 per render, $100/month minimum).
   - For manual recordings on the Mac, Screen Studio-style auto-zoom tools are the faster route.

## Building

### Poses and dense geometry: Depth Anything 3 is the candidate to test

| Model | Licence (source) | Verdict |
|---|---|---|
| DA3-SMALL (0.08B), DA3-BASE (0.12B), DA3-LARGE / DA3-LARGE-1.1 (0.35B): any-view depth and camera poses | Apache-2.0 (official Hugging Face cards) | **Test first** on the 4090 |
| DA3METRIC-LARGE (0.35B): monocular metric depth | Apache-2.0 (official card) | Scale cue, fused with the typed distance as in `metric-scale-and-blender-sim-layer.md` |
| DA3-GIANT / -1.1, DA3NESTED-GIANT-LARGE(-1.1) | CC BY-NC 4.0 (official cards) | Excluded |
| MapAnything `facebook/map-anything-apache` (and `-apache-v1`) | Apache-2.0 (official README) | Already pinned in `mapanything_apache.py`; keep it as the comparison |
| VGGT-1B | CC BY-NC 4.0 (Hugging Face Space card) | Excluded |
| π³ / π³X weights | CC BY-NC 4.0 (GitHub README); the Hugging Face card says commercial use needs the authors | Excluded |

The DA3 authors report 35–44% better pose accuracy and 23–25% better geometry than VGGT. That is the authors' own
benchmark. Measure it ourselves with `robotics/world_worker/benchmark_eth3d.py` against today's numbers:
- sparse: 1.5 cm median error, 87% of points within 5 cm;
- dense CPU: 3.1 cm median error, 59% within 5 cm.

A DA3-Large adapter would replace both COLMAP and the per-frame DA2 densify step on the GPU path. Keep CPU COLMAP for
workers without a GPU.

### Separating and naming objects: tracked masks, lifted to 3D

Today a sofa with a table against it stays one cluster. The fix is 2D instance masks tracked through the walkthrough,
lifted onto the reconstructed points.

- **SAM 2 / 2.1** (Apache-2.0, as recorded in the handoff). This is the default.
- **SAM 3 / 3.1** (November 2025 / March 2026).
  - Given a noun phrase ("sofa", "side table", "door"), it returns a mask and a track ID for every instance, across
    the video.
  - That splits touching objects and names them in one pass. Claude would then review names and handle the long tail.
  - Its weights are gated under Meta's custom **SAM License**. Only mirrors were readable from here. They show
    commercial use with pass-through terms, bans on ITAR and military uses, and termination if the user brings an IP
    claim.
  - **The owner must read the licence before any production use.**
- **Lifting.**
  1. Project each reconstructed point into every frame's mask using the camera poses the worker already has.
  2. Assign the point to the instance most views agree on (MaskClustering's view-consensus idea; WildLIFT does the
     same projection for drone video).
  - It is an algorithm, not weights, so we can write it ourselves and it adds no licence. It feeds the scene
    compiler's existing per-object boxes and IFC export.

### Walls, doors and windows: SpatialLM looks right but its licence rules it out

SpatialLM 1.1 turns a point cloud, including one reconstructed from RGB video, into walls, doors, windows and
oriented boxes across 59 furniture categories. Its weights are **CC BY-NC 4.0**, because it is built on the Sonata
encoder; the 1.0 models inherit CC BY-NC from SceneScript. Use it only as a research comparison for our Blender
compiler, not in the product.

### A visual layer that looks like the room

- **Training.** Train Gaussian splats on the same frames and poses: gsplat (Apache-2.0), on the 4090.
- **Viewing.** Show them with **Spark**, World Labs' MIT-licensed three.js splat renderer.
  - Spark 2.0 (April 2026) streams level of detail with HTTP Range requests.
  - It needs three.js r179–r180 or later; the R3F app is on 0.182.
- **Rule.** Splats stay visual only and never become collision geometry, as the flagship spec already says.
- **The demo shot.** The photoreal room fades into the compiled boxes and the robot route.

## Measured here: the same video does not always give the same reconstruction

Three runs of `colmap-sparse` on the same 62 s room walkthrough, with the same settings, in one container:

| Run | Frames registered | Reconstructed points | Scene | Robot route |
|---|---|---|---|---|
| 1 | 57 / 60 | 12,005 | 7 walls, 8 separated objects, 44 unknown cells | planned (23.0 m) |
| 2 | 57 / 60 | 11,975 | 4 walls, 9 separated objects, 38 unknown cells | planned (20.8 m) |
| 3 | 33 / 60 | 6,915 | 33 walls, 1 separated object, 309 unknown cells | **failed**: "This scene has 169 walls, objects and unobserved areas; a planning map holds at most 128." |

What happens:
- `sparse_colmap.py` passes `random_seed: 0` to the mapper.
- It still runs extraction and matching on two threads, and it never calls `pycolmap.set_random_seed`.
- In run 3, the mapper split the walkthrough, and the largest model held only about half the frames.

A visitor whose capture lands on the bad run sees a scene they cannot plan in, with nothing telling them why.

**The cause is the mapping seed, and a retry fixes it.**
- I copied run 3's database and re-ran only the mapper with four seeds:
  - seed 0 split it again (33 + 26 frames);
  - seeds 1, 2 and 3 each joined 57 frames in one model, in 20–36 s.
- **Extraction and matching vary too.** Image IDs follow thread completion order, and RANSAC kept 633–638
  verified pairs. That moves which seed fails, not whether one can.

**Built in this PR.** `sparse_colmap.map_frames` tries seeds 0, 1 and 2:
- it stops as soon as one model holds at least 90% of the frames;
- it keeps the best model otherwise, within the same 900 s mapping budget as before;
- it records each attempt in `reconstruction.json` under `capture.mapping_attempts`.

On run 3's database, it selected seed 1 with 57 frames in 37 s.

**Still open:**
1. **Treat a low joined share as a capture problem.** If all three seeds still join under about 80% of the frames,
   say "only 33 of 60 frames joined" and ask for a recapture, instead of compiling a fragmented scene.
2. **Merge unknown cells before the 128-element cap.** `worldFromScene` could merge adjacent unknown cells into larger
   rectangles, which would get it under the limit.
3. **Use feed-forward reconstruction on the GPU.** DA3 and MapAnything give every frame a pose by construction, which
   removes this failure mode.

## Assessment of the "Video → Sim → BIM" deep-research plan (same day)

The owner shared a plan with this chain:
1. phone video, IMU, Wi-Fi RTT and a NavVis e57 scan;
2. dense points from CoTracker3, TAPIR and Depth Anything;
3. alignment with Open3D, PDAL and g2o;
4. gsplat, then NuRec USD and TRELLIS.2 PBR;
5. physics with PhysGaussian MPM;
6. simulation in Genesis and Newton;
7. IFC ↔ USD via IfcOpenShell;
8. a GR00T N1.7 fine-tune;
9. Cosmos Transfer and DreamDojo.

The plan assumes three things that are not true:
- **It misreads today's product.** It treats today's product as "photo → depth → mesh → route", but the walkthrough
  path already does all of these:
  - reconstruction;
  - walls and floor;
  - separated, measured objects;
  - GLB, OpenUSD and IFC4 from one `scene.json`, with provenance in `Pset_BrainSNN`, and IfcOpenShell validation
    reporting 0 issues;
  - a robot route.

  The blocker is not missing stages. It is that no GPU worker is live and no real capture exists.
- **It contradicts itself on scanners.** It pitches a phone instead of a $50k scanner, then adds a NavVis VLX e57
  scan to the input.
- **Many citations cannot be checked.**
  - Some are press-release mirrors, a retail listing, or a patent page cited for an IfcOpenShell claim.
  - The `【…】` markers point at nothing.

| Piece | What was checked | Call |
|---|---|---|
| Wi-Fi RTT loop closure | No browser API exists, and as far as I know iOS gives apps no access to RTT. Android's own target is 2–8 m error at the 90th percentile, and both the phone and the access point must support 802.11mc. COLMAP poses are centimetre-level. | **Drop.** The ranging is far coarser than our poses, and visitors cannot reach it from a browser. |
| NavVis e57 alignment | It is a professional scanner. | **Later**, as an optional import for customers who already own one. `geometry.load_arena_cloud` is the place for it. |
| CoTracker3 | It gives 2D point tracks only, not depth. The majority of it is CC BY-NC. | **Drop.** |
| TAPIR / BootsTAPIR / TAPNext | Apache-2.0 code and checkpoints, but 2D tracks too. | **Not needed.** DA3 or MapAnything give dense depth and poses directly. |
| Video Depth Anything | Not re-checked here. | Use DA3 (Apache-2.0, multi-view) instead. |
| Open3D ICP, PDAL, CloudCompare QA | Mature tools. | **Keep in mind** for the NavVis import and QA. They are not needed for phone captures. |
| gsplat → NuRec `py3dgsPlyToUsd.py` | Fits the splat visual layer above. | **Keep.** Add a NuRec USD export next to `scene.usda` once splats exist. |
| TRELLIS.2 (4B) | MIT. Single image to PBR mesh; about 24 GB VRAM (a mirror's figure); fastest timings are on an H100. | **Later**, as a generated stand-in model per separated object, labelled generated. It invents unseen geometry, so it never replaces measured boxes or collision. |
| PhysGaussian / i-PhysGaussian MPM | Simulates deformable materials (elastic, plastic). | **Drop for now.** Rooms and furniture are rigid for a navigating robot, and the i-PhysGaussian repo was not verified. |
| Genesis "43M FPS" | Its own benchmark: one Franka arm, one simple scene. | **Not the bottleneck.** The planner already runs in the browser. Pick Isaac Lab or MuJoCo when a customer needs dynamics. |
| Newton / Warp / Isaac Lab | Real, but GPU-heavy. | **Later**, and `scene.usda` already targets Isaac Sim. |
| IFC ↔ USD via IfcOpenShell | We already write both from one source. IfcOpenShell is LGPL-3.0. | **Keep** what exists. Next, add Revit import QA and `IfcDoor` and `IfcWindow` for doorway gaps, which the handoff already lists. |
| GR00T N1.7 fine-tune on site videos | The official workflow needs robot demonstrations (video, state and action). The NVIDIA tutorial asks for at least 200 episodes per task, with a 40+ GB GPU (LoRA on 24 GB). | **Drop the 30-day plan.** Videos of human workers have no robot actions, and there is no robot. |
| Cosmos Transfer / DreamDojo | Research-grade world models, heavy on GPU. | **Later.** At most, a marketing render after a real scene exists. |

**Instead:** keep the ladder above:
1. a real capture on the 4090 worker;
2. DA3;
3. SAM 2.1 objects;
4. splats, plus a NuRec USD export;
5. IFC doors and windows.

Choose one paying use, then add the dynamics it needs. The construction twin, and robots learning from site
footage, is a different product with a different buyer, and that is the owner's call.

## Build order

1. **A real capture on a GPU worker** (owner and Hermes).
   - Film a walkthrough of a room someone can tape-measure.
   - Run it on the 4090 with `robotics/world_worker/deploy/`.
   - This unblocks the demo and every item below.
2. **A DA3-Large + DA3METRIC adapter.** Benchmark it on ETH3D against COLMAP, dense CPU and MapAnything.
3. **SAM 2.1 tracked masks lifted to 3D objects.** Add SAM 3 only after the owner has read the SAM License.
4. **A splat visual layer** with gsplat and Spark.
5. **Re-record the demo:**
   - headed Chrome on a GPU, with deterministic orbits;
   - a Blender turntable of `scene.glb`;
   - picture-in-picture of the phone;
   - a 20 s 4:5 cut, plus the full version.

## Sources

- [Depth Anything 3 paper](https://arxiv.org/abs/2511.10647); official Hugging Face cards for `depth-anything/DA3-SMALL`, `DA3-BASE`, `DA3-LARGE-1.1`, `DA3METRIC-LARGE` and `DA3-GIANT-1.1` (read through the Hugging Face connector)
- [MapAnything README](https://github.com/facebookresearch/map-anything)
- [VGGT Space card](https://huggingface.co/spaces/lidavidsh/vggt/commit/e404aa37f9a93206dca81bb5391c070788534246), [π³ README](https://github.com/yyfz/Pi3), [Pi3X card](https://huggingface.co/yyfz233/Pi3X/blob/main/README.md)
- [SpatialLM README](https://github.com/manycore-research/SpatialLM)
- [SAM 3 overview (Roboflow)](https://blog.roboflow.com/what-is-sam3/), [SAM License (Hugging Face)](https://huggingface.co/facebook/sam3/blob/main/LICENSE), [SAM License mirror (ScanCode)](https://scancode-licensedb.aboutcode.org/sam-2025-11-19.html), [licence question (GitHub issue)](https://github.com/facebookresearch/sam3/issues/262)
- [MaskClustering](https://arxiv.org/abs/2401.07745), [WildLIFT](https://arxiv.org/abs/2604.24718), [SpaCeFormer benchmark page](https://nvlabs.github.io/SpaCeFormer/)
- [Spark](https://github.com/sparkjsdev/spark), [Spark 2.0 notes](https://radiancefields.com/platforms/spark), [Brush](https://github.com/ArthurBrussee/brush)
- [Remotion pricing](https://www.remotion.dev/docs/license/pricing)
- [WebGL without a GPU](https://microlink.io/blog/webgl-without-a-gpu), [CCapture.js](https://sourceforge.net/mirror/ccapture-js/)
- [Android Wi-Fi RTT](https://source.android.com/docs/core/connect/wifi-rtt), [Aruba on 802.11mc](https://blogs.arubanetworks.com/?p=28476)
- [CoTracker](https://github.com/facebookresearch/co-tracker), [TAPNet (TAPIR)](https://github.com/google-deepmind/tapnet), [TRELLIS.2-4B card](https://huggingface.co/microsoft/TRELLIS.2-4B/blob/main/README.md), [TRELLIS.2 timings (ComfyUI Wiki)](https://comfyui-wiki.com/news/2025-12-18-microsoft-trellis2-3d-generation)
- [Isaac-GR00T README](https://github.com/NVIDIA/Isaac-GR00T), [GR00T fine-tuning tutorial](https://docs.nvidia.com/learning/physical-ai/gr00t-e2e-workflow/latest/real-robot-workflow/real-fine-tuning-and-leapp.html), [IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell), [Genesis announcement coverage](https://www.datacamp.com/blog/genesis-physics-engine)
- [LinkedIn video guide (Kapwing)](https://www.kapwing.com/resources/linkedin-video-size-guide-aspect-ratios-resolution-length-and-best-practices-3/), [LinkedIn video posts 2026 (Ligo)](https://ligosocial.com/blog/linkedin-video-post-best-practices)
