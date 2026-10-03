# Meta FAIR brain-decoding releases (Brain2Qwerty, TRIBE v1/v2, related) as candidate upgrades for the "Poke the Brain" browser toy

Research date: 2026-10-03. Method note: `facebookresearch.github.io` and `ai.meta.com` were blocked by this environment's egress proxy, so the Brain2Qwerty project page was read from its source (`docs/index.html` in the public GitHub repo, which is what GitHub Pages serves), and Meta blog posts were not read directly. Repos were shallow-cloned on 2026-10-03; Hugging Face model cards, file listings and `config.yaml` files were read through the Hugging Face Hub API. Everything below about "what is released" comes from those primary files unless marked otherwise.

## 1. Brain2Qwerty: what it does, reported accuracy, what is released, under what license, browser feasibility, and how to reference it honestly

### Takeaway
Brain2Qwerty decodes the sentence a healthy volunteer is typing from MEG recorded in a lab scanner. v1 (2025, now in Nature Neuroscience) reached 32% character error rate (CER) with MEG and 67% with EEG. v2 (preprint dated June 29, 2026) reached 39% word error rate (WER), about 61% of words correct on average and 78% for the best participant. Training code for both versions is public under CC BY-NC 4.0 and the v1 dataset is public under CC BY-NC 4.0. No trained weights are released and the v2 dataset is under embargo. Nothing in it can run in a browser on a visitor's input, because visitors don't have a MEG scanner and there are no weights. The only honest use is as a clearly labelled explainer or link-out, ideally off the hero.

### Cited Findings
**What it does**
- The repo describes it as "Decoding Sentences from Non-Invasive Recordings of the Brain"; the hero GIF caption reads "A participant types in an MEG scanner; Brain2Qwerty reconstructs the sentence from brain activity." — [brain2qwerty README](https://github.com/facebookresearch/brain2qwerty)
- v1 is a keystroke-level decoder: a convolutional module encodes 500 ms MEG windows around each keystroke, a sentence-level Transformer refines them, and optional N-gram (KenLM) rescoring follows. The repo reports "MEG CER ≈ 0.36 (Conv+Transformer, no language model)". — [AGENT_README](https://github.com/facebookresearch/brain2qwerty/blob/main/AGENT_README.md); [v1 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v1/README.md)
- v1 needs the timing of every keypress, so it "could not work in real time". v2 "generates the sentences directly from a continuous recording of brain activity". — [Project page source, docs/index.html](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/index.html) (served at [facebookresearch.github.io/brain2qwerty](https://facebookresearch.github.io/brain2qwerty/))
- v2 architecture: a Conv + Conformer encoder with a character-level CTC head, a word-level contrastive aligner (SigLIP + DTW), and a LoRA-adapted LLM that generates the sentence. The three losses are trained on a staged schedule. — [v2 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v2/README.md); [AGENT_README](https://github.com/facebookresearch/brain2qwerty/blob/main/AGENT_README.md)
- The v2 LLM is `TinyLlama/TinyLlama-1.1B-Chat-v1.0`. — [v2 xp_config.py](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v2/config/xp_config.py)
- The v2 task: in each trial, participants "listened to a sentence via headphones, waited through a forced delay, and then typed the corresponding text". The decoding covers the language-production (typing) phase. — [v2 preprint PDF](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf) (read from the repo copy at `docs/assets/brain2qwerty_v2.pdf`)

**Reported accuracy**
- v1 (35 healthy volunteers): "With MEG, Brain2Qwerty reaches, on average, a character-error-rate (CER) of 32% and substantially outperforms EEG (CER: 67%). For the best participants, the model achieves a CER of 19%." — [arXiv 2502.17480 (v1 preprint, Feb 2025)](https://arxiv.org/abs/2502.17480)
- v1 was later published as "Non-invasive decoding of typed sentences from human brain activity", Nature Neuroscience 2026, doi 10.1038/s41593-026-02303-2. — [v1 README citation](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v1/README.md); [Nature Neuroscience link](https://www.nature.com/articles/s41593-026-02303-2) (journal page not read directly)
- v2: "By collecting 22,000 sentences typed by nine subjects, each recorded for 10 hours, our model … achieve[s] an average word error rate (WER) of 39%. For our best participant, the model accurately decodes half of the sentences with one word error or less." It is dated June 29, 2026. — [v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)
- v2 WER is 0.39 ± 0.04, compared with 0.55 for the encoder alone and 0.43 for encoder + N-gram. v2 CER is 0.31 ± 0.03, slightly worse than the encoder alone (0.28), because the LLM sometimes produces fluent sentences that differ from the target. — [v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)
- Project page headline: "Word accuracy … 48% / 40% v1 … 78% / 61% v2 (mean / best participant)". The page also says it "reaches up to 78% word accuracy for the best participant". The v1 data was about 2,200 typed sentences and the v2 data about 22,000. The page's own caveat: "decoding performance is not yet good enough for everyday use", and the MEG device "consists of a large scanner — i.e. a setup inaccessible to most patients." — [Project page source](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/index.html)
- Decoding accuracy improves log-linearly with recording hours (Pearson r = −0.99 between log10(hours) and CER), with "no sign of saturation" at about 90 pooled hours. — [v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)
- The preprint says the CTC approach "can thus be applied in real-time, although with some potential delays". All participants were healthy volunteers, and the authors name adapting the method to patients as an open problem. — [v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)
- Side fact: the v2 hyperparameter search used "Auto Research" coding agents, including Cursor running Claude Opus 4.6. — [v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)

**What is released (verified 2026-10-03)**
- Code: full training and evaluation code for v1 and v2 (`brain2qwerty_v1/`, `brain2qwerty_v2/`). The last commit was 2026-07-29. — [GitHub repo](https://github.com/facebookresearch/brain2qwerty)
- License: "The code is released under CC BY-NC 4.0". The LICENSE file is the Attribution-NonCommercial 4.0 International text. — [README](https://github.com/facebookresearch/brain2qwerty); [LICENSE](https://github.com/facebookresearch/brain2qwerty/blob/main/LICENSE)
- Weights: none. The repo has no checkpoints and no download links. Its READMEs only describe training your own model (`main train`, `eval --ckpt $BRAIN2QWERTY_RESULTS/best.ckpt`), on 8 GPUs by default and a CUDA GPU at minimum. — [v1 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v1/README.md); [v2 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v2/README.md)
- v1 data: SpanishBCBL (also called "DECOMEG"), about 262 GB of MEG `.fif` files, EEG BrainVision files and `.mat` behavioural logs from 35 participants at BCBL. It is licensed CC BY-NC 4.0 and was last updated June 29, 2026. — [HF dataset bcbl190626/SpanishBCBL](https://huggingface.co/datasets/bcbl190626/SpanishBCBL); [v1 README](https://github.com/facebookresearch/brain2qwerty/blob/main/brain2qwerty_v1/README.md)
- v2 data (EnglishBCBL): "under embargo until the paper acceptation". The datasets "are collected by and belong to" BCBL. — [README](https://github.com/facebookresearch/brain2qwerty)
- Pre-computed outputs: the repo ships `docs/assets/best_complete_predictions.csv`, which powers the project page's "Explore results" widget. It has 843 rows with columns `subject,true_text,llm_pred,llm_cer,llm_wer` and covers only subjects S07, S08 and S09. Those are, per `results-explorer.js`, "the three best subjects". By my count the file's mean WER is 0.264, against 0.39 averaged over all nine subjects, and 197 sentences have WER 0. — [CSV](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/assets/best_complete_predictions.csv); [results-explorer.js](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/src/results-explorer.js)
- Infrastructure dependencies are `neuralset` and `neuraltrain` from the neuroai repo, which is MIT-licensed. — [AGENT_README](https://github.com/facebookresearch/brain2qwerty/blob/main/AGENT_README.md); [neuroai](https://github.com/facebookresearch/neuroai)
- Press coverage (context only) repeats "61% average word accuracy" and the CC BY-NC code release. — [MarkTechPost, 2026-06-30](https://www.marktechpost.com/2026/06/30/meta-ai-releases-brain2qwerty-v2-a-non-invasive-meg-brain-to-text-pipeline-decoding-typed-sentences-at-61-word-accuracy/)

### Inferences
- **Browser (ONNX/WebGPU) is not viable for the model.** There are no weights to export. Even with weights, the input is a lab MEG recording of one specific trained participant typing; a website visitor has no such signal. The v2 stack also carries a 1.1B-parameter LLM. You could not honestly feed any browser input (mouse, keyboard, mic) into it.
- **A pre-computed replay is technically trivial**: the 90 KB CSV of (true sentence, decoded sentence) pairs is enough for a typewriter-style animation. Two problems remain:
  - It covers the three best participants only, so any replay must say "best 3 of 9 participants".
  - Using it on a sponsored page runs into the CC BY-NC terms (see Q2 on sponsors). The README says "the code" is CC BY-NC; whether the docs assets fall under the same LICENSE is not stated explicitly. Treat it as CC BY-NC.
- **It doesn't map onto the toy's 7 regions.** Brain2Qwerty decodes motor/language-production signals into characters; it doesn't produce region activations. Wiring it into the jelly brain's regions (for example lighting "PFC" when a letter is decoded) would invent a mapping that doesn't exist in the research.
- **Best fit is a linked "real research vs this toy" explainer card**, preferably on a secondary page (an About or Further-reading drawer) rather than the hero. The CONTENT-PLAYBOOK rule "Never say … 'EEG', 'brain scan' or 'reads your mind'" is written about claims for the toy. Even a correctly attributed mention of MEG/EEG research next to the hero risks readers conflating the two.
- **Suggested wording** (stays within the "it's a simulation" rules):
  - Card title: "Real research, not this toy"
  - Body: "In 2026, Meta researchers reported decoding sentences that nine volunteers typed while sitting in a lab MEG scanner (about 6 in 10 words right on average, 10 hours of recordings per person). Poke the Brain does nothing like that. It's a 7-region spiking simulation. It reads nothing from you and was trained on no one's brain. [Read Meta's Brain2Qwerty project →]"
  - Avoid: "decodes thoughts", "mind-reading", "brain-to-text in your browser", "powered by Brain2Qwerty", "like Meta's Brain2Qwerty".

### Gaps
- I could not open the Nature Neuroscience article page or the Meta blog posts ([brain2qwerty-brain-ai-human-communication](https://ai.meta.com/blog/brain2qwerty-brain-ai-human-communication/), [brain-ai-research-human-communication](https://ai.meta.com/blog/brain-ai-research-human-communication/)) because ai.meta.com is blocked here. Final published v1 numbers may differ slightly from the arXiv numbers (the repo's "≈0.36 CER without LM" vs arXiv's "32%" probably reflects with/without LM rescoring, but this is unconfirmed).
- I found no statement from Meta on whether weights will ever be released, and no timeline for the EnglishBCBL embargo beyond "until the paper acceptation".
- It is unclear whether the `docs/` assets (CSV, videos) fall under the repo's CC BY-NC LICENSE or are "all rights reserved". The README only says "The code is released under CC BY-NC 4.0."

## 2. TRIBE v2 and TRIBE v1: what is released, license, size, inputs/outputs, lightweight or pre-computed options, and whether non-commercial licensing is a problem for a sponsored site

### Takeaway
TRIBE v2 is fully released for research: code on GitHub, three checkpoints on Hugging Face (`facebook/tribev2` about 709 MB, `tribev2-subcortical` about 613 MB, an undocumented `tribev2-mini` about 698 MB), all CC BY-NC 4.0. It predicts an average subject's fMRI response on fsaverage5 (~20k cortical vertices) from video, audio or text, using frozen extractors of about 4.8B parameters (Llama-3.2-3B, V-JEPA2 ViT-g, w2v-BERT 2.0), or about 2.1B in the mini variant. A GPU server is realistic; a browser is not.

The workable pattern for the toy is offline, server-side pre-computation of 7-region time series for a fixed set of stimuli, shipped as small JSON. The CC BY-NC "NonCommercial" clause is a real risk for a site with sponsors, and outputs are an unclear legal area. TRIBE v1 is training code only (CC BY-NC, no weights) and is superseded.

### Cited Findings
**TRIBE v2: what is released**
- HF model `facebook/tribev2`: license cc-by-nc-4.0; files `best.ckpt` (708,856,138 bytes), `config.yaml`, `LICENSE`, `README.md`; last updated 27 Mar 2026. — [HF facebook/tribev2](https://huggingface.co/facebook/tribev2)
- HF model `facebook/tribev2-subcortical`: cc-by-nc-4.0; `best.ckpt` 613,171,482 bytes; updated 2026-05-13. Its README is a copy of the main TRIBE v2 README, with no subcortical-specific documentation. — [HF facebook/tribev2-subcortical](https://huggingface.co/facebook/tribev2-subcortical)
- HF model `facebook/tribev2-mini`: cc-by-nc-4.0; `best.ckpt` 698,254,048 bytes; updated 2026-07-07. The README is only the license header (33 bytes). Its config's run path is `tribe_rebuttal/mini_llama1b_vjepa2l`, and it uses `meta-llama/Llama-3.2-1B` (text), `facebook/vjepa2-vitl-fpc64-256` (video) and `facebook/w2v-bert-2.0` (audio). — [HF tribev2-mini](https://huggingface.co/facebook/tribev2-mini); [mini config.yaml](https://huggingface.co/facebook/tribev2-mini/blob/main/config.yaml)
- GitHub code: `facebookresearch/tribev2`, CC-BY-NC-4.0, Python ≥3.11, last commit 2026-06-23. It includes a Colab demo notebook and training grids for cortical and subcortical models. — [GitHub tribev2](https://github.com/facebookresearch/tribev2); [pyproject.toml](https://github.com/facebookresearch/tribev2/blob/main/pyproject.toml)
- Paper: "A foundation model of vision, audition, and language for in-silico neuroscience" (d'Ascoli, Rapin, Benchetrit, Brooks, Begany, Raugel, Banville, King), arXiv 2605.04326, dated May 5, 2026. — [arXiv 2605.04326](https://arxiv.org/abs/2605.04326)
- Official interactive demo: [aidemos.atmeta.com/tribev2](https://aidemos.atmeta.com/tribev2/) (linked from the README; not opened here). — [GitHub README](https://github.com/facebookresearch/tribev2)
- Announcement date: press and search snippets say Meta announced TRIBE v2 on March 26, 2026, releasing "model, codebase, paper, and an interactive demo". This is consistent with the HF update date of Mar 27. — [Meta blog (not read directly; via search snippet)](https://ai.meta.com/blog/tribe-v2-brain-predictive-foundation-model/); [BioPharmaTrend (context)](https://www.biopharmatrend.com/news/meta-open-sources-foundation-model-that-predicts-brain-responses-to-speech-video-and-text-1544/)

**TRIBE v2: inputs, outputs, architecture, size**
- "TRIBE v2 is a deep multimodal brain encoding model that predicts fMRI brain responses to naturalistic stimuli (video, audio, text)." Usage is `TribeModel.from_pretrained("facebook/tribev2")` → `get_events_dataframe(video_path=…)` → `predict()`, which returns `(n_timesteps, n_vertices)`. — [GitHub README](https://github.com/facebookresearch/tribev2)
- "Predictions are for the 'average' subject … and live on the fsaverage5 cortical mesh (~20k vertices). They are offset by 5 seconds in the past, in order to compensate for the hemodynamic lag." — [GitHub README](https://github.com/facebookresearch/tribev2)
- Text input is converted to speech with gTTS and then transcribed to get word timings. — [demo_utils.py](https://github.com/facebookresearch/tribev2/blob/main/tribev2/demo_utils.py)
- The device defaults to "auto": CUDA if available, else CPU. The checkpoint is loaded with `map_location="cpu", mmap=True`. — [demo_utils.py](https://github.com/facebookresearch/tribev2/blob/main/tribev2/demo_utils.py)
- Full-model feature extractors (from `config.yaml`):
  - text: `meta-llama/Llama-3.2-3B`, at layers 0.5/0.75/1.0
  - audio: `facebook/w2v-bert-2.0`
  - video: `facebook/vjepa2-vitg-fpc64-256`
  - `features_to_use: [text, audio, video]`, output frequency 2 Hz for features and 1 Hz for fMRI, with a 5 s offset
  - brain model: an 8-layer, 8-head Transformer, hidden size 1152, `low_rank_head: 2048`, with subject layers for 25 training subjects
  - training ran on 1 GPU (volta32gb), 128 GB RAM, for 15 epochs
  - [tribev2 config.yaml](https://huggingface.co/facebook/tribev2/blob/main/config.yaml); confirmed in code at [grids/defaults.py](https://github.com/facebookresearch/tribev2/blob/main/tribev2/grids/defaults.py)
- Extractor sizes and licenses (HF metadata):

  | Extractor | Params | License | Access |
  |---|---|---|---|
  | Llama-3.2-3B | 3,212.7M | llama3.2 | gated |
  | Llama-3.2-1B | 1,235.8M | llama3.2 | gated |
  | V-JEPA2 ViT-g | 1,034.6M | apache-2.0 | open |
  | V-JEPA2 ViT-L | 326.0M | MIT | open |
  | w2v-BERT 2.0 | 580.5M | MIT | open |

  — [Llama-3.2-3B](https://huggingface.co/meta-llama/Llama-3.2-3B); [Llama-3.2-1B](https://huggingface.co/meta-llama/Llama-3.2-1B); [vjepa2-vitg](https://huggingface.co/facebook/vjepa2-vitg-fpc64-256); [vjepa2-vitl](https://huggingface.co/facebook/vjepa2-vitl-fpc64-256); [w2v-bert-2.0](https://huggingface.co/facebook/w2v-bert-2.0)
- Training data: "over 1,000 hours of fMRI across 720 subjects", made up of a train set (CNeuroMod, BoldMoments, Lebel2023, Wen2017: 25 subjects, 451.6 h) and test sets (NNDb, LPP, Narratives, HCP 7T: 695 subjects, 666.1 h). It generalises zero-shot to new subjects and tasks and outperforms linear encoding models. — [arXiv 2605.04326](https://arxiv.org/abs/2605.04326)
- The paper reports encoding scores in "8 subcortical regions". — [arXiv 2605.04326](https://arxiv.org/abs/2605.04326)
- About 100 community Spaces use `facebook/tribev2`. They include ad and marketing framings such as "ad-brain-scorer", "neuro-ads", "instagram-content-impact-predictor" and "brainrot-or-not". — [HF facebook/tribev2 Spaces list](https://huggingface.co/facebook/tribev2)

**License text**
- CC BY-NC 4.0 §1(i): "NonCommercial means not primarily intended for or directed towards commercial advantage or monetary compensation." — [tribev2 LICENSE](https://github.com/facebookresearch/tribev2/blob/main/LICENSE)
- The README says "This project is licensed under CC-BY-NC-4.0." Model weights carry the same license. — [GitHub README](https://github.com/facebookresearch/tribev2); [HF card](https://huggingface.co/facebook/tribev2)

**TRIBE v1**
- "TRIBE, the first deep neural network trained to predict brain responses to stimuli across multiple modalities, cortical areas and individuals … achieving the first place in the Algonauts 2025 brain encoding competition." — [arXiv 2507.22229](https://arxiv.org/abs/2507.22229)
- The code at `facebookresearch/algonauts-2025` is CC BY-NC 4.0 (LICENSE header), last commit 2025-09-25. The README covers environment setup, gated Llama-3.2-3B access, the Algonauts dataset path, and Slurm training and ensemble scripts. It mentions no pretrained-weight download. — [GitHub algonauts-2025](https://github.com/facebookresearch/algonauts-2025)
- TRIBE v2 "build[s] on the v1 architecture". — [arXiv 2605.04326](https://arxiv.org/abs/2605.04326)

**Discrepancy to flag**
- The HF model card still says "Python 3.10+" and instructs `huggingface-cli login` for gated Llama 3.2-3B. The GitHub README now says Python 3.11+, links arXiv instead of the ai.meta.com publication page, and drops the login step, but the code default is still `meta-llama/Llama-3.2-3B`. Gated Llama access is still needed for text features. — [HF card](https://huggingface.co/facebook/tribev2); [GitHub README](https://github.com/facebookresearch/tribev2); [defaults.py](https://github.com/facebookresearch/tribev2/blob/main/tribev2/grids/defaults.py)

### Inferences
- **In-browser TRIBE v2 isn't practical.** The ~700 MB brain-model checkpoint alone is a heavy download for a hero toy. It also needs per-stimulus features from 2.1B (mini) to 4.8B (full) parameters of frozen extractors. Text input additionally goes through gTTS, which, from general knowledge rather than anything read here, calls Google's online TTS service. ONNX/WebGPU export of the whole pipeline would be a research project, and the Llama component is gated.
- **Lightweight path: pre-compute, don't infer live.**
  - Run TRIBE v2 offline on the existing GPU host for a small fixed library of clips (for example "music", "speech", "faces", "silence").
  - Average fsaverage5 vertices into the 7 toy regions (the existing FastAPI server already does a Desikan-Killiany mapping).
  - Ship per-clip arrays of shape T×7 at 1 Hz as JSON, a few KB each.
  - The toy then plays back "what a research model predicts an average person's cortex does for this clip".
- **Subcortical regions.** The toy has subcortical regions (HPC, THL, AMY, BG, CBL). Cortical fsaverage5 cannot honestly drive most of them. `tribev2-subcortical` may cover some subcortical structures, but its output format and region list are undocumented on the card. Verify in code before using it.
- **`tribev2-mini` is not a "browser-size" model.** Its checkpoint is about the same size (698 MB vs 709 MB); only the extractors are smaller. It has no model card and appears to be a rebuttal artifact, so its accuracy is unverified. Prefer the documented full model for pre-computation.
- **Non-commercial plus sponsors.** BrainSNN score cards carry a sponsor line (BUILD-NOTES.md §score cards; CONTENT-PLAYBOOK "No … sponsor you don't have"). If the site or toy is monetised through sponsors, using CC BY-NC weights to generate content shown on that site arguably falls within "directed towards commercial advantage or monetary compensation". This is a judgment call, not settled law. Lower-risk options, in order:
  1. Keep TRIBE-derived playback on a clearly non-monetised research page with no sponsor placement.
  2. Get written permission from Meta.
  3. Leave TRIBE out of the hero toy and keep the hero purely simulated. Whether model outputs (predictions) inherit CC BY-NC is unclear; see Gaps.
- **The project's own memory file uses risky wording.** `.ai-memory/MEMORY.md` describes the mode as "TRIBE v2 (real fMRI predictions)". That phrasing would breach the site's honesty rules if it leaked into UI copy. Better: "model-predicted fMRI-style response for an average person (research model, not a measurement)".
- **Suggested wording for a TRIBE-driven playback mode:**
  - Label: "Predicted, not measured"
  - Body: "These glow levels come from TRIBE v2, a Meta research model that predicts how an average person's cortex might respond to this clip. We squeeze its prediction into 7 cartoon regions. Nobody's brain was recorded and nothing is read from you. Research model, CC BY-NC 4.0."
  - Avoid: "real brain activity", "fMRI of your brain", "how your brain reacts", "brain scan of this video", "neuro-score your ad".

### Gaps
- Whether CC BY-NC 4.0 restrictions extend to model *outputs* (pre-computed predictions) is not addressed in the repo or model card. I found no Meta FAQ on this. It needs legal judgment or Meta's confirmation.
- I measured no inference latency or memory cost for TRIBE v2 (no GPU run was done here). The only compute facts are from training configs (1× 32 GB V100-class GPU, 128 GB RAM) and parameter counts.
- `tribev2-subcortical`'s exact output (which structures, which space) and `tribev2-mini`'s accuracy are undocumented on their cards.
- I could not read the Meta TRIBE v2 blog post directly. The "70× resolution / 2–3× accuracy" marketing figures come from search snippets and press, not a primary file.
- I did not verify whether Meta's demo page (aidemos.atmeta.com/tribev2) has its own terms of use.

## 3. Other Meta FAIR brain work (2023–2026): what is released and usable

### Takeaway
Meta FAIR's brain group (Jean-Rémi King and colleagues) has released mostly training code under CC BY-NC 4.0 with no pretrained weights: brainmagick for MEG/EEG speech-perception decoding, the TRIBE v1 Algonauts code, and Brain2Qwerty. The exceptions are TRIBE v2 (weights, CC BY-NC) and the neuroai infrastructure (NeuralSet, NeuralTrain, NeuralFetch, NeuralBench), which is MIT-licensed but is tooling, not a model. None of it gives a browser toy a runnable "brain" model. For a commercially sponsored toy, the only permissively licensed Meta piece is neuroai, and it is irrelevant at runtime.

### Cited Findings
- **brainmagick**, "Decoding speech perception from non-invasive brain recordings" (Défossez et al., Nature Machine Intelligence 2023): a contrastive MEG/EEG ↔ wav2vec 2.0 model. It covers 4 datasets, 175 volunteers and more than 160 hours, reaching ">41% top-1 accuracy" among more than 1,300 candidate segments on the Gwilliams dataset. It needs an NVIDIA GPU with 16 GB to train, is licensed CC BY-NC 4.0, and was last committed 2024-03-12. The README mentions no pretrained-weight release. — [GitHub brainmagick](https://github.com/facebookresearch/brainmagick)
- **MEG image decoding**, "Brain decoding: toward real-time reconstruction of visual perception" (Benchetrit, Banville, King; arXiv 2310.19812, v3 March 2024): an MEG decoder with contrastive and regression objectives plus a pretrained image generator. It reports "a 7X improvement of image-retrieval over classic linear decoders" and the authors call the results "preliminary". — [arXiv 2310.19812](https://arxiv.org/abs/2310.19812)
- **Companion neuroscience paper to Brain2Qwerty**, "From Thought to Action: How a Hierarchy of Neural Dynamics Supports Language Production" (Feb 2025): MEG/EEG from 35 skilled typists, analysis only. — [arXiv 2502.07429](https://arxiv.org/abs/2502.07429)
- **neuroai** (NeuralSet, NeuralFetch, NeuralTrain, NeuralBench): pip-installable data-loading, dataset-fetching, training and benchmark packages. MIT license, last commit 2026-10-02 (active). Brain2Qwerty and TRIBE are built on these. The README cites "NeuralSet: A High-Performing Python Package for Neuro-AI" (arXiv 2605.03169). — [GitHub neuroai](https://github.com/facebookresearch/neuroai); [AGENT_README](https://github.com/facebookresearch/brain2qwerty/blob/main/AGENT_README.md)
- **TRIBE v1** (Algonauts 2025 winner): see Q2. Code only, CC BY-NC. — [GitHub algonauts-2025](https://github.com/facebookresearch/algonauts-2025)
- **2026 releases found:**
  - TRIBE v2 (March 2026; arXiv May 2026)
  - `tribev2-subcortical` (May 2026)
  - `tribev2-mini` (July 2026)
  - Brain2Qwerty v2 (preprint June 29, 2026; code in the repo; v1 published in Nature Neuroscience 2026)
  - continuing neuroai package releases
  - [HF facebook/tribev2](https://huggingface.co/facebook/tribev2); [HF tribev2-subcortical](https://huggingface.co/facebook/tribev2-subcortical); [HF tribev2-mini](https://huggingface.co/facebook/tribev2-mini); [brain2qwerty](https://github.com/facebookresearch/brain2qwerty); [neuroai](https://github.com/facebookresearch/neuroai)
- **Hugging Face search:** a search of the `facebook` org on HF for "brain" models and datasets returned nothing beyond the TRIBE v2 repos. There is no `facebook/brain2qwerty` model. The two "brain2qwerty" HF repos found belong to unrelated third parties (`farmakohealth/brain2qwerty-v1-beta`, `Quazim0t0/Spikewhale-SNN-Brain2Qwerty`) and are not Meta releases. — [HF Hub search via API](https://huggingface.co/models?search=brain2qwerty)

### Inferences
- **Nothing here gives BrainSNN a model that runs in a browser on visitor input.** Every decoder (speech, image, typing) needs lab MEG/EEG/fMRI recordings as input, and none ships weights except TRIBE v2, which is an encoder (stimulus → predicted fMRI), not a decoder.
- **The only "honest upgrade" category is explanatory.**
  - Pre-computed TRIBE v2 playback, with the license caveats in Q2.
  - Static "real research" reference cards linking to the papers.
- **Third-party "Brain2Qwerty" repos on HF should not be trusted or cited as Meta's.**

### Gaps
- I did not verify whether the MEG image-decoding paper (2310.19812) has an official public code repo. I found none in this pass.
- The Meta FAIR publications index and Meta blog were unreachable (ai.meta.com blocked). There may be 2026 Meta brain papers without code or HF artifacts that I missed.
- I did not check whether Meta released any EEG-specific or wearable (OPM-MEG) models in 2026. The Brain2Qwerty v2 preprint only discusses OPM-MEG as future work.

## 4. Honesty risks for each release and exact wording that stays within the "it's a simulation" rules

### Takeaway
The main honesty risk is borrowed credibility: putting Meta's real-recording research next to a simulated jelly brain invites visitors to think the toy decodes or measures brains. Keep the hero 100% simulation. Put any Meta reference in a separate, clearly labelled "real research vs this toy" explainer. Treat any TRIBE-driven playback as "a research model's prediction for an average person, squeezed into 7 cartoon regions, not a measurement".

### Cited Findings
- **The site's guardrail:** "Say 'simulation'. Never say 'real brain', 'neural data', 'EEG', 'brain scan' or 'reads your mind'. The brain is a seven-region spiking model inside a 3D shell. It is not a recording of anyone's brain." — local file `/home/user/the-brain/CONTENT-PLAYBOOK.md` (Honesty guardrails)
- **Meta's own framing of Brain2Qwerty's limits:** "decoding performance is not yet good enough for everyday use"; "the MEG device … consists of a large scanner"; all participants were healthy volunteers. — [Project page source](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/index.html); [v2 preprint](https://facebookresearch.github.io/brain2qwerty/assets/brain2qwerty_v2.pdf)
- **Meta's framing of TRIBE v2 outputs:** predictions are for the "average" subject on the fsaverage5 mesh, offset by 5 s for hemodynamic lag. In other words, a model prediction, not a recording. — [GitHub README](https://github.com/facebookresearch/tribev2)
- **The published example predictions are best-case:** the project page's sentence explorer uses only the "three best subjects". — [results-explorer.js](https://github.com/facebookresearch/brain2qwerty/blob/main/docs/src/results-explorer.js)
- **Community TRIBE v2 Spaces show overclaiming patterns** ("ad-brain-scorer", "neuro-ads", "brainrot-or-not"). — [HF facebook/tribev2](https://huggingface.co/facebook/tribev2)

### Inferences
**Risk table**

| Release | What it could add to the toy | Honesty risk | Licensing risk (sponsored site) |
|---|---|---|---|
| Brain2Qwerty v1/v2 | Only a link-out explainer card, or a replay of Meta's published example sentences | High: implies mind-reading or typing-from-brain; replay data is best-3-of-9 cherry-picked | CC BY-NC code/data; docs-asset license unclear |
| TRIBE v2 (full) | Pre-computed 7-region playback for a few fixed clips, rendered by the existing jelly brain | Medium: "fMRI" and "real predictions" language easily slides into "real brain"; cortical-only output can't honestly drive HPC/THL/AMY/BG/CBL | CC BY-NC weights; output status unclear; Llama 3.2 license on the text extractor |
| TRIBE v2-subcortical / mini | Possibly subcortical playback (if verified) / no real size gain | Undocumented outputs → risk of mis-mapping | Same as above |
| TRIBE v1, brainmagick, MEG-image | Reference only | Same "decoding" connotation | CC BY-NC, no weights |
| neuroai (MIT) | Not useful at runtime | None | Permissive |

**Exact wording** (each version keeps the word "simulation" and avoids the banned phrases as claims about the toy)

- Hero (unchanged principle): "A jelly brain wrapped around a 7-region spiking simulation. Not a real brain and not a recording of anyone's."
- Brain2Qwerty explainer card (secondary page): "Real research, not this toy: Meta researchers recently reported decoding sentences that nine volunteers typed inside a lab MEG scanner (about 6 in 10 words right on average). This toy doesn't do anything like that. It's a simulation and reads nothing from you."
  - On a page bound by the literal rule "never say EEG/brain scan", mention "MEG scanner" only inside this attributed third-party description, or replace it with "lab brain-recording equipment". Decide which the content owner prefers.
- TRIBE v2 playback toggle: "Prediction mode: glow levels follow TRIBE v2, a Meta research model that predicts an average person's cortical response to this clip, simplified to 7 cartoon regions. Predicted, not measured. Still a simulation."
- Replay of Brain2Qwerty examples, if ever used: "Examples published by Meta from its three best-performing volunteers (of nine). Average accuracy across all volunteers was lower."
- **Phrases to avoid everywhere:**
  - "powered by Meta's brain AI"
  - "real fMRI"
  - "your brain's response"
  - "decode", "decoding" or "mind-reading" applied to the toy
  - "brain-to-text"
  - "neuro-score"
  - "scientifically accurate brain"

### Gaps
- Whether the CONTENT-PLAYBOOK rule forbids *mentioning* MEG/EEG in attributed third-party research context, or only *claiming* them for the toy, is a policy decision for the site owner. The rule text reads as a ban on claims.
- I had no access to Meta's brand or trademark usage guidance for naming "Meta", "TRIBE" or "Brain2Qwerty" on a sponsored site. Name-only factual attribution with links is the conservative approach.
