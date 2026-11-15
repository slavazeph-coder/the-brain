# COLMAP and VGGT reconstruction comparison

This local benchmark compares the same prepared phone frames through three arms:
`colmap`, `vggt`, and `vggt-ba`. It preserves source/frame hashes, records failed
arms, and keeps the one calibration distance separate from withheld readings.
It does not change the production World Builder reconstruction default.

For frozen multi-capture plans, three rotated repetitions, retained failures and
an aggregate decision, use [repeated measured qualification](world-measured-qualification.md).
This harness is carried forward from closed, unmerged PR #239 onto current main.
The CPU video path retains main's consecutive-frame fold detector, and a
detected fold blocks the dimension/timing screen.

The measured geometric outcome is **triangulated landmark distance from each
arm's cameras**. Dense-preview appearance, final IFC/Rhino element dimensions,
opening completeness, robot-map quality and physical robot operation are not
automatically validated by this test. A dense point cloud can still contain
incorrect surfaces while its selected landmark distances pass.

## 1. Install on the test machine

Run from the repository root. Keep the benchmark in an isolated environment.
The example PyTorch wheel is for an RTX 4090 host with a compatible NVIDIA driver;
GB10 requires its own compatible CUDA/PyTorch environment and qualification.

```bash
python3.12 -m venv .venv-world-compare
. .venv-world-compare/bin/activate
python -m pip install --upgrade pip
python -m pip install torch==2.5.1 torchvision==0.20.1 \
  --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r robotics/world_worker/requirements-comparison.txt
python -m pip install huggingface_hub einops safetensors
```

Install the reviewed VGGT source separately from the BrainSNN checkout:

```bash
git clone https://github.com/facebookresearch/vggt.git /absolute/path/to/vggt
git -C /absolute/path/to/vggt checkout a288dd0f14786c93483e45524328726ab7b1b4ce
```

The runner reads this clean source checkout directly. Do not modify its demo to
download different weights. Download the approved `facebook/VGGT-1B-Commercial`
checkpoint before running the test, after accepting the checkpoint's terms:

```bash
python - <<'PY'
from huggingface_hub import hf_hub_download
print(hf_hub_download(
    repo_id="facebook/VGGT-1B-Commercial",
    filename="model.safetensors",
    revision="ebb29a532abe92960eeb6903a5530f16990ef4ab",
    local_dir="/absolute/path/to/vggt-commercial",
))
PY
```

If the repository is gated, request access through its official model page and
authenticate the download using your existing Hugging Face login. Do not put an
access token in the capture, source files, logs or shell arguments.

Expected checkpoint: `model.safetensors`, 5,026,367,224 bytes,
SHA-256 `2b766b284359bc47ce26be107254621f685b758a0282082ff109f3ff02788b53`.
Execution verifies the exact source revision and weight bytes, and does not
download code, weights or images. Check the local files before allocating GPU
work:

```bash
python -m robotics.world_worker.reconstruction_comparison preflight \
  --vggt-source /absolute/path/to/vggt \
  --vggt-checkpoint /absolute/path/to/vggt-commercial/model.safetensors
```

This file check is not a CUDA execution qualification.

The original `facebook/VGGT-1B` checkpoint is noncommercial. VGGT-Omega currently
has a noncommercial research license, including restrictions on commercial use
of outputs. Neither is silently substituted for this commercial checkpoint.
The commercial checkpoint also has use restrictions; it is not an unrestricted
license for every robotics deployment.

## 2. Prepare one immutable case

Use a rights-cleared walkthrough with slow sideways motion, overlapping views,
visible floor/wall junctions and stationary detail. Start with 32 frames on the
4090. A second case with a plain wall and a third with glass/reflections make
failures visible. Do not choose only captures that reconstruct well.

```bash
python -m robotics.world_worker.reconstruction_comparison prepare \
  --video /absolute/path/to/room.mp4 \
  --frames 32 \
  --out /absolute/path/to/comparison/case-room
```

For a folder of overlapping photographs instead:

```bash
python -m robotics.world_worker.reconstruction_comparison prepare \
  --photos /absolute/path/to/photos \
  --frames 32 \
  --out /absolute/path/to/comparison/case-room
```

Preparation writes `capture.json`, exact prepared JPEGs in `frames/`, and the
local `annotate.html` worksheet. Video selection uses two-pass PyAV decoding,
uniform decoded-frame indices and actual stored PTS/time bases. Stored video
rasters are used without applying display-rotation metadata; mark what the
worksheet displays. Photo EXIF orientation is applied during preparation. All
three arms consume the same prepared frame set. Individual model resizing/cropping is recorded as a pixel transform so
annotations remain attached to the actual prepared images. Fewer registered
COLMAP cameras or unavailable landmarks are reported as missing evidence, not
as zero error. Use fresh output directories for new cases and runs.

## 3. Mark physical references before examining model results

Measure one calibration span and at least seven other identifiable distances
using a tape or laser. Keep the endpoints visible in multiple source frames.
Record the instrument, actual measurement date and reading uncertainty. An
assumed standard door size or an LLM estimate is not a physical reading.

```bash
python -m http.server 8000 --bind 127.0.0.1 \
  --directory /absolute/path/to/comparison/case-room
```

Open `http://127.0.0.1:8000/annotate.html` on that same computer. Add named
landmarks, select a frame, and click each physical feature in at least two
different views. Use at most 12 views per landmark. The worksheet uses
integer-centred pixels in the exact prepared raster, after the preparation
resize and, for photographs, EXIF orientation correction. One click cannot replace an
existing observation; remove that observation explicitly to correct it.

Fill the one calibration span and seven withheld spans, then download
`annotations.json` into the case directory. The worksheet starts with blank
readings. It never guesses metres, uncertainty, an instrument or a measurement
date. It can import a downloaded worksheet only for the same capture hash.

Keep these annotations fixed across all engines. Do not move endpoints or
remove a failed span after seeing the scores. The scorer triangulates the
same pixel observations separately using each arm's cameras, uses only the
calibration distance to set scale, and scores the withheld distances afterwards.
Self-reported readings remain self-reported; this is not independent survey
certification. Reference uncertainty is retained separately from the acceptance
thresholds.

## 4. Run the three arms and score

```bash
python -m robotics.world_worker.reconstruction_comparison run \
  --case /absolute/path/to/comparison/case-room \
  --out /absolute/path/to/comparison/run-room \
  --annotations /absolute/path/to/comparison/case-room/annotations.json \
  --engines colmap vggt vggt-ba \
  --vggt-source /absolute/path/to/vggt \
  --vggt-checkpoint /absolute/path/to/vggt-commercial/model.safetensors \
  --timeout 1800
```

`run --annotations` freezes the worksheet before starting any engine and writes
`comparison.json` and `comparison.md`, including scores. Without predeclared
annotations, the run can still report runtime and failures, but its proposed
dimension/timing promotion gate remains unavailable. To recompute the report
from the same frozen worksheet:

```bash
python -m robotics.world_worker.reconstruction_comparison score \
  --case /absolute/path/to/comparison/case-room \
  --run /absolute/path/to/comparison/run-room \
  --annotations /absolute/path/to/comparison/case-room/annotations.json
```

Keep the machine idle during the run and record the host/GPU configuration.
COLMAP runs on CPU in this benchmark; VGGT runs on CUDA. A speed comparison
therefore compares these complete configured implementations, not equal-hardware
algorithmic speed. Cold per-arm timing includes model loading and the requested
refinement. Shared preparation timing is reported separately. PyTorch allocated
and reserved GPU peaks describe this process, not all GPU use on the machine.
The operating system's file cache is not flushed between arms. Repeat runs in
fresh output directories with rotated `--engines` order before making a speed
claim; one fresh process is not a cold-boot hardware benchmark.

The `vggt-ba` arm uses VGGT's bundled native tracker with grid queries followed
by PyCOLMAP refinement. It does **not** reproduce the official paper/demo's
additional keypoint/matching recipe, so label it `BrainSNN native-track VGGT+BA`
when discussing results. This keeps inference local and avoids silently fetching
additional detector weights. The paper's 0.2-second H100 camera benchmark is
not a measured full-pipeline runtime for this test.

## 5. Read the outcome and retain failures

Read the generated JSON and Markdown comparison reports and each arm's logs.
Check source bindings and the number of available withheld spans before
interpreting a median error. Missing, low-parallax, behind-camera or excessive
reprojection-error landmarks remain unavailable. A score based on fewer
successful endpoints cannot silently outrank the full baseline.

The proposed promotion targets are at least 20% lower median withheld error,
no worse maximum error, no loss of validated opening completeness, and at
least twice the end-to-end speed. This camera-only test cannot establish
opening completeness or final BIM correctness, so a passing numeric comparison
is a candidate for the next controlled geometry review, not automatic permission
to replace the production engine. Require the same outcome across the three
predeclared captures, with failed captures retained.

Optional floor landmarks report the fitted plane's orientation relative to an
engine's arbitrary axes. Those axes are not independently measured gravity.
Low point-to-plane residual or low pixel reprojection error is an internal fit
metric and cannot replace withheld physical readings. An entered scale is not a
measured scale, and a simulated route is not physical robot validation.

## Offline harness check

The self-test exercises the benchmark contracts and scoring with explicitly
synthetic fixture cameras and readings. It does not execute VGGT, reproduce an
author benchmark or qualify a GPU.

```bash
python -m robotics.world_worker.reconstruction_comparison self-test \
  --out /absolute/path/to/comparison/self-test
```

First comparison effort is estimated at 3–5 engineer days including integration,
source annotation and review. The test needs no new GPU purchase if the 4090 is
available. Actual memory, elapsed time and energy cost must come from the run;
GB10 execution is a separate qualification.

## Executed qualification, 25 October 2026

The new runner executed native CPU COLMAP on the retained ETH/Strecha Fountain
photographs: 11/11 registered images and 6,047 reconstructed points. Fresh-process
runtime was 18.7478 seconds, with 0.2137 seconds of shared preparation, and peak
engine-process RSS was 764,608,512 bytes. Internal mean reprojection error was
0.277105 pixels. Capture SHA-256:
`4dbacb97ef851ed9990a4fa3df6ebce85bbf3943fd03fce67aa9fc3481fab2ab`.

These are dataset photographs, not a phone walkthrough. No physical readings or
metric scale were supplied, and the images were not committed or cleared for
commercial demo footage. This run establishes that the new CPU harness executes
and retains actual camera output; it does not validate physical reconstruction
accuracy or VGGT performance.

The offline self-test passes all seven authored withheld spans and correctly
remains ineligible for physical-accuracy claims or production promotion. No
actual VGGT/CUDA inference has been executed in this environment.

Local verification passed 133 new comparison tests and the combined World
Builder/compiler suite: 661 tests, 95 subtests, with two real-capture opt-ins
skipped. Native PyCOLMAP bundle-adjustment tests use authored geometry; they do
not imply that the VGGT model or a physical scene was validated.

The local annotation helper passed headless Chromium checks at desktop and
390-pixel mobile widths: exact raster hash checks, two-frame marking, duplicate
observation rejection, import/export, wrong-capture rejection and stale-image
rejection. The authored UI fixture contains no independently measured scene.

Run the benchmark regression suites from the repository root:

```bash
python -m pytest tests/world/test_reconstruction_comparison.py \
  tests/world/test_comparison_measurements.py \
  tests/world/test_comparison_vggt.py -q
```

## Primary sources and scope

- [VGGT source and commercial-checkpoint distinction](https://github.com/facebookresearch/vggt)
- [VGGT paper, including camera benchmarks and bundle adjustment](https://arxiv.org/abs/2503.11651)
- [Commercial checkpoint and terms](https://huggingface.co/facebook/VGGT-1B-Commercial)
- [VGGT-Omega license](https://github.com/facebookresearch/vggt-omega/blob/main/LICENSE)
- [VGGT-Omega replacement benchmark checkpoint](https://github.com/facebookresearch/vggt-omega/blob/main/reproduction.md)
- [COLMAP camera models](https://colmap.github.io/cameras.html)
- [Existing BrainSNN camera/component evidence](world-camera-evidence.md)

Source/model pins are reviewed as of 25 October 2026. Author-reported benchmarks
remain distinct from results reproduced by this harness.
