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

A visitor whose capture lands on the bad run sees a scene they cannot plan in, with nothing telling them why. Proposed
fixes, smallest first:
1. **Seed everything.** Call `pycolmap.set_random_seed(0)`, then check whether one-thread matching makes runs
   reproducible.
2. **Treat a low share of joined frames as a capture problem.** When the selected model registers under about 80% of
   frames, retry mapping once. If it is still low, report "only 33 of 60 frames joined" and ask for a recapture,
   instead of compiling a fragmented scene.
3. **Merge unknown cells before the 128-element cap.** `worldFromScene` could merge adjacent unknown cells into larger
   rectangles, which would get it under the limit.
4. **Use feed-forward reconstruction on the GPU.** DA3 and MapAnything give every frame a pose by construction, which
   removes this failure mode.

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
- [LinkedIn video guide (Kapwing)](https://www.kapwing.com/resources/linkedin-video-size-guide-aspect-ratios-resolution-length-and-best-practices-3/), [LinkedIn video posts 2026 (Ligo)](https://ligosocial.com/blog/linkedin-video-post-best-practices)
