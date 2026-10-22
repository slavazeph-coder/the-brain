# How reliable VLMs and video LLMs are at absolute metric size and distance (as of Oct 2026)

Scope: this covers absolute metric estimation only (object width and height in metres or cm, distances between objects, room floor area). Relative tasks (left/right, which is closer) are left out except to contrast with the metric results. Dates are tagged [2024] for older results and [2025] or [2026] for current ones. Metric definitions used below:
- **MRA (Mean Relative Accuracy, VSI-Bench and Metric-Bench):** the mean over thresholds θ ∈ {0.50, 0.55, …, 0.95} of 1(|ŷ−y|/y < 1−θ).
- **δ≤2 ("within 2x"):** max(ŷ/y, y/ŷ) ≤ 2.
- **±25% success (SpatialRGPT-Bench).**
- **Acc@10%:** within 10% relative error.

## 1. Benchmark results for absolute metric estimation from single images (Q-Spatial, SpatialRGPT-Bench, SpatialVLM, Metric-Bench, Metric VQA, MMSI)

### Takeaway
From a single uncalibrated image, even the best 2025–2026 models are only reliable at the "within 2x" level. They rarely reach "within 25%" and almost never "within 10%":
- **Within 10%:** fewer than about 40% of answers.
- **Within 25%:** about 40–68%.
- **Within 2x:** about 60–72%.

Distance between objects is consistently the weakest category. The strongest 2026 evidence is the Metric VQA study: open VLMs mostly name the object and recall its typical size, a text-only LLM does as well or better, and the models largely ignore scene geometry.

### Cited Findings
**Q-Spatial Bench [2024, EMNLP 2024]**
- Benchmark design: 271 manually annotated questions in two splits. Q-Spatial-ScanNet has 99 images and 170 questions. Q-Spatial++ has 101 iPhone images with 101 questions, horizontal distance only. Five categories: object width, object height, horizontal distance, vertical distance and direct distance. The main metric is δ≤2 success rate. — [Liao et al., arXiv 2409.09788](https://arxiv.org/html/2409.09788)
- Success rate (δ≤2), standard prompt vs SpatialPrompt, on ScanNet and Q++ — [arXiv 2409.09788](https://arxiv.org/html/2409.09788):

  | Model | ScanNet standard | ScanNet SpatialPrompt | Q++ standard | Q++ SpatialPrompt |
  |---|---|---|---|---|
  | GPT-4o | 69.41 | 71.96 | 61.06 | 62.71 |
  | GPT-4V | 28.24 | 54.90 | 18.81 | 53.47 |
  | Gemini 1.5 Pro | 0.59 | 53.65 | 0.99 | 43.17 |
  | Gemini 1.5 Flash | 20.00 | 52.71 | 26.73 | 38.42 |
  | LLaVA-v1.6-34B | 60.59 | 51.76 | 36.62 | 45.07 |

  Three human raters averaged 90% on a 40-question sample (individual scores 82.5, 90 and 97.5).
- Per-category GPT-4o results (ScanNet, standard prompt, δ≤2): width 81.16, height 93.94, horizontal distance 49.44, vertical distance 71.26, direct distance 78.70. Horizontal distance is the hardest category for most models. — [arXiv 2409.09788](https://arxiv.org/html/2409.09788)

**SpatialRGPT-Bench [2024, NeurIPS 2024]**
- Each cell is success rate (within ±25%) / absolute relative error — [Cheng et al., arXiv 2406.01584](https://arxiv.org/html/2406.01584):

  | Model | Direct distance | Horizontal distance | Vertical distance | Width | Height |
  |---|---|---|---|---|---|
  | GPT-4V | 29.7 / 0.92 | 25.4 / 2.75 | 33.0 / 0.48 | 51.1 / 0.37 | 68.4 / 1.57 |
  | GPT-4 (text only) | 21.6 / 1.29 | 11.5 / 2.08 | 33.0 / 0.65 | 52.3 / 0.52 | 48.1 / 1.40 |
  | LLaVA-v1.6-34B | 24.3 / 0.76 | 24.5 / 1.59 | 30.1 / 0.62 | 30.8 / 0.40 | 42.8 / 1.96 |
  | SpatialRGPT-VILA-1.5-8B | 45.9 / 0.31 | 68.0 / 0.22 | 56.6 / 0.28 | 48.9 / 0.28 | 61.7 / 0.41 |

  Even this specialist model, trained on in-domain data, is within ±25% on only about 46–68% of questions.

**SpatialVLM [2024]**
- Quantitative QA, 215 questions, share of answers within [0.5x, 2x] of ground truth: SpatialVLM 37.2% (it gave a number 99% of the time), PaLM 2-E 33.9%, LLaVA-1.5 13.0%. GPT-4V scored 0.0% because it gave a number only 1.0% of the time. — [Chen et al., arXiv 2401.12168](https://arxiv.org/html/2401.12168)

**Metric-Bench [2026, arXiv Sep 2026]**
- Benchmark design: ScanNetV2 images. Each question gives reference objects with known metric sizes and no camera intrinsics, so this is the best case of "reference-object prompting". 1,340 test QA pairs covering size, position, depth, distance and 3D box. — [Xi et al., arXiv 2609.25841](https://arxiv.org/html/2609.25841v1)
- Results. Columns are average MRA, size MRA, distance MRA, and δ1 (share within 1.25x) — [arXiv 2609.25841](https://arxiv.org/html/2609.25841v1):

  | Model | Avg MRA | Size MRA | Distance MRA | δ1 |
  |---|---|---|---|---|
  | Human | 76.83 | 81.51 | 79.35 | 0.79 |
  | Qwen3-VL-32B | 39.24 | 42.11 | 22.28 | 0.38 |
  | Qwen3-VL-8B | 37.04 | 40.44 | 21.14 | 0.37 |
  | GPT-5-mini (400-question subset) | 37.84 | — | 22.73 | 0.40 |
  | Gemini-2.5-flash (400-question subset) | 33.95 | — | 18.87 | 0.33 |
  | InternVL3.5-8B | 32.00 | — | 21.46 | 0.31 |
  | Qwen2.5-VL-7B | 27.58 | — | 16.71 | — |
  | MetricReasoner (Qwen3-VL-8B + reinforcement fine-tuning) | 48.59 | 52.65 | 19.81 | 0.47 |

  RMSE for the best model is about 0.53 m. Distance has the lowest MRA for most models.

**Metric VQA ("Ill-Posed by Design") [2026, arXiv Jun 2026]**
- Benchmark design: 10,813 object-dimension queries from Objectron, plus 331 in-the-wild scenes measured with a tape. Twelve open VLMs from 3B to 397B parameters. — [Meivar et al., arXiv 2606.24335](https://arxiv.org/html/2606.24335)
- Acc@10% and mean absolute error (MAE), in-the-wild split — [arXiv 2606.24335](https://arxiv.org/html/2606.24335):

  | Model | Acc@10% | MAE (cm) |
  |---|---|---|
  | Human | 39.3% | 6.48 |
  | Text-only "ChatGPT 5.5" (no image) | 36.9% | 9.53 |
  | Qwen3-VL-235B | 30.8% | 10.88 |
  | Qwen3.5-397B | 30.8% | 10.27 |
  | InternVL3.5-241B | 20.9% | 17.42 |
  | Qwen2.5-VL-7B | 20.8% | 30.60 |
  | Gemma3-4B | 12.7% | — |
  | Qwen2.5-VL-3B | 6.0% | — |

  No open VLM beats the text-only baseline on the in-the-wild split. On the Objectron split, Qwen3.5-397B scores 43.6% and Qwen3-VL-235B 38.9%.

**MMSI-Bench, "Attribute (Measurement)" [2025]**
- GPT-5 scores 41.67 against 98.0 for humans (standardized protocol), and 54.69 against 95.3 (official protocol). The authors write that "MM [metric measurement] is inherently an ambiguous task without camera intrinsics." — [Cai et al., Holistic Evaluation of MLLMs on Spatial Intelligence, arXiv 2508.13142](https://arxiv.org/html/2508.13142v2)

### Inferences
- How to read MRA: a prediction with 0% error scores 1.0, about 10% error scores 0.8, about 25% error scores 0.5, and 50% or more error scores 0. So an MRA in the 30s–40s means the typical error is roughly 30–40%.
- For scaling a simulation map, a VLM size estimate alone should be treated as about ±30–50% (1σ-ish) for object size and worse for distances, even with Qwen3-VL-class models.
- The success rates within 2x (60–72%) imply that about 1 in 3 or 4 answers is off by more than 2x.
- The Metric VQA result means a lookup table of category sizes, or an LLM with no image, is about as good as the VLM. The VLM adds most of its value by identifying the object correctly, not by measuring it.

### Gaps
- No verified absolute-metric numbers were gathered for BLINK, CV-Bench, 3DSRBench, OmniSpatial or SPAR-Bench. These benchmarks are mostly relative or multiple-choice; their metric subtasks were not checked here.
- No Claude results on metric benchmarks were found in the sources read.
- No GPT-5 or Gemini 3 results on Q-Spatial were found.
- The Q-Spatial paper reports inconsistent SpatialPrompt gains between its abstract, text and tables (for example, "40/20/30" vs "47/22/30" points) — [arXiv 2409.09788](https://arxiv.org/html/2409.09788).

## 2. Object size, room size and absolute distance from video (VSI-Bench): best models vs humans

### Takeaway
On VSI-Bench's metric tasks, which use MRA, the best spatially fine-tuned open models built on Qwen3-VL-8B now beat the human baseline:
- object size about 76–79 vs 60.4 for humans
- room size about 57–76 vs 45.9
- absolute distance about 52–59 vs 47.0

Frontier closed models are weaker. GPT-5 beats humans on object size and room size but not on absolute distance.

Two caveats:
- **Humans are poor at this too.** Their baseline is low because they have no tape measure.
- **The open-model scores are inflated.** The spatial training data comes from the same scan datasets as the benchmark, and object size can largely be predicted from the category name alone.

### Cited Findings
**Original VSI-Bench results [Dec 2024 / CVPR 2025; MRA]**
- VSI-Bench has more than 5,000 QA pairs from egocentric indoor videos — [Yang et al., Thinking in Space, arXiv 2412.14171](https://arxiv.org/html/2412.14171v2). Its measurement tasks draw on ScanNet, ScanNet++ and ARKitScenes — [VLM-3R, arXiv 2505.20279](https://arxiv.org/html/2505.20279v4).
- Scores on the three metric tasks — [arXiv 2412.14171](https://arxiv.org/html/2412.14171v2):

  | Model | Abs. distance | Object size | Room size |
  |---|---|---|---|
  | Human (400-question subset, unlimited replay) | 47.0 | 60.4 | 45.9 |
  | Frequency chance | 32.0 | 29.9 | 33.1 |
  | GPT-4o | 5.3 | 43.8 | 38.2 |
  | Gemini-1.5 Pro | 30.9 | 64.1 | 43.6 |
  | Gemini-2.0 Flash (subset) | 30.6 | 66.7 | 31.8 |
  | LLaVA-Video-72B | 22.8 | 57.4 | 35.3 |
  | LLaVA-OneVision-72B | 23.9 | 57.6 | 37.5 |
  | InternVL2-40B | 26.2 | 48.2 | 27.5 |

**Frontier closed models [2025; standardized / official protocol]** — [arXiv 2508.13142](https://arxiv.org/html/2508.13142v2)

| Model | Abs. distance | Object size | Room size |
|---|---|---|---|
| GPT-5 | 33.62 / 34.47 | 73.72 / 73.31 | 50.53 / 47.52 |
| Gemini-2.5-Pro | 37.91 / 37.39 | 70.55 / 68.72 | 51.81 / 54.37 |
| Grok-4 | 30.47 / 32.96 | 68.80 / 60.82 | 49.51 / 45.42 |
| Qwen2.5-VL-72B | 25.18 / 26.27 | 43.77 / 58.52 | 39.76 / 40.07 |
| InternVL3-78B | 37.89 / 38.47 | 56.59 / 53.20 | 44.13 / 43.99 |

Quote from the paper: GPT-5 "effectively closes the human–model performance gap, and surpass[es] human performance in Object Size and Room Size."

**Open models, 2025–2026 [MRA]**

| Model | Abs. distance | Object size | Room size | Avg | Source |
|---|---|---|---|---|---|
| Qwen3-VL-8B (base) | 52.3 | 76.1 | 56.7 | 59.8 | [arXiv 2608.10278](https://arxiv.org/html/2608.10278) |
| Space Tokens (Qwen3-VL-8B) | 57.4 | 77.8 | 72.5 | 64.1 | [arXiv 2608.10278](https://arxiv.org/html/2608.10278) |
| SenseNova-SI-1.3 (Qwen3-VL-8B) | 59.4 | 79.2 | 75.7 | 68.9 | [arXiv 2608.10278](https://arxiv.org/html/2608.10278) |
| Gemini 3 Pro | 37.8 | 72.7 | 44.1 | 52.5 | [arXiv 2608.10278](https://arxiv.org/html/2608.10278) |
| Cambrian-S-7B | 50.5 | 74.9 | 72.2 | 67.5 | [Cambrian-S, arXiv 2511.04670](https://arxiv.org/html/2511.04670) |
| Cambrian-S-3B | 40.6 | 68.0 | 46.3 | — | [arXiv 2511.04670](https://arxiv.org/html/2511.04670) |
| VLM-3R (7B, CUT3R geometry) | 49.4 | 69.2 | 67.1 | 60.9 | [arXiv 2505.20279](https://arxiv.org/html/2505.20279v4) |
| Spatial-MLLM-4B | 34.8 | 63.1 | 45.1 | — | [arXiv 2505.20279](https://arxiv.org/html/2505.20279v4) |
| Qwen2.5-VL-7B | 10.9 | 35.8 | 29.2 | — | [arXiv 2505.20279](https://arxiv.org/html/2505.20279v4) |

- The Gemini 3 Pro per-task values in [arXiv 2608.10278](https://arxiv.org/html/2608.10278) look anomalous, and the extraction itself flagged them.
- The same model scores differently in different papers. Qwen3-VL-8B averages 59.8 in [arXiv 2608.10278](https://arxiv.org/html/2608.10278) but 57.9 in [SenseNova-SI, arXiv 2511.13719](https://arxiv.org/html/2511.13719). GPT-5's average is 43.77 under the standardized protocol and 55.03 under the official one — [arXiv 2508.13142](https://arxiv.org/html/2508.13142v2).

**Shortcuts in VSI-Bench [2025]**
- Category-level features predict VSI-Bench object size with 61.4% accuracy, against a 34.0 majority baseline. The single dominant feature is the category's average log size (Gini importance 0.968).
- Questions about low-variance categories are the most guessable: dishwasher (coefficient of variation 0.037), washer (0.058), bed (0.080). High-variance categories are not: ceiling light (0.778), radiator (0.755).
- About 32% of object-size questions were removed to build VSI-Bench-Debiased.
- All of the above: [Brown, Yang et al., "Benchmark Designers Should Train on the Test Set", arXiv 2511.04655](https://arxiv.org/html/2511.04655v1).
- Scores drop on the debiased version — [arXiv 2511.04670](https://arxiv.org/html/2511.04670):

  | Model | VSI-Bench | VSI-Bench-Debiased |
  |---|---|---|
  | Cambrian-S-7B | 67.5 | 59.9 |
  | InternVL3.5-8B | 56.3 | 49.7 |
  | Gemini-2.5 Pro | 51.5 | 49.1 |

**ReVSI [2026, ICML 2026]**
- The authors found that point-cloud annotations reused as video ground truth miss visible objects, mislabel objects and corrupt geometry answers such as size. With only 16–64 sampled frames, many questions cannot be answered.
- They re-annotated 381 scenes and subsampled objects with dominant sizes so that typical-size priors cannot be exploited.
- Sources: [Zhang et al., arXiv 2604.24300](https://arxiv.org/abs/2604.24300); [ReVSI PDF](https://arxiv.org/pdf/2604.24300).

### Inferences
- Room size is where geometry-aware or fine-tuned open models gain most: from about 57 to about 72–76 MRA.
- Absolute distance between objects remains the weakest task, at 50–59 MRA at best, which corresponds to a typical error of about 20–25%.
- High VSI-Bench object-size scores largely reflect category priors plus in-distribution ScanNet/ARKitScenes training. The scores should not be expected to transfer to a robotics customer's warehouse, lab or home scans with unusual objects.

### Gaps
- No ReVSI per-model numbers were extracted (only the abstract was read).
- No per-task VSI-Bench-Debiased numbers for the metric tasks were found.
- No video-LLM results on non-ScanNet domains (warehouses, outdoor) were found.

## 3. Failure modes, and whether chain-of-thought or reference-object prompting helps

### Takeaway
The failure modes are:
- scale ambiguity when camera intrinsics are unknown
- reliance on category priors instead of pixels
- refusal or hedging (2024-era models)
- poor distance reasoning across perspective
- miscalibrated confidence

Asking the model to reason from reference objects helps weak or refusing models a lot. It adds little for strong models, and can hurt some open ones. Generic chain-of-thought hurts the VSI-Bench size tasks.

### Cited Findings
**Prompting**
- On VSI-Bench, zero-shot chain-of-thought and tree-of-thoughts lowered the average by about 4%, and self-consistency was 1.1% below baseline. Room size and object size dropped by 8–21%. — [arXiv 2412.14171](https://arxiv.org/html/2412.14171v2)
- Letting the model generate a "cognitive map" raised relative-distance accuracy (46.0 → 56.0 with the model's own map, 66.0 with the ground-truth map), but that is a relative task. — [arXiv 2412.14171](https://arxiv.org/html/2412.14171v2)
- About 71% of Gemini-1.5 Pro's errors were classed as spatial reasoning. — [arXiv 2412.14171](https://arxiv.org/html/2412.14171v2)
- On Q-Spatial, GPT-4o answers that used a reference object succeeded 83% of the time vs 64% without (logistic coefficient 1.02, about 2.7x odds, p<0.05). SpatialPrompt raised reference-object use to 88–100% of answers. — [arXiv 2409.09788](https://arxiv.org/html/2409.09788)
- SpatialPrompt gains on Q-Spatial ScanNet:
  - Gemini 1.5 Pro went from 0.59 to 53.65. The baseline was near zero because the model refused to give numbers.
  - GPT-4o gained only 2.5 points (69.41 → 71.96).
  - LLaVA-1.6-34B lost about 9 points (60.59 → 51.76).
  - The authors note inconsistent gains for open models and fewer gains when an image has few visual cues.
  - Source: [arXiv 2409.09788](https://arxiv.org/html/2409.09788)
- Even with known-size reference objects supplied, the best models reach only about 37–49 MRA on Metric-Bench against 77 for humans — [arXiv 2609.25841](https://arxiv.org/html/2609.25841v1). Its failure modes:
  - Error grows with the distance between the reference and the target, because the model scales by pixel ratio and ignores perspective.
  - Open models rarely use focal length or pinhole geometry.
  - Distance is the hardest category.

**Category priors and refusals**
- Metric VQA counterfactual tests show what drives the answer:
  - Swapping the target object's identity costs 20.3 pp of Acc@10% for Qwen3-VL-235B.
  - A 1.4x zoom-in leaves predictions unchanged for all 12 models (median ratio 1.00).
  - Most models ignore lens distortion.
  - The authors conclude that "global scene geometry is largely unused", and that LoRA fine-tuning improves existing cues but does not teach geometry use.
  - Source: [arXiv 2606.24335](https://arxiv.org/html/2606.24335)
- Refusals and hedging: Gemini 1.5 Pro consistently refused to give measurements under a standard prompt — [arXiv 2409.09788](https://arxiv.org/html/2409.09788). GPT-4V gave a number for only 1% of quantitative questions — [arXiv 2401.12168](https://arxiv.org/html/2401.12168). GPT-4o sometimes used floor tiles as a reference, which gave inaccurate estimates — [arXiv 2409.09788](https://arxiv.org/html/2409.09788).

**Camera and lens dependence**
- RGB-only MLLMs are "fundamentally flawed in their ability to generalize across cameras": they mix object properties with camera perspective and overfit to the training camera distribution. The paper proposes intrinsics embeddings plus camera augmentation. — [Zhang et al., ICLR 2026, arXiv 2603.06704](https://arxiv.org/abs/2603.06704)

**Calibration**
- LLMs and VLMs are overconfident. When asked for a mean, a standard deviation and a 95% interval, VLMs give poorly calibrated intervals. — [Groot & Valdenegro-Toro, arXiv 2405.02917](https://arxiv.org/html/2405.02917v1)

### Inferences
- For a Qwen-class local model, prompting gains will be small. The bigger levers are:
  - giving the actual intrinsics and measured references (which the product already has)
  - asking for a category label rather than a number
  - comparing against geometry
- A VLM's self-reported uncertainty should not be used as the error bar.
- Phone and robot cameras with unusual FOV (wide-angle, fisheye) are a specific risk for any model trained on ScanNet/ARKit-style imagery.

### Gaps
- No 2026 study was found that quantifies hallucinated sizes for confusable look-alike objects (for example toy vs real car, or a small vs full-size fridge). The Metric VQA "wrong object" test is the closest.

## 4. Grounding VLMs with geometry (depth, 3D reconstruction, intrinsics) and the accuracy gains

### Takeaway
Adding geometry helps, but the gains are moderate:
- **3D-reconstruction features:** about +4–16 MRA on room size and +5–6 on distance.
- **Depth input:** about +6 pp success on distance.

Most of the jump on benchmarks comes from in-domain spatial fine-tuning, not from geometry. None of these systems approaches the accuracy of real metric geometry, which for this product means SfM or metric depth plus a user-measured scale reference.

### Cited Findings
- **SpatialRGPT-7B with a depth plugin [2024]**, success within ±25%, RGB only → with depth:
  - direct distance 35.1 → 41.2
  - horizontal distance 59.0 → 65.6
  - width 51.9 → 49.6 (worse)
  - height 54.9 → 57.9
  - Source: [arXiv 2406.01584](https://arxiv.org/html/2406.01584)
- **VLM-3R [2025]**, adding CUT3R reconstruction tokens on top of a VSI-fine-tuned LLaVA-NeXT-Video-7B. Most of the gain over the base model came from fine-tuning alone (35.6 → 57.7 average); geometry added about +3 more. — [arXiv 2505.20279](https://arxiv.org/html/2505.20279v4)

  | | Abs. distance | Room size | Object size | Avg |
  |---|---|---|---|---|
  | Fine-tuned, no geometry | 43.6 | 63.7 | 70.8 | 57.7 |
  | With CUT3R geometry | 49.4 | 67.1 | 69.2 | 60.9 |

- **Space Tokens [2026]** (geometry distilled from VGGT into reserved tokens) on Qwen3-VL-8B: room size +15.8, absolute distance +5.1, object size +1.7 MRA. — [arXiv 2608.10278](https://arxiv.org/html/2608.10278)
- **SD-VLM [2025, NeurIPS 2025]** (depth positional encoding using Depth-Anything-V2, on LLaVA-1.5-7B) reached a 56.31% success rate on its MSMU-Bench. The paper says it beats GPT-4o by 26.91% and InternVL3-78B by 25.56%. — [Chen et al., arXiv 2509.17664](https://arxiv.org/html/2509.17664v1); [NeurIPS poster](https://neurips.cc/virtual/2025/poster/118216)
- **MetricReasoner [2026]** (reinforcement fine-tuning with metric rewards on Qwen3-VL-8B): Metric-Bench MRA 37.04 → 48.59. On Q-Spatial++, RMSE fell to 64.77 cm vs 143.54 cm for the base model. — [arXiv 2609.25841](https://arxiv.org/html/2609.25841v1)
- **Camera-aware MLLM [2026, ICLR 2026]** (intrinsics embedding, camera augmentation, distillation from a 3D foundation model) "substantially outperform[s]" naive models in cross-camera tests. The abstract gives no numbers. — [arXiv 2603.06704](https://arxiv.org/abs/2603.06704)

### Inferences
- In a robotics mapping product, it is safer to put geometry first and use the VLM for semantics than to use a geometry-augmented VLM for measurement:
  - Measure every dimension from the reconstruction, made metric by a calibrated scale or a metric-depth model.
  - Use the VLM only to name the object and to decide which category prior applies.
- Using a "VLM + metric depth" pipeline means trusting the depth model's scale. That too should be checked against the measured-scale calibration the product already has.

### Gaps
- No head-to-head was found comparing "VLM-guessed size" with "metric monocular depth (e.g., Depth Anything / UniDepth) + segmentation" on the same metric-size benchmark.
- No published accuracy numbers for SpatialLM-style room-layout models were collected.

## 5. Best practice for using VLM size estimates safely (priors, uncertainty, ensembles, consistency checks)

### Takeaway
Use the VLM to pick a category and look up a curated size range. Turn many such object priors into one robust scale check on the reconstruction. Only raise a flag when the reconstruction disagrees by more than about 1.5–2x. Never write a VLM number into the map as ground truth, and never trust the VLM's stated confidence.

### Cited Findings
- **Category is what drives VLM size answers.** Target identity is the main cue, a text-only LLM matches or beats VLMs, and models ignore scene geometry — [arXiv 2606.24335](https://arxiv.org/html/2606.24335). The category's average size explains most VSI-Bench object-size answers — [arXiv 2511.04655](https://arxiv.org/html/2511.04655v1).
- **Low-variance categories are reliable anchors; high-variance ones are not.** Dishwasher, washer and bed have coefficients of variation of 0.04–0.08; ceiling light and radiator about 0.76–0.78 — [arXiv 2511.04655](https://arxiv.org/html/2511.04655v1).
- **Feeding category averages to a VLM works on benchmarks.** One study inserted averaged values into the prompt and raised LLaVA-NeXT-Video-7B's VSI absolute-distance score from 0.14 to 0.61 — [arXiv 2605.30231](https://arxiv.org/pdf/2605.30231) (seen only as a search snippet; verify before relying on it).
- **Verbalized numeric uncertainty is poorly calibrated.** Models are overconfident and their 95% intervals miss the truth too often — [arXiv 2405.02917](https://arxiv.org/html/2405.02917v1). Temperature scaling helps VLM classification calibration but was not tested for regression — [arXiv 2402.07417](https://arxiv.org/pdf/2402.07417).
- **Reference objects help, but are not enough.** Correct references raise accuracy — [arXiv 2409.09788](https://arxiv.org/html/2409.09788) — but are still far from human level, and the error grows with the distance between reference and target — [arXiv 2609.25841](https://arxiv.org/html/2609.25841v1).
- **Results are sensitive to prompt and protocol.** GPT-5's VSI-Bench average moves from 43.77 to 55.03 between the standardized and official protocols — [arXiv 2508.13142](https://arxiv.org/html/2508.13142v2).

### Inferences
These are recommendations for BrainSNN World Builder, derived from the findings above.

1. **Keep geometry authoritative.** The map's scale comes from the reconstruction plus the existing two-point measured-scale calibration. The VLM never sets scale on its own.
2. **Ask the VLM for categories, not numbers.** Use the existing human-reviewed, frame-bound labels as keys into a curated size-prior table (category → min/typical/max, with a variance class). Building codes and product standards should be cited per entry; standard door heights are a likely anchor, but no source was gathered here.
3. **Build a robust scale check.** For each high-confidence, low-variance object:
   - compute the ratio of its reconstructed dimension to the prior's typical dimension
   - take the median and the interquartile range across objects
   - if the median ratio falls outside about [0.67, 1.5] or the objects disagree strongly with each other, flag the calibration for human review rather than auto-correcting it
4. **If numeric VLM estimates are used at all:**
   - ask several frames and several prompt phrasings
   - take the median and use the spread across them as the uncertainty, not the model's stated confidence
   - give the camera intrinsics, and give known references only when they sit near the target
   - store results as "prior/suggestion" with provenance; never as ground truth
5. **Never use VLM estimates for:**
   - distances between objects (the worst task on every benchmark)
   - room dimensions without geometry
   - safety-relevant clearances (doorway widths, aisle widths) in a robot simulation
6. **Default error bars:** treat a VLM object-size estimate as roughly ±40% at 1σ, with about 25–35% of answers outside 2x. Treat a distance estimate as worse.

### Gaps
- No published method was found for calibrating VLM numeric size or distance outputs, for example conformal prediction on metric-size regression. This appears to be an open problem.
- No authoritative citation was gathered for standard object-size priors such as door heights.

## 6. Open-weight models that run locally (GB10 with 128 GB unified memory, RTX 4090 with 24 GB) and their commercial licences

### Takeaway
Qwen3-VL (Apache-2.0) is the best general local choice. InternVL3.5 (Apache-2.0) and Cambrian-S-7B (Apache-2.0) are alternatives. SenseNova-SI checkpoints (fine-tunes of Qwen3-VL and InternVL3) score highest on VSI-Bench, but their licence was not verified.

Even the best of these are only "within roughly 25–40%" estimators, as above. A model upgrade will not remove the need for geometry.

### Cited Findings
- **Qwen3-VL.**
  - Licence: Apache-2.0. Family: dense and MoE, Instruct and Thinking editions. The card mentions 3D grounding for spatial reasoning. — [HF Qwen/Qwen3-VL-8B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct)
  - Sizes seen in benchmarks: 2B and 8B — [arXiv 2511.13719](https://arxiv.org/html/2511.13719); 32B — [arXiv 2609.25841](https://arxiv.org/html/2609.25841v1); 235B — [arXiv 2606.24335](https://arxiv.org/html/2606.24335).
- **InternVL3.5.** Model cards list Apache-2.0 — [HF InternVL3_5-4B commit](https://huggingface.co/OpenGVLab/InternVL3_5-4B/commit/df0a7ca549f147b1e9921327b3e373fc42b3364f); [HF InternVL3_5-38B commit](https://huggingface.co/OpenGVLab/InternVL3_5-38B/commit/fa29caeb98d42dfef20b2b2ddd464cc80b235977). InternVL3.5-8B scores 56.3 on VSI-Bench and 49.7 on the debiased version — [arXiv 2511.04670](https://arxiv.org/html/2511.04670).
- **Cambrian-S-7B.** Apache-2.0, built on Qwen2.5-7B-Instruct with a SigLIP2-SO400M encoder; self-reported VSI-Bench 67.5 — [HF nyu-visionx/Cambrian-S-7B](https://huggingface.co/nyu-visionx/Cambrian-S-7B).
- **SenseNova-SI.** Fine-tunes of Qwen2.5-VL-3B/7B, Qwen3-VL-8B, InternVL3-2B/8B and BAGEL-7B. Version 1.2 InternVL3-8B is listed at VSI-Bench 69.6 — [HF sensenova collection](https://huggingface.co/collections/sensenova/sensenova-vision); [HF SenseNova-SI-1.2-InternVL3-8B](https://huggingface.co/sensenova/SenseNova-SI-1.2-InternVL3-8B). The paper says all models are publicly released but states no licence — [arXiv 2511.13719](https://arxiv.org/html/2511.13719).
- **Qwen3-VL-8B vs Qwen3-VL-32B on Metric-Bench:** only about a 2 MRA difference (37.04 vs 39.24) — [arXiv 2609.25841](https://arxiv.org/html/2609.25841v1).
- **Qwen3-VL-235B on Metric VQA:** 30.8% Acc@10% on the in-the-wild split, below a text-only LLM (36.9%) — [arXiv 2606.24335](https://arxiv.org/html/2606.24335).

### Inferences
- **Memory fit.** This is weight-only arithmetic at about 2 bytes per parameter for BF16 and about 0.5–0.6 for 4-bit, before KV-cache and video tokens; no benchmarked source was found.
  - Qwen3-VL-8B in BF16 needs about 17–18 GB: it fits a 4090 and fits a GB10 comfortably.
  - Qwen3-VL-32B in BF16 needs about 65 GB: it fits a GB10, but on a 4090 it needs a 4-bit quant (about 18–20 GB).
  - Qwen3-VL-235B-A22B needs about 120–130 GB even at 4-bit: marginal on a 128 GB GB10 and not practical.
- **Model size matters little for metric accuracy.** Gains from 8B to 32B are small, so the extra compute is not justified for size estimation.
- **Prefer general models for production.** Spatial fine-tunes (SenseNova-SI, Cambrian-S, VLM-3R) mostly help on ScanNet-like indoor video. Treat them as optional experiments, and use them only after checking the licence and running an in-house test against tape-measured ground truth.

### Gaps
- SenseNova-SI's licence was not confirmed.
- The licences of base models used by some fine-tunes (Qwen2.5-VL-3B/72B, BAGEL) were not checked. Some Qwen2.5 sizes may use non-Apache Qwen licences.
- No verified memory or throughput benchmarks were found for Qwen3-VL on the GB10 or the RTX 4090.
- VLM-3R's and SpatialRGPT's code and model licences were not checked.
