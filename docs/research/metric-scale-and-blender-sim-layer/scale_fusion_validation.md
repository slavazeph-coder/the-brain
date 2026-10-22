# Fusing metric-scale cues into one scale estimate with uncertainty, and validating it (phone scan to robot map, as of Oct 2026)

Scope: BrainSNN World Builder. Phone photos or video go through sparse COLMAP or dense MapAnything to produce a proposed 2D planning map. Today the scale comes from an assumed phone height or a user's two-point tape measurement. Candidate extra cues are monocular metric depth, known-size objects, a camera-height prior, ARKit/IMU and VLM size guesses. A human review gate stays in place.

Dating convention: [2026] means a paper or post from 2026, and so on. Results older than 2024 are marked "older".

---

## Q1. How do we statistically combine independent scale estimates (log-scale inverse-variance, robust M-estimators/RANSAC, Bayesian priors, outlier mixtures), how do SLAM and VIO systems get metric scale, and how do published systems fuse learned depth priors with SfM?

### Takeaway
Current systems do this the same way: work in log-scale, weight each cue by its inverse variance, use a robust loss or a gate to drop outliers, and filter over time. PRISM-SLAM [2026] uses log-domain WLS plus a 1-D Kalman filter. DGSfM [2026] uses robust log-scale averaging over the view graph. MP-SfM [2025] uses a per-image median scale plus an uncertainty-weighted depth-prior term. No single learned cue is accurate enough on its own indoors. MapAnything's images-only metric depth on ScanNet has about 22% relative error. MoGe-2's metric point maps have about 4–7% error indoors. So the fused estimate needs a tape measurement, ARKit, or several agreeing cues before it reaches robot-map accuracy of 1–3%.

### Cited Findings

**Scale fusion inside recent monocular SLAM and SfM (numbers)**
- PRISM-SLAM [2026, arXiv 2605.19257v4, KakaoMobility]:
  - Represents scale as log s so that multiplicative drift becomes additive noise.
  - Computes a single-frame scale by weighted least squares in log space, with a per-pixel information matrix as the precision weights.
  - Tracks log-scale with a 1-D Kalman filter whose measurement noise is the WLS variance.
  - Initializes from the first 5 keyframes.
  - Applies an uncertainty soft gate w(p) = σ((τ − u(p))/T), with τ = 0.07, T = 0.02 and Ω(p) = w(p)/σ₀².
  - Uses Huber kernels (δ_ray = 0.05, δ_depth = 0.1).
  - Depth prior is Depth Anything 3 Large, running at about 30 FPS on an RTX 4500 Ada. — [PRISM-SLAM](https://arxiv.org/html/2605.19257v4)
- PRISM-SLAM results:
  - The Sim(3) vs SE(3) ATE gap measures leftover scale error. On TUM fr1/xyz it is 2.86 vs 3.04 cm, about 3.3%.
  - 7-Scenes mean Sim(3) ATE is 8.8 cm. Heads is 8.8 cm in Sim(3) but 68.4 cm in SE(3), which the authors attribute to scale drift.
  - Ablation (mean SE(3) ATE): full system 2.12 cm; without the log-domain Kalman filter 2.28; without WLS 2.23; without the uncertainty gate 2.34.
  - On TUM fr1/xyz it is still behind classic and learned SLAM (ORB-SLAM3 0.9 cm, MASt3R-SLAM 0.9 cm). — [PRISM-SLAM](https://arxiv.org/html/2605.19257v4)
- DGSfM [2026, arXiv 2607.09507v2, Sattler/Kukelova group]:
  - Gets pairwise depth-scale ratios s_ij from a depth-aware relative-pose solver.
  - Solves global scale averaging in log space, log s_ij = log s_j − log s_i, with a robust loss and the gauge fixed at s_1 = 1.
  - Focal lengths are the median over incident edges.
  - It does **not** weight by depth uncertainty yet; the authors list that as future work.
  - Removing scale averaging lowers ETH3D AUC@5° from 85.43 to 80.16.
  - Depth-prior ablation on ETH3D (AUC@5°): MoGe-1 85.53, MoGe-2 85.43, UniK3D 83.23, UniDepthV2 81.29.
  - It reports no metric scale-error %. — [DGSfM](https://arxiv.org/html/2607.09507)
- MP-SfM [CVPR 2025]:
  - Per-image scale of each monocular depth map is the median ratio between triangulated point depth and monocular depth.
  - The cost is C_BA (truncated Smooth-L1 reprojection) + C_reg (Cauchy) + C_int, where C_int holds the depth prior with truncated L2 weighted by depth uncertainty, plus normal integration.
  - Prior std is clipped to at least 2 cm and combined (by max) with a term proportional to depth.
  - Uncertainties are rescaled by one constant tuned on a different dataset, using SfM points as pseudo-GT, and checked on ETH3D laser GT. — [MP-SfM](https://arxiv.org/html/2504.20040)
- MP-SfM prior comparison (AUC@1/5/20°, ETH3D min-overlap):

  | Depth prior | AUC@1/5/20° |
  |---|---|
  | Metric3D-v2 with uncertainty | 27.3/55.9/71.8 |
  | Depth Pro + DSINE | 23.3/47.5/63.4 |
  | Depth Anything V2 + DSINE | 21.3/44.8/60.8 |

  The constant rescaling improves calibration overall, except for the 10% most confident Metric3D-v2 pixels. Runtime is about 0.65 s per image for depth and normals. — [MP-SfM](https://arxiv.org/html/2504.20040); [search snippet on calibration](https://arxiv.org/pdf/2504.20040)

**Accuracy of the individual learned cues (inputs to the fusion)**
- MoGe-2 [2025] predicts metric scale with a separate head. A 2-layer MLP on the DINOv2 CLS token outputs one scale, made positive with exp() and trained with a log-space L2 loss.
- MoGe-2 metric point-map Rel / δ1:

  | NYUv2 | ETH3D | iBims-1 | 7-dataset avg |
  |---|---|---|---|
  | 4.44% / 98.3 | 7.19% / 97.7 | 5.63% / 97.4 | 8.19% / 93.6 |

  Metric-depth Rel averaged over 7 datasets is 15.7% without camera intrinsics and 13.6% with GT intrinsics. Supplying intrinsics helps. — [MoGe-2](https://arxiv.org/html/2507.02546v1)
- MapAnything [3DV 2026] also predicts a single metric scale factor through a learnable scale token and an MLP, exponentiated and trained with log-space losses.
- MapAnything multi-view metric depth (rel / τ):

  | Inputs | ScanNet | KITTI |
  |---|---|---|
  | Images only | 22.23 / 10.6 (MUSt3R 7.66 / 35.7) | 5.45 |
  | Images + intrinsics + poses | 5.58 / 48.1 | not quoted |

  The authors call MapAnything's ScanNet metric scale "sub-optimal" next to MoGe-2.
- MapAnything averaged over ETH3D, ScanNet++ v2 and TAv2 at 50 views: images-only τ 58.6; adding metric poses gives τ 76.8; adding intrinsics and poses gives τ 80.5. — [MapAnything](https://arxiv.org/html/2509.13414v3)
- Depth Pro [ICLR 2025] produces metric depth "without relying on … camera intrinsics" and estimates focal length from a single image. It makes a 2.25 MP depth map in 0.3 s on a "standard GPU". — [Depth Pro](https://arxiv.org/abs/2410.02073)
- Metric3D v2 maps images to a canonical camera with focal length 1000. Without intrinsics ("in-the-wild" mode) the code tries 9 default focal lengths. A wrong focal length gives distorted, wrongly scaled clouds. — [Metric3D repo](https://github.com/YvanYin/Metric3D)
- iPhone/ARKit LiDAR measured accuracy:
  - iPhone 12 Pro indoor mapping RMSE was ±1.41 cm in the 3D Scanner app and ±3.94 cm in Clirio. — [Erciyes study](https://avesis.erciyes.edu.tr/yayin/a99156bd-ffe3-4421-af12-b3fd8af6118e/investigation-of-geometric-object-and-indoor-mapping-capacity-of-apple-iphone-12-pro-lidar)
  - A practitioner RoomPlan test found wall-length error of 3–20 cm, 8.5 cm on average. The worst cases were walls hidden behind kitchen cabinets. — [Nomtek](https://www.nomtek.com/blog/getting-a-room-plan-with-arkit)
  - A 2026 TLS comparison reports whole-model RMSE of 0.182 m. — [Geodesy & Cartography 2026](https://journals.vilniustech.lt/index.php/GAC/article/download/25678/13527)
- VLM metric size guesses are weak:
  - In a tool-augmented study [2026], the no-tool baseline scored 0.58 MRA and the best real detector plus tools scored 0.61. Tools reached 0.97 only with ground-truth boxes, so the detector is the bottleneck. — [Seeing Is Not Measuring](https://arxiv.org/pdf/2609.29073)
  - Example failure: GPT-5 estimated a trash bin at 25 cm against a ground truth of 40 cm. — [VLM spatial survey](https://arxiv.org/pdf/2509.18905)
  - Q-Spatial Bench [2024]: prompting the model to reason from a reference object raised the top model's success rate by 19 points. — [Q-Spatial](https://arxiv.org/abs/2409.09788)
  - Newer metric benchmarks: Metric VQA [2026] has 10,813 dimension queries, some checked against tape-measured GT ([2606.24335](https://arxiv.org/pdf/2606.24335)). Metric-Bench [2026] covers 15 VLMs on indoor scenes using MRA, RMSE and δ1 ([2609.25841](https://arxiv.org/pdf/2609.25841)).
- Known-size reference: an ID-1 card (credit card) is 85.60 × 53.98 mm under ISO/IEC 7810. — [Wikipedia ISO/IEC 7810](https://en.wikipedia.org/wiki/ISO/IEC_7810)

**VIO scale observability**
- Monocular VIO cannot observe scale without accelerometer excitation. Under constant acceleration, including constant velocity, scale is unobservable. Under generic motion, everything is observable except global position and yaw about gravity. — [Range-VIO, arXiv 2103.15215 (older, 2021)](https://arxiv.org/pdf/2103.15215)
- A single v1 preprint [2026] reports VIO scale error by trajectory shape: straight 9.2%, circular 6.4%, figure-eight 4.8%. Curvature-induced acceleration is what couples scale to the inertial state. — [arXiv 2603.26740](https://arxiv.org/abs/2603.26740)
- A range sensor removes scale from the nullspace even under zero or constant acceleration. This motivates using LiDAR depth on Pro phones. — [Range-VIO](https://arxiv.org/pdf/2103.15215)

**Robust and outlier-tolerant back-ends (older, still standard)**
- Max-mixtures (Olson & Agarwal, RSS 2012, older): models each constraint as a Gaussian mixture and takes the max over components, so the most likely mode wins.
- Switchable constraints (Sünderhauf & Protzel, IROS 2012, older): gives each constraint a switch variable the optimizer can turn off. Handled up to 1000 false-positive loop closures.
- The VERTIGO library implements both for g2o and GTSAM. — [Wang & Olson 2014](https://april.eecs.umich.edu/media/pdfs/wang2014icra.pdf); [Switchable constraints](https://eprints.qut.edu.au/109582); [VERTIGO](https://researchdatafinder.qut.edu.au/display/n6362); [Agarwal ICRA 2013 (DCS)](https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/agarwal13icra.pdf)

### Inferences (design recommendations)

**1. Estimate in log-scale.** Let s be metres per reconstruction unit. Each cue k gives ℓ_k = ln s_k with a calibrated log-std σ_k; σ ≈ relative error for small errors.
- Fused estimate: ℓ̂ = Σ w_k ℓ_k / Σ w_k, with w_k = 1/σ_k².
- Fused uncertainty: σ̂ = (Σ w_k)^(-1/2).
- Report ŝ = exp(ℓ̂) with interval [ŝ·e^(−zσ̂), ŝ·e^(+zσ̂)].
- Working in log space keeps s > 0, makes a ±x% error symmetric, and matches what PRISM-SLAM, DGSfM, MoGe-2 and MapAnything all do internally.

**2. Treat priors as pseudo-cues.** The camera-height prior and a weak VLM guess are Gaussian priors N(ℓ₀, σ₀²) in log space. Bayesian updating with a Gaussian prior is the same as adding one more term to the inverse-variance sum.
- Give them wide σ₀, roughly 0.15–0.30 (15–30%).
- That way they only matter when nothing better exists.

**3. Check consistency before trusting the fused σ.**
- χ² = Σ w_k (ℓ_k − ℓ̂)², compared against χ²_{K−1}. The Birge ratio is R_B = √(χ²/(K−1)).
- If R_B > ~1.5, or the test fails at p < 0.01, the cues disagree. In that case:
  - (a) run robust re-estimation: Huber or Cauchy IRLS in log space, or a two-component mixture (1−ε)·N(ℓ̂, σ_k²) + ε·U(ln s_min, ln s_max) fitted with EM, or a max-mixture;
  - (b) if no consensus remains, inflate σ̂ by R_B and send the scan to the human gate.
- RANSAC over cues: with K ≤ ~10, enumerate each cue as a hypothesis, count the cues within 2.5σ_k, and refit on the largest inlier set.

**4. Handle correlated cues.** N door detections from the same detector and N frames from the same depth model are not independent. Collapse each source to one cue:
- take a median over its observations;
- set σ_k² = σ_bias,k² + σ_noise,k²/N;
- take σ_bias from held-out calibration (Q2).
- Without this, 300 MoGe-2 frames would give a falsely tiny σ.

**5. Suggested cue ordering and starting σ_k.** Replace all of these with calibrated values.

| Cue | Starting σ_k | Basis |
|---|---|---|
| User tape, two points | about 0.5–1% at 3 m | dominated by point-picking error |
| ARKit LiDAR / RoomPlan | about 1–3% | 1.4–8.5 cm on room-size spans |
| Known-size objects with a standard (ID-1 card, fiducials of known printed size) | about 1–3% when fully visible and fronto-parallel | |
| Multi-frame MoGe-2 / Metric3D-v2 / Depth Pro median | about 5–8% indoors | per MoGe-2 Rel on NYUv2/iBims |
| MapAnything images-only metric factor | about 10–20% | ScanNet rel 22% |
| VIO from casual motion | about 5–10% | |
| Camera-height prior | about 15–25% | |
| VLM size guess | about 30%+ | treat as a sanity check only |

Door and outlet sizes vary by country and building code, so give them wide σ unless a regional standard is assumed. I found no sourced dimension tables in this pass.

**6. Separate dense and sparse pipelines.** MapAnything already outputs a metric factor. Treat it as one cue. Where available, re-run it with intrinsics, and with metric poses from ARKit, because those inputs cut ScanNet rel from 22% to about 5.6%. Don't fuse it and also trust it blindly.

### Gaps
- No published system found that fuses all of these heterogeneous cues: depth, objects, IMU, VLM and height prior. PRISM-SLAM fuses one depth prior with geometry. DGSfM fuses no uncertainty.
- No sourced distribution of handheld camera height for phone capture. The height-prior σ above is an assumption.
- No sourced door, outlet or A4 tolerance table. A4 = 210 × 297 mm under ISO 216 is common knowledge but was not verified in this pass.
- Per-image metric scale error (as opposed to point-map Rel) for MoGe-2, UniDepthV2 and Depth Pro on phone imagery was not found as a single number.

---

## Q2. How do we calibrate uncertainty for learned estimators so the reported uncertainty is honest, and how do we decide when to ask a human to measure?

### Takeaway
Raw learned uncertainties are miscalibrated, and published SfM work fixes this with a single constant rescale learned on another dataset. Split conformal prediction on log-scale residuals from a held-out set of tape-measured rooms gives finite-sample, distribution-free marginal coverage. It is the simplest honest option. Re-calibrate per capture mode, because coverage only holds under exchangeability.

### Cited Findings
- **Split conformal guarantee.** Fit or freeze the model, compute nonconformity scores on n held-out calibration points, and take the ⌈(n+1)(1−α)⌉/n empirical quantile. The resulting interval has ≥ 1−α marginal coverage regardless of model correctness. — [Angelopoulos & Bates, Gentle Intro (2021/2023)](https://arxiv.org/abs/2107.07511); [Theoretical Foundations of CP](https://arxiv.org/pdf/2411.11824)
- **Exchangeability is required.** The guarantee is marginal over inputs, not conditional on each input. Distribution shift (new lighting, new phone, new building type) can break coverage. — [DataRobot](https://datarobot.com/ai-accelerators/prediction-intervals-via-conformal-inference); [arXiv 2004.00279](https://arxiv.org/pdf/2004.00279)
- **Learned nonconformity scores for robotics [2025]:**
  - keep the guarantee;
  - give 46–54% narrower detection intervals at 90% coverage;
  - raise navigation success from 87.8% (standard CP) to 91.5%. — [arXiv 2509.21955](https://arxiv.org/html/2509.21955v1)
- **Online recalibration.** Re-computing the quantile on recent batches tracks time-varying noise, but it departs from exchangeability. — [arXiv 2511.08231](https://arxiv.org/pdf/2511.08231)
- **Multimodal uncertainty.** Standard conformal regression gives one contiguous interval, which fits multimodal ambiguity poorly. — [arXiv 2309.11018](https://arxiv.org/html/2309.11018v1)
- **What SfM practice actually does:**
  - MP-SfM rescales prior uncertainty with one constant tuned on a different dataset and verifies against ETH3D laser GT.
  - It sets a 2 cm std floor and adds a depth-proportional term.
  - Calibration still fails for the 10% most confident Metric3D-v2 pixels. Overconfidence at the high-confidence tail is the known failure mode. — [MP-SfM](https://arxiv.org/html/2504.20040)
- **Other uncertainty methods for depth** (alternatives, not conformal): evidential regression ([arXiv 1910.02600](https://arxiv.org/pdf/1910.02600), older) and ordinal-regression variance decomposition ([ECCV 2022](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136620229.pdf), older). No paper applying conformal prediction specifically to monocular depth scale was found in search.

### Inferences (design recommendations)

**1. Calibrate on normalized log residuals.** For calibration scan i, take ground-truth scale s_i* from a tape or laser and the fused (ŝ_i, σ̂_i). Then:
- score r_i = |ln(ŝ_i/s_i*)| / σ̂_i;
- q̂ = the ⌈(n+1)(1−α)⌉-th smallest r_i;
- deployed interval ŝ·exp(±q̂·σ̂).
- With n = 50 rooms and α = 0.1, q̂ is the 46th smallest score.
- Also check per-cue calibration with the same score per cue. This yields the σ_bias values that Q1 needs.

**2. Use Mondrian (group-wise) conformal per stratum**, so coverage holds within each group and not just on average:
- capture mode: sparse COLMAP vs dense MapAnything; LiDAR vs non-LiDAR phone;
- which cues were present: tape, ARKit, objects, learned only.

**3. Calibration data must be commercially usable.** Most metric-GT indoor sets are non-commercial (Q3). Plan a small in-house set of 30–100 real rooms, each with a laser-measured or tape-measured room, door width and wall-length GT, captured with the target phones. Use Hypersim (CC BY-SA) only for synthetic checks.

**4. Human-gate rule.** Request a tape measurement when any of these hold:
- (a) the 90% conformal interval half-width exceeds the map tolerance. Example: with 0.30 m robot clearance and a 5 m room, a 3% scale error is 15 cm, so require half-width ≤ about 2–3%;
- (b) the χ² cue-consistency test fails;
- (c) only weak cues are present (height prior, VLM, single-frame depth);
- (d) the scan is out of distribution for the calibration set (new phone model, no intrinsics, very large or very small room).
- Always show the user which cues drove the estimate, as provenance (Q5).
- A measured two-point distance always overrides. Keep it as a cue with small σ so the χ² test can still flag a mis-click.

**5. Validate the gate.** On held-out scans, report empirical coverage (target 90% ± binomial CI), mean interval width, and the referral rate (fraction sent to human) versus the residual error of the scans that were not referred. That gives a selective-prediction risk–coverage curve.

### Gaps
- No published empirical coverage numbers exist for monocular metric scale on phone captures. They must be measured in-house.
- How strongly cue errors correlate (e.g. MoGe-2 vs Depth Pro, both DINOv2/ViT-based) is unknown and must be estimated from calibration data.

---

## Q3. Which datasets have metric ground truth for indoor phone-like capture, what are their licences, sizes and commercial-use terms, and what metrics should we report?

### Takeaway
The best phone-like metric-GT indoor sets are ScanNet++ (iPhone plus sub-mm laser) and ARKitScenes (iPad LiDAR plus stationary laser). ScanNet++, ScanNet, Matterport3D and Replica forbid commercial use, and the ETH3D licence is reported as non-commercial. ARKitScenes appears to allow commercial use for entities under Apple's 700M-MAU threshold. Hypersim is CC BY-SA 3.0, but it is synthetic. A commercial product should use permissive sets for engineering validation and build a small in-house tape/laser set for release claims.

### Cited Findings

| Dataset | Content / GT | Size | Licence / commercial |
|---|---|---|---|
| **ScanNet++** [ICCV 2023; v2 Dec 2024] | Sub-mm laser scans, 33 MP DSLR (~280k images), iPhone RGB-D (>3.7M frames) | v1 paper 460 scenes; site says "1000+" scenes for v2 | TUM Terms of Use: "non-commercial research and educational purposes. Commercial use is strictly prohibited"; binds for-profit employers; redistribution only to co-signers; GDPR deletion duty |
| **ARKitScenes** [NeurIPS D&B 2021, older] | iPad Pro LiDAR plus stationary laser-scanner high-res depth; 3D boxes | 5,047 captures of 1,661 scenes; HR laser subset 2,257 captures / 841 scenes | Base grant "personal, non-commercial"; separate "Commercial License terms" grant a licence if, in every month before Aug 2024, the licensee's products had < 700M MAU (else ask Apple) |
| **Matterport3D** (older) | Matterport RGB-D panoramas | n/a | Academic EULA: "non-commercial academic purposes only"; signed ToU; HM3D notes trained models count as derived data |
| **Replica** (older) | High-quality synthetic-looking real scans | 18 scenes | "Replica Dataset Research Terms": research or education that is "non-commercial or not-for-profit… and not for any other purpose"; also binds for-profit employees |
| **Hypersim** (Apple, older) | Synthetic photoreal; `depth_meters` (Euclidean ray distance, not planar z); asset units converted with `meters_per_asset_unit` | 77,400 images / 461 scenes (74,619 public), ~1.9 TB | CC BY-SA 3.0 Unported (commercial allowed with attribution + share-alike) |
| **ETH3D** (older) | High-precision laser GT, indoor + outdoor | n/a | CC BY-NC-SA 3.0 per secondary listings (official page not reachable in this pass) |
| **ScanNet** (older) | RGB-D | n/a | ToU must be signed and emailed with an institutional address; listed as non-commercial in secondary tables |
| **7-Scenes** (MSR, older) | n/a | n/a | Download implies accepting an MSR licence agreement (not opened) |

Sources for the table:
- ScanNet++: [ToU PDF](https://scannetpp.mlsg.cit.tum.de/scannetpp/static/scannetpp-terms-of-use.pdf); [site](https://scannetpp.mlsg.cit.tum.de/scannetpp/); [arXiv 2308.11417](https://arxiv.org/abs/2308.11417)
- ARKitScenes: [repo](https://github.com/apple/ARKitScenes); [LICENSE](https://raw.githubusercontent.com/apple/ARKitScenes/main/LICENSE); [arXiv 2111.08897](https://arxiv.org/abs/2111.08897)
- Matterport3D: [Matterport academic EULA](https://matterport.com/legal/matterport-end-user-license-agreement-academic-use-model-data); [HM3D repo](https://github.com/facebookresearch/habitat-matterport3d-dataset)
- Replica: [Replica LICENSE](https://raw.githubusercontent.com/facebookresearch/Replica-Dataset/main/LICENSE); [repo](https://github.com/facebookresearch/Replica-Dataset)
- Hypersim: [ml-hypersim](https://github.com/apple/ml-hypersim)
- ETH3D: [HyperAI listing](https://hyper.ai/en/datasets/18276); [TIB record](https://service.tib.eu/ldmservice/dataset/eth3d-benchmark)
- ScanNet: [ScanNet repo](https://github.com/ScanNet/ScanNet); [secondary table, NeurIPS 2025 D&B supplement](https://papers.nips.cc/paper_files/paper/2025/file/6b9628a5da76f5f1d6ec025f4b493686-Supplemental-Datasets_and_Benchmarks_Track.pdf)
- 7-Scenes: [MSR project](https://www.microsoft.com/en-us/research/wp-json/wp/v2/msr-project/171165)

**Model-weight licences.** These matter because a model trained on non-commercial data may inherit the restriction.
- **MapAnything:** code Apache 2.0. Checkpoints `facebook/map-anything` and `-v1` are CC-BY-NC 4.0; `map-anything-apache` and `-apache-v1` are Apache 2.0. The Apache model was trained on 6 datasets, including ScanNet++ v2 and Mapillary Planet-Scale Depth, with owners' approval for permissive release. — [repo](https://github.com/facebookresearch/map-anything); [paper](https://arxiv.org/html/2509.13414v3)
- **VGGT:** code relicensed in July 2025 for commercial use, excluding military use. Only the gated `VGGT-1B-Commercial` checkpoint allows commercial use; the original checkpoint is CC BY-NC 4.0. — [VGGT repo](https://github.com/facebookresearch/vggt); [HF VGGT-1B-Commercial](https://huggingface.co/facebook/VGGT-1B-Commercial)
- **UniDepth:** "Creatives Common BY-NC 4.0" (non-commercial). — [UniDepth repo](https://github.com/lpiccinelli-eth/UniDepth)
- **MoGe:** code MIT, with a DINOv2 subfolder under Apache 2.0. The weights licence is not stated on the README. — [MoGe repo](https://github.com/microsoft/MoGe)
- **Metric3D:** code BSD-2; weights licence not stated; "commercial inquiries" go to the authors. — [Metric3D repo](https://github.com/YvanYin/Metric3D)
- **Depth Pro:** Apple licence grants a "personal, non-exclusive license" to use, modify and redistribute, with no non-commercial clause in the text. No patent rights are granted and the weights are not mentioned. — [ml-depth-pro LICENSE](https://raw.githubusercontent.com/apple/ml-depth-pro/main/LICENSE)

**Metric conventions in the literature**
- Depth and point maps: Rel (abs-rel) and δ1 / τ inlier ratio, as used by MoGe-2 and MapAnything. — [MoGe-2](https://arxiv.org/html/2507.02546v1); [MapAnything](https://arxiv.org/html/2509.13414v3)
- Trajectories: ATE in Sim(3) vs SE(3). The gap isolates scale error. — [PRISM-SLAM](https://arxiv.org/html/2605.19257v4)
- Poses: AUC@1/5/20°. — [MP-SfM](https://arxiv.org/html/2504.20040)
- VLM sizes: MRA (mean relative accuracy). — [Metric-Bench](https://arxiv.org/pdf/2609.25841)
- Room dimensions: ICC and cm error vs tape. — [LiDAR rehab study](https://radiopharmaconnect.srsweb.org/users/489992/articles/1253435-an-investigation-into-the-accuracy-of-lidar-technology-for-in-home-rehabilitation-planning-a-proof-of-concept-study); [Nomtek](https://www.nomtek.com/blog/getting-a-room-plan-with-arkit)

### Inferences (recommended validation protocol)

**Metrics to report for BrainSNN.** Each one should have a median, a 90th percentile and bootstrap CIs.
1. Scale error: |ln(ŝ/s*)| ×100 %, plus signed bias.
2. Room-dimension error in cm (L, W, ceiling height) vs tape or laser.
3. Door-width error in cm. This is critical for robot passability.
4. 2D occupancy map IoU and boundary F-score at 5 and 10 cm tolerance vs a GT map rasterized from the laser mesh at the same resolution.
5. Conformal coverage, interval width and human-referral rate (Q2).
6. Sim(3) vs SE(3) ATE where GT trajectories exist.

**Suggested dataset use for a commercial team (subject to legal review):**
- Hypersim for synthetic unit tests and map-IoU pipelines. Its depth is Euclidean, so convert to planar z.
- ARKitScenes for real phone-like LiDAR vs laser validation, if counsel confirms the MAU-threshold commercial grant covers the use.
- An in-house tape/laser set of 30–100 rooms for release claims and conformal calibration.
- ScanNet++, ScanNet, Replica, Matterport3D and ETH3D only for non-commercial research comparisons by an academic partner. They must not ship in product calibration.

### Gaps
- The exact current ARKitScenes licence wording was read via a summarizing fetch. Get legal confirmation that "evaluation inside a commercial product's development" is covered.
- The ETH3D, Taskonomy, NYUv2 and 7-Scenes licence texts were not retrieved from primary pages.
- The licence of the underlying Evermotion assets in Hypersim was not checked.
- Licence of the MoGe-2 and Metric3D v2 weights is unconfirmed.

---

## Q4. What are the runtime, VRAM and throughput of the candidate models on GB10 vs RTX 4090, and what ARM64 compatibility issues exist?

### Takeaway
All single-image metric-depth models are small: 35M–504M parameters, about 1–8 GB peak memory, and 24–140 ms FP16 on an A100. They fit easily on both machines. In compute-bound work the RTX 4090 is about 2–4× faster than GB10. GB10's advantage is 128 GB unified memory: it runs 70B and 120B-class VLMs/LLMs and very long MapAnything/VGGT view sets, but slowly. Llama-3.1-70B FP8 decodes at about 2.7 tok/s, bounded by 273 GB/s bandwidth. On GB10 (ARM64, sm_121, CUDA 13), use NGC PyTorch containers (25.10 or later) or cu130 wheels. Many pip wheels still target CUDA 12 or sm_120.

### Cited Findings

**Hardware**
- DGX Spark/GB10: 128 GB coherent unified LPDDR5x at 273 GB/s; up to 1 PFLOP sparse FP4. — [LMSYS review (Oct 2025)](https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark)
- RTX 4090: 24 GB GDDR6X at 1008 GB/s; 16,384 CUDA cores vs GB10's 6,144. — [mrdbourke gpu-benchmarking](https://github.com/mrdbourke/gpu-benchmarking)

**Measured GB10 vs RTX 4090** (same harness, early 2026; ratio = 4090 speed-up):

| Workload | GB10 | RTX 4090 | Ratio |
|---|---|---|---|
| Qwen3-VL-8B, vLLM FP8, 1 image (output tok/s) | 191 | 392 | 2.05× |
| Qwen3-VL-8B, vLLM FP8, text-only | 220 | 580 | 2.64× |
| Qwen3-VL-8B, llama.cpp Q4, multimodal generation | 33.1 | 122.8 | 3.71× |
| gpt-oss-20b, vLLM | 230 | 584 | 2.54× |
| FLUX.2-klein-4B (s/image) | 4.20 | 1.29 | 3.26× |
| RT-DETRv2 fine-tune, 10 epochs | 807 s | 222 s | 3.63× |
| Gemma-3-270M fine-tune | 343 s | 82 s | 4.21× |
| gpt-oss-120b, vLLM | 116 tok/s | — | 4090: N/A, does not fit |
| Qwen3-VL-32B / 30B-A3B FP8 | runs | — | 4090: Spark only |

Also from this repo: flash-attention 2 was "questionable" on Spark as of Jan 2026. — [benchmark_analysis](https://github.com/mrdbourke/gpu-benchmarking/blob/main/benchmark_analysis/README.md); [repo](https://github.com/mrdbourke/gpu-benchmarking)

**LMSYS on Spark (SGLang/Ollama, Oct 2025)**

| Model | Precision | Batch | Prefill tok/s | Decode tok/s |
|---|---|---|---|---|
| Llama-3.1-8B | FP8 | 1 | 7,991 | 20.5 |
| Llama-3.1-8B | FP8 | 32 | — | 368 |
| Llama-3.1-70B | FP8 | — | 803 | 2.7 |
| gpt-oss-20b | MXFP4 | 1 | 2,053 | 49.7 |
| gpt-oss-20b on RTX 5090 (comparison) | MXFP4 | 1 | — | 205 |

LMSYS calls Spark best for prototyping, not production. — [LMSYS](https://www.lmsys.org/blog/2025-10-13-nvidia-dgx-spark)
- Later llama.cpp numbers for gpt-oss-120b on Spark: about 58.7–60.6 tok/s generation and about 1,956–2,444 tok/s prefill. Early launch reviews reported only 14.5 tok/s, so software maturity matters. — [Spheron summary](https://www.spheron.network/blog/dgx-spark-vs-rtx-5090-for-local-llms-tokens-per-second-2026/); [MayhemCode 2026](https://www.mayhemcode.com/2026/08/why-dgx-spark-runs-70b-llms-at-27.html)
- NVIDIA lists Qwen2.5-VL-7B-Instruct NVFP4 on TRT-LLM on Spark at 65,832 prefill tok/s and 41.7 generation tok/s. — [NVIDIA dev blog](https://developer.nvidia.com/blog/how-nvidia-dgx-sparks-performance-enables-intensive-ai-tasks)

**Monocular metric depth models** (single A100, single frame; MoGe-2 paper Table B.3):

| Model (params) | Native resolution | Latency FP16 / FP32 (ms) | Peak memory FP16 / FP32 (GB) |
|---|---|---|---|
| MoGe-2 (326M) | 484² | 29 / 82 | 0.96 / 1.7 |
| MoGe-2 (326M) | 1188² | 108 / 565 | 1.9 / 3.8 |
| Depth Pro (504M) | 1536² | 139 / 906 | 3.7 / 8.0 |
| UniDepthV2 (354M) | 448² | 33 / 84 | 1.1 / 1.8 |
| UniDepthV2 (354M) | 774² | 50 / 206 | 1.8 / 2.5 |
| Metric3D-v2 (412M) | 1064×616 | 87 / 255 | 1.4 / 2.3 |
| Depth Anything V2 (335M) | 518² | 24 / 86 | 0.91 / 1.8 |

Sources: [MoGe-2](https://arxiv.org/html/2507.02546v1). The MoGe README separately states about 60 ms per image for ViT-L FP16 on an A100 or RTX 3090. MoGe-2 also comes in ViT-B (104M) and ViT-S (35M) variants. — [MoGe repo](https://github.com/microsoft/MoGe)

**Multi-view models**
- VGGT-Omega [CVPR 2026] peak memory on an A100 at 624×416:

  | Frames | 1 | 100 | 200 | 500 |
  |---|---|---|---|---|
  | Peak memory (GB) | 6.0 | 13.4 | 20.8 | 43.2 |

  — [vggt-omega](https://github.com/facebookresearch/vggt-omega)
- Original VGGT runs out of memory at about 300 frames on an 80 GB A800. — [FastVGGT](https://arxiv.org/pdf/2509.02560)
- A May 2026 VGGT memory fix allows about 2–3× more frames in the same budget. — [VGGT repo](https://github.com/facebookresearch/vggt)
- MapAnything:
  - memory-efficient mode handles "up to 2000 views on 140 GB";
  - profiled on an H200-140GB;
  - no numeric speed or memory figures in the text;
  - bf16 recommended;
  - PyTorch is not pinned. — [MapAnything repo](https://github.com/facebookresearch/map-anything); [paper](https://arxiv.org/html/2509.13414v3)

**ARM64 / sm_121 compatibility on GB10**
- GB10 is compute capability sm_121. PyPI cu128 stable wheels and cu130 nightlies compile kernels only up to sm_120, according to community builders.
- The ptxas bundled with cu128 rejects sm_121 and breaks `torch.compile`. Switching to cu130 wheels fixed it.
- Bundled NVRTC 12 doesn't know sm_121. Symlinking the system NVRTC 13 was still needed as of Apr 2026.
- Community prebuilt sm_121 wheels exist for PyTorch, Triton, flash-attn and bitsandbytes.
- Sources: [dgx-spark-llm-stack](https://github.com/ogulcanaydogan/dgx-spark-llm-stack); [dgx-spark-ml-guide](https://github.com/martimramos/dgx-spark-ml-guide); [natolambert/dgx-spark-setup](https://github.com/natolambert/dgx-spark-setup); [HF sm121 wheel](https://huggingface.co/Qanatpharma/pytorch-sm121-gb10)
- NGC `nvcr.io/nvidia/pytorch:25.10-py3` and later support GB10; 24.10 and earlier do not. NGC 25.11 ships PyTorch 2.10 for ARM64. — [dgx-spark-ml-guide](https://github.com/martimramos/dgx-spark-ml-guide); [Obsidian week-one notes](https://publish.obsidian.md/aixplore/AI+Systems+&+Architecture/dgx-spark-week-one-finding-the-right-stack)
- Many pip packages (e.g. vLLM precompiled kernels, flash-attn) ship CUDA 12 builds, which cause `libcudart.so.12` errors on CUDA 13. A vLLM issue tracks SM121 support. A forum claim that sm_121 is binary-compatible with sm_120 is unverified. — [vLLM #31128](https://github.com/vllm-project/vllm/issues/31128)
- "Great hardware, early days for the ecosystem" (Oct 2025). — [Simon Willison](https://simonwillison.net/2025/Oct/14/nvidia-dgx-spark/)

### Inferences
- **Depth models.** Expect each depth model to run in roughly 0.05–0.5 s per frame on GB10, about 2–4× slower than A100/4090-class. Running a depth prior on 30–100 keyframes per room therefore takes seconds to under a minute on either box. The RTX 4090 is the faster box for this.
- **MapAnything and VGGT with many views.** On a 4090, keep to roughly 100–200 frames at about 518–624 px, or use memory-efficient mode. GB10 can take several hundred to about 1,000 views, but slowly. This is extrapolated from the VGGT-Omega A100 table; there is no direct GB10 measurement.
- **VLMs.**
  - An 8B VLM (Qwen3-VL-8B FP8) fits on both machines. The 4090 is about 2–3.7× faster.
  - 70B-class VLMs do not fit in 24 GB even at 4-bit (weights alone about 35–40 GB). They need GB10. At about 2.7 tok/s decode, a 100-token size answer takes about 40 s plus prefill. That is acceptable only as an offline, asynchronous sanity check.
  - Because VLM size guesses carry about 30%+ error, a 70B VLM is not worth it for scale. Use an 8B VLM for semantics (detecting doors and cards), and compute geometric size from the reconstruction.
- **Deployment.**
  - Standardize GB10 on an NGC PyTorch container (25.10 or later).
  - Pin per-model containers, and verify the MapAnything, MoGe and UniDepth custom ops (xformers or flash-attn, if used) build for sm_121.
  - Keep the RTX 4090 (x86, CUDA 12.x/13) as the throughput worker.

### Gaps
- No published GB10 numbers for MoGe-2, Depth Pro, UniDepth, Metric3D v2, MapAnything or VGGT. No published RTX 4090 latency tables for these models (only A100/V100/3090). Measure in-house.
- No sourced GB10 results for 70B-class VLMs specifically. Only text Llama-3.1-70B: 2.7 tok/s.

---

## Q5. How should we record per-field provenance (measured vs inferred vs generated) and uncertainty in scene formats (OpenUSD, JSON), and what standards or practices exist?

### Takeaway
There is no formal OpenUSD standard for provenance or uncertainty. The emerging convention is:
- layer-level `customLayerData` with a "creator" key and layer comments;
- organization-namespaced custom attributes or customData on prims and attributes;
- metadata kept informational, not used to drive runtime behaviour.

W3C PROV (Entity, Activity, Agent, plus wasGeneratedBy, wasDerivedFrom, wasAttributedTo) is the established vocabulary for the provenance graph. Mirror it in a project JSON schema, and namespace it in USD.

### Cited Findings
- OpenUSD has "no formal specification" for authoring metadata, but conventions have emerged.
  - The most common is a "creator" string in `SdfLayer::CustomLayerData`, with author notes in `SdfLayer::SetComment`.
  - This metadata is "strictly informational" and "not advisable to drive runtime behavior." — [Omniverse USD Exchange SDK: SdfLayer authoring](https://docs.omniverse.nvidia.com/usd/code-docs/usd-exchange-sdk/latest/api/group__layers.html)
- `customData` is a composable dictionary on prims and attributes for user data. NVIDIA recommends namespacing an organization's custom properties and schemas (NVIDIA uses `omni:`). Custom properties are often preferred over customData for prototyping, because customData is costlier for composition. — [Learn OpenUSD: metadata](https://docs.nvidia.com/learn-openusd/latest/stage-setting/metadata.html); [Learn OpenUSD: custom properties](https://docs.nvidia.com/learn-openusd/latest/beyond-basics/custom-properties.html); [Omniverse: set custom metadata](https://docs.omniverse.nvidia.com/dev-guide/latest/programmer_ref/usd/properties/set-custom-metadata_py_usd.html)
- NVIDIA's digital-twin course includes an asset metadata and structure review step. — [NVIDIA Assembling Digital Twins](https://docs.nvidia.com/learning/physical-ai/assembling-digital-twins/latest/getting-started/asset-metadata-review.html)
- W3C PROV-O core terms (2013 Recommendation, older but stable):
  - three classes: Entity, Activity, Agent;
  - starting-point relations: `wasGeneratedBy`, `wasDerivedFrom`, `used`, `wasAssociatedWith`, `wasAttributedTo`, `actedOnBehalfOf`;
  - `prov:Derivation` qualifies a `wasDerivedFrom` link. — [W3C PROV-O slides](https://www.w3.org/2011/prov/wiki/images/archive/4/43/20120619203549%212012-06-ipaw-provo.ppt.pdf); [W3C blog](https://www.w3.org/blog/2012/the-prov-ontology-an-update); [PROV-O docs mirror](https://akswnc7.informatik.uni-leipzig.de/dstreitmatter/archivo/w3.org/ns--prov-o/2020.06.10-215645/ns--prov-o_type%3DgeneratedDocu.html)
- No standard OpenUSD uncertainty attribute was found. Any such attribute is a project convention. — [USD Exchange SDK docs](https://docs.omniverse.nvidia.com/usd/code-docs/usd-exchange-sdk/latest/api/group__layers.html)

### Inferences (proposed convention)

**JSON record** for every derived quantity: global scale, room L/W/H, door widths, map cells/polygons.

```json
"scale": {
  "value": 0.01832, "unit": "m_per_recon_unit",
  "log_sigma": 0.021, "interval": {"level": 0.90, "lo": 0.01770, "hi": 0.01896, "method": "split_conformal", "calib_set": "bsnn-rooms-v1", "n_calib": 64},
  "origin": "fused",          // one of: measured | sensor | inferred | generated | assumed | fused | user_edited
  "cues": [
    {"id":"tape-1","origin":"measured","agent":"user:<id>","value":0.01829,"log_sigma":0.006,"weight":0.88,"inlier":true},
    {"id":"moge2-median","origin":"inferred","model":"moge-2-vitl@<sha>","frames":42,"value":0.0191,"log_sigma":0.06,"weight":0.09,"inlier":true},
    {"id":"vlm-door","origin":"generated","model":"qwen3-vl-8b@<sha>","value":0.0241,"log_sigma":0.30,"inlier":false}
  ],
  "consistency": {"chi2": 1.3, "dof": 2, "birge": 0.81},
  "review": {"status":"approved","by":"user:<id>","at":"2026-10-22T…Z"},
  "prov": {"wasGeneratedBy":"activity:scale-fusion-run-<uuid>","wasDerivedFrom":["entity:recon-<uuid>","entity:tape-1"]}
}
```

- Keep an enum of origin values. "generated" means generative or VLM output; "assumed" means a fixed prior such as phone height.
- Rule: no field reaches the robot map as `approved` without a review record.

**USD mapping**
- Author namespaced attributes on the relevant prims:
  - `brainsnn:scale:value` (double)
  - `brainsnn:scale:logSigma` (double)
  - `brainsnn:scale:interval90` (double2)
  - `brainsnn:prov:origin` (token, from the enum)
  - `brainsnn:prov:activity` (string UUID)
  - `brainsnn:review:status` (token)
- Put the full PROV/JSON record in a sidecar file referenced from `customLayerData` (e.g. `brainsnn:provenanceFile`), plus `creator`. Attributes give typed per-prim queries; the sidecar avoids heavy customData composition cost.
- Treat it as informational, per NVIDIA guidance. The planner should consume the explicitly approved map, not parse provenance at runtime.
- Set the stage's linear unit consistently with the fused scale once it is approved. (UsdGeom `metersPerUnit` stage metadata is the usual mechanism; not verified in this pass.)
- Keep cue-level detail so a reviewer can see why the scale was chosen. This is also the calibration log that feeds Q2.

### Gaps
- No AOUSD or Alliance-level provenance/uncertainty schema was found. The AOUSD work was not searched.
- ROS conventions for covariance and units (REP-103, `*WithCovariance` messages) were not verified in this pass.
- No existing robotics or digital-twin tool was found that records measured vs inferred vs generated provenance per field. Treat the above as a BrainSNN-defined convention.
