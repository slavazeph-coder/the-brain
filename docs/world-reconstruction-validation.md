# World reconstruction validation — 19 October 2026

CPU sparse reconstruction and dense MapAnything GPU reconstruction have executed
on real photographs. GPU qualification covers one and three views on an idle GB10.
Neither result qualifies a metric collision map, robot policy, or public GPU service.

## Executed CPU reconstruction

Environment: macOS ARM64, Python 3.13.12, PyCOLMAP 4.2.1, NumPy 2.5.4,
Pillow 12.1.0. Dependencies are pinned in
`robotics/world_worker/requirements-colmap.txt`; worker dependencies remain separate.

Inputs: the eleven `Fountain/images/0000.png`–`0010.png` photographs in the
[ETH Strecha Fountain archive](https://cvg-data.inf.ethz.ch/local-feature-evaluation-schoenberger2017/Strecha-Fountain.zip),
also used by the [official PyCOLMAP example](https://github.com/colmap/pycolmap/blob/master/example.py).
Archive SHA256: `e2bd4f87caec2f7d354e3e09b06c397b4194ed1cb09da029bcbe680dab9c972d`.
The archive's redistribution/commercial-use terms have not been established here;
the capture and resulting scene are private validation inputs, not distributed
product samples. COLMAP itself is BSD licensed; its
[license explicitly distinguishes dependency licenses](https://github.com/colmap/colmap/blob/main/LICENSE).

| Actual local run | Views accepted / registered | Points | Mean reprojection error | Elapsed |
|---|---:|---:|---:|---:|
| Eleven original photographs | 11 / 11 | 6,041 | 0.276 px | 11.269 s |
| MP4 made from those photographs | 11 / 11 | 6,225 | 0.432 px | 9.995 s |

The MP4 is a 5.5-second photograph sequence, **not a physical iPhone walkthrough**.
It exercises real video decoding, frame selection and COLMAP; six near-duplicate
frames were removed. Capture quality, phone optics, rolling shutter, long videos
and indoor low-texture scenes remain unqualified. Reprojection error measures
image consistency, not metric accuracy or obstacle completeness.

Local receipts are under `/tmp/brainsnn-world-validation/` (temporary, not shipped):

| Receipt | SHA256 |
|---|---|
| `output/sparse-preview.ply` | `dca641d087c68c735e075a57b4e409e4a51904522fed81be81536fbf8d7ad437` |
| `output/reconstruction.json` | `6db544c4f6fbb222b10aa92175c7320814722d166d29e77414b4bcbb4bd349e2` |
| `video-deduplicated/output/reconstruction.json` | `24e36b570e1eeac46fbcbde0835723dceeebfb6ae824b1b144fa1b6ea3a4327c` |

The PLY also loaded in the first-party browser viewer: 6,041 finite points, no
skipped values. Sparse outliers remain visible; the viewer does not silently
trim them to imply a cleaner reconstruction.

Repeat the complete authenticated upload/start/process/ticket/download tests with:

```sh
WORLD_COLMAP_TEST_CAPTURE=/path/to/Fountain/images \
  /path/to/colmap-venv/bin/python -m pytest tests/world/test_worker.py -q
```

Those tests use the installed native PyCOLMAP runtime and actual photographs for
both photo and video jobs. They never download a dataset or substitute a mocked
reconstruction. Without the dataset/runtime, those checks explicitly skip.
The complete run passed **46 tests in 24.34 seconds**, including both real HTTP
reconstruction jobs, the no-overlap failure case, concurrent storage reservations,
and queue recovery after cancelled/deleted jobs or filesystem errors. One Starlette/AnyIO
deprecation warning remains; it did not affect execution.

## Dense GPU adapter and bounded execution

`robotics/world_worker/mapanything_apache.py` calls the official
[`MapAnything.from_pretrained` and `infer` API](https://github.com/facebookresearch/map-anything/blob/3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9/README.md).
The [Apache checkpoint](https://huggingface.co/facebook/map-anything-apache/tree/00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a)
is distinct from `facebook/map-anything`, which is CC-BY-NC. The upstream source
and selected checkpoint both declare Apache-2.0; third-party dependencies still
require their own review.

| Required pin | Value |
|---|---|
| MapAnything source | `3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9` |
| DINOv2 source (architecture only) | `7764ea0f912e53c92e82eb78a2a1631e92725fc8` |
| Apache checkpoint revision | `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a` |
| `model.safetensors` | 4,914,062,480 bytes; SHA256 `fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201` |
| `config.json` | SHA256 `65701d09d99ed37a21d295f0d138978b3d584ab3bccdbcb4a2853da212b676c5` |
| Encoder dependency | `uniception==0.1.7` |

Operator setup must provision clean pinned source checkouts, install MapAnything
and its reviewed dependencies in a separate CUDA environment, and download the
exact Apache snapshot into a local directory before enabling the engine. Set
`WORLD_MAPANYTHING_SOURCE_DIR`, `WORLD_DINOV2_SOURCE_DIR` and
`WORLD_MAPANYTHING_MODEL_DIR`. `model.safetensors` and `config.json` must be regular
files; use a local-directory snapshot rather than cache symlinks.

The adapter verifies source revisions and model hashes, requires CUDA, uses at
most twelve views at 518-pixel longest side, and runs memory-efficient inference
with minibatches of one. Hugging Face is offline; the hidden Torch Hub DINO code
fetch is redirected to the pinned local checkout with no separate pretrained
weights. Python network connections are denied. Missing files, changed source,
invalid outputs, or unavailable CUDA fail the job without a successful manifest.

CPU tests cover output shapes, mask/nonfinite filtering, bounded sampling,
RGB conversion, source pin rejection and network denial. World points are
rotated once from OpenCV to a right-handed Y-up frame; predicted camera poses are
not applied twice. A model's predicted metric scale remains `metric_verified:false`.
Output is a dense point-cloud preview, not Gaussian splats or a collision mesh.
The bounded execution below validates model loading, output generation, peak GPU
memory and latency for its specific inputs. General numerical quality, twelve-view
or video operation, and production concurrency remain release gates. The example
engine remains disabled.

## Isolated GPU staging, without inference

At **2026-10-19 14:18:52 UTC**, the source pins and complete 4,914,062,480-byte
Apache checkpoint above were SHA-verified in `/workspace/brainsnn-world-builder`.
`staging-receipt.json` records both clean source checkouts, byte counts and hashes;
`staging.log` records the completed download (orchestrator PID 349837).
No applicable remote `AGENTS.md` was present in the staging directory or its
ancestors. No production service or shared environment was changed.

The isolated `.venv` uses Python 3.12.3 and reads the existing Torch 2.13.0+cu130
and torchvision 0.28.0+cu130 packages through a separate path entry. Supplemental
dependencies, including UniCeption 0.1.7 and OpenCV 4.10.0.84, were installed only
under that new environment. `requirements-resolved.txt` and
`dependency-install.json` record their exact versions and artifact SHA256 hashes;
no Torch, CUDA, NVIDIA, Triton or vLLM package was installed or changed.

At **14:20:48 UTC**, CPU-only validation rechecked the full model/source pins and
imported the real MapAnything API successfully with Python network access blocked.
`import-validation.json` records the worker source hashes, dependency paths and
`cuda_initialized:false`, `model_loaded:false`, `inference_executed:false`.
This proves local installation and imports, not GPU compatibility or reconstruction
quality. The subsequent bounded GPU qualification is recorded below.

## Executed GPU qualification

Adapter commit: `715ce8b14e2e278ba656e62d562e6f643f94c8d0`. The isolated environment
executed the exact pinned Apache model on NVIDIA GB10, with Torch 2.13.0+cu130,
two CPU threads, a 20 GiB Torch allocation cap and a 180-second deadline.
Inputs were Fountain photographs `0000.png` for one view and `0000.png`–`0002.png`
for three views. No synthetic depth or replacement output was used.

| Actual GPU run | Colored preview points | Predicted cameras | Adapter elapsed | Peak allocated / reserved |
|---|---:|---:|---:|---:|
| One photograph | 72,125 | 1 | 15.556 s | 5.03 / 5.28 GiB |
| Three photographs | 86,593 | 3 | 16.800 s | 5.17 / 5.51 GiB |

Adapter elapsed includes checkpoint/source validation, preprocessing, model load,
inference and export; the model's evidence file separately times loading through
export. These are single cold-process trials, not throughput benchmarks.

A watchdog checked vLLM health, active/waiting work, host memory minus free CMA,
cgroup headroom and OOM counters before model loading and during execution. It
could terminate only its own process group. The first admission at 14:25 UTC
correctly declined to start when one production request was active. A later
25-second idle interval permitted the one-view run; the three-view run then
passed a fresh admission check. During the successful runs, all 19 and 21 samples
reported health 200, no active/waiting production work and unchanged OOM counters.
Minimum host headroom was 61.28 and 61.06 GiB. The watchdog's stop thresholds
were 35 GiB host headroom, 24 GiB cgroup headroom, new production work, failed
health, changed OOM counters or the deadline. No production service was stopped,
restarted or reconfigured.

Both child processes exited successfully. At **14:29:51 UTC**, vLLM remained
healthy with its original engine process, GPU utilization was 0%, temperature
45°C, host headroom 69.72 GiB, and all OOM counters remained zero. This shows
coexistence during the measured idle intervals, not an assurance about concurrent
production traffic.

| Artifact | SHA256 |
|---|---|
| One-view `dense-preview.ply` | `fa89c4c15e078803ac9393e0f3cd023a7bbc8862e4ed2e04ddfbd7eb296ed5b0` |
| One-view `reconstruction.json` | `7cd5e8be5b52fcc5cd0fdaf64001a785c25e382339abda790e2a2b49823e1928` |
| Three-view `dense-preview.ply` | `71e88803e5fae6176b25c5b55edbdc3750c2f601f3d3343431823d5c51494df4` |
| Three-view `reconstruction.json` | `494ae3c65df7158e66e766c06c2430d3f65686d0fe01d2b78395da54cbb6253d` |

Remote receipts are under `/workspace/brainsnn-world-builder/qualification/`,
in `1-view-20261019T142658Z` and `3-view-20261019T142807Z`: `watchdog.json`,
`gpu-result.json`, and `output/reconstruction.json`. Copies under
`/tmp/brainsnn-world-validation/gpu-qualification/` were verified against their
byte counts and SHA256 hashes. Inputs, outputs and screenshots remain private
validation artifacts outside the repository because dataset redistribution
rights have not been established.

The actual dense artifacts also passed the first-party PLY parser and browser
viewer: 72,125 and 86,593 finite points, with no dropped values. The three-view
scene visibly reconstructs the fountain and wall. Chrome desktop and an iPhone
15-sized WebKit viewport rendered nonempty scenes, accepted camera controls,
reported no WebGL/page errors, and made no upload or cross-origin requests.
The UI retained point-cloud and unverified-scale labels. Screenshots and browser
receipts are local ignored files under `output/playwright/world/`; this verifies
rendering, not real-device Safari or geometric accuracy.

Predicted metric scale remains unverified, and point clouds are not watertight
meshes or reviewed collision geometry. This qualification does not cover longer
videos, twelve views, low-texture interiors, geometric accuracy, semantic labels,
robot execution or a public worker endpoint.

## Read-only GPU hardware observation

At **2026-10-19 13:59 UTC**, the authenticated GB10 host reported ARM64,
driver 580.159.03, 94% GPU utilization and 70°C. Its production vLLM process
reported 42,888 MiB GPU memory. Host available memory minus free CMA was
70.04 GiB; cgroup usage was 16.77 GiB of 116.82 GiB, with no OOM events, and the
workspace had approximately 1.24 TiB free. These counters describe different
memory accounting domains; they are not interchangeable free-VRAM measurements.

An existing environment contains Torch 2.13.0+cu130, torchvision 0.28.0+cu130,
vLLM 0.31.0 and Transformers 5.17.0. No reconstruction packages or weights were
installed and no inference was started during this inspection. Production
Hermes/vLLM/Ollama processes were left running unchanged. That initial busy
observation did not establish a safe reconstruction slot; the later idle-window
qualification is documented separately above.

[Lyra 2's tested installation](https://github.com/nv-tlabs/lyra/blob/main/Lyra-2/INSTALL.md)
uses H100, CUDA 12.8 and Torch 2.7.1 with x86-specific build examples; a GB10 ARM64
port and its service coexistence remain untested. Do not convert the available
system memory observation into a claim that Lyra fits or runs here. An idle,
bounded GPU qualification must precede any engine activation or flagship release.
