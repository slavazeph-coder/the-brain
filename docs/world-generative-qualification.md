# Generative world qualification — 19 October 2026

**Status: unqualified.** Neither Lyra version has generated a scene in this
environment. Lyra 1 is the candidate for a separate commercial-use qualification;
Lyra 2's published checkpoint terms exclude production use. Existing MapAnything
results establish a reconstruction path, not Lyra compatibility or scene generation.

This review inspected official source revision
[`9fffc9adc37004091ecf26ef03abfb3abdf4d59a`](https://github.com/nv-tlabs/lyra/tree/9fffc9adc37004091ecf26ef03abfb3abdf4d59a)
and public checkpoint metadata. Approximately 1.03 MB of source/metadata was saved
privately; no Lyra weights, packages or model processes were installed or run.

## Source and checkpoint rights

The repository's [Apache-2.0 source license](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/LICENSE)
does not license every checkpoint. Pins below identify reviewed metadata, not
downloaded or executed weights.

| Component / checkpoint revision | Verified terms and role |
|---|---|
| [Lyra 1 `240ecc75fedadd3d0056666c679d82348903806e`](https://huggingface.co/nvidia/Lyra/tree/240ecc75fedadd3d0056666c679d82348903806e) | NVIDIA Open Model License; card explicitly permits commercial use. Static Gaussian decoder `lyra_static.pt`: 65,578,549 bytes. |
| [GEN3C-Cosmos-7B `9bcfdb4f3924f41376daeadf6200826c12a3bf8e`](https://huggingface.co/nvidia/GEN3C-Cosmos-7B/tree/9bcfdb4f3924f41376daeadf6200826c12a3bf8e) | NVIDIA Open Model License; generates Lyra 1's multiview latents. `model.pt`: 28,949,459,416 bytes. |
| [Cosmos-Tokenize1-CV8x8x8-720p `b6af495317c76f287a4131e9299936b1533f5f9f`](https://huggingface.co/nvidia/Cosmos-Tokenize1-CV8x8x8-720p/tree/b6af495317c76f287a4131e9299936b1533f5f9f) | NVIDIA Open Model License; Lyra 1 tokenizer. Select exact required native/JIT files before provisioning. |
| [MoGe `ad326bfb61facd6c52b5a825bc1e34d7c97d9672`](https://huggingface.co/Ruicheng/moge-vitl/tree/ad326bfb61facd6c52b5a825bc1e34d7c97d9672) | MIT; initial depth/intrinsics in Lyra 1 and default Lyra 2 scale alignment. |
| [T5-11B `90f37703b3334dfe9d2b009bfcbfbf1ac9d28ea3`](https://huggingface.co/google-t5/t5-11b/tree/90f37703b3334dfe9d2b009bfcbfbf1ac9d28ea3) | Apache-2.0; Lyra 1 text encoder. |
| [Lyra 2 `c178c3fcf12b63cf98f6749999e6ecb63901669f`](https://huggingface.co/nvidia/Lyra-2.0/tree/c178c3fcf12b63cf98f6749999e6ecb63901669f) | NVIDIA Internal Scientific Research and Development Model License. The official `checkpoints/*` download totals 97,010,390,452 bytes, including diffusion, text/image encoders, VAE, LoRAs and reconstruction weights; this is an inventory, not a minimum runtime footprint. |
| [DA3NESTED-GIANT-LARGE-1.1 `b2359bdf726fb44ef62acca04d629dcf158053e7`](https://huggingface.co/depth-anything/DA3NESTED-GIANT-LARGE-1.1/tree/b2359bdf726fb44ef62acca04d629dcf158053e7) | CC-BY-NC-4.0; Lyra 2's default depth checkpoint adds a separate commercial-use gate. |
| [UMT5-XXL `66cb9e7e85526fe440a945569e42c72fb6cbc0ad`](https://huggingface.co/google/umt5-xxl/tree/66cb9e7e85526fe440a945569e42c72fb6cbc0ad) | Apache-2.0 upstream text model/tokenizer; Lyra 2 also supplies encoder weights under its own model notice. |

Lyra 2's [model license](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-internal-scientific-research-and-development-model-license/)
permits internal scientific R&D in a non-production environment and excludes using
the model to generate works for sale or distribution. Outputs are not derivative
models, and NVIDIA claims no ownership of them; neither provision removes that
use restriction. Do not provision Lyra 2 as a production candidate without
additional rights. Its optional VIPE dependency chain has not been fully reviewed.

Lyra 1's core rights chain supports investigating commercial hosting, subject to
the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/):
preserve required safeguards, follow incorporated use terms, provide Cosmos
attribution for a service using Cosmos, and retain required license/notices when
redistributing models. This is not a completed license review of every dependency.

The shipped [guardrail downloader](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-1/scripts/download_guardrail_checkpoints.py)
adds [Cosmos-Guardrail1 `d6d4bfa899a71454a700907664f3e88f503950cf`](https://huggingface.co/nvidia/Cosmos-Guardrail1)
(NVIDIA Open Model License, with separately licensed components) and
[Llama-Guard-3-8B `7327bd9f6efbbe6101dc6cc4736302b3cbb6e425`](https://huggingface.co/meta-llama/Llama-Guard-3-8B)
(Llama 3.1 terms, including attribution, acceptable-use and large-user-count
conditions). Their weight access is gated; public terms were inspected without
accepting access agreements. Inventory and review the actual selected safety
components, including inherited Llama, SigLIP and face-filter weights, before
declaring the complete runtime commercially cleared.

There is a source/card mismatch: the official single-image
[entry point sets `args.disable_guardrail = True`](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-1/cosmos_predict1/diffusion/inference/gen3c_single_image_sdg.py#L593),
while the model card warns against disabling safeguards. The current Open Model
License permits a substantially similar replacement. Resolve the applicable
terms and preserve or qualify equivalent checks in a recorded patch before any
smoke run; do not copy the disabling flag from the demo or its offloading example.

## Documented inference scope

| Candidate | Smallest qualification scope supported by the inspected examples |
|---|---|
| Lyra 1 static scene | One image through GEN3C's six-trajectory static path, 121 frames per trajectory, 704×1280, then the static Lyra Gaussian decoder. The inspected defaults use 35 diffusion steps and guidance 1. A smaller shape or fewer decoder trajectories is not established here. |
| Lyra 2, research only | One image, caption and custom 81-pose trajectory at 480×832: one 80-frame autoregressive chunk plus the initial frame. `--use_dmd` selects four fixed steps. Video-to-Gaussian reconstruction is a separate stage. The preset zoom example instead requests 81 inward and 241 outward frames. |

Sources: [Lyra 1 demo](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-1/README.md),
[inference defaults](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-1/cosmos_predict1/diffusion/inference/inference_utils.py),
[static decoder configuration](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-1/configs/demo/lyra_static.yaml),
[Lyra 2 inference](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-2/README.md).
Decoder-only execution on supplied latents qualifies only that stage; it must not
be presented as fresh-image generation. Example assets require their own rights
review, so use an authorized fixture with an explicit input manifest.

## GB10 port and resource gates

Lyra 1 documents an approximately **43 GB observed peak with full offloading**
on H100/A100. This is neither a minimum requirement nor a GB10 measurement; its
example also disables safeguards. It exceeds the existing **20 GiB allocation
guard**, and restoring checks may add memory. Available host memory on a unified
memory system does not establish a safe concurrent slot alongside production vLLM.

The [Lyra 1 installation](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-1/INSTALL.md)
uses Python 3.10, Torch 2.6 and CUDA 12.4, with native Apex, Transformer Engine,
FlashAttention, Mamba, causal-conv1d and gsplat dependencies. Lyra 2's
[tested installation](https://github.com/nv-tlabs/lyra/blob/9fffc9adc37004091ecf26ef03abfb3abdf4d59a/Lyra-2/INSTALL.md)
uses H100, Torch 2.7.1 and CUDA 12.8 with x86 compiler examples. GB10 is
[Blackwell compute capability 12.1](https://developer.nvidia.com/cuda/gpus), not H100.

Read-only inspection found GB10 ARM64, Python 3.12.3, Torch 2.13.0+cu130 and
Transformers 5.17.0, but an `nvcc` 12.8 compiler. Apex, Transformer Engine,
FlashAttention, Mamba, causal-conv1d, gsplat, Decord and Megatron Core were absent
from the inspected environment. These are concrete missing dependencies and
version differences; source compilation, ABI/kernel support and numerical
compatibility remain untested. Prepare a separate environment and source checkout;
never upgrade or patch the shared production environment to satisfy this stack.

## Staged execution and acceptance plan

These are future gates, not completed runs. Weight provisioning requires the recorded rights and resource gates to pass.

1. **Freeze rights and inputs.** Record source/submodule revisions, per-file weight
   hashes and license notices, approved guardrail behavior, asset rights and the
   proposed disk/memory/time budgets. Resolve gated access through the operator.
   Keep Lyra 2 excluded from production. Do not rely on source licensing alone.
2. **Build the isolated Lyra 1 port without weights.** Resolve ARM64 wheels or
   reviewed native builds and matching Torch/compiler versions. Record every
   compatibility patch. From the pinned `Lyra-1` directory, use commands below
   for syntax/import checks, then separately test the required native kernels
   under resource guards. Imports alone do not establish kernel compatibility.

   ```sh
   "$WORLD_LYRA_PYTHON" -m compileall -q cosmos_predict1 src scripts sample.py
   PYTHONPATH=. "$WORLD_LYRA_PYTHON" -c 'import torch, torchvision, diffusers, transformers, megatron.core, transformer_engine, apex, flash_attn, mamba_ssm, causal_conv1d, gsplat, decord'
   ```

3. **Qualify one decoder sample.** After the rights and resource gates pass, run the official
   `sample.py --config` entry point through `accelerate`, using an isolated copy
   of `configs/demo/lyra_static.yaml` that selects exactly one authorized latent
   sample. First implement and verify that selection and the process watchdog;
   the stock dataset-wide launch is not a bounded one-sample harness. Record
   input hashes, camera/latent shapes, finite Gaussian attributes, PLY hash,
   peak allocation/reservation, host headroom and elapsed time. Label this
   explicitly as decoder-only evidence.
4. **Qualify fresh-image generation separately.** Use the reviewed guarded
   `gen3c_single_image_sdg.py` entry point and documented six-trajectory settings,
   then decode the produced latents. No cache substitution, external captioning
   or silent model download. A resource assessment must identify a suitable slot
   or separate host before execution; do not raise the current 20 GiB guard or
   stop production services to force this run. Missing headroom is a failed
   admission, not a reason to drop checks.
5. **Accept artifacts and behavior.** Verify source/weight/prompt provenance,
   process cancellation, failed-run cleanup, bounded output, health/OOM guards,
   and actual PLY loading in Chromium/WebKit. Inspect generated missing surfaces
   and hallucinations against the source. Keep `metric_verified:false`, generated
   visual labels, and collision/robot execution disabled. Only actual receipts
   may change engine readiness; passing imports or viewing supplied latents may not.

Private research receipts: `/tmp/brainsnn-world-validation/lyra2-audit/`.
