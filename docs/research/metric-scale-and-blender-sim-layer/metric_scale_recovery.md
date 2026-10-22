# Metric scale recovery for phone-scan indoor robot maps (state of the art as of Oct 2026)

Scope: practical ways for the BrainSNN World Builder pipeline (phone photos/video, then sparse pycolmap SfM or dense MapAnything, then a 2D planning map) to output real metres instead of arbitrary units. Today the pipeline assumes a phone height of about 1.35 m or asks the user to measure between two picked points. Licence facts were checked on 2026-10-22 against GitHub LICENSE files and the Hugging Face model API (`cardData.license`). Accuracy numbers are quoted with their dataset and metric. "Older" means published before 2025.

---

## 1. Monocular metric depth and geometry models: indoor accuracy, runtime, and code vs weight licences

### Takeaway
On indoor benchmarks, the best single-image metric models reach about 4–8% relative depth/point error on NYUv2 and about 5–14% on iBims-1 when camera intrinsics are unknown. Error grows sharply on harder indoor scenes (HAMMER 13–30%+). Four models have both code and weights licensed for commercial use: **MoGe-2 / MoGe-3** (MIT code and weights), **DA3METRIC-LARGE** (Apache-2.0), **map-anything-apache** (Apache-2.0) and **Pi3** (BSD-2). VGGT also has a commercial checkpoint, but under a custom gated licence. **Depth Pro weights, UniDepth, UniK3D, MASt3R/DUSt3R/CUT3R, and the large DA3/VDA/MapAnything default checkpoints are non-commercial.**

### Cited Findings

**Accuracy: MoGe-2 paper, zero-shot, Appendix Table B.4 (NeurIPS 2025)**
- Metric definitions: point error Rel^p = ‖p̂−p‖/‖p‖, and δ1^p = % of points with that ratio < 0.25. Depth error Rel^d = |ẑ−z|/z, and δ1^d = % of pixels with max(d̂/d, d/d̂) < 1.25. Metric point maps are aligned only by an optimal translation (no scale). Metric depth is evaluated **unaligned** — [MoGe-2, arXiv 2507.02546](https://arxiv.org/html/2507.02546)
- **Metric point map, Rel^p / δ1^p (NYUv2 | iBims-1 | ETH3D | HAMMER | DIODE | 7-set avg)** — [MoGe-2 Table B.4](https://arxiv.org/html/2507.02546):
  - MoGe-2: 4.44/98.3 | 5.63/97.4 | 7.19/97.7 | 13.4/87.0 | 7.85/92.3 | 8.19/93.6
  - UniDepth V2: 4.83/98.0 | 5.23/97.9 | 9.46/95.0 | 15.0/83.9 | 17.0/80.8 | 10.1/91.9
  - UniDepth V1: 4.80/98.3 | 10.8/92.8 | 22.4/63.1 | 18.0/79.5 | 12.8/88.9 | 12.1/87.2
  - Depth Pro: 6.13/97.3 | 6.89/96.9 | 21.2/64.9 | 14.5/86.0 | 13.5/81.8 | 13.7/81.9
  - MASt3R: 7.11/95.6 | 10.1/89.3 | 27.4/43.1 | 56.0/18.3 | 21.7/66.3 | 26.2/55.3
- **Metric depth without GT intrinsics, Rel^d / δ1^d (same columns)** — [MoGe-2 Table B.4](https://arxiv.org/html/2507.02546):
  - MoGe-2: 7.33/96.1 | 13.6/83.0 | 10.4/90.8 | 26.9/65.6 | 17.5/66.4 | 15.7/76.8
  - UniDepth V2: 10.6/92.8 | 9.52/93.2 | 20.7/69.5 | 38.2/46.8 | 43.0/51.8 | 21.3/75.3
  - Depth Pro: 10.7/91.9 | 15.9/81.5 | 38.5/32.8 | 39.1/63.0 | 31.9/37.7 | 27.6/54.4
  - Depth Anything V2 (metric): 16.4/80.9 | 11.1/91.7 | 36.1/36.3 | 52.1/38.9 | 41.2/22.1 | 29.9/56.6
  - MASt3R: 10.8/89.7 | 18.7/61.5 | 47.2/20.1 | 97.2/6.74 | 54.9/19.0 | 49.7/30.3
  - ZoeDepth (older, 2023): 11.0/91.9 | 17.4/67.2 | 57.1/33.7 | 94.3/3.23 | 39.3/29.3 | 39.3/49.9
- **Metric depth with GT intrinsics** (relevant because SfM/COLMAP gives intrinsics), Rel^d/δ1^d: MoGe-2 6.46/96.9 (NYUv2), 9.92/92.4 (iBims); UniDepth V2 7.81/96.0, 7.71/95.5; Metric3D V2 7.16/96.5, 9.96/94.1; UniDepth V1 5.98/97.9, 22.6/60.5 — [MoGe-2 Table B.4](https://arxiv.org/html/2507.02546)
- The MoGe-2 authors acknowledge that "ambiguity in real-world metric scale can also lead to deviations in out-of-distribution scenarios". The paper reports no separate scale-error metric — [MoGe-2](https://arxiv.org/html/2507.02546)
- **Runtime on A100, FP16/FP32** (MoGe-2 Table B.3):
  - MoGe-2: 326M params, 29/82 ms at 1200 tokens, 0.96/1.7 GB memory
  - UniDepth V2: 354M, 33/84 ms
  - DA V2: 335M, 24/86 ms
  - Metric3D V2: 412M, 87/255 ms
  - Depth Pro: 504M, 139/906 ms at 20160 tokens

  Source: [MoGe-2](https://arxiv.org/html/2507.02546). Depth Pro's own abstract claims "a 2.25-megapixel depth map in 0.3 seconds on a standard GPU" — [Depth Pro, arXiv 2410.02073, ICLR 2025](https://arxiv.org/abs/2410.02073)

**Accuracy: Depth Anything 3 paper, Table 11 (Nov 2025), δ1 / AbsRel (NYUv2 | KITTI | ETH3D | SUN-RGBD | DIODE)** — [DA3, arXiv 2511.10647](https://arxiv.org/html/2511.10647)
- DA3-metric: 0.963/0.070 | 0.953/0.086 | 0.917/0.104 | 0.973/0.105 | 0.838/0.128
- UniDepthV2: 0.968/0.064 | 0.968/0.076 | 0.863/0.152 | 0.977/0.111 | 0.856/0.123
- UniDepthV1: 0.980/0.061 | 0.978/0.051 | 0.234/0.464 | 0.971/0.113 | 0.570/0.266
- Metric3D v2: 0.971/0.067 | 0.976/0.051 | 0.830/0.138 | 0.954/0.132 | (0.018, almost certainly a typo)/0.154
- DepthPro: 0.932/0.093 | 0.843/0.121 | 0.386/0.349 | 0.950/0.126 | 0.734/0.173
- DA3 metric output convention: `metric_depth = focal * net_output / 300` (focal in pixels). The DA3NESTED-GIANT-LARGE output is already in metres. Prefer the "-1.1" re-trained checkpoints, because the originals had a training bug — [DA3 README](https://github.com/ByteDance-Seed/Depth-Anything-3)
- DA3 throughput on A100 at 504×336: DA3-Large 78.4 FPS (1500–1600 images max on 80 GB), DA3-Giant 37.6 FPS, VGGT 34.1 FPS — [DA3 Table 8](https://arxiv.org/html/2511.10647)

**Accuracy: Video Depth Anything metric models (Aug 2025, from the repo README), δ1** — [VDA README](https://github.com/DepthAnything/Video-Depth-Anything)
- NYUv2: MoGe-2-L 0.967, UniDepthV2-L 0.989, DepthPro 0.953, VDA-S-Metric 0.850, VDA-B-Metric 0.883, VDA-L-Metric 0.908
- ScanNet temporal alignment error (TAE, lower is better): VDA-L-Metric 1.09, UniDepthV2 1.41, MoGe-2 2.56, DepthPro 2.73
- Takeaway from these numbers: VDA is more temporally stable but less accurate in per-frame metric scale.

**Accuracy: MapAnything metric mode (v1 paper, Sept 2025)** — [MapAnything, arXiv 2509.13414](https://arxiv.org/html/2509.13414)
- Mechanism: a scale token passes through an MLP to predict one global metric scale factor m, applied exponentially. The final geometry is m × the up-to-scale geometry.
- Robust-MVD benchmark, metric depth, rel↓/τ↑ on **ScanNet**:
  - images only, single view: 27.77/2.9
  - images only, multi-view: 22.23/10.6
  - multi-view + intrinsics: 24.94/8.2
  - multi-view + intrinsics + metric poses: 5.58/48.1
- Same benchmark on KITTI, images-only multi-view: 5.45/45.7
- Scale ablation (50 views, average of ETH3D/ScanNet++ v2/TartanAirV2): images-only rel 0.16, τ 40.7; with intrinsics + metric poses, rel 0.05, τ 57.8
- These are v1 numbers. The Hugging Face checkpoints were updated in Dec 2025–Feb 2026 (`facebook/map-anything` lastModified 2026-01-20; `-apache` 2026-02-04), and v1 checkpoints are kept as `-v1` — [HF API](https://huggingface.co/facebook/map-anything-apache), [MapAnything README](https://github.com/facebookresearch/map-anything)
- Apache variant training data: Mapillary Planet-Scale Depth, ScanNet++ v2, Spring, TartanAirV2-WB, UnrealStereo4K and BlendedMVS. The CC-BY-NC variant adds seven more datasets, including Aria Synthetic Environments, DL3DV-10K and MegaDepth — [MapAnything paper](https://arxiv.org/html/2509.13414)

**VGGT is not metric.** Ground truth is normalised by "the average Euclidean distance of all 3D points in the point map P to the origin", and the network is forced "to learn the normalization". Outputs therefore share an arbitrary, though consistent, scale convention.
- Backbone runtime on H100 at 336×518: 100 frames 3.12 s / 21.15 GB; 200 frames 8.75 s / 40.63 GB
- Source: [VGGT, arXiv 2503.11651](https://arxiv.org/html/2503.11651)

**New in 2026:**
- **MoGe-3** ("Fine-Detail Monocular Geometry Estimation with Self-Guided Sparse Volumetric Refinement", [arXiv 2607.17967](https://arxiv.org/abs/2607.17967)). The checkpoint `Ruicheng/moge-3-vitg` has 1.25B params, metric scale and normals, and an MIT weight licence (HF created 2026-08-18) — [MoGe README](https://github.com/microsoft/MoGe), [HF](https://huggingface.co/Ruicheng/moge-3-vitg). I did not retrieve indoor accuracy numbers for MoGe-3.
- **"Honey, I Shrunk the Arc de Triomphe!"** (Xiangli, Chen, Tsang, Snavely; arXiv 2606.02379, June 2026) documents "scale-collapse": monocular geometry models under-estimate distant/large scenes. Fine-tuning MoGe-2 on the new MetricScenes dataset reduces it. The work targets outdoor scenes — [arXiv 2606.02379](https://arxiv.org/abs/2606.02379)
- **ZipDepth** (arXiv 2607.08771) is a lightweight zero-shot depth model reporting the best AbsRel among lightweight models on NYUv2 (8.4) and ScanNet (8.8). I only saw a search snippet, and it is unclear whether its output is metric — [arXiv 2607.08771](https://arxiv.org/html/2607.08771v1)

**Licence matrix: code vs weights** (verified against GitHub LICENSE files and the HF API, 2026-10-22)

| Model | Code licence | Weight licence | Commercial OK? |
|---|---|---|---|
| MoGe-1/2/3 | MIT ([repo](https://github.com/microsoft/MoGe)); bundled DINOv2 code Apache-2.0 | MIT on all HF cards: [moge-2-vitl-normal](https://huggingface.co/Ruicheng/moge-2-vitl-normal), [vitb](https://huggingface.co/Ruicheng/moge-2-vitb-normal), [vits](https://huggingface.co/Ruicheng/moge-2-vits-normal), [moge-3-vitg](https://huggingface.co/Ruicheng/moge-3-vitg) | **Yes** (training-data provenance not assessed) |
| Depth Anything 3 | Apache-2.0 ([repo](https://github.com/ByteDance-Seed/Depth-Anything-3)) | DA3METRIC-LARGE, DA3MONO-LARGE, DA3-BASE, DA3-SMALL: Apache-2.0. DA3-LARGE(-1.1), DA3-GIANT(-1.1), DA3NESTED-GIANT-LARGE(-1.1): CC BY-NC 4.0 ([README table](https://github.com/ByteDance-Seed/Depth-Anything-3)) | **Yes** for Metric-Large/Base/Small; no for Large/Giant/Nested |
| MapAnything | Apache-2.0 ([repo](https://github.com/facebookresearch/map-anything)) | `facebook/map-anything-apache` and `-apache-v1`: Apache-2.0. `facebook/map-anything` and `-v1`: CC BY-NC 4.0 ([README](https://github.com/facebookresearch/map-anything)) | **Yes** with the -apache weights only |
| VGGT | Custom "VGGT License" v1 (2025-07-29) for code ([LICENSE.txt](https://github.com/facebookresearch/vggt/blob/main/LICENSE.txt)) | VGGT-1B: CC BY-NC 4.0. **VGGT-1B-Commercial**: custom licence, gated by application form, "excluding military applications" ([README](https://github.com/facebookresearch/vggt), [HF](https://huggingface.co/facebook/VGGT-1B-Commercial)) | Yes with the Commercial checkpoint under its terms; not metric anyway |
| Metric3D v2 | BSD-2-Clause ([LICENSE](https://github.com/YvanYin/Metric3D/blob/main/LICENSE)) | No licence on the HF card ([JUGGHM/Metric3D](https://huggingface.co/JUGGHM/Metric3D)). README: "For further commercial inquiries, please contact" the authors ([README](https://github.com/YvanYin/Metric3D)) | **Unclear**: code is permissive, weight terms are unstated |
| Depth Pro (Apple) | Apple sample-code licence (permissive, [GitHub LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE)) | HF weights: **apple-amlr**, "exclusively for Research Purposes… does not include… use in any commercial product or service" ([HF LICENSE](https://huggingface.co/apple/DepthPro)). Conflict: the GitHub README says weights are under the repo LICENSE ([README](https://github.com/apple/ml-depth-pro)) | **No** (treat as research-only) |
| UniDepth V1/V2 | CC BY-NC 4.0 ([repo](https://github.com/lpiccinelli-eth/UniDepth)) | Same repo licence; no separate HF licence | **No** |
| UniK3D | CC BY-NC-SA 4.0 ([repo](https://github.com/lpiccinelli-eth/UniK3D)) | Same | **No** |
| Depth Anything V2 (metric) | Apache-2.0 ([repo](https://github.com/DepthAnything/Depth-Anything-V2)) | README: "Small… Apache-2.0. Base/Large/Giant… CC-BY-NC-4.0". But the HF cards for [Metric-Hypersim-Large](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Large) and Metric-Hypersim-Small both say apache-2.0, and the -Metric-Indoor-*-hf cards carry no licence tag | Small: yes. Base/Large: **conflicting sources**, treat as NC |
| Video Depth Anything (incl. metric) | Apache-2.0 ([repo](https://github.com/DepthAnything/Video-Depth-Anything)) | Small and Metric-Small: Apache-2.0. Base/Large and Metric-Large: CC BY-NC 4.0 ([HF](https://huggingface.co/depth-anything/Metric-Video-Depth-Anything-Large)) | Small only |
| Prompt Depth Anything (iPhone LiDAR prompt, 4K metric) | Apache-2.0 ([repo](https://github.com/DepthAnything/PromptDA)) | Apache-2.0 for vitl and vits ([HF](https://huggingface.co/depth-anything/prompt-depth-anything-vitl)) | **Yes** |
| MASt3R / DUSt3R | CC BY-NC-SA 4.0 ([mast3r](https://github.com/naver/mast3r), [dust3r](https://github.com/naver/dust3r)) | CC BY-NC-SA, plus training-dataset terms ("mapfree dataset license… very restrictive") ([CHECKPOINTS_NOTICE](https://github.com/naver/mast3r/blob/main/CHECKPOINTS_NOTICE)) | **No** |
| CUT3R | CC BY-NC-SA 4.0 ([LICENSE](https://github.com/CUT3R/CUT3R)) | Same | **No** |
| π³ (Pi3) / Pi3X | Code licence not retrieved (no LICENSE at repo root) | Pi3: BSD-2-Clause ([HF](https://huggingface.co/yyfz233/Pi3)). Pi3X: CC BY-NC 4.0 ([HF](https://huggingface.co/yyfz233/Pi3X)) | Pi3 weights yes. Pi3 output scale is not stated as metric (not verified) |
| VGGT-SLAM | BSD-2-Clause ([LICENSE](https://github.com/MIT-SPARK/VGGT-SLAM)) | Uses VGGT weights (see above) | Depends on the VGGT checkpoint |

### Inferences
- The strongest commercial-safe choice for per-frame metric depth/points is **MoGe-2 ViT-L** (MIT/MIT). It has the best average metric point accuracy in its own paper (NYUv2 Rel^p 4.4%, iBims 5.6%) and runs fast (about 30 ms FP16 on A100). **DA3METRIC-LARGE** (Apache-2.0) is the independent second opinion, with δ1 0.963 on NYUv2 and the best ETH3D score in DA3's table. Running both and checking agreement between their scale estimates is cheap.
- Papers rank these models differently depending on who runs the evaluation. For example, UniDepthV2 NYUv2 δ1 is 0.989 in the VDA README, 0.968 in the DA3 paper, and 0.928 (no intrinsics) in MoGe-2. Benchmark protocol (crop, intrinsics given or not, resolution) moves numbers by several points, so the team should validate on its own phone captures.
- Feeding COLMAP intrinsics to models that accept them (MoGe-2, UniDepth, Metric3D, MapAnything) is likely to help indoors. MoGe-2 iBims Rel^d improves from 13.6 to 9.92 with GT intrinsics.
- MapAnything's own images-only metric scale on ScanNet (rel about 22%) is much weaker than single-image MoGe-2 on NYUv2. The product should not rely on the MapAnything scale token alone. Instead, re-scale MapAnything output with a per-frame metric-depth median (Section 2), or feed it metric poses or intrinsics. Its error drops to 5.6% with metric poses.

### Gaps
- No primary-source indoor numbers were retrieved for MoGe-3, Pi3/Pi3X metric output, UniK3D, or MASt3R metric-checkpoint scale error specifically on ScanNet or ARKitScenes.
- No paper reports a clean "global scale error %" metric for these models. Rel/δ1 mixes scale and shape errors.
- The Metric3D v2 weight licence is unstated, and the Depth Anything V2 Base/Large metric weight licence is contradictory (README vs HF card). Both need direct confirmation from the authors.
- The MASt3R metric-checkpoint HF card has no licence tag. The repo licence and CHECKPOINTS_NOTICE are assumed to govern.

---

## 2. Aligning a scale-free SfM/MapAnything reconstruction to metric depth predictions, and accuracy in practice

### Takeaway
The standard method computes a robust ratio, usually the median, between predicted metric depth and SfM depth at each frame's triangulated points, then takes a robust (median or IRLS) aggregate across frames. Published per-frame metric errors (4–14% on indoor sets) and observed frame-to-frame scale variability (CV about 5%) suggest aggregating many frames gives a global scale accurate to a few percent. No 2024–2026 paper was found that directly reports "% global scale error" for this exact recipe on indoor phone video.

### Cited Findings
- **MP-SfM (CVPR 2025)** adds monocular depth and normal priors to incremental SfM. It aligns monocular depth to the multi-view scale "using median statistics" and assumes known intrinsics. The authors say it can reliably reconstruct challenging indoor scenes from few images (search snippet; full paper not read) — [MP-SfM, arXiv 2504.20040](https://arxiv.org/html/2504.20040v1)
- **DropD-SLAM** (arXiv 2510.06216, Oct 2025) replaces the RGB-D sensor in a SLAM system with monocular metric depth, using **UniDepthV2** or **DepthAnythingV2** — [DropD-SLAM](https://arxiv.org/html/2510.06216v1)
  - TUM RGB-D static sequences, mean ATE: UniDepthV2 0.074 m, DepthAnythingV2 0.083 m, same pipeline with real sensor depth 0.068 m
  - Dynamic sequences, mean ATE: UniDepthV2 about 2.27 cm vs sensor 1.8 cm
  - Frame-to-frame **scale coefficient of variation**: DepthAnythingV2 0.0493, UniDepthV2 0.0508, Metric3DV2 0.0648
  - The paper does not state whether ATE used SE(3) or Sim(3) alignment.
- **Scalix** (Barbas Laina et al., Leutenegger group; arXiv 2608.17553, Aug 2026) makes per-frame depth scale an optimised factor-graph variable, with a prior from Metric3Dv2-small plus learned uncertainty heads — [Scalix](https://arxiv.org/html/2608.17553)
  - 7-Scenes average ATE: Scalix 8.6 cm Sim(3) vs **12.0 cm SE(3)** (metric, no scale fitted); with full BA 7.8 vs 11.5 cm
  - DROID-SLAM + Metric3D: 10.1 cm Sim(3) vs 13.5 cm SE(3)
  - Code "will be released upon acceptance"
- **Learning Image-Adaptive Scale Fields** (Li & Althoff, TUM; arXiv 2605.07418, May 2026) compares a global least-squares scale+shift fit of DA3-BASE relative depth against an 8-basis scale field, using sparse metric anchors — [arXiv 2605.07418](https://arxiv.org/html/2605.07418)
  - Global fit, AbsRel/δ1: 0.21/0.74 (10–15 anchors), 0.18/0.78 (500+ anchors)
  - Scale field: 0.08/0.92 and 0.07/0.95
  - Evaluated only on pooled UrbanSyn + SUN RGB-D, so these are not indoor-only numbers.
  - Implication: a single global factor cannot fix the spatially varying distortion in *relative* depth. Use metric-trained models, or local or per-frame scales.
- **DGSfM** (arXiv 2607.09507, 2026) uses monocular depth for scale averaging and initialisation in global SfM, and also estimates focal length. Search snippet only; no numbers retrieved — [DGSfM](https://arxiv.org/pdf/2607.09507)
- **PRISM-SLAM** (arXiv 2605.19257) adds a ray-distance factor to make metric scale identifiable. It criticises competitors for relying on post-hoc Sim(3) alignment to ground truth. No numbers retrieved — [PRISM-SLAM](https://arxiv.org/html/2605.19257v2)
- **SCE-SLAM** (arXiv 2601.09665) argues that metric-depth and multi-view models add too much overhead for real-time use and targets scale consistency instead (KITTI results) — [SCE-SLAM](https://arxiv.org/pdf/2601.09665)
- **Metric3D v2 (older, 2024; revised Jan 2025)** feeds metric depth into DROID-SLAM on KITTI and reports a "significant drop" in translation drift (snippet) — [Metric3D v2](https://arxiv.org/html/2404.15506v4)
- The **DA3 "Nested" model** combines an any-view model for pose and depth with a monocular metric depth estimator for scaling. This is a built-in version of the align-to-metric-depth recipe, but its weights are CC BY-NC — [DA3 README](https://github.com/ByteDance-Seed/Depth-Anything-3)

### Inferences
- **Recommended recipe for World Builder** (engineering inference, not from a single paper):
  1. Take each registered image i, with COLMAP or MapAnything intrinsics.
  2. Run MoGe-2 (and optionally DA3METRIC-LARGE) with the known intrinsics.
  3. Project the image's SfM 3D points into it, giving camera-frame depth z_sfm.
  4. Sample the predicted metric depth z_m at the same pixels, keeping valid-mask and edge-free pixels only.
  5. Compute s_i = median(z_m / z_sfm).
  6. Take global s = median over i, or Huber/IRLS on log s_i weighted by point count and inverse MAD.
  7. Report a confidence interval from the bootstrap spread of s_i.
  8. For MapAnything dense output, use its per-frame depth instead of SfM tracks.
- Error budget: per-frame scale scatter is about 5% CV (DropD-SLAM). If frame errors were independent, 50+ frames would cut the random part below 1%. But model bias is correlated across frames of the same room (e.g. scale-collapse at range, as in "Honey, I Shrunk…"), so the realistic floor is likely the model's systematic indoor bias. That is probably a few percent on NYUv2-like rooms and possibly 10%+ in atypical spaces (iBims/HAMMER-like). This range is inferred from the Section 1 numbers and has not been measured.
- The Scalix SE(3)-vs-Sim(3) gap of about 3.4 cm on room-scale 7-Scenes shows that metric-prior SLAM is already metrically consistent to a few centimetres at room scale.
- Prefer pixels at 0.5–5 m depth and exclude windows, mirrors and glass, where metric models and sensors both fail (see Section 3). Also exclude sky and outdoor views seen through windows.
- Compared with the current fixed 1.35 m phone-height prior: people hold phones at different heights, so that prior plausibly carries a ±10% or worse error. This figure is an inference with no measured source. A median-ratio alignment to MoGe-2/DA3-metric is likely to beat it on typical rooms, and should be cross-checked against the floor-plane-to-camera height when a floor is detected.

### Gaps
- No primary 2024–2026 source reports a "% global scale error" for median-ratio alignment of COLMAP to MoGe-2/UniDepth/Depth Pro on ScanNet, ARKitScenes or real phone video. The team should run this measurement themselves, for example on ARKitScenes, which has laser-scanner ground truth.
- The full text of MP-SfM was not read, so no numbers on its scale accuracy are recorded here.

---

## 3. Phone sensors: ARKit/ARCore VIO, iPhone LiDAR, RoomPlan, Android Depth, and browser options (WebXR, DeviceMotion)

### Takeaway
A native app gets metric scale almost for free. ARKit VIO closes loops to about 0.2–0.5% of path length indoors, iPhone LiDAR is accurate to centimetres within about 5 m, and RoomPlan handles rooms up to 15 × 15 m. From a **web browser**, iOS Safari has **no WebXR at all**. Chrome on Android exposes metric depth through the WebXR Depth Sensing module backed by ARCore. Raw DeviceMotion IMU is available in all browsers but needs custom visual–inertial scale estimation, which reached about 1% in a 2017 study.

### Cited Findings
**VIO accuracy** (independent benchmark; Sensors 2022 / arXiv 2207.06780 — older, iOS 14.7.1, iPhone 12 Pro Max vs ARCore on LG V60 ThinQ, closed loops):
- Final drift error (start–end gap, metres; ARKit | ARCore | path length) — [Table I, arXiv 2207.06780](https://arxiv.org/pdf/2207.06780), [PubMed](https://pubmed.ncbi.nlm.nih.gov/36560242/):
  - Indoor corridor: 0.79 | 0.12 | 145.21 m
  - Indoor hallway: 0.14 | 0.09 | 83.98 m
  - Indoor stairs: 0.19 | 3.98 | 114.13 m
  - Parking lot: 0.26 | 1.14 | 446.26 m
  - Outdoor roads: 2.68 | 140.08 | 3051.61 m
- Of the four VIO systems tested, the authors found ARKit the most consistent. Its trajectories kept "orthogonality and scale… well compared with the floorplan", and the floor heights it estimated "are approximately identical" to the blueprint — [arXiv 2207.06780](https://arxiv.org/pdf/2207.06780)
- An informal, older blog test on an iPhone X over a 19.1 m corridor reported about 1.5 m error for ARKit and about 0.5 m for ARCore. This is weak evidence — [Medium](https://zhongyu-wang.medium.com/drifting-error-comparision-of-arcore-and-arkit-visual-odometry-16cb68e02b8a)

**iPhone/iPad LiDAR:**
- Luetzenburg et al., Sci. Rep. 2021 (older; iPhone 12 Pro): absolute accuracy of **±1 cm** for objects with side length > 10 cm, and **±10 cm** for a 130 × 15 × 10 m coastal cliff — [Sci Rep 11:22221](https://pmc.ncbi.nlm.nih.gov/articles/8593014)
- Façade study (iPhone 12 Pro Max, 0.25–5 m): RMSE of 4.89 mm vs 3.44 mm for a terrestrial laser scanner. Error grew slightly with range. Peer-review status was not confirmed — [ResearchGate](https://www.researchgate.net/publication/378351112_Evaluating_the_Accuracy_of_iPhone_Lidar_Sensor_for_Building_Facades_Conservation)
- ARKit `sceneDepth` provides an ARDepthData depth map plus a per-pixel confidence map (ARConfidenceLevel) on LiDAR devices — [Apple ARDepthData](https://developer.apple.com/documentation/arkit/ardepthdata). Developer reports describe 256×192 Float32 depth at 60 Hz, interpolated from 576 LiDAR points. This is a third-party claim that Apple does not document — [Apple dev forums](https://origin-devforums.apple.com/forums/profile/CurvSurf/replies?page=2)
- A range of about 5 m is widely cited. Vendor (unverified) claims are 1–3 cm under 3 m, 3–5 cm at 3–4 m, and 5–10 cm near 5 m — [Manifold blog (vendor)](https://www.scanmanifold.com/blog-posts/lidar-on-iphone-how-accurate-is-it-plus-the-biggest-errors-that-manifold-corrects)
- **Prompt Depth Anything** (CVPR 2025) uses low-resolution iPhone LiDAR depth as a prompt to produce high-resolution metric depth. Code and weights are Apache-2.0 — [PromptDA](https://github.com/DepthAnything/PromptDA), [HF](https://huggingface.co/depth-anything/prompt-depth-anything-vitl)

**RoomPlan** (Apple ML research):
- Walls and windows: 95% precision/recall; doors: 90%
- 16 object categories: 91% precision / 90% recall at 3D IoU 0.3
- Supports rooms up to 15 m × 15 m and up to 3.6 m tall
- Layout voxels are 3 cm in x/y. Apple publishes **no cm-level dimension accuracy**.
- Glass and mirrored walls are a known difficulty.
- Source: [Apple ML Research](https://machinelearning.apple.com/research/roomplan)
- Independent accuracy evidence is thin. One blog demo measured a 6.45 m wall as 6.821 m (+37 cm, +5.8%) and noted that errors accumulate across walls — [it-jim](https://www.it-jim.com/blog/roomplan-framework-by-apple/). Forum anecdotes put it "often within 15 cm" — [Apple forums](https://developer.apple.com/forums/thread/712500)
- A non-peer-reviewed open-source test on ARKitScenes iPad scans found 11 of 12 ceiling-height estimates within 1.5 cm (mean −0.3 cm) — [GitHub case study](https://github.com/suraj2022s/floorplan-case-study)

**Android ARCore Depth API:**
- "robust, accurate depth estimates from 0 to 65 meters", most accurate at **0.5–5 m**
- Depth comes from motion, so data appears only after the device moves. ToF data is fused when the hardware has it.
- Featureless surfaces such as white walls give imprecise depth.
- Only some devices are supported.
- Source: [ARCore Depth](https://developers.google.com/ar/develop/depth)

**Browser capture:**
- The **WebXR Depth Sensing Module** (Editor's Draft, 25 Aug 2026) exposes depth through `getDepthInMeters()` or raw values × `rawValueToMeters`. It offers cpu-optimised (ArrayBuffer) and gpu-optimised (WebGL/WebGPU texture) modes. `luminance-alpha` is mandatory, and `unsigned-short`/`float32` are optional. Resolution is device-dependent. It needs the `depth-sensing` feature and user consent equivalent to camera access — [W3C/Immersive Web draft](https://immersive-web.github.io/depth-sensing/)
- In Chrome, WebXR uses ARCore on supported Android devices, and Google lists the Depth API as **shipped** in WebXR — [ARCore–WebXR comparison](https://developers.google.com/ar/develop/webxr/arcore-comparison?hl=en)
- caniuse marks WebXR **"Not supported" on Safari iOS in every version through 27.2**. Chrome for Android has partial support, Samsung Internet partial, and Firefox disabled by default — [caniuse WebXR](https://caniuse.com/webxr)
- **DeviceMotionEvent** gives `acceleration` and `accelerationIncludingGravity` (m/s²), `rotationRate` (deg/s) and `interval` (ms). It requires HTTPS and has a `DeviceMotionEvent.requestPermission()` method. It has been Baseline widely available since Sept 2023. Chrome and Firefox differ in coordinate handling — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent)

**IMU-only scale for SfM:**
- Mustaniemi et al. (IROS 2017, older) estimate SfM scale from phone IMU plus camera poses, with frequency-domain estimation for timestamp robustness. Scale was **about 1% from ground truth**, varying by recording. A MATLAB implementation is available — [arXiv 1611.09498](https://arxiv.org/abs/1611.09498), [code](https://github.com/jannemus/InertialScale)
- A 2026 study using a consumer IMU on a ground robot found scale error depends on the motion pattern: 9.2% for straight lines, 6.4% for circles, 4.8% for figure-eights — [arXiv 2603.26740](https://arxiv.org/abs/2603.26740)

### Inferences
- The best achievable path is a native iOS capture app recording ARKit poses, plus LiDAR depth on Pro models. ARKit translations are already metric; at about 0.2–0.5% loop drift, scale error on a room-scale scan is likely under 1%. COLMAP can be Sim(3)-aligned to the ARKit camera centres (Umeyama), or the ARKit poses can be used directly as metric pose priors for MapAnything. MapAnything's metric error drops to about 5% rel with metric poses.
- For browser-only capture: on Android Chrome, record WebXR camera poses and depth. On iOS Safari there is no WebXR, so the options are (a) learned metric depth alignment (Section 2), (b) DeviceMotion IMU logged alongside video for Mustaniemi-style scale estimation, or (c) user reference objects (Section 4). For (b), the user should move the phone with some translational acceleration; the motion pattern strongly affects error, per arXiv 2603.26740.
- Browser IMU and video timestamps are not hardware-synchronised. This is why the frequency-domain or time-offset estimation in Mustaniemi et al. matters. This is an inference: browser sync quality was not measured in any source found.

### Gaps
- No peer-reviewed 2024–2026 study of RoomPlan wall-length accuracy against laser ground truth was found.
- No study of ARKit scale error (as opposed to loop-closure drift) on recent iPhones or iOS versions was found.
- Apple publishes no official sceneDepth resolution, rate or accuracy figures.
- No data was found on DeviceMotion sampling-rate jitter or IMU–video sync on iOS Safari.

---

## 4. Known-size object priors and fiducials: dimensions, accuracy, failure modes

### Takeaway
Credit cards (ISO/IEC 7810 ID-1, 85.60 × 53.98 mm) and printed fiducials (AprilTag/ArUco/ChArUco) are the only references with truly standardised dimensions worldwide. Door heights vary about 3% between regions, from 1981 mm (England/Wales) to 2032 mm (US) to 2040 mm (Scotland/Australia), and within regions. That makes doors a weak automatic prior but a useful sanity check. Fiducial pose error is millimetre-level at close range in lab tests, but grows with distance and viewing angle.

### Cited Findings
- **ID-1 card** (credit, debit and ID cards): 85.60 × 53.98 mm (3.370 × 2.125 in), corner radius 2.88–3.48 mm, thickness 0.76 mm ± 0.08 mm — [ISO/IEC 7810](https://en.wikipedia.org/wiki/ISO/IEC_7810)
- **Paper sizes:** A4 = 210 × 297 mm ([ISO 216](https://en.wikipedia.org/wiki/ISO_216)); US Letter = 8.5 × 11 in = 215.9 × 279.4 mm ([Letter](https://en.wikipedia.org/wiki/Letter_(paper_size)))
- **Door heights:**
  - England/Wales most common: 1981 mm (6′6″); Scotland: 2040 mm (80 in, as that source states) — [Howarth Timber](https://www.howarth-timber.co.uk/inspiration-advice/uk-door-sizes)
  - US standard interior: 80 in (2032 mm) — [itemfits (secondary)](https://itemfits.com/reference/door-sizes-by-country)
  - Australia about 2040 mm, citing AS 1428.1/NCC — single commercial table, unverified — [itemfits](https://itemfits.com/reference/door-sizes-by-country)
  - DIN 18101 / EN 14351 is linked to about 2100 mm, but only by the same commercial table; not verified against the standard — [itemfits](https://itemfits.com/reference/door-sizes-by-country)
- **Fiducial accuracy:**
  - Lab pose benchmark, mean (max) position error: AprilTag 36h11 1.402 mm (3.824 mm), ArUco 8.191 mm, ARToolKit 8.639 mm, TopoTag 1.011 mm — [TopoTag, arXiv 1908.01450](https://arxiv.org/pdf/1908.01450)
  - KIT study: open-source fiducials can be tracked "at submillimeter range at distances up to one meter" — [KIT](https://publikationen.bibliothek.kit.edu/1000092221)
  - A drone-localisation thesis reports 98% detection but about 40 cm position error in field conditions — [CVUT thesis](https://dspace.cvut.cz/entities/publication/2cfdae10-94af-4f7c-9a46-e34f5692ffbc/full)
  - AprilTag error analysis: yaw about the camera's vertical axis is the main error source, and accuracy is best when the tag is viewed head-on (snippet) — [PMC6960891](https://pmc.ncbi.nlm.nih.gov/articles/PMC6960891)

### Inferences
- **Recommended UX tiers:**
  1. Automatic metric-depth alignment (Section 2), which needs zero user effort.
  2. Optional "place a printed AprilTag/ChArUco sheet (or a credit card) on the floor and include it in 3+ frames". Detect it, triangulate its corners in the SfM model, and scale so the corner distances match.
  3. Optional door-height consistency check: detected door frames should come out at 1.95–2.10 m, and anything outside triggers a warning rather than auto-scaling.
  4. The existing two-point manual measurement as override.
- Failure modes:
  - Printers silently rescale pages ("fit to page"). Users should verify the printed marker side with a ruler, or use an ID-1 card instead, which is never rescaled.
  - A card is small (8.6 cm). A 1 px corner error at 1–2 m distance is a large relative error. Triangulating corners across many frames, and using the long edge, reduces this. This is an inference; no published phone-SfM card-scale study was found.
  - Door heights vary by region (about 3%), and non-standard, double, accessible or commercial doors break the prior.
  - Ceiling heights and outlet plates vary even more and should only be soft priors.

### Gaps
- Wall-plate and outlet sizes by region (e.g. NEMA US plates, UK 86 × 86 mm, EU 80 × 80 mm) were not verified against primary standards. Treat them as unverified.
- Ceiling-height code minimums (e.g. US IRC, UK and Canadian codes) were not retrieved.
- No published study was found that quantifies SfM scale error when scaling from a credit card or A4 sheet in phone video. The fiducial numbers above are pose-estimation errors, not reconstruction-scale errors.
- The DIN 18101 and AS 1428.1 door-height values need checking against the standards text.

---

## 5. 2024–2026 papers and open-source systems on scale recovery for phone SfM / metric monocular SLAM

### Takeaway
The 2025–2026 trend is to fold metric-depth foundation models into SLAM/SfM as scale priors (Scalix, PRISM-SLAM, DropD-SLAM, MP-SfM, DGSfM, DA3-Nested), or to predict metric scale directly in feed-forward reconstruction (MapAnything, MASt3R metric). Room-scale results reach centimetre-level metric ATE, but none is a turnkey, commercially licensed "scale my COLMAP model" tool. Most code is either unreleased or non-commercial.

### Cited Findings
- **Scalix** (Aug 2026): Metric3Dv2-S scale priors; 7-Scenes SE(3) ATE 11.5–12.0 cm; code not yet released — [arXiv 2608.17553](https://arxiv.org/html/2608.17553)
- **DropD-SLAM** (Oct 2025): UniDepthV2/DA-V2 metric depth replaces the depth sensor; TUM static ATE 7.4 cm vs 6.8 cm with real depth; 22 FPS on one GPU (search snippet) — [arXiv 2510.06216](https://arxiv.org/html/2510.06216v1). Note that UniDepthV2 is CC BY-NC.
- **PRISM-SLAM** (May 2026) uses a Plücker ray-distance factor for metric scale — [arXiv 2605.19257](https://arxiv.org/pdf/2605.19257)
- **SCE-SLAM** (Jan 2026) targets scale consistency via scene coordinate embeddings, evaluated on KITTI — [arXiv 2601.09665](https://arxiv.org/pdf/2601.09665)
- **MP-SfM** (CVPR 2025) puts monocular depth and normal priors in incremental SfM, with median scale alignment — [arXiv 2504.20040](https://arxiv.org/html/2504.20040v1)
- **DGSfM** (2026) does depth-guided, scale-aware global SfM — [arXiv 2607.09507](https://arxiv.org/pdf/2607.09507)
- **Image-adaptive scale fields** (May 2026) recover metric depth from relative depth plus sparse anchors — [arXiv 2605.07418](https://arxiv.org/html/2605.07418)
- **MapAnything** (Sept 2025; Apache code and Apache weights variant) predicts a global metric scale and accepts optional metric poses, intrinsics or depth. It also ships a COLMAP export script (`scripts/demo_colmap.py --apache`) — [README](https://github.com/facebookresearch/map-anything), [paper](https://arxiv.org/html/2509.13414)
- **DA3-Nested** (Nov 2025) combines an any-view model with a metric mono model for scale; output is in metres; CC BY-NC — [DA3 README](https://github.com/ByteDance-Seed/Depth-Anything-3)
- **VGGT-SLAM** (BSD-2 code) — [repo](https://github.com/MIT-SPARK/VGGT-SLAM). VGGT itself is up-to-scale — [VGGT paper](https://arxiv.org/html/2503.11651)
- **Inertial scale for SfM** (2017, older): about 1% scale error, with MATLAB code — [arXiv 1611.09498](https://arxiv.org/abs/1611.09498)

### Inferences
- A practical, commercially clean stack for World Builder:
  1. pycolmap or MapAnything-apache for poses.
  2. MoGe-2 (MIT) per-frame metric depth with COLMAP intrinsics.
  3. Robust median-ratio global scale with a bootstrap confidence interval.
  4. An optional ARKit/WebXR pose or IMU channel, or fiducial, when available.
  5. Floor-plane/camera-height and door-height checks as validators.
- All the building blocks are MIT, Apache or BSD. Avoid Depth Pro, UniDepth, MASt3R, CUT3R and the large DA3/VDA checkpoints for production.

### Gaps
- Licences were not checked for Scalix, PRISM-SLAM, DGSfM or MP-SfM code; most have no code release yet.
- No benchmark directly comparing these scale-recovery approaches on smartphone indoor video, for example on ARKitScenes with laser ground truth, was found.
