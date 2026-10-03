# Browser neural simulation, neural foundation models, and open EEG/MEG data for the "Poke the Brain" toy

Research date: 2026-10-03. Scope: whether brainsnn.com can run a bigger spiking network in the browser fast enough to play with; how to ship connectivity data without slowing the homepage; which open neural foundation models and EEG/MEG datasets could honestly be added. Primary sources were used where reachable. physionet.org, caniuse.com, web.dev, developer.chrome.com, webkit.org, mozilla.org and arxiv.org were blocked by the egress proxy, so some facts come from search-engine snippets of those pages and are marked as such. Browser support facts come from MDN's browser-compat-data repo (main branch, fetched today), which is the data caniuse/MDN render.

Local measurements in this session ran on Node 22.22.0 (V8, the same JS engine as Chrome), on 1 thread of an "Intel Xeon Processor @ 2.10GHz" cloud vCPU. This is not a laptop or a phone. Scripts: `lifbench.mjs` / `lifbench2.mjs` in the session scratchpad. They use a CSR LIF network with event-driven spike push, dt = 1 ms, about 80% local and 20% random connections, and Float32 state.

## 1. Spiking-network simulation in the browser: WebGPU vs WASM vs plain JS, throughput, browser availability, existing demos

### Takeaway
A connectome-scale LIF network (about 140k neurons and 15M synapses) already runs fully client-side on WebGPU, but at 4x slower than real time on an M2 Pro with a roughly 120 MB binary. That is too heavy for a homepage hero. Plain JS typed arrays in a Web Worker handle 10k neurons with 1M synapses faster than real time on one desktop-class core, and about 100k neurons at about 0.5x real time. That is enough for an 8 Hz visual toy. Use JS (worker) as the baseline everyone gets and WebGPU as an optional add-on. WASM threads aren't worth it, because they need site-wide cross-origin isolation headers.

### Cited Findings

**WebGPU availability (MDN browser-compat-data, current main):**
- Chrome: WebGPU since 113 on ChromeOS, macOS and Windows. Since Chrome 144 it is also on Linux, but only on "Intel Gen12+ GPUs". Edge mirrors Chrome. — [MDN BCD api/GPU.json](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json)
- Chrome for Android: since 121. — [MDN BCD api/GPU.json](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json). Chrome's launch post (seen as a search snippet; the page itself was blocked) says it shipped on "devices running Android 12 and greater powered by Qualcomm and ARM GPUs", with wider device support to follow. — [Chrome blog: New in WebGPU 121](https://developer.chrome.com/blog/new-in-webgpu-121)
- Firefox desktop support is partial, starting in 141. Details: Windows since 141. macOS Tahoe on Apple silicon since 145. Older macOS on Apple silicon since 147. "Does not support macOS on Intel CPUs". "Does not support Linux". Not available in service workers. — [MDN BCD api/GPU.json](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json)
- Firefox for Android: `version_added: false`, meaning no WebGPU. — [MDN BCD api/GPU.json](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json)
- Safari: WebGPU since Safari 26. Safari iOS mirrors desktop Safari, so it is iOS/iPadOS 26. — [MDN BCD api/GPU.json](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json)
- Conflicting claim: some 2026 secondary blog posts in search results say Safari iOS got WebGPU in "iOS 18.2, which shipped in early 2026". They also say WebGPU covers "roughly 78% of Chrome Android users". Neither claim is attributed to a primary source, and the iOS one contradicts MDN, which lists Safari 26. Treat both as unreliable. — [abratabia WebGPU on mobile](https://abratabia.com/mobile-browser-performance/webgpu-on-mobile.php), [cinevva WebGPU vs WebGL 2026](https://app.cinevva.com/guides/webgpu-vs-webgl-games)
- A 2026 browser-GPU benchmark site reported 32,604 submissions, of which 73.6% came from mobile and 86.2% used WebGPU rather than WebGL2. The audience is self-selected, so this is a weak signal for real-world reach. — [volumeshader.dev 2026 report](https://www.volumeshader.dev/id/blog/browser-gpu-benchmark-report-2026)

**WebGPU default limits that matter for CSR data:**
- Default `maxStorageBufferBindingSize` is 134,217,728 bytes (128 MiB). Default `maxBufferSize` is 268,435,456 bytes (256 MiB). Default `maxComputeWorkgroupsPerDimension` is 65,535. — [W3C WebGPU spec source (gpuweb/spec/index.bs)](https://github.com/gpuweb/gpuweb/blob/main/spec/index.bs)
- A 2026 study of WebGPU LLM inference found that per-dispatch overhead is a main source of performance differences. On Vulkan, fusing kernels cut dispatches from 876 to 564 and raised throughput by 53%. (This comes from the search snippet; arxiv.org was blocked.) — [arXiv 2604.02344, Characterizing WebGPU Dispatch Overhead](https://arxiv.org/abs/2604.02344)

**Existing browser SNN and connectome demos (measured where available):**
- **webgpu-fly** (MIT code) runs the FlyWire brain (139,255 neurons, about 15M synaptic edges) plus the MANC nerve cord (23,188 neurons, 5.2M edges). Both are LIF with two-state alpha synapses, each in its own WebGPU instance, with gather, integrate, threshold and reset fused into one kernel per step. The fly body runs in MuJoCo/WASM. — [github.com/abgnydn/webgpu-fly](https://github.com/abgnydn/webgpu-fly)
  - Measured speed on an M2 Pro: about 0.25 kHz of biological time, which the author says is "about 4× slower than real time" and "memory-bandwidth-bound, not compute-bound". On the same machine, NEST 3.10 manages 0.67 kHz and multicore Rust 0.45 kHz. The original 1 kHz target was "unreachable across all three implementations". — [webgpu-fly README](https://github.com/abgnydn/webgpu-fly)
  - It needs WebGPU (Chrome, Edge or recent Safari), and the README describes no non-WebGPU fallback. The author advertises a "30-second time-to-first-spike". — [webgpu-fly HF mirror](https://abgunaydin-webgpu-fly.static.hf.space/index.html)
  - Its disclaimers include "Not a scientific simulator replacement", "not biophysically detailed", and "not quantitatively validated whole-brain". It also says brain-to-spine wiring is matched by cell-type name across two different animals. — [webgpu-fly README](https://github.com/abgnydn/webgpu-fly)
- **fly-connectome-webgpu** (MIT code; modified TF.js files are Apache-2.0) is a feasibility test of the MaleCNS v1.0 connectome (165,122 neurons, 25.6M connections) on TensorFlow.js's WebGPU backend. It adds two custom kernels, a CSR sparse matrix-vector multiply and a fused LIF step, because stock TF.js has no sparse matmul and an unfused LIF would need about 20 elementwise dispatches per step. Its weight rule is `sign(NT) × synapse_count × 0.275 mV` (Shiu et al. 2024). It has been tested only on Apple M-series. Status: "experiment in progress… Nothing here is a validated model", and no performance numbers are published yet. — [github.com/itsyuimorii/fly-connectome-webgpu](https://github.com/itsyuimorii/fly-connectome-webgpu)
- **flybrain** is a native, non-browser reference point: CUDA/Triton on an RTX 3060 (12 GB). It runs the full CNS (166,700 neurons) at 2.4x real time, and 8.9x real time with batch 4 in fp16. Its membrane kernel reaches 250 GB/s, 86% of the card's ceiling, so memory bandwidth is again the limit. It reports 57% of neurons never spike in the model and lists what it "could not establish". The code is MIT. — [github.com/annel0/flybrain](https://github.com/annel0/flybrain)
- Other demos found:
  - The **Brian2 Web Simulation App** is described as Brian2 + Flask, so it runs on a server, not in the browser. This is from a search snippet; the page was blocked. — [Brian discourse](https://brian.discourse.group/t/brian2-web-simulation-app-interactive-spiking-neural-network-simulator-in-your-browser/1440)
  - **akamaus/Spike** is a "browser based spiking neural network simulator". Its age and activity weren't checked. — [GitHub](https://github.com/akamaus/Spike)
  - A 2022 paper runs GPU spiking *neural P systems* in browsers. That is a different formalism from LIF. — [Springer Natural Computing 2022](https://link.springer.com/article/10.1007/s11047-022-09914-1)
  - Search found no maintained, general-purpose npm LIF/SNN library. — [search results](https://github.com/AghilZadeh/spiking-network-simulator)

**WASM:**
- Fixed-width WASM SIMD is supported since Chrome 91, Firefox 89 and Safari 16.4. — [MDN BCD webassembly/fixed-width-SIMD.json](https://github.com/mdn/browser-compat-data/blob/main/webassembly/fixed-width-SIMD.json)
- WASM threads need `SharedArrayBuffer`. To use shared memory, the document must be in a secure context **and cross-origin isolated**, which means sending the COOP/COEP headers. — [MDN SharedArrayBuffer: Security requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)

**Plain JS typed arrays, measured locally (Node 22 / V8, 1 thread of a 2.1 GHz Xeon vCPU, dt = 1 ms, mean firing about 2 Hz):**

| Network | Wall time per 1 ms step (neuron update incl. per-neuron noise RNG, plus spike push) | Real-time factor |
|---|---|---|
| 1,000 neurons × 100 synapses (100k edges) | 0.031 ms | about 32x faster than real time |
| 10,000 × 100 (1M edges) | 0.18 ms | about 5.5x faster |
| 50,000 × 100 (5M edges) | 0.88 ms | about 1.1x faster |
| 100,000 × 100 (10M edges) | 1.80 ms | about 0.55x (slower than real time) |
| 100,000 × 30 (3M edges) | 1.75 ms | about 0.57x. Cost is dominated by the neuron loop and RNG, not by synapses. |

- The neuron update alone, without RNG, costs 0.42 ms per step for 100k neurons, about 4 ns per neuron. Spike push along CSR rows ran at 180–395 M synaptic events per second, depending on the fraction of neurons spiking (0.1–5% per step). A full CSR SpMV that touches every edge each step (pull-style, like the GPU kernels) took 21 ms per pass for 10M edges, about 0.47 G edges/s. Source: measured locally in this session (no URL; method above).

### Inferences
- **Recommendation: plain JS, event-driven, in a Web Worker.** At low firing rates, an event-driven CPU simulator only touches the synapses of neurons that actually spiked. The GPU gather kernels in webgpu-fly and fly-connectome-webgpu read every edge every step. That is why one CPU core keeps up with 10k–50k neurons, while the 139k-neuron WebGPU fly brain runs slower than real time. The toy only redraws at about 8 Hz, so it can show 1 step per frame or run in "slow motion". It does not need biological real time.
- **Sizing for the homepage:**
  - About 5k–20k neurons with 50–100 synapses each (0.25–2M edges) fits comfortably on phones.
  - Assumption, not measured: a mid-range phone core is 3–5x slower than this Xeon vCPU, which would put 10k × 100 at about 1–2x real time.
  - About 100k neurons is desktop-only on the CPU path, at about 0.5x real time measured, or it needs WebGPU.
- **When WebGPU helps:** 100k+ neurons with dense activity, or many parallel instances. Fuse the LIF step and the synaptic gather or scatter into 1–2 dispatches per step, since dispatch overhead dominates small kernels. Run several steps per command submission. For anything over 128 MiB per binding, split buffers or request higher adapter limits, and expect phones to refuse.
- **WebGPU gaps that require a fallback anyway:** Firefox on Android, Firefox on Linux and Intel Macs, Chrome on Linux with non-Intel-Gen12 GPUs, and iOS versions before 26. WebGPU can therefore only be an optional add-on, never the default path.
- **Skip WASM threads.** COOP/COEP isolation applies site-wide, can break third-party embeds and iframes (payments, video, analytics), and buys little: the scatter-add of spikes is memory-bound and doesn't vectorize. WASM SIMD without threads mainly speeds up the dense neuron-update loop, which is about 0.4 ms per 100k neurons in plain JS already.
- **Wording to borrow:** webgpu-fly's disclaimers, such as "not biophysically detailed" and "not quantitatively validated", are a good model for BrainSNN's "this is a simulation" text, especially if a real connectome is used.

### Gaps
- I found no published, measured WebGPU SNN throughput for a **mid-range phone** or a **mid-range Windows laptop** (iGPU). The only browser number is webgpu-fly on an M2 Pro. fly-connectome-webgpu has not published results yet.
- webgpu-fly doesn't state its dt outright. "0.25 kHz = 4x slower than real time" suggests 1 kHz is real time, so dt is about 1 ms, but this is unconfirmed.
- No measured WASM SIMD vs JS comparison for LIF/CSR workloads was found. The local benchmark covered JS only, since no WASM toolchain was available.
- The local JS numbers come from a server vCPU in Node, not from Chrome, Safari or Firefox on consumer hardware. Phone figures are extrapolations.
- The arXiv dispatch-overhead study could only be read as a search snippet. I don't have its per-dispatch microsecond numbers.

## 2. Data delivery: compact binary CSR, compression ratios, and lazy loading without hurting first paint

### Takeaway
Raw float32 CSR costs about 8 bytes per edge; webgpu-fly ships 120 MB for 15M edges. Delta-encoded column indices plus 8-bit weights, compressed with Brotli, should get to about 2–3 bytes per edge (my estimate, from synthetic tests). That makes a 1M-edge network about 2–3 MB and a 10M-edge one about 20–30 MB. Load it only after the hero is interactive and the visitor engages. Start with the current 7-region toy, then swap in the bigger network.

### Cited Findings
- **webgpu-fly sizes:**
  - The FlyWire source download is about 855 MB, compiled to a **120 MB `brain.bin`** for about 15M edges (about 8 B/edge).
  - The MANC source is about 88 MB, compiled to a **43 MB `vnc.bin`** for 5.2M edges (about 8.3 B/edge).
  - Format is CSR, specified in the `tools/build_csr.py` docstring. The app also loads about 9 MB of JS+WASM.
  - Large assets are served from Cloudflare R2 because Cloudflare Pages caps individual files at 25 MB.
  - — [webgpu-fly README](https://github.com/abgnydn/webgpu-fly)
- **fly-connectome-webgpu:** the MaleCNS data download is about 1.9 GB, licensed CC-BY 4.0 (Janelia FlyEM / Google Research), and exported as CSR. — [fly-connectome-webgpu](https://github.com/itsyuimorii/fly-connectome-webgpu)
- **Connectome weights are integers.** In the Shiu et al. rule, the weight is `sign(NT) × synapse_count × constant`, so stored weights are a small signed integer times one global scale. — [fly-connectome-webgpu](https://github.com/itsyuimorii/fly-connectome-webgpu)
- **Compression, measured locally** (Node zlib: gzip level 9, Brotli quality 11) on a synthetic network of 20k neurons × 50 synapses (1M edges). Bytes per edge after Brotli:

| Stream | Random wiring | Region-local wiring |
|---|---|---|
| Column indices, Uint32 | 1.62 B/edge (gzip 1.71x, Brotli 2.47x) | 1.31 B/edge (gzip 2.29x, Brotli 3.06x) |
| Column indices, sorted per row, delta + varint | 1.26 B/edge | 0.98 B/edge |
| Weights, float32 (random values) | 3.36 B/edge (barely compressible, 1.15–1.19x) | same |
| Weights, float16 | 1.48 B/edge | same |
| Weights, int8 | 0.72 B/edge | same |

  Source: measured locally in this session (no URL).
- **ML runtime payloads, measured locally** from the npm tarball of `onnxruntime-web` 1.30.0 (MIT):
  - `ort-wasm-simd-threaded.wasm` (CPU): 14.24 MB raw, 3.69 MB gzip, **2.36 MB Brotli**.
  - `ort-wasm-simd-threaded.jsep.wasm` (WebGPU/JSEP): 28.31 MB raw, 6.66 MB gzip, **3.95 MB Brotli**.
  - The whole npm package unpacks to 144.6 MB, because it includes many variants.
  - `@huggingface/transformers` 4.3.0 is Apache-2.0 and unpacks to 9.9 MB.
  - — [npm onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web), [npm @huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers)

### Inferences
- **Recommended format**, as one versioned binary with a small JSON header:
  - `rowPtr` as Uint32. This adds 4 B per neuron, which is negligible.
  - Columns sorted within each row and stored as delta-varint, or plain Uint16 when the network has at most 65,536 neurons. Uint16 is the simplest choice for a 10k–50k neuron toy.
  - Weights as Int8 or Uint8 synapse counts plus a sign bit or a per-neuron NT sign. This is lossless for real connectome counts up to 127 or 255; clamp or use Uint16 for the rare larger ones.
  - Real connectome weights are integer counts, so the int8 figure (about 0.7 B/edge, likely less) is the right one to plan with. The random-float figures are a worst case.
- **Expected payloads**, Brotli-compressed:
  - 10k neurons × 100 synapses (1M edges): about 2–3 MB.
  - 100k × 100: about 20–30 MB. Too big for a casual homepage visit; better kept for an opt-in "fly brain mode".
  - Full FlyWire (about 15M edges): about 30–45 MB even compressed. That belongs on a separate page.
- **Lazy loading plan:**
  - Keep the current hand-built 7-region simulation as the instant first paint.
  - Fetch the network binary only after `requestIdleCallback` / on first poke / on an explicit "load the bigger brain" button.
  - Decode and stream it in a Web Worker: `fetch` → `DecompressionStream` for gzip, or let the server's `Content-Encoding: br` do the work → transferable `ArrayBuffer`.
  - Cache it with HTTP immutable caching plus a content hash.
  - Keep each file under 25 MB if hosting on Cloudflare Pages. Railway or any CDN can serve larger files.
- **Pre-compress offline.** Brotli quality 11 is too slow to run on the fly, so ship pre-compressed `.br` files with `Content-Encoding: br`. That avoids shipping a JS decompressor. Browsers' built-in `DecompressionStream` handles gzip and deflate; Brotli support there should be checked before relying on it.
- **onnxruntime-web only for a model feature.** Adding it costs at least about 2.4 MB (CPU) or about 4 MB (WebGPU) Brotli-compressed before any model weights, roughly 10–16x three.js's ~250 KB gzipped. It must never load on the homepage critical path.

### Gaps
- Compression ratios on a **real** connectome subset (FlyWire, hemibrain or C. elegans) were not measured here. Real wiring is more clustered than the synthetic test, so ratios are probably better, but this is unconfirmed.
- The exact byte layout of webgpu-fly's `brain.bin` (index width, weight type, whether delays are stored) was not readable. It lives in a docstring that wasn't fetched.

## 3. Neural foundation models open by 2026: what each predicts, license, size, and whether in-browser or precomputed use is feasible and honest

### Takeaway
None of these models fits the homepage toy well. The models that predict brain responses (TRIBE v2) or behaviour from brain recordings (NDT3) are **CC BY-NC 4.0**, so they can't be used on a commercial site, and they are far too large for a browser. The small, permissive EEG encoders (LaBraM, CBraMod, signal-JEPA: 3.5–5.8M parameters, BSD-3/MIT, about 20 MB) are browser-sized. But they only turn *real EEG input* into embeddings or classifications, and they don't "predict what the brain does". Feeding them simulated data would produce meaningless output with a misleading scientific gloss.

### Cited Findings

**TRIBE v2 (Meta FAIR, March 2026):**
- What it predicts: a "deep multimodal brain encoding model that predicts fMRI brain responses to naturalistic stimuli (video, audio, text)". Predictions are for the "average" subject on the **fsaverage5 cortical mesh (~20k vertices)**. — [HF model card facebook/tribev2](https://huggingface.co/facebook/tribev2)
- Size and dependencies: the checkpoint `best.ckpt` is 708,856,138 bytes (about 709 MB). It also needs LLaMA 3.2-3B (gated), V-JEPA2 ViT-g, and Wav2Vec-BERT 2.0 as feature extractors. — [HF model card facebook/tribev2](https://huggingface.co/facebook/tribev2)
- License: **CC-BY-NC-4.0**. — [HF model card facebook/tribev2](https://huggingface.co/facebook/tribev2). Press coverage describes "an explicit ban on for-profit usage". — [heise](https://heise.de/-11225344)
- Release: March 26, 2026. Trained on more than 1,000 hours of fMRI from 700+ volunteers. — [Meta AI blog](https://ai.meta.com/blog/tribe-v2-brain-predictive-foundation-model/), [heise](https://heise.de/-11225344)
- Conflict: one blog says TRIBE v2 covers "70,000 brain regions", which doesn't match the model card's fsaverage5 (~20k vertices) output. Trust the model card. — [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/2474/meta-tribe-v2-ai-model-predicts-brain-activity-fmri)
- Paper: "A foundation model of vision, audition, and language for in-silico neuroscience" — [HF papers 2605.04326](https://huggingface.co/papers/2605.04326)
- Evidence of overreach: a July 2026 paper found that "a global predicted-fMRI drive signal from TRIBE does not predict YouTube replay heatmaps". — [HF papers 2607.01400](https://huggingface.co/papers/2607.01400)
- The HF page lists 100 demo Spaces, including commercial-sounding ones such as "ad-brain-scorer", "neuro-ads" and "instagram-content-impact-predictor". This shows the misuse pattern BrainSNN must avoid. — [HF facebook/tribev2](https://huggingface.co/facebook/tribev2)

**NDT3 (Joel Ye et al.):**
- A "multimodal Transformer modeling neural population spiking activity from motor cortex and low-dimensional behavioral covariates", trained on up to 2,000 hours of human and monkey data. Its metric is decoding R². Checkpoints come in 45M and 350M parameters, pretrained on 200 h or 2k h. License: **CC-BY-NC-4.0**. — [HF joel99/ndt3](https://huggingface.co/joel99/ndt3), [GitHub joel99/ndt3](https://github.com/joel99/ndt3)

**POYO / POYO+ (Azabou et al.):**
- POYO+ is a transformer for "multi-session, multi-task neural decoding from distinct cell-types and brain regions". It turns spike events into tokens, compresses them with cross-attention into latents, and uses task-specific decoders. A calcium-imaging variant (`CalciumPOYOPlus`) also exists. — [torch_brain docs: POYOPlus](https://torch-brain.readthedocs.io/en/stable/generated/api/autosummary/torch_brain.models.POYOPlus.html), [CalciumPOYOPlus](https://torch-brain.readthedocs.io/en/stable/generated/api/autosummary/torch_brain.models.CalciumPOYOPlus.html)
- The torch_brain framework is Apache-2.0, and the docs mention a `load_pretrained()` method. I couldn't find where pretrained weights are hosted or what license they carry. — [github.com/neuro-galaxy/torch_brain](https://github.com/neuro-galaxy/torch_brain)

**Brain-JEPA (NeurIPS 2024):**
- An fMRI foundation model. Input is fMRI parcellated into 450 ROIs (400 cortical, 50 subcortical), with "brain gradient positioning". Output is learned representations of brain activity. It was pretrained on UK Biobank, and checkpoints are on Google Drive. The README states no license. — [github.com/Eric-LRL/Brain-JEPA](https://github.com/Eric-LRL/Brain-JEPA)
- A third-party Rust/Burn port is tagged MIT. — [HF eugenehp/brainjepa](https://huggingface.co/eugenehp/brainjepa)

**EEG foundation models:**
- **LaBraM** (ICLR 2024 spotlight): MIT repo. Input is EEG band-passed at 0.1–75 Hz, notch-filtered at 50 Hz, resampled to 200 Hz, in 200-sample patches. Pretraining is masked-code prediction. Downstream uses are fine-tuned classification, e.g. abnormality detection and emotion recognition. — [github.com/935963004/LaBraM](https://github.com/935963004/LaBraM)
  - braindecode re-hosts it as **5.8M parameters, a 23.3 MB safetensors file, BSD-3-Clause** (HF downloads: about 148k). — [HF braindecode/labram-pretrained](https://huggingface.co/braindecode/labram-pretrained)
- **CBraMod** (ICLR 2025): MIT repo. Input tensor shape is (batch, channels, segments, 200-point patches), e.g. (8, 22, 4, 200). — [github.com/wjq-learning/CBraMod](https://github.com/wjq-learning/CBraMod)
  - braindecode re-hosts it as **4.9M parameters, a 19.7 MB safetensors file, BSD-3-Clause**. — [HF braindecode/cbramod-pretrained](https://huggingface.co/braindecode/cbramod-pretrained)
- **signal-JEPA**: EEG self-supervised feature extractor, **3.5M parameters, MIT**. — [HF braindecode/signal-jepa](https://huggingface.co/braindecode/signal-jepa)

**Browser runtime cost:** see section 2. onnxruntime-web's WASM is about 2.4–4 MB Brotli-compressed, plus about 20–23 MB of fp32 weights for LaBraM or CBraMod. — [npm onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web), measured locally

### Inferences
- **TRIBE v2: browser use is impossible.** Its feature extractors alone are a 3B-parameter LLM plus a ViT-g video model.
- **TRIBE v2: precomputed replay is technically easy but should be ruled out:**
  - Precomputing its ~20k-vertex predictions for a few fixed clips would yield small arrays that could be mapped onto the jelly brain.
  - It is still the wrong choice. CC BY-NC conflicts with a site that has sponsors and checkout, so it is commercial.
  - "Predicted fMRI" shown on a 3D brain is exactly what visitors read as a "brain scan" or "mind-reading", which the site's rule forbids.
  - The YouTube-replay paper shows how easily its outputs are oversold.
  - This matches the project's existing note that TRIBE stays a research reference unless licensing is cleared (`.ai-memory/neural-mirror-research.md`).
- **NDT3 and POYO+: wrong inputs for the toy.** They decode behaviour (e.g. cursor or hand velocity) from *recorded* intracortical spikes. Feeding them spikes from the toy's simulator would be out of distribution and meaningless. NDT3 is also NC-licensed. Not usable.
- **EEG encoders (LaBraM, CBraMod, signal-JEPA): browser-sized but pointless here.**
  - Licensing is fine (MIT, BSD-3) and they fit in a browser after ONNX export, with a likely int8 quantization to about 5–6 MB (estimate).
  - Their only honest input is real EEG, and their output is an embedding or a fine-tuned label. The pretrained checkpoints carry no task head, so "what the model predicts" would need a separately fine-tuned classifier, e.g. motor imagery on PhysioNet.
  - That turns the toy into an EEG-classifier demo on recorded data. It is a separate product, not an upgrade to "Poke the Brain".
- **Honest model-flavoured alternative:** train a tiny surrogate model on the toy's *own simulator output*, e.g. predicting which region lights up next. Label it plainly as "a small neural net trained on this simulation". That keeps everything synthetic and honest, adds no licensing risk, and is cheap (KBs, plain JS or ORT CPU).

### Gaps
- POYO/POYO+ pretrained weights: hosting location, license and size were not found.
- Brain-JEPA: neither the code license nor the license of the UK Biobank-derived weights is stated in the README. UKB derivative-sharing terms were not checked.
- NDT2 license and checkpoints were not checked.
- No ONNX export or in-browser benchmark of LaBraM or CBraMod was found or run. The int8 size is an estimate.
- The original LaBraM and CBraMod weight licenses aren't stated separately from the MIT code licenses. braindecode's BSD-3 re-host label may reflect braindecode's wrapper rather than the original authors' terms; check before shipping.
- MEG foundation models were not researched.

## 4. Open EEG/MEG datasets: licenses, and whether a clearly labelled "recorded data replay" mode is compatible with the site's rule

### Takeaway
The data is legally easy to use: OpenNeuro is CC0 by default and PhysioNet's EEG Motor Movement/Imagery set is ODC-By 1.0, which requires attribution. The honesty problem is the real one. Any EEG shown inside or next to the 3D brain invites the reading "this is real brain activity". Scalp EEG channels also can't be honestly mapped onto the toy's 7 simulated regions. Keep replay out of the homepage hero. If it is ever built, put it on a separate, clearly labelled page that shows raw traces with attribution and never drives the simulated brain.

### Cited Findings
- **PhysioNet EEG Motor Movement/Imagery Dataset (eegmmidb v1.0.0):**
  - Contents: 64-channel EEG from **109 volunteers**, recorded with BCI2000. More than 1,500 recordings of 1–2 minutes each: eyes-open and eyes-closed baselines plus real and imagined fist and foot movements. Sampled at **160 Hz**, stored as **EDF+** with annotations.
  - **License: "Open Data Commons Attribution License v1.0"**. This is from a search snippet; physionet.org itself was blocked.
  - Citation: Schalk, G. (2009), doi:10.13026/C28G6P.
  - — [PhysioNet eegmmidb 1.0.0](https://physionet.org/content/eegmmidb/1.0.0/)
- **OpenNeuro:** datasets must be in BIDS format and are released under **CC0**, which "places no restrictions on who can use the data or what can be done with them". They become public after a grace period of up to 36 months, with up to two 6-month extensions. Uploaders must confirm ethics permission and that the data has no HIPAA-identifiable information. — [OpenNeuro FAQ](https://openneuro.readthedocs.io/faq.html), [eLife: The OpenNeuro resource](https://elifesciences.org/articles/71774v2), [Wikipedia: OpenNeuro](https://en.wikipedia.org/wiki/OpenNeuro)

### Inferences
- **Payload is not a problem.** By my arithmetic, one 2-minute eegmmidb run is 64 ch × 160 Hz × 120 s ≈ 1.23M samples, about 2.5 MB as int16 before compression.
- **Licensing is not a problem either.** CC0 needs nothing. ODC-By needs visible attribution and a dataset citation on the replay page.
- **The rule bans *claiming* the toy shows real data, which leaves room for a replay.** A replay on its own route, titled e.g. "Recorded EEG replay, PhysioNet eegmmidb, subject S001, recorded 2009", is truthful. Several risks still argue for avoiding it now:
  1. **Conflation.** Visitors who just poked a "brain" will assume the replay and the simulation are connected. Any visual bridge, such as the same jelly brain or region glow driven by EEG power, would effectively claim real neural activity in the toy, and would require inventing a channel-to-region mapping. Scalp EEG at 64 sites doesn't correspond to the toy's 7 simulated regions.
  2. **Brand risk.** BrainSNN has had to keep Neural Mirror explicitly `validatedAgainstNeuralData: false` (`.ai-memory/neural-mirror-research.md`). An EEG page muddies that line for little playful value: raw EEG looks like noise to lay visitors.
  3. **Mind-reading framing.** Motor-imagery data ("imagined fist movements") paired with a classifier is a short step from "the AI read their mind". That is exactly the forbidden claim.
- **If a replay is ever built, it needs these guardrails:**
  - Its own URL, never on the homepage.
  - Persistent "Recorded data, not this simulation" labelling and the ODC-By citation.
  - Raw time series or a 2-D scalp topography only, never mapped onto the 3D simulated brain.
  - No visitor-specific or "your brain" framing.
  - No classifier verdicts presented as mind-reading.
- **Better option for the hero:** stay 100% simulated, and make "real" mean the *wiring*, using a CC-BY connectome subset with attribution such as "wiring from FlyWire (CC-BY 4.0); activity is simulated". That gives real scientific grounding without ever implying recorded neural activity.

### Gaps
- The PhysioNet license text was confirmed only through a search snippet, because physionet.org was blocked. Verify it on the page before shipping.
- Individual OpenNeuro EEG/MEG datasets weren't surveyed. Some older datasets or those with special agreements may differ from the CC0 default, so check each dataset's `dataset_description.json` License field.
- Other EEG and MEG sources (TUH EEG Corpus, which needs a data use agreement; MOABB datasets; MNE sample data; the Cam-CAN MEG data-sharing agreement) were not checked within this budget.
