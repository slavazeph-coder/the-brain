# Let geometry measure and the VLM name

Yes, add a metric-scale layer. Build it from geometry rather than from the video LLM, and bring Blender in later as a visual dressing pass that never touches scale or collision geometry. Open VLMs still miss absolute sizes by roughly a third. Qwen3-VL-8B scores **37 MRA on Metric-Bench against 77 for humans**, even when the prompt gives it reference objects of known size. On tape-measured real scenes, Qwen3-VL-235B lands within 10% only **30.8%** of the time, which is below a text-only LLM that never saw the image (36.9%). The Qwen model's real value is the human-reviewed category label. That label can look up a curated size-prior table to catch gross scale errors of about 1.5–2×. The accuracy gain comes from a commercially licensed metric-depth model aligned to the COLMAP or MapAnything reconstruction by per-frame median depth ratios: **MoGe-2 (MIT code and weights)**, with **DA3METRIC-LARGE (Apache-2.0)** as a second opinion. Its 4–8% per-frame indoor error should clearly beat the fixed 1.35 m phone-height guess. It will rarely meet the roughly 2–3% tolerance that a 0.30 m robot clearance demands, though, so the two-point tape measurement stays the route to planning-grade maps, now with an automatic check for mis-clicks. Every cue should be fused in log space with inverse-variance weights, a χ² consistency test and split-conformal intervals calibrated on 30–100 in-house tape-measured rooms. Every number should carry a provenance tag, so automated cues can propose a scale but never approve one. The licence risk is in weights, assets and datasets, not code, and Blender's GPL is harmless for a server-side SaaS that runs it as a subprocess. GB10 should host the whole layer. The RTX 4090 is 2–4× faster but is currently unavailable and adds nothing to accuracy.

## VLM size guesses miss by a third and mostly recite category priors

Results agree across three generations of models: VLMs are reliable to about a factor of two, sometimes to within 25%, and almost never to within 10%. On Q-Spatial, GPT-4o is within 2× of ground truth on **69.4%** of ScanNet questions, so about one answer in three is off by more than double ([Q-Spatial](https://arxiv.org/html/2409.09788)). SpatialRGPT, a specialist trained on in-domain data, is within ±25% on only **46–68%** of questions, depending on category ([SpatialRGPT](https://arxiv.org/html/2406.01584)). The 2026 benchmarks are harsher because they remove the usual excuses. Metric-Bench puts known-size reference objects in every question, which is the best case for reference prompting. It still finds Qwen3-VL-8B at **37.0 average MRA** and Qwen3-VL-32B at **39.2**, against **76.8 for humans**, with distance the weakest category ([Metric-Bench](https://arxiv.org/html/2609.25841v1)). MRA (mean relative accuracy) scores a 10% error as 0.8 and a 25% error as 0.5, so a score in the high 30s means a typical error of about 30–35%. The Metric VQA study measured 331 real scenes with a tape. Qwen3-VL-235B was within 10% on **30.8%** of queries (mean absolute error 10.9 cm), Qwen3.5-397B also on 30.8%, and a text-only LLM given no image on **36.9%** ([Metric VQA](https://arxiv.org/html/2606.24335)). Humans eyeballing the same photos managed only 39.3%. Nobody, human or model, measures to 10% by looking.

Video LLMs look better on paper. Because World Builder captures video, that gap needs a close look. On VSI-Bench, base Qwen3-VL-8B scores **76.1 MRA on object size, 56.7 on room size and 52.3 on absolute distance**. Spatial fine-tunes such as SenseNova-SI-1.3 push room size to 75.7. All of these beat the human baselines of 60.4, 45.9 and 47.0 ([Space Tokens comparison](https://arxiv.org/html/2608.10278)). Three facts deflate these scores:

- **Category alone predicts the answer.** Category-level features alone predict VSI-Bench object size with **61.4% accuracy, against a 34.0 majority baseline**, and the category's average log size carries almost all of the importance ([Brown, Yang et al.](https://arxiv.org/html/2511.04655v1)). On the debiased benchmark, Cambrian-S-7B drops from 67.5 to 59.9 ([Cambrian-S](https://arxiv.org/html/2511.04670)).
- **Training and test data overlap.** The spatial training data comes from the same ScanNet, ScanNet++ and ARKitScenes scans the benchmark uses ([VLM-3R](https://arxiv.org/html/2505.20279v4)).
- **The human baseline is weak.** The raters had no tape measure.

In error terms, 57 MRA on room size means a typical miss of about 20%, and 52 on distance about 24%, even on familiar data. A customer's warehouse, lab or unusual home will do worse.

The mechanism explains why better prompts and bigger models will not close the gap:

- **The models ignore scene geometry.** In Metric VQA's counterfactual tests, swapping the target object's identity cost Qwen3-VL-235B **20.3 points** of accuracy within 10%. A 1.4× zoom left the predictions of all 12 models unchanged (median ratio 1.00). The authors conclude that global scene geometry is largely unused ([Metric VQA](https://arxiv.org/html/2606.24335)).
- **They confuse object size with camera perspective.** RGB-only multimodal LLMs mix up object size and camera perspective, and they overfit the cameras they were trained on. That is a direct risk for wide-angle phone lenses ([Camera-aware MLLM](https://arxiv.org/abs/2603.06704)).
- **Prompting does not help.** Chain-of-thought prompting lowered VSI-Bench size scores by 8–21% ([Thinking in Space](https://arxiv.org/html/2412.14171v2)). Reference-object prompting rescued models that had refused to answer, but it added only 2.5 points for GPT-4o and cost LLaVA-1.6-34B about nine ([Q-Spatial](https://arxiv.org/html/2409.09788)).
- **A bigger model barely helps.** Going from Qwen3-VL-8B to 32B buys about **2 MRA** ([Metric-Bench](https://arxiv.org/html/2609.25841v1)).
- **Geometry grounding helps only a little.** Distilled VGGT tokens add 15.8 MRA on room size but only 5.1 on distance and 1.7 on object size ([Space Tokens](https://arxiv.org/html/2608.10278)). In VLM-3R, most of the gain came from fine-tuning, not from the reconstruction tokens ([VLM-3R](https://arxiv.org/html/2505.20279v4)).
- **The detector is the bottleneck.** In a tool-augmented study, real detectors plus measurement tools moved MRA only from 0.58 to 0.61, while ground-truth boxes reached 0.97 ([Seeing Is Not Measuring](https://arxiv.org/pdf/2609.29073)).
- **Self-reported confidence is unusable.** VLMs' own stated intervals are overconfident ([Groot & Valdenegro-Toro](https://arxiv.org/html/2405.02917v1)), so an error bar the model reports for itself cannot go into a fusion.

The Qwen model should therefore keep the job it already does, extended by one step:

1. Its human-accepted, frame-bound labels become keys into a curated size-prior table. Each entry holds the category, min, typical and max size, a variance class and a cited source.
2. The reconstruction measures each labelled object's gravity-aligned bounding box.
3. The ratio of measured to typical size, taken across several objects, becomes a gross-error alarm.

Only low-variance categories carry useful signal. Dishwashers vary with a coefficient of variation of **0.037**, washers 0.058 and beds 0.080, while ceiling lights (0.778) and radiators (0.755) are useless ([Brown, Yang et al.](https://arxiv.org/html/2511.04655v1)). If the median ratio falls outside about **0.67–1.5**, or the objects disagree with each other, the map is flagged for review rather than corrected. The alarm targets the most damaging failure in today's pipeline: an assumed phone height or a mis-clicked measurement that is wrong by half.

The alarm should never feed the fused value directly. At a log-σ of 0.30–0.40, against MoGe-2's roughly 0.06, it would carry only 2–4% of the weight anyway. VLM numbers must stay out of three things: distances, room dimensions, and clearances such as doorway and aisle widths. Every benchmark shows its worst results in exactly those categories.

## Metric depth beats the phone-height guess, not the tape measure

Today's two scale sources sit at opposite ends of the reliability range:

- **The 1.35 m phone-height assumption** has no published distribution behind it. The research team's working estimate is an error of ±10% or worse, and the fusion design gives it a starting log-σ of 0.15–0.25. Both numbers are unmeasured assumptions.
- **The two-point tape measurement** is the strongest cue the product has. Its error comes mainly from picking the points; the starting σ is about 0.5–1% at a 3 m span, also an assumption to calibrate.

The new layer therefore has two jobs. It replaces the phone-height default when nobody measured, and it independently checks a self-reported measurement when somebody did.

Single-image metric geometry models are now good enough for the first job:

- **MoGe-2** reports metric point-map error of **4.44% on NYUv2, 5.63% on iBims-1 and 7.19% on ETH3D**, but **13.4% on the harder HAMMER set** ([MoGe-2](https://arxiv.org/html/2507.02546)). Its iBims-1 metric depth error falls from 13.6% to 9.92% when it is given the true camera intrinsics. That matters because COLMAP and MapAnything both produce intrinsics. MoGe-2 runs in **29 ms at FP16 on an A100, using under 1 GB** of memory ([MoGe-2](https://arxiv.org/html/2507.02546)).
- **DA3METRIC-LARGE** reaches δ1 0.963 and AbsRel 0.070 on NYUv2, and it is the best entry on ETH3D in its authors' table ([Depth Anything 3](https://arxiv.org/html/2511.10647)).
- **MapAnything's own scale token** is weak on its own. With images only, its metric depth on ScanNet has **22.2% relative error**. That falls to **5.6%** only when intrinsics and metric poses are supplied, and the authors call its ScanNet scale sub-optimal next to MoGe-2 ([MapAnything](https://arxiv.org/html/2509.13414)).
- **VGGT** is explicitly not metric ([VGGT](https://arxiv.org/html/2503.11651)).

Benchmark scores for the same model shift by several points between papers. UniDepthV2's NYUv2 δ1, for example, ranges from 0.928 to 0.989 depending on protocol ([MoGe-2](https://arxiv.org/html/2507.02546), [Video Depth Anything](https://github.com/DepthAnything/Video-Depth-Anything)). Treat these numbers as expectations, not product claims.

The alignment recipe is simple and mirrors MP-SfM's median statistics ([MP-SfM](https://arxiv.org/html/2504.20040)):

1. For each registered frame, run MoGe-2 with the reconstruction's intrinsics.
2. Project the frame's SfM points into it, or use MapAnything's per-frame depth.
3. Take the median ratio of predicted metric depth to reconstruction depth, over valid, edge-free pixels at 0.5–5 m.
4. Combine frames with a median or Huber IRLS in log space, and bootstrap the spread.

How accurate will this be? Frame-to-frame scale scatter from metric depth models is about **5% coefficient of variation** ([DropD-SLAM](https://arxiv.org/html/2510.06216v1)). If frame errors were independent, averaging 50 frames would shrink the random part below 1%. They are not independent. Every frame of the same room shares the model's bias, and monocular models systematically shrink large or distant spaces ([Honey, I Shrunk the Arc de Triomphe!](https://arxiv.org/abs/2606.02379)). The realistic floor is the model's systematic indoor bias: probably a few percent in NYUv2-like rooms, and 10% or more in unusual spaces. That range is inferred from benchmarks and has never been measured on phone video.

Room-scale SLAM results support the optimistic end. On 7-Scenes, Scalix's metric-prior system has 12.0 cm trajectory error without any fitted scale, against 8.6 cm with one ([Scalix](https://arxiv.org/html/2608.17553)). On TUM fr1/xyz, PRISM-SLAM's error with and without a fitted scale (Sim(3) vs SE(3) alignment) differs by only 0.18 cm. The same PRISM-SLAM table also shows the failure mode: on 7-Scenes Heads its error balloons from 8.8 cm to **68.4 cm** without scale correction ([PRISM-SLAM](https://arxiv.org/html/2605.19257v4)). The depth model must therefore be one cue among several, behind a consistency check, never an unconditional override. One more constraint: fitting a single global scale to *relative* depth leaves 0.18–0.21 AbsRel of spatially varying distortion ([Image-Adaptive Scale Fields](https://arxiv.org/html/2605.07418)). Only models trained to output metric depth qualify.

Stronger cues exist, and each one changes what the user has to do:

- **A bank or ID card.** An ISO/IEC 7810 ID-1 card is **85.60 × 53.98 mm** everywhere, and no printer can silently rescale it ([ISO/IEC 7810](https://en.wikipedia.org/wiki/ISO/IEC_7810)).
- **A printed AprilTag.** AprilTag 36h11 pose error averages **1.4 mm** in lab tests ([TopoTag benchmark](https://arxiv.org/pdf/1908.01450)). That is pose error, not reconstruction-scale error, and it gets worse with distance and at oblique angles.
- **Doors.** Door heights range from **1981 mm in England and Wales to 2032 mm in the US and about 2040 mm in Scotland and Australia** ([Howarth Timber](https://www.howarth-timber.co.uk/inspiration-advice/uk-door-sizes), [itemfits](https://itemfits.com/reference/door-sizes-by-country)). That is about a 3% spread, enough for a sanity check (warn outside 1.95–2.10 m) but not for setting scale.
- **Phone sensors**, which are the step change:
  - ARKit closed an 84 m indoor hallway loop with **0.14 m of drift**, and a 145 m corridor with 0.79 m ([Sensors 2022 benchmark](https://arxiv.org/pdf/2207.06780)).
  - iPhone LiDAR measures objects larger than 10 cm to about ±1 cm ([Luetzenburg et al.](https://pmc.ncbi.nlm.nih.gov/articles/8593014)).
  - A practitioner test of RoomPlan found wall-length errors of 3–20 cm, averaging 8.5 cm ([Nomtek](https://www.nomtek.com/blog/getting-a-room-plan-with-arkit)).

The catch with phone sensors is the capture surface:

- **iOS Safari has no WebXR in any version through 27.2** ([caniuse](https://caniuse.com/webxr)).
- **Chrome on Android** exposes ARCore-backed metric depth through the WebXR Depth Sensing module ([Google](https://developers.google.com/ar/develop/webxr/arcore-comparison?hl=en), [W3C draft](https://immersive-web.github.io/depth-sensing/)).
- **The browser motion sensor (DeviceMotion)** is available everywhere ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent)). Inertial scale for SfM reached about 1% in a 2017 study ([Mustaniemi et al.](https://arxiv.org/abs/1611.09498)). A 2026 study found 4.8–9.2%, depending on whether the motion was a figure-eight or a straight line ([arXiv 2603.26740](https://arxiv.org/abs/2603.26740)).

The table below gives starting uncertainties for each cue. They come from the research synthesis and must be replaced by calibrated values before any release claim.

| Cue | Starting log-σ (pre-calibration) | 90% half-width | Evidence | Capture surface / licence |
|---|---|---|---|---|
| User two-point tape | 0.005–0.01 | ±0.8–1.6% | Limited by point picking (assumption) | Any; self-reported |
| ARKit poses, LiDAR, RoomPlan | 0.01–0.03 | ±1.6–5% | 0.14 m drift over 84 m; LiDAR ±1 cm; RoomPlan walls 8.5 cm average ([benchmark](https://arxiv.org/pdf/2207.06780), [Nomtek](https://www.nomtek.com/blog/getting-a-room-plan-with-arkit)) | Native iOS app only |
| ID-1 card or printed AprilTag/ChArUco | 0.01–0.03, fully visible and face-on | ±1.6–5% | 85.60 mm card; 1.4 mm tag pose error ([ISO](https://en.wikipedia.org/wiki/ISO/IEC_7810), [TopoTag](https://arxiv.org/pdf/1908.01450)) | Any browser |
| MoGe-2 / DA3-metric multi-frame median | 0.05–0.08 | ±8–13% | 4.4–7.2% indoor point error, 13.4% on HAMMER ([MoGe-2](https://arxiv.org/html/2507.02546)) | MIT / Apache-2.0 |
| Phone IMU from casual motion | 0.05–0.10 | ±8–16% | 1% (2017), 4.8–9.2% by motion (2026) ([2017](https://arxiv.org/abs/1611.09498), [2026](https://arxiv.org/abs/2603.26740)) | DeviceMotion in any browser |
| MapAnything images-only scale token | 0.10–0.20 | ±16–33% | 22.2% ScanNet rel; 5.6% with intrinsics and metric poses ([MapAnything](https://arxiv.org/html/2509.13414)) | Apache-2.0 weights |
| Phone-height prior (1.35 m) | 0.15–0.25 | ±25–41% | No published distribution | None needed |
| VLM size estimate or category prior | 0.30 or more | ±50% or worse | 37 MRA Metric-Bench; 30.8% within 10% ([Metric-Bench](https://arxiv.org/html/2609.25841v1), [Metric VQA](https://arxiv.org/html/2606.24335)) | Qwen3-VL Apache-2.0; flag only |

The arithmetic of the review gate follows directly. With a 0.30 m robot clearance in a 5 m room, a 3% scale error is already 15 cm. An unattended map therefore needs a 90% interval no wider than about ±2–3%. Only the tape, a card or tag, or phone sensors reach that. A browser-only capture scaled by learned depth will land around ±9–13% and still go to the reviewer. That is not a failure of the layer. It changes the review step from "type a number nobody can check" into "the scan says 4.1 m ± 0.4 m; measure one wall to tighten it to ±6 cm". And if the measurement disagrees with the learned estimate, the system flags it.

## Fuse in log space and let calibrated intervals open the gate

Every recent system that mixes learned and geometric scale does it the same way, and World Builder should copy that pattern rather than invent one:

- PRISM-SLAM estimates the logarithm of scale by weighted least squares and smooths it over time with a 1-D Kalman filter ([PRISM-SLAM](https://arxiv.org/html/2605.19257v4)).
- DGSfM averages scale robustly in log space across all image pairs ([DGSfM](https://arxiv.org/html/2607.09507)).
- MoGe-2 and MapAnything both predict scale through an exponentiated output trained with log-space losses ([MoGe-2](https://arxiv.org/html/2507.02546v1), [MapAnything](https://arxiv.org/html/2509.13414v3)).

The calculation is short:

1. Each cue k contributes ℓ_k = ln s_k, where s is metres per reconstruction unit, with a calibrated log-σ_k.
2. The fused value is the inverse-variance mean ℓ̂ = Σ w_k ℓ_k / Σ w_k, with w_k = 1/σ_k².
3. Its uncertainty is σ̂ = (Σ w_k)^−1/2.
4. The reported interval is ŝ·e^(±zσ̂).

The phone-height prior and any VLM-derived prior enter as Gaussian pseudo-cues with a wide σ. The weights show at once which cues matter. MoGe-2 at 0.06, MapAnything's token at 0.15 and the height prior at 0.20 fuse to about **0.054**, barely better than MoGe-2 alone. Adding a tape cue at 0.0075 pulls the result to about **0.0074**. Once any learned cue exists, the phone-height prior effectively retires. Once a tape measurement exists, the learned cues mainly serve to audit it.

Inverse-variance fusion is honest only when the cues agree. Each fusion therefore runs a χ² test, χ² = Σ w_k(ℓ_k − ℓ̂)², against K−1 degrees of freedom, and reports the Birge ratio √(χ²/(K−1)). If the Birge ratio exceeds about 1.5, or p < 0.01, the fusion switches to robust mode:

1. Re-fit with Huber or Cauchy IRLS in log space, or with a two-component inlier/outlier mixture.
2. Try each cue as a RANSAC hypothesis, which is cheap with fewer than ten cues.
3. If no consensus survives, inflate σ̂ by the Birge ratio and send the scan to the reviewer.

SLAM back-ends that handle false loop closures with max-mixtures and switchable constraints are the mature version of the same idea ([Wang & Olson](https://april.eecs.umich.edu/media/pdfs/wang2014icra.pdf), [Sünderhauf & Protzel](https://eprints.qut.edu.au/109582)).

Two rules prevent false confidence:

- **One cue per source.** Correlated observations collapse into a single cue per source, with σ_k² = σ_bias,k² + σ_noise,k²/N. Otherwise 300 MoGe-2 frames sharing one model's bias would produce an absurdly tight interval.
- **The tape is a cue, not an override.** It always dominates, but it stays in the fusion with a small σ. A mis-picked point or a misread tape then produces a χ² failure instead of a silently wrong map.

Learned depth models share architectures and training data. How strongly their errors correlate is unknown until calibration data measures it, so MoGe-2 and DA3 agreeing is weaker evidence than two truly independent cues agreeing.

Raw uncertainties need recalibration before they can open or close the gate. MP-SfM rescales its depth-prior uncertainty with one constant tuned on another dataset, yet its most confident 10% of Metric3D-v2 pixels remain overconfident ([MP-SfM](https://arxiv.org/html/2504.20040)). Split conformal prediction is a distribution-free alternative with a finite-sample coverage guarantee ([Angelopoulos & Bates](https://arxiv.org/abs/2107.07511)):

1. On n held-out tape-measured rooms, compute r_i = |ln(ŝ_i/s_i*)|/σ̂_i.
2. Take the ⌈(n+1)(1−α)⌉-th smallest score as q̂. With 50 rooms and α = 0.1, q̂ is the 46th smallest score.
3. Ship intervals of ŝ·exp(±q̂σ̂).

The guarantee holds only if new scans resemble the calibration set statistically (exchangeability). So calibrate separately for each group (Mondrian conformal): sparse COLMAP vs dense MapAnything, LiDAR vs non-LiDAR phones, and which cues were present. A later refinement is learned nonconformity scores, which have cut robotic interval widths by 46–54% at the same coverage ([arXiv 2509.21955](https://arxiv.org/html/2509.21955v1)).

The gate asks for a tape measurement when any of these holds:

- the 90% half-width exceeds the map tolerance;
- the χ² test fails;
- only weak cues are present (height prior, VLM, a single frame);
- the scan is unlike the calibration set, for example a new phone model or a very large room.

**Provenance format.** No OpenUSD or Alliance standard covers provenance or uncertainty. The emerging convention is a "creator" entry in the layer's customLayerData and organisation-namespaced custom attributes on prims, with metadata that informs but never drives runtime behaviour ([Omniverse USD Exchange SDK](https://docs.omniverse.nvidia.com/usd/code-docs/usd-exchange-sdk/latest/api/group__layers.html), [Learn OpenUSD](https://docs.nvidia.com/learn-openusd/latest/beyond-basics/custom-properties.html)). W3C PROV-O supplies the vocabulary: Entity, Activity, Agent; wasGeneratedBy, wasDerivedFrom, wasAttributedTo ([W3C](https://www.w3.org/blog/2012/the-prov-ontology-an-update)). World Builder should:

- Define an origin enum: **measured, sensor, inferred, generated, assumed, fused and user_edited**.
- Store a JSON record for every derived quantity (global scale, room dimensions, door widths, map cells). The record holds the value, log-σ, the conformal interval with its calibration-set id, each cue's model hash, weight and inlier flag, the χ² result, and a review record.
- Mirror the key fields as namespaced USD attributes: `brainsnn:scale:value`, `brainsnn:scale:logSigma`, `brainsnn:scale:interval90`, `brainsnn:prov:origin` and `brainsnn:review:status`. Add `brainsnn:dimsSource` (`scan_obb`, `asset_default` or `vlm_estimate`) on every object.
- Keep the full PROV record in a sidecar file referenced from customLayerData.

**Gate invariants.** Four rules keep the review gate intact:

1. Automated cues may change only the *proposed* scale and raise flags.
2. Nothing reaches the planner as approved without a review record.
3. VLM output and Blender assets never alter collision geometry.
4. The current rule that a self-reported measurement leaves `scaleVerified` false stays as it is ([World Builder notes](../../.ai-memory/world-builder-2026-10.md)). Add a separate "corroborated" note when the tape and an independent cue agree inside the calibrated interval.

The planner reads only the approved map, never the provenance.

## Blender belongs downstream of a measured skeleton

Blender cannot make World Builder's sizes more accurate, because it measures nothing. The only dimensions it can add are asset defaults, which is exactly the error the provenance scheme exists to block. What it offers is a mature headless geometry and rendering engine:

- **Headless use.** The `bpy` wheel runs without a UI. It is now at 5.2.2 on Python 3.13 only, with the 4.5 LTS line on Python 3.11 ([PyPI](https://pypi.org/pypi/bpy/json)). Only one .blend file can be open per process, and the module behaves like factory-startup background Blender ([Blender docs](https://docs.blender.org/api/current/info_advanced_blender_as_bpy.html)).
- **USD export.** The exporter writes the stage's metersPerUnit, converts axes, instances duplicates, and exports custom properties under a `userProperties` namespace. It does not author UsdPhysics colliders, rigid bodies or mass ([Blender manual](https://docs.blender.org/manual/en/latest/files/import_export/usd.html)).
- **Physics.** Physics must come from a `pxr` (usd-core) pass, either in a `USDHook.on_export` callback or afterwards ([USDHook API](https://docs.blender.org/api/current/bpy.types.USDHook.html)). The physics code the planner depends on therefore never needs Blender.

The 2025–2026 scan-to-sim literature confirms both the appeal and the hazard. No system turns a phone scan into Isaac-ready UsdPhysics with a commercially clean asset base. The closest matches:

- **Phone2Proc** builds procedural houses conditioned on a RoomPlan scan. It is Apache-2.0, with AI2-THOR output ([Phone2Proc](https://github.com/allenai/phone2proc)).
- **SpatialLM** turns a point cloud into walls, doors and oriented boxes, under the Llama 3.2 Community License ([SpatialLM](https://github.com/manycore-research/SpatialLM)).
- **ACDC** retrieves assets and rescales them to the point-cloud extent. It achieves **4–16 cm centre error and 0.59–0.74 3D-box IoU** in sim-to-sim tests, but its real-world accuracy was judged only qualitatively. A policy trained on the exact twin succeeded **25%** of the time in reality, against **90%** for one trained on randomised "cousins" ([ACDC](https://arxiv.org/html/2410.07408v3)).

LLM layout generators invent scenes rather than reproduce them. Holodeck (code Apache-2.0) draws assets from Objaverse, where roughly 77,000 of about 817,000 objects carry non-commercial licences ([Holodeck](https://github.com/allenai/Holodeck), [Objaverse](https://pypi.org/project/objaverse/0.0.4)). LayoutGPT depends on 3D-FRONT/3D-FUTURE, which is research-only ([LayoutGPT](https://github.com/weixi-feng/LayoutGPT), [3D-FUTURE terms](https://terms.aliyun.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud202004171628_60052.html)). These generators are useful for cousins, not twins.

Real-to-sim built by VLM agents is still brittle: Agentic Real2Sim's best backend failed 44 of 100 episode twins ([Agentic Real2Sim](https://huggingface.co/papers/2607.19190)). Generated fills mislead quietly. Poisson surface reconstruction "even extrapolates into some areas" ([Open3D](https://www.open3d.org/docs/release/tutorial/geometry/surface_reconstruction.html)), and Gaussian splats carry no collision geometry at all ([Radiance Fields](https://radiancefields.com/niantic-spatial-launches-places-library)).

The architecture that follows keeps the planner's geometry identical with or without Blender. It runs in three stages.

**Stage 1: measured skeleton.**
- Floor and walls come from RANSAC planes, extruded to thin static boxes.
- Obstacles become gravity-aligned oriented bounding boxes fitted to DBSCAN-clustered points. All of this uses Open3D (MIT) ([Open3D](https://www.open3d.org/docs/release/tutorial/geometry/pointcloud.html)).
- Unscanned regions become explicit unknown volumes, not plausible furniture.
- Object sizes from this stage inherit the scale error plus segmentation bleed. Their depth against walls is underestimated wherever the back of the object was never seen.

**Stage 2: physics authoring with `pxr`.** The OpenUSD defaults are traps. An unauthored metersPerUnit falls back to **0.01, that is centimetres** ([OpenUSD](https://openusd.org/release/api/group___usd_geom_linear_units__group.html)). Triangle-mesh colliders on dynamic bodies silently fall back to convex hulls ([Isaac Sim](https://docs.isaacsim.omniverse.nvidia.com/latest/physics/simulation_fundamentals.html), [UsdPhysics](https://openusd.org/release/api/usd_physics_page_front.html)). So the pass must:
- set metersPerUnit = 1, upAxis = Z and kilogramsPerUnit = 1;
- add a PhysicsScene;
- put CollisionAPI on the static boxes;
- reserve RigidBodyAPI and MassAPI for movable objects, with mass labelled inferred.

MuJoCo collides every mesh as its convex hull ([MuJoCo](https://mujoco.readthedocs.io/en/latest/modeling.html)). Generate MJCF directly from the scene spec instead, using box geoms, or CoACD (MIT) `--split` hulls for concave objects ([CoACD](https://github.com/SarahWeiii/CoACD)).

**Stage 3: Blender dressing.** Only now does Blender run:
- visual meshes scaled to the measured bounding boxes, with assets chosen through the VLM's reviewed labels, ACDC-style;
- materials and previews;
- an Infinigen-driven "cousins" export, labelled as such and kept separate from the "twin" export.

**GPL.** Blender's licence fits this design if the boundary is drawn correctly:

- Blender is GPL v2-or-later, Cycles is Apache-2.0, and Blender's outputs, .blend files included, belong to the user ([Blender](https://www.blender.org/about/license/)).
- Running even modified GPL code on a server without distributing it is not "conveying" ([GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#UnreleasedMods), [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html)). Program output is generally not covered by the program's copyright ([GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#WhatCaseIsOutputGPL)).
- Obligations arrive when Blender ships. An on-prem GB10 kit, a desktop app or a Docker image handed to customers must honour the GPL for Blender and for any bpy scripts.
- Importing `bpy` into the proprietary server's own process (a shared address space) is the pattern most likely to be read as one combined program ([GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)).
- A separate worker invoked as `blender -b --python job.py`, taking a JSON scene spec in and returning USD or GLB files, keeps the proprietary core at arm's length.

Given BrainSNN's local-first direction, decide where that boundary sits before any customer-run kit includes Blender.

Blender's biggest contribution to accuracy is indirect: generating test data. Infinigen (BSD-3) generates procedural interiors ([Infinigen](https://github.com/princeton-vl/infinigen)). Rendered as synthetic phone walkthroughs with controlled camera heights, focal lengths and room sizes, they give exact metric ground truth for regression-testing the scale pipeline and the gate logic, including deliberately corrupted tape measurements. Synthetic rooms cannot replace real calibration, because conformal coverage holds only when new scans resemble the calibration set. They do make every pipeline change testable in minutes.

## Licence lines fall at weights, assets and datasets

Code licences are almost all permissive. The restrictions hide in checkpoints, asset libraries and ground-truth datasets, and the same repository often offers both a commercial and a non-commercial variant.

| Component | Code / weights or data licence | Verdict for World Builder |
|---|---|---|
| MoGe-2, MoGe-3 | MIT / MIT on HF cards ([repo](https://github.com/microsoft/MoGe), [HF](https://huggingface.co/Ruicheng/moge-2-vitl-normal)) | Use as primary depth cue |
| Depth Anything 3 | Apache-2.0 / METRIC-LARGE, MONO-LARGE, BASE, SMALL Apache-2.0; LARGE, GIANT, NESTED CC BY-NC ([README](https://github.com/ByteDance-Seed/Depth-Anything-3)) | Use METRIC-LARGE only |
| MapAnything | Apache-2.0 / `-apache` Apache-2.0; default checkpoint CC BY-NC ([repo](https://github.com/facebookresearch/map-anything)) | Keep the `-apache` weights |
| Prompt Depth Anything (LiDAR prompt) | Apache-2.0 / Apache-2.0 ([repo](https://github.com/DepthAnything/PromptDA)) | Use if a native LiDAR app ships |
| Depth Anything V2 / Video Depth Anything metric | Apache-2.0 / Small Apache-2.0; Base and Large non-commercial or conflicting ([DA V2](https://github.com/DepthAnything/Depth-Anything-V2), [VDA](https://github.com/DepthAnything/Video-Depth-Anything)) | Small only |
| Metric3D v2 | BSD-2 / weight terms unstated ([repo](https://github.com/YvanYin/Metric3D)) | Ask the authors first |
| VGGT-1B-Commercial | Custom / gated, excludes military use ([HF](https://huggingface.co/facebook/VGGT-1B-Commercial)) | Not metric; irrelevant for scale |
| Depth Pro | Apple sample code / HF weights research-only ([HF](https://huggingface.co/apple/DepthPro)) | Avoid |
| UniDepth, UniK3D, MASt3R, DUSt3R, CUT3R | CC BY-NC or BY-NC-SA ([UniDepth](https://github.com/lpiccinelli-eth/UniDepth), [MASt3R](https://github.com/naver/mast3r), [CUT3R](https://github.com/CUT3R/CUT3R)) | Avoid |
| Qwen3-VL, InternVL3.5, Cambrian-S-7B | Apache-2.0 ([Qwen3-VL](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct), [Cambrian-S](https://huggingface.co/nyu-visionx/Cambrian-S-7B)) | Fine for labels |
| SenseNova-SI spatial fine-tunes | Licence not stated ([HF](https://huggingface.co/collections/sensenova/sensenova-vision)) | Avoid until confirmed |
| Blender / bpy / BlenderProc | GPL v2+ (Cycles Apache-2.0) / bpy GPL-3.0 / GPL-3.0 ([Blender](https://www.blender.org/about/license/), [PyPI](https://pypi.org/project/bpy/), [BlenderProc](https://github.com/DLR-RM/BlenderProc)) | Subprocess worker; GPL applies only if distributed |
| Infinigen | BSD-3, procedural assets ([repo](https://github.com/princeton-vl/infinigen)) | Preferred content source |
| Objaverse / Objaverse-XL | Per-object; about 77K of about 817K non-commercial ([Objaverse](https://pypi.org/project/objaverse/0.0.4), [XL](https://github.com/allenai/objaverse-xl)) | Filter to CC0/CC-BY; record attribution |
| 3D-FRONT/3D-FUTURE, PartNet-Mobility, Scan2CAD, SceneScript | Research or non-commercial only ([3D-FUTURE](https://terms.aliyun.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud202004171628_60052.html), [PartNet-Mobility](https://huggingface.co/datasets/sapien-sim/PartNetMobility), [Scan2CAD](https://github.com/skanti/Scan2CAD), [SceneScript](https://github.com/facebookresearch/scenescript)) | Avoid in product |
| SpatialLM | Llama 3.2 Community License ([repo](https://github.com/manycore-research/SpatialLM)) | Legal review before use |
| TRELLIS, SAM 3D Objects, Hunyuan3D-2 | MIT / custom SAM License / excludes EU, UK, South Korea ([TRELLIS](https://github.com/microsoft/TRELLIS), [SAM 3D](https://github.com/facebookresearch/sam-3d-objects), [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2)) | TRELLIS for visual-only fills |
| Open3D, trimesh, CoACD, V-HACD | MIT, MIT, MIT, BSD-3 ([Open3D](https://github.com/isl-org/Open3D), [CoACD](https://github.com/SarahWeiii/CoACD), [V-HACD](https://github.com/kmammou/v-hacd)) | Use |
| MuJoCo, Isaac Lab, Newton | Apache-2.0, BSD-3, Apache-2.0 ([MuJoCo](https://github.com/google-deepmind/mujoco), [Isaac Lab](https://github.com/isaac-sim/IsaacLab), [Newton](https://github.com/newton-physics/newton)) | Use; Isaac Sim needs extra NVIDIA components |
| ScanNet++, Matterport3D, Replica | Non-commercial ([ScanNet++](https://scannetpp.mlsg.cit.tum.de/scannetpp/static/scannetpp-terms-of-use.pdf), [Replica](https://raw.githubusercontent.com/facebookresearch/Replica-Dataset/main/LICENSE)) | Academic partner comparisons only |
| ARKitScenes / Hypersim | Commercial grant under Apple's 700M-MAU threshold / CC BY-SA 3.0 ([ARKitScenes](https://raw.githubusercontent.com/apple/ARKitScenes/main/LICENSE), [Hypersim](https://github.com/apple/ml-hypersim)) | ARKitScenes after legal sign-off; Hypersim for synthetic tests |

Three caveats apply:

- **Training-data provenance.** MIT or Apache weights say nothing about where their training data came from, and this research did not assess it. MapAnything's Apache variant stands out because it was trained only on datasets whose owners approved permissive release ([MapAnything](https://arxiv.org/html/2509.13414v3)).
- **Depth Pro.** Its GitHub README and its Hugging Face licence contradict each other, so treat it as research-only.
- **Pending confirmations.** The ARKitScenes commercial grant and the SenseNova-SI licence both need legal confirmation.

This is a technical reading of the licence texts, not legal advice.

## GB10 hosts the layer; the 4090 only adds speed

The two machines trade memory for speed:

- **GB10:** **128 GB of unified memory at 273 GB/s** ([LMSYS](https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark)) and 6,144 CUDA cores ([gpu-benchmarking](https://github.com/mrdbourke/gpu-benchmarking)).
- **RTX 4090:** **24 GB at 1,008 GB/s** and 16,384 CUDA cores ([gpu-benchmarking](https://github.com/mrdbourke/gpu-benchmarking)).

On the same benchmark harness, the 4090 runs Qwen3-VL-8B FP8 at 392 output tokens/s against 191 (2.05×), the 4-bit multimodal path 3.7× faster, and a detector fine-tune 3.6× faster. Qwen3-VL-32B and gpt-oss-120b run only on GB10 ([benchmark analysis](https://github.com/mrdbourke/gpu-benchmarking/blob/main/benchmark_analysis/README.md)).

Neither advantage matters much for this layer:

- **Depth models are small.** MoGe-2 needs under 2 GB at FP16 even at 1188², and Depth Pro 3.7 GB ([MoGe-2](https://arxiv.org/html/2507.02546v1)). A depth pass over 30–100 keyframes should take seconds to under a minute on either box. That is an extrapolation, since nobody has published GB10 or 4090 timings for these models.
- **Long captures favour GB10.** Multi-view reconstruction is where memory counts. VGGT-Omega needs 20.8 GB at 200 frames and 43.2 GB at 500 ([VGGT-Omega](https://github.com/facebookresearch/vggt-omega)), and MapAnything's memory-efficient mode handles up to 2,000 views on 140 GB ([MapAnything](https://github.com/facebookresearch/map-anything)).
- **A bigger VLM does not help scale.** Going from 8B to 32B buys about 2 MRA ([Metric-Bench](https://arxiv.org/html/2609.25841v1)), and 70B-class models decode at about 2.7 tokens/s on GB10 ([LMSYS](https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark)).

Put the whole layer on GB10. It already runs the MapAnything Apache adapter at a 5.0–5.8 GiB peak alongside the local Qwen VLM, while the 4090 is currently occupied on Vast ([World Builder notes](../../.ai-memory/world-builder-2026-10.md), [hardware note](../../.ai-memory/brainsnn-local-first-2026-10-17.md)). MoGe-2, DA3METRIC-LARGE, MapAnything and the VLM fit in 128 GB at the same time.

GB10's risk is software, not capacity. It is an ARM64 machine with GPU compute capability sm_121:

- cu128 wheels compile only up to sm_120 and break `torch.compile`.
- NVRTC 12 does not recognise sm_121.
- NGC PyTorch containers from 25.10 onward are the supported baseline ([dgx-spark-ml-guide](https://github.com/martimramos/dgx-spark-ml-guide)).
- Many pip packages still ship CUDA 12 builds, and flash-attention was "questionable" on GB10 as of January 2026 ([vLLM #31128](https://github.com/vllm-project/vllm/issues/31128), [benchmark analysis](https://github.com/mrdbourke/gpu-benchmarking/blob/main/benchmark_analysis/README.md)).

Pin one NGC-based container per model, and verify any xformers or flash-attn custom kernels before trusting results.

Blender should not go on GB10. PyPI publishes bpy 5.2 wheels for x86-64 Linux, macOS arm64 and Windows, but not for ARM64 Linux ([PyPI](https://pypi.org/pypi/bpy/json)). Dressing and USD export need no GPU, so an x86 CPU container is the simpler host. When the 4090 returns, it becomes a throughput worker for batch depth passes and x86-only packages, not a source of accuracy.

## Validation runs on BrainSNN's own tape-measured rooms

The datasets that would make validation easy are mostly off-limits for a commercial product:

- **ScanNet++** (sub-millimetre laser plus iPhone RGB-D) forbids commercial use and binds for-profit employers ([ScanNet++ terms](https://scannetpp.mlsg.cit.tum.de/scannetpp/static/scannetpp-terms-of-use.pdf)).
- **Matterport3D and Replica** are non-commercial ([Matterport EULA](https://matterport.com/legal/matterport-end-user-license-agreement-academic-use-model-data), [Replica](https://raw.githubusercontent.com/facebookresearch/Replica-Dataset/main/LICENSE)).
- **ARKitScenes** (5,047 captures with laser ground truth) carries a commercial grant for licensees under Apple's 700M-MAU threshold, which needs legal confirmation ([ARKitScenes](https://raw.githubusercontent.com/apple/ARKitScenes/main/LICENSE)).
- **Hypersim** is CC BY-SA 3.0 but synthetic. Its depth is Euclidean ray distance, which must be converted to planar z ([Hypersim](https://github.com/apple/ml-hypersim)).

Release claims and conformal calibration therefore need an in-house set of **30–100 real rooms**, captured on the target phones. Each room needs laser or tape ground truth for length, width and ceiling height, wall lengths, and door widths.

Report each metric below with medians, 90th percentiles and bootstrap intervals:

- **Scale error** |ln(ŝ/s*)| in percent, with the signed bias.
- **Room-dimension error** in cm.
- **Door-width error** in cm, the number that decides whether a robot fits through.
- **2D occupancy accuracy:** IoU and boundary F-score at 5 and 10 cm, against a map rasterised from the laser mesh.
- **Gate performance:** conformal coverage, mean interval width and human-referral rate.
- **Trajectory error** with and without fitted scale (Sim(3) vs SE(3)), where ground-truth trajectories exist ([PRISM-SLAM](https://arxiv.org/html/2605.19257v4)).

The key plot is the risk–coverage curve: the residual error of scans the gate let through, against the fraction it referred to a human. Coverage should hit 90%, within its binomial confidence interval, in every group, not just on average.

Two tests specific to the new layers complete the protocol.

**VLM prior check.** Inject known scale errors (±10%, ±25%, ±50%) into correctly scaled calibration rooms, and measure the detection rate and the false-flag rate. Run the same check using only the reviewed label looked up in the prior table, without the VLM's numeric answer; Metric VQA predicts the lookup will do as well.

**Sim layer.**
- Hash the collider layer and the planner's route with and without the Blender dressing pass, and require them to be identical.
- Lint every exported stage for: authored metersPerUnit = 1, Z-up, no triangle-mesh colliders on rigid bodies, a provenance attribute on every collider, and explicit unknown volumes.
- Load each export in Isaac Sim or Isaac Lab and in MuJoCo, as part of CI.

None of these numbers exists yet in the literature for phone captures. World Builder has to produce them itself.

## Build order: record, measure, calibrate, then dress

| Priority | Build | Why at this point | Exit criterion |
|---|---|---|---|
| P0 | Scale record, provenance enum, log-space fusion with χ² test, and a USD unit lint. Wire in the existing cues: tape, phone height, implied camera height, MapAnything scale token. Start logging DeviceMotion IMU with every capture. | Needs no new models. Makes every later cue auditable and catches the 100× unit trap. | Every proposed map carries cues, σ, origin and a review record. A synthetic mis-click triggers a χ² failure. Exports pass the lint. |
| P1 | MoGe-2 ViT-L metric-depth cue using the reconstruction's intrinsics, with median-ratio alignment, one cue per source and bootstrap intervals. DA3METRIC-LARGE as second opinion. | Largest accuracy gain for unmeasured scans, under MIT/Apache licences. | Runs in a pinned NGC container on GB10. Per-room runtime and agreement between cues are logged. |
| P2 | In-house calibration set (start at 30 rooms, grow to 100), then split and per-group (Mondrian) conformal intervals, then gate thresholds. Start capture in week one. | Turns guessed σ values into honest intervals. | Empirical 90% coverage within its binomial confidence interval in each group, and a published σ table. |
| P3 | ID-1 card or printed AprilTag sheet cue, with a check for printer scaling. | The only browser cue that reaches 1–3% on iOS. | σ measured on the calibration set. |
| P4 | Physics-correct USD and direct MJCF from the measured skeleton (RANSAC walls, bounding-box obstacles, unknown volumes), authored with `pxr`. Can run alongside P1–P3. | The sim export must be correct before it is pretty. | Loads in Isaac Sim or Isaac Lab and in MuJoCo in CI. Every collider is tagged measured. |
| P5 | VLM label → size-prior table → sanity flag. | Cheap once reviewed labels exist, and catches errors of 1.5× or more. | Detection and false-flag rates measured on injected errors, compared against a lookup-only baseline. |
| P6 | Blender dressing worker (subprocess, pinned LTS, x86) with a CC0/CC-BY/Infinigen asset allowlist, a labelled cousins export, and synthetic Infinigen test rooms. | Visual realism and variation only make sense once the geometry is trustworthy. | Collider and route hashes identical with and without dressing. Asset licence recorded on every prim. |
| P7 | Sensor track: Android Chrome WebXR depth and poses, IMU scale from the P0 logs, and a go/no-go decision on a native iOS ARKit/LiDAR capture app. | The only path to 1–3% scale or better without a tape. | Sensor cue σ measured on the calibration set. ARKit poses feed MapAnything as metric poses. |

The order puts auditability before accuracy, and accuracy before appearance:

- **P0** comes first because every later number needs somewhere honest to live.
- **P1 and P2** carry the real accuracy gain. The calibration rooms should be captured from week one, because their ground truth does not depend on which cue is under test.
- **P4** is independent of the scale work and can run in parallel on the export surface.
- **The VLM check (P5) and Blender (P6)** come late on purpose. One only raises flags, and the other adds no accuracy, so neither should block the work that does.

## Conclusion

The original question assumed a smarter model could replace a measurement. The evidence says otherwise. VLMs mostly recall what a category usually measures. Blender only imports what assets usually measure. Learned depth measures, but with a bias shared across the whole room. What makes the product better is not a cleverer guess but an honest error bar: a planning map that says ±1.5% and is right 90% of the time is worth more to a robot team than a beautiful Blender scene of unknown scale. The fused, calibrated, provenance-tagged scale record becomes the asset that the review gate, the planner and any later sensor all plug into.

Two implications reach beyond this layer. First, the biggest remaining accuracy jump, to 1–3% or better without a tape, is a decision about the capture surface (native ARKit or Android WebXR), not a model choice. Calibration data will now put a number on what the browser-first strategy costs. Second, ACDC's result (90% real-world success for cousin-trained policies against 25% for the exact twin) suggests Blender's greatest value for robot training is controlled variation around a measured skeleton, not photorealistic fidelity. That reverses the usual intuition that the sim layer exists to look real.
