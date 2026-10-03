# Drosophila connectome resources (FlyWire, Shiu et al. LIF model, related fly datasets) as a "Poke the Brain" upgrade

Research date: 2026-10-03. Method: web search plus **hands-on measurement**. I downloaded the Shiu et al. FlyWire v783 connectivity table (100.8 MB), ported the Shiu LIF model to plain JavaScript, ran it in Node, built browser-sized subsets, and measured their size and speed.

Egress note: codex.flywire.ai, flywire.ai, zenodo.org, nature.com, virtualflybrain.org and Europe PMC were all **blocked by the sandbox egress proxy**. Facts that would normally come from those primary pages come from search-result summaries, GitHub repositories (raw.githubusercontent.com was reachable) or public GCS buckets (gsutil). Each such fact is flagged below.

Measurement machine: 4-core Intel Xeon @ 2.10 GHz, Node v22.22.0, single thread. All "measured" numbers come from scripts in `/tmp/claude-0/-home-user/f993ed11-e4c2-5085-b521-38064180b876/scratchpad/fly/`. That scratchpad is session-specific, so the regeneration recipe is copied into this file (see "How to regenerate the chosen subset").

---

## 1. FlyWire (FAFB v783): what is released, sizes, where, and under what licence

### Takeaway
FlyWire v783 is public: about 139k proofread neurons, a 15.1 M-edge / 54.5 M-synapse connectivity table, a roughly 130 M-synapse point table with neurotransmitter predictions, cell-type annotations, skeletons, and neuropil meshes. It is distributed via Codex, Zenodo and public GCS buckets. **The licence is the main risk.** Several sources say FlyWire data is **CC BY-NC 4.0 (non-commercial)**, and one third-party project says CC-BY 4.0. I could not open the primary licence page, so it must be confirmed before anything ships on a commercial site.

### Cited Findings
- The FlyWire v783 connectivity data was published on Zenodo on 2 June 2024 as "Version 783.0". Its main file, `flywire_synapses_783.feather`, is a pandas dataframe with "all ~130 million synapses, their locations, neurotransmitter predictions, and pre and postsynaptic partners". Data is also downloadable from Codex — [Zenodo 10676866 (via search summary; page blocked)](https://zenodo.org/records/10676866)
- Codex says the latest public release is v783, a snapshot from October 2023, and that all Codex data for snapshot 783 is publicly released. Data exports are at codex.flywire.ai/api/download — [Codex FAQ (via search summary; page blocked)](https://codex.flywire.ai/faq)
- Skeletons and NBLAST scores are on Zenodo record 10877326. The synapse table and edge list are on Zenodo record 10676866. Required citations for the annotations: Schlegel et al. 2024, Dorkenwald et al. 2024, Matsliah et al. 2024, and for newer annotations Berg et al. 2026 and Tastekin et al. 2026 — [flyconnectome/flywire_annotations README](https://github.com/flyconnectome/flywire_annotations)
- **Licence, non-commercial version:** "FlyWire data is licensed under CC BY-NC 4.0 (Attribution-NonCommercial 4.0 International)". Derived files "may be shared and adapted with attribution, for non-commercial use". Cite Dorkenwald et al. 2024 (Nature 634:124–138) and Schlegel et al. 2024 (Nature 634:139–152) — [desktop-fly DATA_LICENSE.md](https://github.com/DenisSergeevitch/desktop-fly/blob/master/data/DATA_LICENSE.md). The search summaries of the [Virtual Fly Brain FlyWire page](https://virtualflybrain.org/blog/2022/01/01/flywire-connectome-neurons-dorkenwald2023/) and the [Codex FAQ](https://codex.flywire.ai/faq) also give "CC-BY-NC 4.0" (both pages blocked, so not read directly).
- **Licence, conflicting version:** the webgpu-fly NOTICE says FlyWire "Connectivity and annotation tables are licensed CC-BY 4.0" — [webgpu-fly NOTICE](https://github.com/abgnydn/webgpu-fly/blob/main/NOTICE). This is the minority claim and comes from a third party.
- FlyWire also has its own [Terms of Service](https://flywire.ai/tos) and [citing guidelines](https://flywire.ai/guidelines). Both turned up in search, but I could not read them (blocked).
- Public GCS buckets, listed with `gsutil`:
  - Neuroglancer-precomputed neuropil meshes at `gs://flywire_neuropil_meshes/neuropils/neuropil_mesh_v141_v6/` (`info` + `mesh/`), with earlier versions v141 to v5.
  - A whole-brain neuropil shell at `gs://flywire_neuropil_meshes/whole_neuropil/brain_mesh_v3/`.
  - Codex data folders at `gs://flywire-data/codex/data/{fafb,banc,manc,mcns,maol}/`, plus `codex/skeletons/` and `codex/synapses/`.
  - Source: gsutil listing, this session. I did not measure file sizes; the recursive listing timed out.
- **Measured** from Shiu's repackaged v783 table `Connectivity_783.parquet` (100,804,642 bytes) and `Completeness_783.csv` (3,327,347 bytes) — [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model):
  - Neurons: 138,639.
  - Directed edges: 15,091,983. Synapses: 54,492,922.
  - Synapses per edge: median 2, mean 3.61, max 2,405.
  - Edges with ≥5 synapses: 2,700,513, carrying 34,153,566 synapses.
  - About 60% of edges are excitatory (the sign comes from the neurotransmitter prediction).
  - 99.945% of signed weights fit in int8 (|w| ≤ 127).
- The webgpu-fly and FlyBrain projects describe the same brain as 139,255 neurons with about 15 M edges, or 2.7 M connections after thresholding — [webgpu-fly README](https://github.com/abgnydn/webgpu-fly); [snedea/flybrain README](https://github.com/snedea/flybrain)

### Inferences
- The 616-neuron gap (139,255 vs 138,639) is probably Shiu's "Completeness" filter. Use "~139,000 neurons" in public copy.
- **Plan as if the licence is CC BY-NC 4.0 until a primary FlyWire/Codex page says otherwise.** brainsnn.com is a business site that seeks clients, so using FlyWire-derived data on its homepage could count as commercial use. Practical options:
  1. Get written permission from the FlyWire team (Princeton, Murthy/Seung labs).
  2. Use a CC-BY 4.0 Janelia dataset instead, such as MaleCNS v1.0 or hemibrain (see section 5).
  3. Keep the toy on a clearly non-commercial page.

  This needs a human decision.
- The 54.5 M synapses / 15.1 M edges table is the "no threshold" edge list. Most published counts ("~50 million synapses") match it.

### Gaps
- I could not read the actual licence text on codex.flywire.ai, flywire.ai/tos or Zenodo (proxy-blocked). This is the single most important open item.
- File sizes of the Codex CSV exports (neurons, classification, coordinates, connections with neuropil column, cell types, NT predictions) and of the neuropil meshes were not measured.
- Per-neuron 3D positions (soma or centroid coordinates) are **not** in the Shiu files. They come from Codex exports, which I did not verify (blocked).
- The commonly cited "78 neuropils" figure was not verified this session.

---

## 2. Shiu et al. (Nature 2024) LIF whole-brain model: code, licence, parameters, experiments, runtime, ports

### Takeaway
The model is small and simple: one LIF neuron per cell, an exponential/alpha synapse, a signed synapse-count weight, and a 1.8 ms delay. The code is **MIT-licensed**, and the repo ships ready-to-use v783 inputs (about 104 MB). A faithful port is about 40 lines of JS. I ported it, and it **reproduces the paper's headline result in Node**: sugar receptor activation drives MN9, the proboscis-extension motor neuron; bitter does not. Several browser ports (WASM/WebGPU) already exist.

### Cited Findings
- Repo `philshiu/Drosophila_brain_model`:
  - Licence: **MIT**, "Copyright (c) 2023 Philip Shiu and Nico Spiller" — [LICENSE](https://github.com/philshiu/Drosophila_brain_model/blob/main/LICENSE)
  - Built on Brian 2.
  - Supports activation (Poisson spiking at a fixed rate) and silencing (zeroing all synapses to and from a neuron).
  - The paper used FlyWire v630; config switches to public v783 via `Completeness_783.csv` and `Connectivity_783.parquet`.
  - Raw model output is "several GB", archived at doi:10.17617/3.CZODIW.
  - Source: [README](https://github.com/philshiu/Drosophila_brain_model/blob/main/Readme.md)
- Model parameters, from `default_params` in [model.py](https://github.com/philshiu/Drosophila_brain_model/blob/main/model.py):

  | Parameter | Value |
  |---|---|
  | Resting / reset potential | −52 mV |
  | Threshold | −45 mV |
  | Membrane time constant | 20 ms |
  | Synaptic time constant | 5 ms |
  | Refractory period | 2.2 ms |
  | Synaptic delay | 1.8 ms |
  | Weight per synapse (`w_syn`) | 0.275 mV, times the signed synapse count (`Excitatory x Connectivity`) |
  | Poisson input weight | 250 × w_syn (forces a spike) |
  | Trial length × trials | 1000 ms × 30 trials |

  Equations: `dv/dt=(v_0 - v + g)/t_mbr`, `dg/dt=-g/tau`; on spike, `g += w`.
- Experiments in the repo notebooks — [example.ipynb](https://github.com/philshiu/Drosophila_brain_model/blob/main/example.ipynb); [figures.ipynb](https://github.com/philshiu/Drosophila_brain_model/blob/main/figures.ipynb):
  - Activate 21 right-hemisphere labellar sugar GRNs at 10–200 Hz and read out MN9 (`720575940660219265`).
  - Silencing screens over the top 200 responders.
  - Sugar × bitter (21 GRNs) and sugar × Ir94e (18 GRNs) frequency grids.
  - Water GRNs (18 neurons).
- Paper: "A Drosophila computational brain model reveals sensorimotor processing", Nature 2024. A LIF model of the whole central brain ("more than 125,000 neurons and 50 million synaptic connections") studying feeding and antennal grooming. Predictions were validated by optogenetic activation and behaviour — [Nature s41586-024-07763-9 (via search summary; page blocked)](https://www.nature.com/articles/s41586-024-07763-9); [bioRxiv preprint](https://www.biorxiv.org/content/10.1101/2023.05.02.539144.full.pdf)
- Press coverage says the Shiu study validated behaviour-encoding connections "with 91–95% accuracy", falling to about 1% with scrambled wiring — [Yahoo/press summary of Eon Systems](https://tech.yahoo.com/science/articles/scientists-upload-complete-fruit-fly-183733167.html). This is a secondary source; I did not confirm it in the paper.
- **Runtime, published by others:**
  - An MLX/Metal port runs the 127,400-neuron, 14,687,178-connection v630 model at **0.29 s per biological second on an M4 Pro**, versus **2.07 s in Brian2** on the same machine — [Kisame76/drosophila-brain-mlx (search summary)](https://github.com/Kisame76/drosophila-brain-mlx)
  - webgpu-fly measured, on an M2 Pro: NEST 3.10 at 0.67 kHz of biological time, hand-written multicore Rust at 0.45 kHz, WebGPU at 0.25 kHz, i.e. "4× slower than real time" — [webgpu-fly README](https://github.com/abgnydn/webgpu-fly)
- **Runtime, measured here** (my JS port, single thread, full 138,639-neuron / 15.09 M-edge v783 graph, dt = 0.1 ms):
  - **Naive loop** (every neuron, every step): 0.95–1.18 ms per step, i.e. 9.5–11.8 s per simulated second.
  - **Event-driven** (only neurons with non-resting state are updated):

    | Stimulus | µs per step | s per sim-second | Mean neurons updated per step | Neurons that spike | MN9 rate |
    |---|---|---|---|---|---|
    | Sugar 150 Hz | 162 | 1.62 | 9,753 | 384 | 106 Hz |
    | Sugar 100 Hz | 125 | 1.25 | – | – | 74 Hz |
    | Sugar 50 Hz | 59 | – | – | – | 13 Hz |
    | Sugar 200 Hz | 194 | – | – | – | 120 Hz |
    | Bitter 150 Hz | 58 | – | – | 72 | **0 Hz** |

  - The graded sugar→MN9 response, and no response to bitter, matches the paper's qualitative claim.
- Sanity-check lesson (measured): my first build paired weights with the wrong edges (weights taken before sorting by presynaptic neuron). MN9 then stayed at 0 Hz while everything else looked plausible. **"Sugar → MN9 > 0 Hz and bitter → MN9 = 0 Hz" should be a unit test in any port.**
- Existing ports:
  - Lulzx/fly-brain: LIF in JS, WASM and WebGPU (`src/lif.js`, `lifwasm.js`, `lifgpu.js`) — [Lulzx/fly-brain](https://github.com/Lulzx/fly-brain)
  - webgpu-fly: WebGPU, one fused LIF kernel per timestep. Its `w_syn` was retuned for Kenyon-cell sparsity and it says it is "not … an independent validation of Shiu et al." — [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
  - snedea/flybrain: JS Web Worker over 2.7 M connections — [snedea/flybrain](https://github.com/snedea/flybrain)
  - gianlucamazza/flymsg: Shiu-style spiking model of MaleCNS v1.0 — [gianlucamazza/flymsg (search summary)](https://github.com/gianlucamazza/flymsg)

### Inferences
- The full brain is not out of reach for compute. An event-driven JS loop runs at about 0.6× real time on one worker thread, even on a 2.1 GHz server core. **Download size is the blocker** (section 3), not CPU.
- The model has no gap junctions, no neuromodulation and zero spontaneous activity (search summary of the paper). With no input, nothing happens, so the toy must inject Poisson drive into named sensory neurons. That maps neatly onto "poke".

### Gaps
- I could not open the Nature full text (blocked), so the exact validation statistics and the grooming-circuit details are unverified. The repo notebooks only cover the gustatory (feeding) experiments.
- I did not reproduce the 30-trial averages exactly. I ran 1 trial per condition, with seeds 1–13.

---

## 3. Which subset is browser-feasible: sizes and per-step compute (all measured)

### Takeaway
**Recommended subset: `hop2_all`, 2,621 neurons and 195,759 edges, 0.29 MB brotli / 0.38 MB gzip.**
- It is built from neurons up to two strong hops downstream of the sugar and bitter GRNs plus MN9, keeping all edges among them.
- It reproduces the full-brain result: sugar 150 Hz gives MN9 at 109 Hz (full brain: 106 Hz); bitter gives 0 Hz.
- It runs at about 23 µs per 0.1 ms step in JS, so real-time simulation costs about 3.8 ms of CPU per 60 fps frame.

`hop2_thr5` (55,557 edges, 0.11 MB brotli, MN9 96 Hz) is a lighter fallback. Top-N-by-degree subsets do **not** preserve the feeding response unless N ≥ about 20k.

### Cited Findings
All rows below are measured with `subsets.py`, `sizes.js` and `lif2.js` on [Connectivity_783.parquet](https://github.com/philshiu/Drosophila_brain_model).
- Packed format: uint32 row pointers (n+1), then post indices (uint16 if n < 65,536, else int32), then int16 signed weights.
- Compression: gzip level 9 and brotli quality 11 (Node zlib).
- Simulation: sugar GRNs at 150 Hz, 1,000 ms, one trial.

| Subset | Neurons | Edges | Raw MB | gzip MB | brotli MB | MN9 (sugar 150 Hz) | µs/step | ms per sim-s |
|---|---|---|---|---|---|---|---|---|
| full (no threshold) | 138,639 | 15,091,983 | 91.11 | 48.34 | 31.71 | 106 Hz | 162 | 1,619 |
| thr5 (all neurons, edges ≥5 syn) | 138,639 | 2,700,513 | 16.76 | 9.57 | 6.56 | 92 Hz | 63 | 625 |
| **hop2_all** | **2,621** | **195,759** | **0.79** | **0.38** | **0.29** | **109 Hz** (bitter: 0 Hz) | **23** (bitter 29) | **226** |
| hop2_thr5 | 2,621 | 55,557 | 0.23 | 0.13 | 0.11 | 96 Hz | 19 | 189 |
| responsive (spiked in sugar/bitter runs) | 474 | 21,773 | 0.09 | 0.04 | 0.03 | 95 Hz (bitter: 0 Hz) | 8 | 83 |
| top2000 by synapse degree (+stim, MN9) | 2,040 | 154,712 | 0.63 | 0.30 | 0.23 | **0 Hz** | 4 | 45 |
| top2000_thr5 | 2,040 | 62,291 | 0.26 | 0.14 | 0.11 | not run | – | – |
| top5000 | 5,040 | 546,436 | 2.21 | 1.18 | 0.84 | 25 Hz | 16 | 163 |
| top5000_thr5 | 5,040 | 189,807 | 0.78 | 0.48 | 0.36 | not run | – | – |
| top10000 | 10,040 | 1,373,485 | 5.53 | 3.19 | 2.15 | 44 Hz | 33 | 329 |
| top10000_thr5 | 10,040 | 414,946 | 1.70 | 1.11 | 0.81 | 71 Hz | 21 | 211 |
| top20000 | 20,040 | 2,984,849 | not sized | – | – | 100 Hz | 63 | 628 |
| top20000_thr5 | 20,040 | 803,688 | 3.29 | 2.23 | 1.60 | not run | – | – |
| top40000 | 40,036 | 6,002,453 | not sized | – | – | 96 Hz | 90 | 901 |
| top40000_thr5 | 40,036 | 1,393,239 | 5.73 | 3.97 | 2.89 | not run | – | – |

- Downstream reach from the 43 seeds (21 sugar GRNs, 21 bitter GRNs, MN9) over edges with ≥5 synapses: 175 neurons cumulative after 1 hop, **2,621 after 2 hops**, 19,598 after 3 hops (measured).
- For comparison, existing whole-brain browser demos download far more:
  - fly-brain viewer about 30 MB, arena about 23 MB (built from "the raw 10 GB of Janelia tables" down to 27 MB) — [Lulzx/fly-brain](https://github.com/Lulzx/fly-brain)
  - webgpu-fly `brain.bin` 120 MB plus `vnc.bin` 43 MB, served from R2 because Cloudflare Pages caps files at 25 MB — [webgpu-fly](https://github.com/abgnydn/webgpu-fly)

### Inferences
- **Per-frame cost for hop2_all:**
  - Real-time simulation is 10,000 steps per second, about 167 steps per 60 fps frame. At about 23 µs per step that is about 3.8 ms per frame on a 2.1 GHz server core.
  - Slow motion (for example 0.25× real time, which is easier to watch) would be about 1 ms per frame.
  - It should run in a Web Worker, or even on the main thread, alongside the three.js scene.
- **Rendering cost for hop2_all:**
  - 2,621 neurons fit easily in one InstancedMesh or Points draw call.
  - Spikes are sparse: about 330 spiking neurons, about 15k spikes per simulated second at 150 Hz drive.
- **Bundle impact for hop2_all:** about 0.3–0.4 MB of compressed connectivity, plus IDs and positions (not yet built).
  - Storing 2,621 FlyWire IDs as int64 is 21 KB raw.
  - xyz as float32 is 31 KB raw, or about 16 KB as uint16. The coordinates themselves must come from Codex (gap).
  - Lazy-loaded with the existing three.js chunk, this is well under 1 MB.
- `hop2_thr5` cuts size by about 3× with a modest drop in MN9 rate (96 vs 106 Hz). Using int8 weights (99.9% of edges fit) would shave a further ~25% (not measured).
- The `responsive` set (474 neurons, 30 KB) is the smallest faithful circuit, but it is circular: it only contains neurons that already spiked for sugar or bitter. Any other "poke" would look dead. `hop2_all` is the honest minimum for a pokeable gustatory/feeding circuit.
- To support more poke targets (water, Ir94e, antennal grooming, and so on), add their sensory neuron IDs to the seed list and rebuild. Size grows roughly with the 2-hop reach of the seeds.
- Two other routes:
  - **Whole-brain at reduced fidelity:** `thr5` is 6.6 MB brotli, 63 µs/step, and MN9 still fires at 92 Hz. This is plausible for an opt-in "full brain" mode, but too heavy for the homepage hero.
  - **Neuropil-level aggregation:** a roughly 78×78 matrix would be a few KB. It discards the single-neuron spiking that makes the claim "real", and it needs a neuropil-annotated edge list from Codex, which I did not obtain.

### Gaps
- I did not benchmark in a real browser (V8 in Node should be close). I did not run a WebGPU version myself.
- Positions and cell-type labels for the subset were not pulled (Codex blocked). These are needed for 3D layout and labels such as "sugar GRN", "MN9" and "proboscis motor neuron".
- Neuropil mesh file sizes were not measured.

### How to regenerate the chosen subset (`hop2_all`)
Working files: `/tmp/claude-0/-home-user/f993ed11-e4c2-5085-b521-38064180b876/scratchpad/fly/`, containing `prep.py`, `subsets.py`, `lif2.js`, `sizes.js`, and the output folders `hop2_all/` and so on. These may not survive the session, so here is the full recipe:

1. Download the data (MIT code repo; the data is FlyWire-derived, so the section 1 licence applies):
   ```
   curl -LO https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Connectivity_783.parquet   # 100.8 MB
   curl -LO https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Completeness_783.csv       # 3.3 MB
   pip install pandas pyarrow numpy
   ```
2. Column meanings in `Connectivity_783.parquet`:
   - `Presynaptic_Index` and `Postsynaptic_Index` are row numbers in `Completeness_783.csv`. Neuron i has FlyWire root ID `Completeness.index[i]`; I verified that this matches `Presynaptic_ID`/`Postsynaptic_ID` for all rows.
   - `Connectivity` is the synapse count.
   - `Excitatory x Connectivity` is the signed weight in synapse units.
3. Seeds:
   - Sugar GRNs (21): 720575940624963786, 720575940630233916, 720575940637568838, 720575940638202345, 720575940617000768, 720575940630797113, 720575940632889389, 720575940621754367, 720575940621502051, 720575940640649691, 720575940639332736, 720575940616885538, 720575940639198653, 720575940620900446, 720575940617937543, 720575940632425919, 720575940633143833, 720575940612670570, 720575940628853239, 720575940629176663, 720575940611875570
   - Bitter GRNs (21): 720575940621778381, 720575940602353632, 720575940617094208, 720575940619197093, 720575940626287336, 720575940618600651, 720575940627692048, 720575940630195909, 720575940646212996, 720575940610483162, 720575940645743412, 720575940627578156, 720575940622298631, 720575940621008895, 720575940629146711, 720575940610259370, 720575940610481370, 720575940619028208, 720575940614281266, 720575940613061118, 720575940604027168
   - MN9: 720575940660219265
   - All from Shiu's `figures.ipynb`.
4. Build the subset (this is the hop2 logic of `subsets.py`):
   ```python
   import pandas as pd, numpy as np
   c = pd.read_parquet('Connectivity_783.parquet')
   ids = pd.read_csv('Completeness_783.csv', index_col=0).index.values.astype(np.int64)
   id2i = {v: i for i, v in enumerate(ids)}
   seeds = [id2i[x] for x in SUGAR + BITTER + [720575940660219265]]
   e5 = c[c.Connectivity >= 5]                       # hop expansion uses strong edges only
   keep, frontier = set(seeds), set(seeds)
   for _ in range(2):                                # HOPS = 2  -> 2,621 neurons
       nxt = set(e5[e5.Presynaptic_Index.isin(frontier)].Postsynaptic_Index) - keep
       keep |= nxt; frontier = nxt
   nodes = np.array(sorted(keep)); remap = -np.ones(len(ids), np.int64); remap[nodes] = np.arange(len(nodes))
   m = np.isin(c.Presynaptic_Index, nodes) & np.isin(c.Postsynaptic_Index, nodes)   # keep ALL edges (any count); use & (c.Connectivity>=5) for hop2_thr5
   pre, post = remap[c.Presynaptic_Index[m]], remap[c.Postsynaptic_Index[m]]
   w = c['Excitatory x Connectivity'][m].values
   o = np.lexsort((post, pre)); pre, post, w = pre[o], post[o], w[o]   # sort FIRST, then take w from the same order
   ptr = np.zeros(len(nodes) + 1, np.int64); np.add.at(ptr, pre + 1, 1); ptr = np.cumsum(ptr)
   open('packed.bin', 'wb').write(ptr.astype(np.uint32).tobytes() + post.astype(np.uint16).tobytes()
                                  + np.clip(w, -32768, 32767).astype(np.int16).tobytes())
   ids[nodes].tofile('ids.bin')                      # FlyWire root IDs for labels/positions
   ```
   Expected output: 2,621 neurons, 195,759 edges, `packed.bin` = 793,524 bytes (0.29 MB brotli).
5. Simulator (port of Shiu's `model.py`; `lif2.js` in the scratchpad):
   - dt = 0.1 ms, exact integration:
     - eT = exp(−dt/20), et = exp(−dt/5), k = (5/(5−20))·(et − eT)
     - per step: v ← −52 + (v + 52)·eT + g·k, then g ← g·et
   - Spike when v > −45: reset v = −52, g = 0, refractory 22 steps.
   - Delivery: g[post] += w·0.275 mV, delayed 18 steps via a 19-slot ring buffer of spike lists.
   - Poke: each step, each stimulated neuron gets +68.75 mV with probability rate·dt (Poisson). Stimulated neurons have no refractory period.
   - Event-driven: keep an "active" list of neurons whose |g| or |v + 52| > 1e-3, and update only those.
6. Validate with `node lif2.js hop2_all 150 1000 13 sugar`. Expect MN9 at about 100–110 Hz. The same command with `bitter` should give MN9 = 0 Hz. Make this a CI test.

---

## 4. Existing browser visualizations and simulations of the fly brain

### Takeaway
"Real fly connectome in the browser" has been done several times since 2025–26: WASM/WebGPU whole-brain LIF with MuJoCo bodies, and JS Web Worker demos. They download 20–160 MB and target dedicated pages, not a homepage hero. Eon Systems' March 2026 embodied fly drew wide press attention. BrainSNN's possible angle is a **tiny, validated, honest** feeding circuit (<0.5 MB) with a visible checkable outcome (MN9 / proboscis extension), not "the whole brain".

### Cited Findings
- **Lulzx/fly-brain:**
  - Embodied whole-CNS simulation of MaleCNS v1.0 (165,122 neurons, 104 M synapses) as a spiking brain in a MuJoCo flybody, with a flyvis compound eye.
  - Viewer about 30 MB, arena about 23 MB. It documents which behaviours come from the wiring and which are added by code.
  - MIT code. Connectome CC-BY 4.0, flybody Apache-2.0, flyvis MIT.
  - Sources: [README](https://github.com/Lulzx/fly-brain); [sources.md](https://github.com/Lulzx/fly-brain/blob/main/docs/guide/sources.md)
- **webgpu-fly:**
  - FlyWire brain (139,255 neurons, ~15 M edges) plus Janelia MANC spine (23,188 neurons, 5.2 M edges) as WebGPU LIF, with a flybody MuJoCo/WASM body. Keys fire named descending neurons.
  - Candid limitations: "Not quantitatively validated", "runs slower than real time"; locomotion is a hand-written tripod gait.
  - About a 9 MB JS+WASM bundle plus large data files on R2.
  - Source: [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
- **snedea/flybrain (flybrain.app):** 139,255 neurons and 2.7 M connections (FlyWire v783) in a Web Worker, with a WebGL strip of all neurons. Behaviour (food seeking, startle) is driven by the simulation; it is wrapped in a Workday-agent demo. MIT code — [snedea/flybrain](https://github.com/snedea/flybrain)
- **desktop-fly:** ships FlyWire-derived `brain_points.json` and `circuit.json` under CC BY-NC 4.0 — [desktop-fly](https://github.com/DenisSergeevitch/desktop-fly/blob/master/data/DATA_LICENSE.md)
- **motg-flywire:** a "3D explorer of the FlyWire fruit fly connectome" — [zack-maz/motg-flywire](https://github.com/zack-maz/motg-flywire) (not inspected).
- **Eon Systems (7 March 2026):**
  - Announced an emulated FlyWire whole brain ("139,255 neurons and 50 million synapses") driving a MuJoCo fly body, with grooming and sugar-triggered feeding — [Yahoo/press](https://tech.yahoo.com/science/articles/scientists-upload-complete-fruit-fly-183733167.html); [Eon update](https://eon.systems/updates/embodied-brain-emulation); [ISPR](https://ispr.info/2026/04/21/researchers-upload-model-of-flys-brain-to-matrix-let-it-control-virtual-body/)
  - webgpu-fly describes it as "server-side and closed" — [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
- Other embodied models named by webgpu-fly: NeuroMechFly v2 / flygym (Nature Methods 2024, Python), FlyGM (arXiv 2602.17997), and flybody (Vaxenburg et al., Nature 2025, Apache-2.0) — [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
- FlyWire's own viewers (Codex, neuroglancer) serve neuroglancer-precomputed meshes from public GCS. The neuropil meshes are at `gs://flywire_neuropil_meshes/neuropils/neuropil_mesh_v141_v6/` (gsutil listing, this session).

### Inferences
- Because Eon and the whole-brain demos exist, "first fly brain in a browser" claims are off the table. "A pocket-sized, checkable slice of a published fly-brain model, on our homepage" is defensible.
- For a brain silhouette, the FlyWire whole-neuropil mesh (`brain_mesh_v3`) could be decimated to a small GLB. Its size is unmeasured; it needs a neuroglancer-precomputed-to-GLB conversion.

### Gaps
- I did not load any of these demos in a browser, so there are no fps or first-load timings of my own.
- I did not inspect the Codex web viewer's asset sizes, or Virtual Fly Brain's browser (blocked).

---

## 5. Other fly datasets: what each adds, licences

### Takeaway
The Janelia datasets (hemibrain, MANC, MaleCNS v1.0) are reported as **CC-BY 4.0**. That makes them the commercially safer choice if FlyWire is confirmed as NC. MaleCNS v1.0 already has a Shiu-style spiking port. BANC adds brain plus nerve cord in one female fly. The larval connectome is tiny (about 3k neurons) and would fit whole in a browser.

### Cited Findings
- **MaleCNS v1.0** (Janelia FlyEM and Google Research): CC-BY 4.0, 165,122 neurons, 104 M synapses — [Lulzx sources.md](https://github.com/Lulzx/fly-brain/blob/main/docs/guide/sources.md); [desktop-fly DATA_LICENSE](https://github.com/DenisSergeevitch/desktop-fly/blob/master/data/DATA_LICENSE.md)
  - Shiu-style LIF ports of MaleCNS exist: [flymsg](https://github.com/gianlucamazza/flymsg); [drosophila-brain-mlx](https://github.com/Kisame76/drosophila-brain-mlx), which supports v630 and MaleCNS v1.0.
- **MANC** (male adult nerve cord, June 2023): about 23,000 neurons, 10 M presynaptic sites, 74 M postsynaptic densities — [Janelia MANC page (search summary)](https://www.janelia.org/manc-connectome)
  - Licence: "Licensed CC-BY 4.0" — [webgpu-fly NOTICE](https://github.com/abgnydn/webgpu-fly/blob/main/NOTICE)
  - A webgpu-fly build is 23,188 neurons and 5.2 M edges; the pull is about 88 MB from Janelia GCS, giving a 43 MB `vnc.bin` — [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
- **BANC** (Brain And Nerve Cord, a single female fly, FlyWire-hosted):
  - 158,262 neurons; available in Codex — [FlyWire blog: The BANC](https://blog.flywire.ai/?p=1823); [Neuroscience News](https://neurosciencenews.com/fly-central-nervous-system-connectome-30840/)
  - Synapse-count summaries conflict: "more than three million synaptic connections" versus "around 40 million" in the same search summary. Treat both as unverified.
  - Published in Nature "June 8" (year not confirmed in the snippet).
  - A Codex folder exists at `gs://flywire-data/codex/data/banc/` (gsutil).
- **Larval connectome** (Winding et al., Science 379, eadd9330, 10 March 2023): 3,016 neurons, 548,000 synapses — [NSF PAR copy (search summary)](https://par.nsf.gov/servlets/purl/10422064)
- Codex also hosts `mcns` (MaleCNS) and `maol` (likely male optic lobe) folders — [gsutil listing of gs://flywire-data/codex/data/] (this session).

### Inferences
- If the FlyWire licence is confirmed NC and BrainSNN counts as commercial, the same pipeline (seed sensory neurons → 2-hop subgraph → LIF) could be rerun on **MaleCNS v1.0 (CC-BY 4.0)**.
  - It would need the MaleCNS equivalents of the sugar GRNs and MN9 (matched by cell type), plus neurotransmitter signs.
  - The Shiu-on-MaleCNS ports suggest this is tractable, but I did not validate sugar→MN9 on MaleCNS.
- At 3,016 neurons and 548k synapses, the larval brain could be simulated whole in a browser at about `hop2_all` cost. I found no published larval LIF behavioural validation comparable to Shiu's in this pass.

### Gaps
- I did not find the hemibrain licence or size in this pass (it is believed to be CC-BY 4.0; unverified).
- The BANC licence and synapse count were not verified.
- The larval data licence was not found.
- None of the Janelia licence pages were read directly; the CC-BY claims come from third-party project NOTICE/licence files.

---

## 6. Honest wording: what can and cannot be claimed

### Takeaway
Defensible claim: "**A simulation of a published fruit-fly wiring diagram.** About 2,600 real neurons from the FlyWire adult fly brain connectome, run with the Shiu et al. (Nature 2024) spiking model; activate the sugar-taste neurons and watch the signal reach the motor neuron that, in the model and in experiments, drives proboscis extension."

Do not claim: a "real brain", "the whole fly brain", a "brain upload", "what the fly feels/thinks", or that the toy's activity is recorded neural data.

### Cited Findings
- The Shiu model is a LIF network built from connectivity plus predicted neurotransmitter identity, with simplifications (search summary of the paper — [Nature](https://www.nature.com/articles/s41586-024-07763-9)):
  - zero basal firing
  - no gap junctions
  - no neuromodulation beyond excitation/inhibition
- Its validated domain is feeding initiation (sugar/water GRNs → MN9 / proboscis extension) and antennal grooming. Predictions were validated by optogenetics and behaviour — [Nature (search summary)](https://www.nature.com/articles/s41586-024-07763-9); [figures.ipynb](https://github.com/philshiu/Drosophila_brain_model/blob/main/figures.ipynb)
- The webgpu-fly authors model the right register. They state "Not quantitatively validated", "Not biophysically detailed" and that `w_syn` was tuned, and they list every approximation — [webgpu-fly](https://github.com/abgnydn/webgpu-fly)
- Measured here: in the 2,621-neuron subset, sugar drive gives MN9 at 109 Hz and bitter gives 0 Hz, matching the full 138,639-neuron model (106 Hz / 0 Hz) within one-trial noise.
- Attribution: if FlyWire data is used, cite Dorkenwald et al. 2024 and Schlegel et al. 2024, and credit Shiu et al. 2024 plus the MIT code — [desktop-fly DATA_LICENSE](https://github.com/DenisSergeevitch/desktop-fly/blob/master/data/DATA_LICENSE.md); [flywire_annotations](https://github.com/flyconnectome/flywire_annotations); [Shiu LICENSE](https://github.com/philshiu/Drosophila_brain_model/blob/main/LICENSE)

### Inferences
- Suggested label: "Simulation · 2,621 neurons from the FlyWire fruit-fly connectome (v783), Shiu et al. 2024 LIF model. Not recorded activity; a simplified model of a subset of the brain." Add a "what's real / what's simplified" popover, similar to webgpu-fly's list.
- Be explicit that the subset was chosen around taste circuits. Poking neurons outside the seeded circuits is out of scope, so the UI should only offer validated poke targets (sugar, bitter, optionally water) rather than "poke anywhere".
- Because spontaneous activity is zero, an idle brain will be silent. Any ambient shimmer must be labelled as decorative or as background Poisson drive.

### Gaps
- Nobody has confirmed that a 2-hop subset is an acceptable "published model" representation. It is my construction. It matches the full-model MN9 output for the two tested stimuli but has not been reviewed by the authors.
- The licence must be verified (section 1) before any public claim that the data is used "with permission" or "openly licensed".
