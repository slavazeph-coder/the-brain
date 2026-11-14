# Surface inspection and the MetricTrail research bridge

Two November 14 references motivated this layer:

- [Wenjin Tao, How Surfaces Meet](https://www.linkedin.com/posts/wenjin-tao_engineeringdesign-cad-surfacemodeling-ugcPost-7526112794975453185-gtvd/): zebra stripes and continuity. The implementation uses our existing local renderer. It does not copy the author's video or claim to recover analytic surfaces from triangles.
- [Pablo Vela, MetricTrail/Rerun example](https://www.linkedin.com/posts/pablo-vela_i-found-another-cool-nvidia-robotics-paper-ugcPost-7527155677392322560-My1V/): long-video reconstruction. Primary sources are [NVIDIA's project and paper](https://research.nvidia.com/labs/sil/projects/metrictrail/), [ViPE source](https://github.com/nv-tlabs/vipe/tree/ead2e008bc055310121736a49ff306bba50d10dc), its [point-cloud exporter](https://github.com/nv-tlabs/vipe/blob/ead2e008bc055310121736a49ff306bba50d10dc/docs/metrictrail_pointcloud.md), and the [weight model card](https://huggingface.co/nvidia/MetricTrail/blob/f5a3ce1cebd2a6a35c30ffb138caa07122731fff/README.md).

## Surface inspection in World Builder

Open a worker's `scene.glb` in **Building model review**, or open a local GLB at `/world/splat.html`. Choose zebra reflection stripes, face normals, wireframe or the original materials. Inspection changes materials only. It neither smooths the source mesh nor rewrites geometry, scale, object identities, BIM/Rhino exports or robot-route evidence.

**Check mesh topology** reports exact-position boundary edges, edges with more than two faces, inconsistent winding, duplicate/degenerate triangles and adjacent face-normal angles of at least 30 degrees. Each mesh is inspected independently, in its node transform. Separate components are never welded together, and nearly coincident vertices are not silently joined. A closed-manifold candidate is not a proof against self-intersections, intersecting components or an unobserved hole. Intentional wall corners and open surfaces are not automatically defects.

The JSON download identifies the original file by SHA-256, byte count and, for hosted artifacts, its job. Clearing, replacing or closing the source clears the review. Files remain local. Numeric inspection refuses more than 200,000 triangles rather than reporting a sampled audit as complete. Static triangles only: skinning, morph targets and instancing require an inspection copy.

Zebra stripes use the mesh's supplied shading normals, which may conceal a geometric crease. The numeric check uses face normals. Neither can establish G2 or G3 across analytic NURBS patches. On the actual analytic surfaces in Rhino, use [Zebra](https://docs.mcneel.com/rhino/8/help/en-us/commands/zebra.htm) and [EdgeContinuity](https://docs.mcneel.com/rhino/8/help/en-us/commands/edgecontinuity.htm), with appropriate document tolerances. [McNeel's geometric-continuity definitions](https://developer.rhino3d.com/en/guides/general/essential-mathematics/parametric-curves-surfaces/) distinguish position, tangency and curvature. BrainSNN's current box-like BIM solids intentionally contain sharp corners. No Class-A surface, measured accuracy or robot safety claim follows from a smooth-looking stripe.

## MetricTrail: isolated evaluation, not production

MetricTrail adds MoGe-2 metric-depth constraints and learned DINOv3 adapters to a DPVO local estimator. This complements the existing COLMAP/VGGT comparison. It does not establish that either should be replaced.

The authors report KITTI-02 steady-state 12.70 FPS and 3.21 GB peak allocated GPU memory with supplied intrinsics. Their RGB-only startup is about 175 seconds and 6.81 GB before settling. These are author measurements on their A100 configuration, not BrainSNN results or 4090/GB10 guarantees. Main trajectory scores use a fitted Sim(3), while dense scores also use ICP. Such alignment removes scale/frame error and does not demonstrate unaligned metric or survey accuracy. Dynamic-scene performance is not uniformly best. Low parallax, white walls, motion blur, rolling shutter and a shared camera model remain important phone-video failure cases. Pose/depth streaming does not supply BIM wall thickness, MEP connectivity or verified robot collision geometry.

The model card's license name metadata conflicts with its linked/prose terms. The prose and linked [NVIDIA One-Way Noncommercial License](https://developer.download.nvidia.com/licenses/NVIDIA-OneWay-Noncommercial-License-22Mar2022.pdf) limit the checkpoint to noncommercial research/evaluation. This integration requires `--evaluation-only` and is not registered in any production worker profile, website processing selector or paid demo. DINOv3 access/terms and other dependency terms apply separately. The code does not accept agreements or fetch checkpoints.

## Run on an authorized GPU host

The current execution environment has no queryable NVIDIA GPU. Inference, native CUDA kernels, real phone behavior and GB10 compatibility are unexecuted. Start on the RTX 4090 in an isolated environment. Do not change the deployed worker image for this experiment.

Install the pinned upstream checkout and its CUDA 12.8 environment according to the [upstream installation guide](https://github.com/nv-tlabs/vipe/blob/ead2e008bc055310121736a49ff306bba50d10dc/docs/installation.md). Build its kernels there:

```sh
git clone https://github.com/nv-tlabs/vipe.git /opt/vipe
git -C /opt/vipe checkout ead2e008bc055310121736a49ff306bba50d10dc
cd /opt/vipe
conda env create -f envs/cu128.yml
conda activate cu128
uv sync
uv pip install yacs numba xformers==0.0.33.post1
export CUDA_HOME="$CONDA_PREFIX"
uv run python -m vipe.metrictrail.build
```

Obtain the separately licensed weights through their original providers and keep them outside the source checkout. The bridge checks full SHA-256 before inference:

| File | SHA-256 |
| --- | --- |
| NVIDIA `dino_dpvo.pth`, HF revision `f5a3ce1cebd2a6a35c30ffb138caa07122731fff` | `d0aa57e165b159fc84bdb9d94918ad9b508c153acfb4c46f5058ab80421fb5f5` |
| Meta native `dinov3_vits16_pretrain_lvd1689m-08c60483.pth` | `08c60483bc63c04f533611e34bf70b120eedb7240f469bc16e9e20bf344b941d` |
| MoGe-2 ViT-L `model.pt`, HF revision `39c4d5e957afe587e04eec59dc2bcc3be5ecd968` | `3eefd4abb2102f38f12b2d1992e5ff15e4923e5431c67dd494afe157e0111cd5` |

The native DINO hash is the full backbone digest embedded in NVIDIA's hash-verified DPVO checkpoint, read without unpickling. The Hugging Face Transformers-format DINO safetensors file is not a substitute for that native checkpoint.

From the BrainSNN repository, use a plain video basename containing only letters, digits, underscores or hyphens, for example `room-loop.mp4`:

```sh
python -m robotics.world_worker.metrictrail_trial run \
  --source /opt/vipe \
  --python /opt/vipe/.venv/bin/python \
  --video /data/room-loop.mp4 \
  --dpvo /data/models/dino_dpvo.pth \
  --dino /data/models/dinov3_vits16_pretrain_lvd1689m-08c60483.pth \
  --moge /data/models/moge-2-vitl.pt \
  --out /data/trials/metrictrail-room-001 \
  --timeout 1800 --evaluation-only
```

This uses clean pinned local code, passes all three explicit local checkpoints and sets Hugging Face offline flags. No installation or checkpoint download is performed by the bridge. The two child processes have separate bounded 1,800-second defaults and capped logs; a failed/timed-out tracker or exporter remains failed with no successful handoff. Native missing dependencies fail visibly. The default upstream raster is 280 by 504, with at most 1,500 selected frames; this may downsample longer input and is not a claim that every original frame was tracked. Loop closure and optional retrospective focal refinement are not enabled.

The runner retains raw upstream artifacts and bounded tracking/fusion logs. It invokes the actual upstream strict point-cloud exporter, then bridges its outputs. To import an already completed upstream run, save the exporter's single JSON summary as `fusion.json` and run:

```sh
python -m robotics.world_worker.metrictrail_trial ingest \
  --video /data/room-loop.mp4 \
  --run-root /data/vipe_results/room-loop --name room-loop \
  --fusion /data/vipe_results/room-loop/fusion.json \
  --out /data/trials/metrictrail-import-001 --evaluation-only
```

The importer requires initialized successful tracking with an applied metric prior, ordered original frame IDs, source timing, a proper z-up rotation, enabled multiview filtering, matching cloud counts and numeric camera poses. It rejects reflected/non-rigid poses, partial/static results and pickle arrays. It uses the existing nested-voxel thinning and 50,000-point bound. The actual retained voxel resolution is preserved for downstream inspection.

Outputs preserve input hashes and do not overwrite them:

- `arena-cloud.json`: arbitrary units, no measured scale. This is the browser's conservative preview path. A separate measured distance is required before requesting metric use.
- `estimated-metric-cloud.json`: separate research-only geometry with `scale.source=model-estimated`, `selfReported=false`, `verified=false`. Do not relabel it as a laser scan, entered scale or surveyed geometry.
- `camera-path.json`: predicted camera-to-handoff transforms, per-frame pinhole intrinsics, original frame IDs and frame-derived timestamps. Times use frame ID divided by nominal FPS, not decoded presentation timestamps; variable-frame-rate timing remains unvalidated. It applies both the upstream mean-camera-up rotation and BrainSNN's recorded floor/heading transform. This is not a retained-raster camera ledger, physical robot route or measured IMU gravity.
- `metrictrail-receipt.json`: original video, poses, intrinsics, PLY, run/fusion report hashes, output hashes and explicit unverified flags. A supplied local run is operator-bound, not independently attested to the video. No point-to-frame membership is invented; `multiView` remains false in the handoff.

For an explicit offline compiler experiment only, use the existing compiler with `--allow-unverified`. Its outputs remain experimental and inherit the learned scale:

```sh
blender --background --python-exit-code 1 \
  --python robotics/scene_compiler/scene_compiler.py -- \
  --cloud /data/trials/metrictrail-room-001/handoff/estimated-metric-cloud.json \
  --out /data/trials/metrictrail-room-001/experimental-scene --allow-unverified
```

## Checks and next experiment

```sh
node --test tests/world/surface-audit.test.mjs
python -m pytest -q tests/world/test_metrictrail_trial.py
npm --prefix brainsnn-r3f-app run build
WORLD_BROWSERS=chromium,webkit node tests/world/visual-browser-smoke.mjs
WORLD_BROWSERS=chromium,webkit WORLD_PHONE_VIEWPORT=1 python tests/world/scene_browser_smoke.py
```

All numeric/browser fixtures are explicitly authored data. Bridge tests are not model execution or published benchmark reproduction.

Highest-impact experiment: freeze one corrected 30-second phone loop, collect independent held-out lengths and object centres before modeling, and run this pinned strict MetricTrail trial alongside the current reconstruction. Freeze any scale/frame controls separately from the held-out checks. Before ranking timing or geometric accuracy, match the processed frame inventory, resolution and hardware assumptions; record any remaining differences. Evaluate raw learned scale before any similarity fit, then evaluate geometry with only preregistered control registration. Inspect wall completeness, moved-object location and clutter, not just a photoreal rendering.

Proposed success criterion, not an achieved result: initialized complete tracking, no folded/reversed loop, at least six untouched held-out length checks within `max(5 cm, 2% of reference)`, and no new false wall or silently missing obstacle versus the frozen baseline. Reopen resulting IFC/3DM in independent viewers. A route produced from it remains simulated until a supervised physical robot test.

Estimate: one to two engineering days for first GPU setup and comparison, plus two to four capture/measurement hours. Estimate: US$0 incremental compute on available owned hardware, or US$5 to US$20 for a bounded rented trial, excluding engineering, storage and measurement equipment. No paid compute was started. Main blockers: an accessible qualified GPU environment, authorized native weights and independent real-room measurements. Smooth zebra stripes, internal floor fit and an aligned trajectory score cannot replace those checks.
