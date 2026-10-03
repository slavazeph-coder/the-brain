# Borrow real wiring, keep sparks simulated

Brain2Qwerty can't upgrade Poke the Brain. Meta released its training code and a 262 GB MEG/EEG dataset under CC BY-NC 4.0, but no trained weights. The model only decodes sentences that a volunteer types while sitting in a lab MEG scanner, so the most it can honestly add is a clearly labelled "real research, not this toy" card away from the hero. TRIBE v2, NDT3 and the EEG foundation models get the same verdict for one of three reasons: they are non-commercial, too big for a browser, or they need real recordings that a visitor doesn't have. None of them produces anything that maps honestly onto the toy's seven regions.

The open resources that do fit share one pattern: real wiring with simulated activity. The best of them is the Shiu et al. (Nature 2024) fruit-fly spiking model. Its code is MIT-licensed. This research cut a **2,621-neuron feeding circuit** from the FlyWire connectome, which weighs **0.29 MB Brotli-compressed** and costs **23 µs per simulation step**. It reproduces the paper's headline result: sugar drives the proboscis motor neuron MN9 at **109 Hz**, against 106 Hz in the full 138,639-neuron brain, and bitter leaves MN9 silent.

**Build that first**, as a lazy-loaded second specimen next to the human jelly brain, with one gate before launch. FlyWire data is probably non-commercial, and a site that funnels visitors to sponsors can't assume it is allowed to use it. Email FlyWire for permission the day work starts, and keep Janelia's CC BY 4.0 MaleCNS connectome as the fallback. In the same sprint, three cheap hero upgrades make the existing brain easier to defend without weakening its promise that it's a simulation: a 7×7 pathway table from CC BY tractography, region meshes from an Allen atlas licensed CC BY, and a "what's real / what's simplified" popover.

## Four tests sort a dozen resources into three piles

Every candidate was judged on four questions:

1. **Is it released?** What can actually be downloaded today?
2. **Does the licence allow this site?** brainsnn.com sends visitors to a sponsor page and to enterprise builds, and score cards carry a sponsor line (`/home/user/the-brain/CONTENT-PLAYBOOK.md`).
3. **Is it light enough?** Can it ride along with a homepage hero that is already careful with its three.js budget?
4. **Can it be shown honestly?** The house rule is "Say 'simulation'. Never say 'real brain', 'neural data', 'EEG', 'brain scan' or 'reads your mind'" (`/home/user/the-brain/CONTENT-PLAYBOOK.md`).

Brain decoders and encoders each fail at least two of these. Connectomes and atlases pass the size and honesty tests easily, which leaves the licence as the only thing that limits them.

| Resource | What is actually released | Licence | Browser cost | Verdict for the toy |
|---|---|---|---|---|
| Brain2Qwerty v1/v2 (Meta) | Training code; v1 MEG/EEG data (~262 GB); **no weights**; v2 data embargoed | CC BY-NC 4.0 | Can't run: no weights, needs a lab MEG recording, v2 adds a 1.1B-parameter LLM | Explainer card only, off the hero |
| TRIBE v2 (Meta) | Code plus 3 checkpoints (613–709 MB) | CC BY-NC 4.0; its text feature extractor is gated Llama 3.2 | Can't run live (2.1–4.8B parameters of feature extractors); pre-computed playback is a few KB | Research drawer only; its cortical output can honestly drive just 2 of the 7 regions |
| NDT3, POYO+, Brain-JEPA | Checkpoints or code for decoding recorded spikes or fMRI | NDT3 CC BY-NC; others unclear | Needs recorded input | No |
| LaBraM, CBraMod, signal-JEPA | EEG encoders, 3.5–5.8M parameters, ~20 MB | BSD-3 / MIT | Feasible with onnxruntime-web (+2.4–4 MB) | Wrong input (needs real EEG); a separate product |
| PhysioNet eegmmidb, OpenNeuro | Recorded EEG/MEG | ODC-By 1.0 / CC0 | ~2.5 MB per 2-minute run | Never on the hero; never drives the 3D brain |
| **FlyWire v783 + Shiu LIF model** | ~139k-neuron connectome; MIT simulator with packaged inputs | Code MIT; data **probably CC BY-NC** (unconfirmed) | 2,621-neuron circuit: 0.29 MB, 23 µs/step (measured) | **Build first, after the licence is cleared** |
| MaleCNS v1.0 (Janelia) | 165,122-neuron connectome | CC BY 4.0 (per third-party projects) | Same pipeline; not yet measured | Fallback for the fly |
| C. elegans (Cook 2019, Witvliet 2021) | 302-neuron wiring; 8 developmental stages; MIT tooling | No data licence stated | ~17 KB gzip (measured) | Strong second specimen |
| Allen Human Reference Atlas 3D | 141-structure human parcellation; GLB derivative | CC BY 4.0 | Est. 100–250 KB after decimation | Region meshes for the hero |
| Škoch 2022 / ENIGMA | Group-average structural connectivity | CC BY 4.0 / HCP terms | 49 numbers once collapsed to 7×7 | Re-weight the hero's pathways |
| H01 / MICrONS | Petascale EM data; single-neuron skeletons | CC BY 4.0 | A few KB per neuron | "One real neuron" easter egg |
| Allen mouse CCF, MouseLight, zebrafish Fish1/mapZebrain | Atlases and reconstructions | Noncommercial terms | Varies | Avoid for now |

The pattern is consistent enough to adopt as a design rule. Anything that outputs *activity* (decoded text, predicted fMRI, EEG embeddings) brings with it an implied claim about real brains. Anything that supplies *structure* (wiring, meshes, pathway weights) lets the toy stay a simulation and still point at real science.

## Brain2Qwerty decodes typing in a lab scanner and ships no weights

Brain2Qwerty reconstructs the sentence a healthy volunteer types while sitting in a MEG scanner.

- **v1** was tested on 35 volunteers. It reached a **32% character error rate with MEG** and 67% with EEG, and 19% for the best participants ([arXiv 2502.17480](https://arxiv.org/abs/2502.17480)). It needs the timing of every keypress, so it "could not work in real time" ([project page source](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/index.html)).
- **v2** decodes continuous recordings. It uses a convolutional + Conformer encoder with a character-level CTC head, and a LoRA-adapted TinyLlama-1.1B that writes out the sentence ([v2 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v2/README.md); [xp_config.py](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v2/config/xp_config.py)). It was trained on **22,000 sentences from nine subjects, 10 hours each**, and reached a **39% word error rate** ([v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)). The project page states this as **61% of words right on average and 78% for the best participant**, and adds its own caveat that "decoding performance is not yet good enough for everyday use" with "a large scanner — i.e. a setup inaccessible to most patients" ([Brain2Qwerty project page](https://facebookresearch.github.io/brain2qwerty/)).

What is released is narrower than the press coverage suggests:

- **Code:** full training code for both versions, under **CC BY-NC 4.0** ([repo](https://github.com/facebookresearch/brain2qwerty)).
- **Weights:** **no checkpoints at all.** The READMEs only describe training your own model, on 8 GPUs by default ([v1 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v1/README.md)).
- **v1 data:** about 262 GB of MEG and EEG, under CC BY-NC 4.0 ([HF SpanishBCBL](https://huggingface.co/datasets/bcbl190626/SpanishBCBL)).
- **v2 data:** under embargo "until the paper acceptation" ([repo](https://github.com/facebookresearch/brain2qwerty)).
- **Pre-computed results:** the only browser-ready file is an 843-row CSV of true versus decoded sentences, which powers the project page's results explorer ([CSV](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/assets/best_complete_predictions.csv)). It covers only "the three best subjects" ([results-explorer.js](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/src/results-explorer.js)). By this research's count its mean WER is 0.264, against 0.39 across all nine subjects. The README says only "the code" is CC BY-NC, so the CSV's licence is ambiguous.

That combination rules out a feature. There are no weights to export. Even with weights, the input has to be one specific trained participant's MEG recorded while typing, and a visitor has only a mouse and keyboard. Wiring decoded letters to, say, a PFC glow would invent a link the research never makes. Meta's sibling releases give the same answer: brainmagick decodes speech perception, is CC BY-NC and has no weights ([brainmagick](https://github.com/facebookresearch/brainmagick)), and the TRIBE v1 Algonauts code is training-only ([algonauts-2025](https://github.com/facebookresearch/algonauts-2025)). The MIT-licensed neuroai packages are data and training tooling, useless at runtime ([neuroai](https://github.com/facebookresearch/neuroai)). The two "brain2qwerty" repos on Hugging Face belong to unrelated third parties and should not be cited as Meta's ([HF search](https://huggingface.co/models?search=brain2qwerty)).

The honest use is contrast rather than borrowed credibility: a card on an About or Further-reading page, never beside the hero.

- **Wording that works:** "Real research, not this toy: in 2026 Meta researchers reported decoding sentences that nine volunteers typed inside lab brain-recording equipment, about 6 in 10 words right on average. Poke the Brain does nothing like that. It's a 7-region spiking simulation and reads nothing from you."
- **Owner decision needed:** the content owner must decide whether naming "MEG" inside an attributed third-party description breaks the playbook's ban on the word "EEG". The rule reads as a ban on *claims about the toy*, but the safe default is the generic phrase used above.
- **If the sentence CSV is ever replayed,** it must say "three best of nine participants" and inherits the non-commercial question.

## Foundation models and EEG data fail the licence, size or input test

### TRIBE v2

TRIBE v2 is the most complete Meta release:

- **Code** on GitHub, CC BY-NC 4.0 ([GitHub tribev2](https://github.com/facebookresearch/tribev2)).
- **Three checkpoints**, all CC BY-NC 4.0: `facebook/tribev2` (**709 MB**), `tribev2-subcortical` (613 MB) and an undocumented `tribev2-mini` (698 MB) ([HF tribev2](https://huggingface.co/facebook/tribev2); [HF tribev2-subcortical](https://huggingface.co/facebook/tribev2-subcortical); [HF tribev2-mini](https://huggingface.co/facebook/tribev2-mini)).
- **What it predicts:** an *average* subject's fMRI response to video, audio or text. The output is on the fsaverage5 cortical mesh (~20k vertices) and is offset 5 s to account for hemodynamic lag ([GitHub tribev2](https://github.com/facebookresearch/tribev2)).
- **What it depends on:** frozen feature extractors totalling about **4.8B parameters**: gated Llama-3.2-3B, V-JEPA2 ViT-g and w2v-BERT 2.0 ([config.yaml](https://huggingface.co/facebook/tribev2/blob/main/config.yaml)). The mini variant's extractors total about 2.1B parameters ([mini config](https://huggingface.co/facebook/tribev2-mini/blob/main/config.yaml)).

Live inference in a browser is out of the question. Pre-computing playback is trivial, though: a T×7 array at 1 Hz per clip is a few KB. BrainSNN already has this path. The project memory records a TRIBE v2 FastAPI server that maps fsaverage5 onto the seven regions via Desikan-Killiany, and the research drawer keeps TRIBE "manually enabled" and "clearly labeled" (`/home/user/the-brain/.ai-memory/MEMORY.md`; `/home/user/the-brain/brainsnn-r3f-app/src/features/research/ResearchDrawer.jsx`).

Three separate problems keep TRIBE playback off the hero:

1. **Licence.** CC BY-NC excludes use "primarily intended for or directed towards commercial advantage or monetary compensation" ([tribev2 LICENSE](https://github.com/facebookresearch/tribev2/blob/main/LICENSE)). Whether that also covers the model's *outputs* is unsettled.
2. **Coverage.** fsaverage5 is a cortical surface. It can honestly drive CTX and PFC, but not HPC, THL, AMY, BG or CBL. The subcortical checkpoint's output format is undocumented.
3. **Framing.** Predicted fMRI glowing on a 3D brain reads as a brain scan. Nearly 100 community Spaces already market TRIBE as "ad-brain-scorer" or "neuro-ads" ([HF tribev2](https://huggingface.co/facebook/tribev2)). A July 2026 paper found that TRIBE's global predicted-fMRI drive "does not predict YouTube replay heatmaps" ([HF papers 2607.01400](https://huggingface.co/papers/2607.01400)).

Keep TRIBE in the research drawer, labelled "Predicted, not measured". Also reword the memory file's line "TRIBE v2 (real fMRI predictions)" before that phrasing leaks into UI copy.

### Other neural foundation models

None of the others has an input the toy can honestly supply:

- **NDT3** decodes behaviour from *recorded* motor-cortex spiking. It ships in 45M and 350M parameter sizes and is CC BY-NC ([HF ndt3](https://huggingface.co/joel99/ndt3)).
- **POYO+** lives in an Apache-2.0 framework, but no weight hosting or licence turned up ([torch_brain](https://github.com/neuro-galaxy/torch_brain)).
- **Brain-JEPA** takes parcellated fMRI and states no licence ([Brain-JEPA](https://github.com/Eric-LRL/Brain-JEPA)).

Feeding any of them the toy's simulated spikes would be out of distribution and meaningless.

The EEG encoders are permissively licensed and small enough for a browser:

- **LaBraM:** 5.8M parameters, a 23.3 MB file, BSD-3 ([HF labram](https://huggingface.co/braindecode/labram-pretrained)).
- **CBraMod:** 4.9M parameters, 19.7 MB ([HF cbramod](https://huggingface.co/braindecode/cbramod-pretrained)).
- **signal-JEPA:** 3.5M parameters, MIT ([HF signal-jepa](https://huggingface.co/braindecode/signal-jepa)).

They still need real EEG as input, and the pretrained checkpoints have no task head. The runtime alone would cost **2.36 MB (CPU) or 3.95 MB (WebGPU) Brotli-compressed** of onnxruntime-web before any weights load ([onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)). That makes them a separate EEG-classifier product, not a toy upgrade. The one honest machine-learning flourish available is a tiny surrogate network trained on the toy's *own* simulator output, labelled as exactly that.

### Open EEG/MEG datasets

The data is legally easy to use:

- **PhysioNet's EEG Motor Movement/Imagery set:** 109 volunteers, 64 channels at 160 Hz, ODC-By 1.0. The licence was confirmed only via a search snippet ([PhysioNet eegmmidb](https://physionet.org/content/eegmmidb/1.0.0/)).
- **OpenNeuro:** CC0 by default ([OpenNeuro FAQ](https://openneuro.readthedocs.io/faq.html)).

Showing it honestly is the hard part:

- **No mapping to the regions.** Scalp channels don't correspond to the seven simulated regions.
- **Mind-reading risk.** Motor-imagery data plus a classifier is one caption away from "the AI read their mind".
- **The live-EEG mode.** The project memory records an earlier live-EEG mode fed by a Muse headband over Web Bluetooth (`/home/user/the-brain/.ai-memory/MEMORY.md`). That input must never drive the hero brain.

Any replay belongs on its own URL as raw traces, labelled "Recorded data, not this simulation".

## A 2,621-neuron fly circuit fits in 0.29 MB and passes a Nature check

### What is released

FlyWire v783 is public and distributed through Codex, Zenodo and public GCS buckets ([flywire_annotations](https://github.com/flyconnectome/flywire_annotations)). It includes:

- about 139,000 proofread neurons
- a 15.1M-edge connectivity table carrying 54.5M synapses
- a synapse table of about 130M entries with neurotransmitter predictions

The Shiu et al. whole-brain model is **MIT-licensed** ([LICENSE](https://github.com/philshiu/Drosophila_brain_model/blob/main/LICENSE)) and ships ready-made v783 inputs ([Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model)). Each neuron is a leaky integrate-and-fire (LIF) unit with these parameters ([model.py](https://github.com/philshiu/Drosophila_brain_model/blob/main/model.py)):

| Parameter | Value |
|---|---|
| Resting potential | −52 mV |
| Spike threshold | −45 mV |
| Membrane time constant | 20 ms |
| Synaptic time constant | 5 ms |
| Synaptic delay | 1.8 ms |
| Weight | 0.275 mV per signed synapse |

The model has no spontaneous firing, no gap junctions and no neuromodulation. Its validated territory is feeding and grooming, with predictions confirmed by optogenetics ([Nature, Shiu et al. 2024](https://www.nature.com/articles/s41586-024-07763-9)). Zero spontaneous activity suits a "poke" toy: nothing happens until a visitor injects drive into named sensory neurons.

### What this research measured

This research ported the model to about 40 lines of JavaScript and ran it on Shiu's v783 table, single-threaded on a 2.1 GHz Xeon core under Node 22.

**The full brain** (138,639 neurons, 15.09M edges) behaves as the paper reports:

- Driving the 21 sugar taste neurons at 150 Hz fires MN9 at **106 Hz**.
- Bitter drive leaves MN9 at **0 Hz**.
- The response scales with drive: 50 Hz gives 13 Hz, 100 Hz gives 74 Hz, and 200 Hz gives 120 Hz.
- An event-driven loop runs at 1.62 s of compute per simulated second.

**The subset** is where it gets interesting. Expanding two strong hops downstream of the 43 seed neurons, and keeping every edge among them, yields **2,621 neurons and 195,759 edges** that preserve the behaviour. Ranking neurons by connectivity degree to get a subset of the same size does not.

| Subset (v783, measured) | Neurons | Edges | Brotli size | MN9 at sugar 150 Hz | µs per 0.1 ms step |
|---|---|---|---|---|---|
| Full brain | 138,639 | 15,091,983 | 31.71 MB | 106 Hz | 162 |
| All neurons, edges ≥5 synapses | 138,639 | 2,700,513 | 6.56 MB | 92 Hz | 63 |
| **2-hop feeding circuit** | **2,621** | **195,759** | **0.29 MB** | **109 Hz (bitter: 0 Hz)** | **23** |
| 2-hop, edges ≥5 synapses | 2,621 | 55,557 | 0.11 MB | 96 Hz | 19 |
| Top 2,000 by degree | 2,040 | 154,712 | 0.23 MB | **0 Hz** | 4 |
| Top 20,000 by degree | 20,040 | 2,984,849 | not sized | 100 Hz | 63 |

Source data: [Connectivity_783.parquet](https://github.com/philshiu/Drosophila_brain_model), measured in this research.

The degree-ranked row is the important negative result. A circuit chosen by "most connected" looks plausible and is silently wrong. One more trap surfaced during the port: pairing weights with edges *before* sorting them by presynaptic neuron left MN9 at 0 Hz while everything else looked fine. "Sugar fires MN9, bitter doesn't" therefore belongs in CI.

### Will it run in a browser?

At 23 µs per 0.1 ms step, real-time simulation costs about **3.8 ms of CPU per 60 fps frame** on the server core, or about 1 ms at 0.25× slow motion. Mid-range phone cores are *assumed* (not measured) to be 3–5× slower. The simulation should therefore run in a Web Worker with slow motion as the default. Rendering the 2,621 neurons is a single InstancedMesh draw call.

The existing whole-brain demos show why small is the point:

- **webgpu-fly** downloads a 120 MB brain file plus a 43 MB nerve-cord file, and runs about 4× slower than real time on an M2 Pro ([webgpu-fly](https://github.com/abgnydn/webgpu-fly)).
- **fly-brain** ships viewers of roughly 30 MB ([Lulzx/fly-brain](https://github.com/Lulzx/fly-brain)).
- **Eon Systems'** March 2026 embodied fly already took the "uploaded brain" headlines ([Eon Systems](https://eon.systems/updates/embodied-brain-emulation)).

BrainSNN's defensible angle is the opposite of theirs: pocket-sized and checkable.

Plain JavaScript is the right engine for this. WebGPU still has gaps: no Firefox on Android, no Firefox on Linux, and nothing before iOS 26 ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json)). WASM threads would need site-wide cross-origin isolation headers ([MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)).

### The licence is the real blocker

Sources disagree on FlyWire's licence:

- **CC BY-NC 4.0:** a project redistributing FlyWire data states it outright ([desktop-fly DATA_LICENSE](https://github.com/DenisSergeevitch/desktop-fly/blob/master/data/DATA_LICENSE.md)), and search summaries of the [Codex FAQ](https://codex.flywire.ai/faq) say the same.
- **CC BY 4.0:** one third-party NOTICE file claims this ([webgpu-fly NOTICE](https://github.com/abgnydn/webgpu-fly/blob/main/NOTICE)).

The primary licence pages were unreachable during this research, so treat the data as non-commercial until FlyWire says otherwise. One of this research's own working notes suggested the caption "wiring from FlyWire (CC-BY 4.0)". That caption must not ship.

The fallback is Janelia's **MaleCNS v1.0**: 165,122 neurons and 104M synapses, reported as CC BY 4.0 ([Lulzx sources.md](https://github.com/Lulzx/fly-brain/blob/main/docs/guide/sources.md)). Shiu-style ports of it already exist ([flymsg](https://github.com/gianlucamazza/flymsg); [drosophila-brain-mlx](https://github.com/Kisame76/drosophila-brain-mlx)), but nobody here has validated sugar→MN9 on it.

Two more pieces of work remain open:

- **Labels and layout.** Neuron positions and cell-type labels must still be pulled from Codex.
- **Citations.** Credit is owed to Dorkenwald et al. 2024 and Schlegel et al. 2024 for the data, and to Shiu et al. 2024 for the model.

## Worm wiring and CC BY human atlases ground the hero for kilobytes

### The worm: smallest, but no clean test

*C. elegans* is the smallest honest specimen. The Cook 2019 hermaphrodite neuron-to-neuron wiring compresses to **16.9 KB gzip**, or 30.6 KB with muscles and end organs, measured from OpenWorm's MIT-licensed `cect` package ([cect](https://pypi.org/project/cect/); [ConnectomeToolbox LICENSE](https://github.com/openworm/ConnectomeToolbox/blob/main/LICENSE)). Witvliet 2021's eight developmental stages run from **1,296 to 7,970 chemical synapses** between birth and adulthood ([Witvliet preprint](https://www.biorxiv.org/content/10.1101/2020.04.30.066209v1.full.pdf)). That is a natural "watch the wiring grow" slider in which only the activity is invented.

wormlight (Apache-2.0) shows the right tone. It runs the full connectome on the GPU with lesioning, and it states plainly that its synapse signs have "no basis" for 14% of connections and that some behavioural checkpoints fail ([wormlight](https://github.com/chrisjz/wormlight)). The worm has two weaknesses next to the fly:

- **No clean readout.** There is no single, crisp validated behaviour comparable to sugar→MN9.
- **No data licence.** None was found for the wiring tables themselves, so attribute them visibly and ask the Emmons and Zhen labs for permission.

### The human hero's pathways

The hero's pathways are where a cheap fix matters most. The current `PATHWAYS` table is hand-written, with functional metaphor labels such as "attention to meaning" and "emotion to action pressure". It also includes a direct cerebellum→cortex edge, even though the standard cerebellar output route runs through the thalamus (`/home/user/the-brain/brainsnn-r3f-app/src/features/brain3d/brainRegions.js`).

Two open matrices can replace it:

- **ENIGMA Toolbox:** a 25,098-byte group-average matrix covering the 68 Desikan-Killiany cortical parcels plus 14 subcortical structures. That spans six of the seven regions, everything except cerebellum. The code is BSD-3, but the data is derived from the Human Connectome Project (HCP) ([ENIGMA matrices](https://github.com/MICA-MNI/ENIGMA/tree/master/enigmatoolbox/datasets/matrices/hcp_connectivity)). The HCP terms require derived data to be redistributed under the same terms ([HCP data use terms](https://balsa.wustl.edu/file/mplpX)).
- **Škoch et al. 2022:** matrices from 88 subjects, released CC BY 4.0, per a search snippet ([Škoch et al., PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9363436/)). This is the cleaner source.

Either one collapses to 49 numbers. The cerebellar loops would be hand-specified and labelled "schematic". After that, the playbook caption "every poke fires signals down real pathways in the model" carries real weight.

### Meshes for the seven regions

The **Allen Human Reference Atlas 3D (2020)** labels 141 structures and has been CC BY 4.0 since 1 September 2022 ([Allen community post](https://community.brain-map.org/t/allen-human-reference-atlas-3d-2020-new/405)). A HuBMAP GLB derivative is also listed as CC BY 4.0 ([NIH 3D entry](https://3d.nih.gov/entries/20960)). The atlas covers all seven regions. One natural use is as glowing inner structures revealed by the existing Slice cross-section, without replacing the procedural jelly shell; BUILD-NOTES already documents the GLB swap path. The 100–250 KB size after decimation is an estimate; nobody has measured it.

The alternatives are weaker:

- **fsaverage5** costs about 320–420 KB gzip for both hemispheres ([nilearn fsaverage5](https://github.com/nilearn/nilearn/tree/main/nilearn/datasets/data/fsaverage5)). FreeSurfer's licence allows commercial use if the licence text ships with it and modified meshes are marked as modified ([FreeSurfer LICENSE](https://raw.githubusercontent.com/freesurfer/freesurfer/dev/LICENSE.txt)). It is cortex only.
- **BigBrain** is non-commercial ([neurodata BigBrain](https://neurodata.io/data/bigbrain)). Avoid it.

### One real neuron, and what to leave alone

At the cellular scale, **H01** is verified CC BY 4.0 and includes 104 proofread neurons as SWC skeletons ([H01 data](https://h01-release.storage.googleapis.com/data.html)). **MICrONS** skeleton files are 181 B to 6.3 KB each ([BossDB listing](https://bossdb-open-data.s3.amazonaws.com/?prefix=iarpa_microns/minnie/minnie65/&delimiter=/)) and are reported as CC BY 4.0 ([Allen portal](https://portal.brain-map.org/connectivity/ultrastructural-connectomics)). Either would make a "one real neuron" easter egg.

Leave these alone for now:

- **Allen mouse atlases:** Allen's Terms of Use limit content to research or noncommercial use ([Allen Terms of Use](https://alleninstitute.org/legal/terms-of-use)).
- **MouseLight:** CC BY-NC ([MouseLight](https://janelia.figshare.com/collections/MouseLight_Neuron_Browser/3924067)).
- **Zebrafish:** the Fire&Wire whole-brain connectome is still being proofread ([Janelia Fire&Wire](https://www.janelia.org/fish-firewire)), and the visible zebrafish licences are non-commercial ([zebrafishconnectome](https://github.com/jamieswrld/zebrafishconnectome)).

## Build the pocket fly first, behind a licence gate

The fly feeding circuit is the only candidate that has all four of these:

1. a measured browser budget
2. a published result the visitor can check
3. a natural mapping onto "poke"
4. permissively licensed simulator code

It answers the question a sceptic asks of the hero ("is any of this real?") with an experiment the visitor runs themselves: sugar fires the feeding motor neuron, bitter doesn't, and turning the stimulus up fires it harder.

### Build sequence

1. **Ask for the licence.** On day one, email the FlyWire team for written permission covering brainsnn.com.
2. **Build the engine in parallel.** None of this depends on which dataset ships:
   - **Build script.** A Python script emits a packed binary: uint32 row pointers, uint16 target indices and int16 weights. That is 793,524 bytes raw and 0.29 MB Brotli, alongside the FlyWire IDs.
   - **Simulator.** A Web Worker runs the Shiu LIF model:
     - dt of 0.1 ms with exact integration
     - an 18-step delay ring buffer
     - Poisson "pokes" of 68.75 mV at probability rate × dt
     - an event-driven active list
   - **CI test.** Sugar must drive MN9 above 0 Hz and bitter must leave it at 0 Hz.
   - **Rendering.** One InstancedMesh as a second specimen on the existing tray.
   - **Loading.** Fetch only when the visitor opens the specimen, never on first paint.
   - **Controls.** Sugar and bitter buttons, plus a 50–200 Hz dial.
   - **Default speed.** Slow motion.
3. **Decide the dataset when the licence answer arrives.** If FlyWire grants permission, ship. If the answer is no, rerun the pipeline on MaleCNS v1.0, match the taste neurons and MN9 by cell type, and ship only if the same CI test passes. If that fails too, the worm becomes the second specimen. Nothing fly-derived goes on the homepage while the licence question is open.

### Same sprint, nearly free

Ship these alongside the fly work:

- the Škoch-weighted 7×7 pathway table with schematic cerebellar routes
- a "what's real / what's simplified" popover
- the Brain2Qwerty card on an About page
- the memory-file wording fix

### Not now

- TRIBE playback on the hero
- any EEG replay or live EEG near the 3D brain
- onnxruntime-based models
- the 6.56 MB whole-brain fly, which belongs on its own opt-in page later

### Labels

| Feature | Label to ship | Never say |
|---|---|---|
| Fly specimen | "Simulation · 2,621 neurons from the FlyWire fruit-fly connectome (v783), run with the Shiu et al. 2024 model. Not recorded activity; a simplified model of part of a fly's brain." | "real fly brain", "whole brain", "brain upload", "what the fly feels" |
| Hero pathways | "Pathway strengths follow population-average diffusion-MRI tractography (Škoch et al. 2022); cerebellar routes are schematic. Signals are simulated." | "real brain activity", "your brain" |
| Worm (if used) | "Real wiring diagram (Cook et al. 2019). Simulated activity — not recorded neural data." | "living worm", "recorded" |
| Brain2Qwerty card | "Real research, not this toy … This toy reads nothing from you." | "powered by", "like Meta's", "decodes", "mind-reading", "brain-to-text" |

### Open uncertainties

- None of the timings come from a real browser or a phone.
- The 2-hop subset is this research's own construction. The Shiu authors have not reviewed it.
- The Allen, Škoch and PhysioNet licences were confirmed only through search snippets.
- Whether CC BY-NC reaches the *outputs* of a model is legally unresolved.

## Conclusion

Compute was never the binding constraint; licences and honesty were. Every performance question got a measured answer, such as a 2,600-neuron circuit costing a few milliseconds per frame. Every real blocker was either a non-commercial clause or an implied claim about real brain activity. That reorders the work: the first deliverable is an email to FlyWire, not a GPU kernel. It also explains why Meta's flashy releases end up as footnotes. Their value lies in outputs (decoded text, predicted fMRI) that the site's own rules forbid it to claim.

The deeper lesson is that "real" should attach to structure, never to activity, and that the strongest honesty device is a prediction anyone can check. A glowing predicted-fMRI map can't be falsified by a visitor. "Sugar fires MN9, bitter doesn't" can, in the browser, in seconds. The degree-ranked subset that went silent shows that a plausible-looking connectome toy can be quietly wrong without such a test. Any future specimen, such as a licensed zebrafish circuit once Fire&Wire publishes its terms, should arrive with its own behavioural unit test and a published source to match.
