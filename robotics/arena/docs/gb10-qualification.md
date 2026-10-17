# GB10 qualification: a separate target for the same Arena contract

Research checked 17 October 2026. **No GB10 model run, image build or EGL validation has been performed for this kit.** This is a qualification plan, not an installation recipe. The specific RTX 4090 procedure remains in `docs/rtx4090-handoff.md`. Do not change an existing text service, its environment, the host driver or the known 4090 dependency pins to try this plan.

## What is known

GB10 uses an ARM64 CPU and a Blackwell GPU with CUDA compute capability 12.1. RTX 4090 has compute capability 8.9. NVIDIA currently lists 64 GB (coming through participating OEMs) and 128 GB unified-memory Spark configurations. Inventory the actual SKU; the chip name does not specify its installed memory. Unified memory is shared by CPU, GPU, operating system and other services. It is not dedicated GPU memory, and capacity does not establish policy latency. NVIDIA's advertised FP4 throughput is not a measurement of this policy. [Spark specifications](https://www.nvidia.com/en-us/products/workstations/dgx-spark/), [CUDA GPU list](https://developer.nvidia.com/cuda/gpus).

| Component | Evidence | Qualification still needed |
|---|---|---|
| OpenPI `215abfb217dbac7d5f1273282331b9b1866c0479` | Python >=3.11, JAX CUDA12 0.5.3, Torch 2.7.1, NumPy <2; lock includes ARM64 JAX/plugin/PJRT wheels and CUDA 12.9 dependencies | Full dependency resolution, XLA compilation, checkpoint load and real policy inference on the actual machine |
| Physics environment | Separate Python 3.10; official CPU Torch 2.2.2 and MuJoCo 3.2.3 distributions include Linux ARM64 wheels | Full LIBERO/robosuite dependency build, assets, seeded reset and camera rendering |
| NVIDIA JAX recipe for Spark | CUDA 13.0.1, Python 3.12, JAX 0.7.2, NumPy 2.3.3 | These differ from OpenPI's pins; adopting this recipe requires a separate tested migration |
| EGL | Container recipe already requests the `graphics` driver capability | A CUDA-visible GPU alone does not prove working offscreen OpenGL or correct camera images |

Sources: pinned [OpenPI project](https://raw.githubusercontent.com/Physical-Intelligence/openpi/215abfb217dbac7d5f1273282331b9b1866c0479/pyproject.toml) and [lock](https://raw.githubusercontent.com/Physical-Intelligence/openpi/215abfb217dbac7d5f1273282331b9b1866c0479/uv.lock); [CPU Torch wheels](https://download.pytorch.org/whl/cpu/torch/); [MuJoCo 3.2.3 files](https://pypi.org/pypi/mujoco/3.2.3/json); [NVIDIA Spark JAX Dockerfile](https://raw.githubusercontent.com/NVIDIA/dgx-spark-playbooks/main/nvidia/jax/assets/Dockerfile); [NVIDIA container capabilities](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html).

CUDA 12.9 added `sm_121` support. It would be inaccurate to reject the current route solely because it says CUDA12. Equally, the existence of an ARM wheel does not establish that this JAX/XLA version executes the model correctly. [CUDA 12.9 release notes](https://docs.nvidia.com/cuda/archive/12.9.0/cuda-toolkit-release-notes/index.html).

## Work that does not require the target GPU

Use the native inspector, integrity validator, local imports, recorded fixtures and API lifecycle tests. The existing test suites exercise camera/event relationships, missing evidence, archive retention, read-only credentials and browser behavior using worker doubles. Optional real Parquet/video/MCAP fixtures validate interchange. None of those tests qualifies GPU policy execution.

Keep portable recording schemas, evidence rules and API behavior common across both machines. Keep policy, physics and optional importer dependencies isolated. The optional importer uses Python >=3.12; its NumPy/PyAV versions must not leak into the OpenPI or Python 3.10 physics environment. There is no need to train a new video model or migrate the website while hardware is unavailable.

## Qualification when the machine is available

1. Record SKU, memory, `uname -m`, OS/kernel, NVIDIA driver, container runtime and source commit without printing secrets. Inventory resident services and ports. Preserve their health baseline. Check available system memory (`MemAvailable`) and memory pressure as well as GPU activity; ordinary framebuffer-memory reporting is unavailable on Spark, so the 4090 `nvidia-smi memory.free` gate is insufficient. Literal free memory excludes reclaimable cache. [NVIDIA known issues](https://docs.nvidia.com/dgx/dgx-spark/known-issues.html).
2. Build the existing physics recipe natively for ARM64 in isolation. Record the image digest and resolved versions. Verify pinned imports, LIBERO task assets, seeded reset, ordinary stepping, both policy cameras, spectator image and renderer cleanup. Do not use x86 emulation as evidence of native support.
3. Resolve the unchanged OpenPI lock in its separate environment. Record installed versions and any resolver/build failures. Preserve the entire checkpoint and its external manifest. Verify JAX selects a GPU and compiles representative BF16 operations before loading the checkpoint.
4. Start the policy wrapper privately on loopback 8010. Record cold load/compilation separately. A synthetic warm-up is not an episode. Verify real captured observations produce finite action chunks of the expected shape, then start physics privately on 8081 with persistent recording storage.
5. Run the same bounded pilot as the 4090 handoff: a practice canary and one measured `libero_spatial:0`, seed 7 episode. Accept either LIBERO `check_success` or an honest miss at 220 control steps. Require verified complete durable bundles and linked camera/inference/controller/state evidence. Import the bundle independently in the browser. An error or partial archive fails qualification even if a preview rendered.
6. Measure episode wall time, per-inference latency, the 20-second inference deadline, total system memory pressure, GPU activity and recorder overhead. Exercise reset, timeout/failure cleanup and post-session archive reads. Verify the resident text service remains healthy. Record idle versus active power if estimating owned-machine cost; do not derive throughput from model size or FP4 marketing figures.
7. Only after the first evidence folder is accepted, run ten sequential episodes under the existing handoff. Record successes, misses and operational failures separately. No batch runner, concurrent sessions or public aggregate score is implied.

If the pinned model environment fails, retain its failure receipt and prepare a separately identified CUDA13/JAX candidate. Any dependency or precision change needs a new environment lock, recorded runtime identity and fresh validation. Do not silently rewrite the RTX 4090 recipe. Keep port 8010 private, use the existing authorized HTTPS proxy for 8081, and stop only processes started for the pilot.

## Release and commercial boundary

The accurate status is **prepared for GB10 qualification**. Neither this document nor a website deployment creates available compute or demonstrates model execution. Use the same saved-evidence acceptance gate on either target before advertising a named-model run or measured pricing.

Keep the exact checkpoint's provenance and accompanying notices with the deployment. OpenPI's code license alone does not describe every model-weight obligation: the pinned source includes Apache 2.0 and separate Gemma terms. LIBERO identifies its code as MIT and datasets as CC BY 4.0. Check the specific artifacts and their terms before distributing weights or offering hosted inference. [OpenPI license](https://raw.githubusercontent.com/Physical-Intelligence/openpi/215abfb217dbac7d5f1273282331b9b1866c0479/LICENSE), [pinned Gemma terms](https://raw.githubusercontent.com/Physical-Intelligence/openpi/215abfb217dbac7d5f1273282331b9b1866c0479/LICENSE_GEMMA.txt), [pinned LIBERO README](https://raw.githubusercontent.com/Lifelong-Robot-Learning/LIBERO/8f1084e3132a39270c3a13ebe37270a43ece2a01/README.md).
