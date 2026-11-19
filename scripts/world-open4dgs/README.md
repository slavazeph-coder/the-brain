# Process a prepared capture with Open4DGS

This operator workflow turns calibrated multi-camera frames into actual Open4DGS timeline and per-frame Gaussian PLY exports. Run it locally on an NVIDIA CUDA host with storage for the inputs, initialization, checkpoints and exports. World Builder can review the exported appearance. It does not use it for room measurements, collision geometry or robot maps.

## Prepare the capture

[Line up and extract your videos](capture.md) if starting with raw recordings. Keep cameras fixed, with overlapping views of the subject, and preserve the sensor dimensions and camera settings used for calibration. Use authorized files, model weights and footage.

The runner takes this folder:

```text
capture/
  camera-setup.json            optional, written by the frame extractor
  images/0001/000001.jpg       sequential images, same frame number per camera
  images/0002/000001.jpg
  masks/0001/000001.png        corresponding foreground mask at the image dimensions
  masks/0002/000001.png
  sparse/0/                    complete COLMAP reference model
  reference_export.json        paired Open4DGS camera export
```

Use `0001`–`0099`, or consistent ASU-style `01`–`99` folders with the same names in the calibration. Supply every image and mask in the selected frame range. The runner checks the reference JSON against the actual registered COLMAP image names, intrinsics and transforms. Choose `SIMPLE_PINHOLE`, `PINHOLE` or `OPENCV` so preparation and training use the same lens model. Prepare calibration and masks in the same camera mode following the [pinned alignment and masks guide](https://github.com/ASU-NEM-Labs/open4dgs-core/blob/3cac7ba62d930e3ce56cb532bb60870e4ebf6db5/README.md#pipeline). Alignment uses a textured reference scene in the same fixed-camera layout. Background Matting V2 uses a clean plate per camera. Review the sparse model and masks before training.

## Install the pinned runtime

Use the official [two-repository installation guide](https://github.com/ASU-NEM-Labs/open4dgs-core/blob/3cac7ba62d930e3ce56cb532bb60870e4ebf6db5/SETUP.md) for the **Linux Python 3.11, NVIDIA CUDA 12.8** environment. Keep the official Core and Trigs code separate from BrainSNN.

```sh
git clone https://github.com/ASU-NEM-Labs/open4dgs-core.git
git -C open4dgs-core checkout --detach 3cac7ba62d930e3ce56cb532bb60870e4ebf6db5
git clone https://github.com/ASU-NEM-Labs/open4dgs-trigs.git
git -C open4dgs-trigs checkout --detach ed7a84aff1aeccd18dfb48d2806e521255ccf9ef
```

Install the trainer lock as directed by the upstream [trainer setup](https://github.com/ASU-NEM-Labs/open4dgs-trigs/blob/ed7a84aff1aeccd18dfb48d2806e521255ccf9ef/SETUP.md), then add the [preparation dependencies](https://github.com/ASU-NEM-Labs/open4dgs-core/blob/3cac7ba62d930e3ce56cb532bb60870e4ebf6db5/prep/SETUP.md) without re-resolving the shared environment. In that environment, install the documented RoMa v2 and MEMFOF source revisions directly so the runner can verify their VCS metadata:

```sh
uv pip install --python "$CONDA_PREFIX/bin/python" \
  'git+https://github.com/Parskatt/RoMaV2.git@95c9968145c8906b7b59383258e9f73b02853d89' \
  'git+https://github.com/msu-video-group/memfof.git@a51de9fc59c6fe20ba08e079372c7b583d58a712'
```

Model weights have separate terms, including [DINOv3](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) for RoMa v2. Follow those terms before installing weights. Upstream model loaders can download weights on first use. ASU's [example captures](https://huggingface.co/datasets/asu-nem-labs/open4dgs-datasets) are restricted to private noncommercial evaluation. Keep captures and derivatives private unless you have rights to share them. The upstream exporter opens pickle-based trainer checkpoints. This runner accepts prepared frames and only passes its own trained checkpoints to the exporter. Run it with ordinary user privileges on trusted inputs.

## Run and review

From the BrainSNN checkout, replace the paths shown below with your capture, job and environment paths:

```sh
python3 scripts/world-open4dgs/run_prepared_capture.py \
  --capture-dir /captures/take01 --output-dir /jobs/take01 \
  --upstream-core /tools/open4dgs-core --upstream-trigs /tools/open4dgs-trigs \
  --python "$CONDA_PREFIX/bin/python"
```

With an extractor receipt, the runner uses its frame count and FPS and checks camera IDs. Without one, add `--fps 30000/1001 --frame-end 180` using your actual capture rate and last image number. `--frame-start` defaults to 1. Ranges are inclusive. `--steps` defaults to 30,000 before upstream's optional extra fast-motion visits. Use `--chunk-seconds` for long sequences when the whole training model cannot fit on the GPU. Training windows change GPU residency, but neither export is compressed. A large capture may be too large for browser review.

The default receipt says `nominal-frames` for timing. A coarse shared flash or motion event can line up approximate frame numbers but does not remove smaller inter-camera delays or rolling-shutter distortion. For an optional validated visual timing pass, choose one of the following:

- With fixed global-shutter cameras, add `--visual-sync-global-shutter` to solve sub-frame offsets without a rolling-shutter term.
- With the same rolling-shutter readout in every camera's recorded sensor mode, add `--sync-readout-ms <measured-ms> --confirm-sensor-rows`. Use independently measured row readout. The images must retain the raw sensor row direction. Rotating or mirroring a video can change the correct readout model.

The optional solver needs at least four well-overlapped cameras and enough visible motion. It must resolve every camera and pass upstream quality gates. A failed solve leaves its reports and stops before initialization. It never silently substitutes all-zero offsets. To deliberately use nominal timing on a different run, omit the timing flags and give it a new output directory.

Stages write logs to `/jobs/take01/attempts`. After fixing a failed installation or transient problem, add `--resume` with the original arguments. The runner locks the output folder, verifies capture, settings and completed artifact hashes, and starts the first missing stage in a new attempt folder. It does not resume training weights inside a failed stage. Runtime or input changes require a new output folder. Keep the prepared capture immutable while a job runs.

Use the final `exports.json` to find `capture.trigsbin`, `ply/export_meta.json`, all numbered PLY files and the upstream `eval.json`. Play starts at local frame 0, and the receipt records which source frame that represents. The job records the submitted rational FPS and the runtime clock, which uses float32 because upstream's initialization file stores FPS that way. The timeline holds a single clip to match the current browser preview. The trainer's final viewer snapshot carries the original deformation configuration used for both exports. The upstream evaluator reports whole-photo PSNR including the background, even when the training used masks. It compares with the supplied recordings. Check with independent captures and references if your use needs accuracy evidence.

If the full exports exceed browser limits, use `make_playground_preview.py` on the PLY folder for a bounded local preview:

```sh
python3 scripts/world-open4dgs/make_playground_preview.py \
  --input-dir /jobs/take01/attempts/export-0001/ply --output-dir /jobs/take01-preview
```

The converter takes a short ordered segment and keeps a bounded number of the original Gaussian rows. Use the preview's PLY files and its corresponding `export_meta.json` together. The untouched full native PLY and timeline remain in the job exports.

The ASU release reports a CUDA reference platform and says no fresh end-to-end GPU run from the two split public repositories had yet completed. BrainSNN has exercised the pinned exporters on CPU with authored checkpoints. A trained reconstruction on the operator's own calibrated rig remains a separate qualification. [Upstream release status](https://github.com/ASU-NEM-Labs/open4dgs-core/blob/3cac7ba62d930e3ce56cb532bb60870e4ebf6db5/README.md#release-status-and-support)
