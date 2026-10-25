# World Builder: a measurement advantage that can be tested

Research checked October 24, 2026. This plan builds on [the existing metric-scale research](metric-scale-and-blender-sim-layer.md), rather than restarting that work. External benchmark numbers below are author-reported and have not been reproduced here. Roadmap dates, effort and acceptance targets are proposals.

## Product objective and implementation boundary

Turn a phone walkthrough into a structured IFC reference model whose dimensions carry source evidence, explicit uncertainty and independent checks. The potential advantage is less manual cleanup and better evidence per delivered model. It is not established superiority over an existing capture product.

The backend first slice in this branch is an evidence layer: `measurement_check.py`, optional `measurementChecks` on the cloud request, and a worker `scene-measurements.json` report. It compares declared physical reference measurements with the bound geometry and distinguishes calibration inputs from held-out checks. It does not run a new geometry model, derive trustworthy dimensions from an LLM, prove the reference measurements were collected correctly, certify a building, or automatically establish physical accuracy.

Keep four separate questions in every result:

1. Does the compiled model follow the reconstructed points? Existing `fit-check.json` answers internal model-to-points agreement.
2. Do selected dimensions agree with independently recorded measurements? The measurement report answers a bounded, self-reported check.
3. Is the object identity correct? VLM/detector suggestions and human review answer semantic identification.
4. Does the IFC work in the intended BIM application? Import, element inspection and an explicit editing test answer interoperability.

## Architecture: identify, reconstruct, measure, check

| Layer | Responsible component | Output and boundary |
|---|---|---|
| Capture | Phone video and capture-quality checks | Original bytes, timestamps, lens/camera information and missing-view warnings |
| Geometry | Existing COLMAP/dense worker and recorded transforms | Points, poses, gravity alignment and source-bound scene geometry |
| Semantics | Existing VLM naming; planned mask tracking | Suggested identity and instance association; numeric size priors remain separate from measured geometry |
| Dimensions | Geometry in a recorded metric frame | Point-derived spans and element sizes; occluded or inferred bases remain tagged |
| Physical checks | Calibration records plus independent held-out measurements | Residuals, check policy, reference uncertainty and evidence bindings; a check cannot secretly rescale the geometry it evaluates |
| Delivery | IFC, DXF, quantities and evidence sidecars | Separate walls/slab/openings, scale provenance and unresolved geometry for downstream review |

A VLM should identify the target, suggest its category and choose useful views. A segmentation/tracking model should follow the same instance through the video. Calibrated geometry should calculate dimensions. A language model can explain disagreements and request another view or physical measurement, while the measurement layer retains numeric authority and the original observations.

## What the research supports

**VLM sizing is a weak primary measurement source.** [Metric VQA](https://arxiv.org/html/2606.24335v1) evaluates 10,813 queries in total: 10,482 Objectron queries and 331 tape-measured in-the-wild queries. Qwen3-VL-235B and Qwen3.5-397B each reach 30.8% within 10% error on the wild split, versus 36.9% for its text-only reference. The study finds target identity more influential than scene geometry. It does not establish that every later VLM behaves identically. Treat a VLM's typical-object size as a labelled prior or anomaly flag, never an independently verified wall, object or clearance measurement.

The earlier synthesis includes an intuitive conversion from MRA scores to a typical percentage error. Do not use that conversion: an aggregate MRA score does not uniquely determine an error distribution. Likewise, estimated SfM intrinsics are not ground-truth intrinsics, frame agreement is not independent accuracy evidence, and learned-model benchmark error is not a calibrated interval on a specific BIM dimension.

### Qualification order

| Priority | Candidate | Evidence, licence and practical use |
|---|---|---|
| 1 | MoGe-2 metric geometry | [Code](https://github.com/microsoft/MoGe) is MIT apart from its Apache-2.0 DINOv2 component; the [normal checkpoint](https://huggingface.co/Ruicheng/moge-2-vitl-normal) declares MIT. The [paper](https://arxiv.org/html/2507.02546v1) reports metric point relative errors of 4.44% on NYUv2, 7.19% on ETH3D and 13.4% on HAMMER. Point evaluation fits translation; depth evaluation is unaligned. Use a pinned v2 setup as a proposed scale audit against shared SfM observations. The current repo defaults include v3/CUDA13/Triton changes, so avoid replacing the working worker environment. |
| 2 | DA3METRIC-LARGE | [Official code and model table](https://github.com/ByteDance-Seed/Depth-Anything-3) identify this 0.35B checkpoint as Apache-2.0. BASE/SMALL are relative-only, while Nested/Large/Giant weights are noncommercial. Metric conversion is `focal_px * net_output / 300`; preserve the resized-image focal convention. Its [paper Table 11](https://arxiv.org/html/2511.10647) reports NYUv2 AbsRel 0.070 and ETH3D 0.104. Trial it as another audit cue; agreement with MoGe is not proof that their errors are independent. |
| 3 | SAM 2 instance tracking | [Official repository](https://github.com/facebookresearch/sam2) provides image/video prediction, multi-object mask propagation and Apache-2.0 checkpoints/code. Use masks plus existing camera poses and 3D observations to separate touching objects and compute point-derived extents. Mask confidence alone does not establish physical size or the geometry hidden behind an object. |

The [MapAnything Apache variant](https://github.com/facebookresearch/map-anything) remains the existing dense baseline. Reuse its pinned setup and bounded receipts; the default MapAnything checkpoint has different, noncommercial terms.

MoGe-2's paper reports 29 ms and 0.96 GB for 1200-token FP16 inference on A100. These are neither a 4090 timing result nor a GB10 admission guarantee. Qualify each model in a separate environment with pinned source/checkpoint hashes, actual peak memory, timeout and coexistence checks. Prefer the 4090 for initial x86_64 trials. GB10 ARM64 dependencies and shared-service behavior require their own qualification. No new model was installed or executed for this plan.

## Reproducible benchmark and comparator

Start with three rooms for a demonstration protocol, then expand to a locked test set. Three rooms do not justify a general accuracy claim or a calibrated population-level interval.

1. Capture three independent 30 to 60 second videos per room using one phone's fixed 1x lens. Include floor texture, corners, doorways and furniture bases. Preserve originals and capture metadata.
2. Mark identifiable endpoints and record at least one calibration length plus five held-out dimensions spanning different directions and lengths. Record instrument, units, measurement uncertainty and whether endpoints were directly accessible. A second operator should check the reference record where practical.
3. Lock the calibration/check assignment and tolerance policy before processing. Use only calibration inputs to set scale. Do not tune geometry or thresholds against the held-out lengths and then count those lengths as an unseen test.
4. Baseline A is the current corrected pipeline with the same one-distance scale. B is the same geometry plus the new backend evidence report. B should leave dimensions unchanged while exposing missing, mismatched or failing evidence. Its immediate benefit is auditability, not an invented reduction in reconstruction error.
5. After qualification, C adds a proposed MoGe-2 audit and D adds mask-based instance separation. Keep video, frame selection, calibration, compute budget and acceptance policy fixed; record each change separately.
6. Use Polycam as one named external comparator. Its [own AEC page](https://poly.cam/solutions/architecture-engineering-construction) markets phone capture, measurements and CAD exports; its [building digitization guide](https://poly.cam/blog/how-to-digitize-an-existing-building-start-to-finish) describes modelling from exported scan geometry and says it does not directly export IFC. Those are vendor statements, not reproduced comparative results. Record the product version, capture mode, LiDAR use, device, operator, export settings and human cleanup time. If identical video import is unavailable, disclose the acquisition difference instead of calling it an identical-input comparison.
7. Report absolute and relative held-out errors, median and worst-case errors, missing dimensions, repeated-capture spread, missed/false obstacles, element/door-opening correctness, import success, human correction minutes, processing time, peak GPU memory and actual cost. Retain failures and unsupported views.
8. Proposed demo target: every declared held-out length within the greater of 5 cm or 2%, a usable doorway and individually inspectable BIM elements. Label this as an acceptance target, not an achieved survey tolerance. A dimension agreement result does not establish every unseen surface or robot clearance.

Preserve input and export hashes, worker/scene versions, calibration picks, check records, naming originals and reviews, inferred geometry flags and the BIM application's import result. Any geometry change makes the earlier check report historical until rebound and recomputed. Internal fit, physical checks, semantic review and native editing results remain separate evidence.

## Verification of the proposed VGGT, GPT4Scene and Bonsai stack

| Proposed claim | Primary-source correction and implication |
|---|---|
| VGGT's 85.3/88.2 at about 0.2 seconds means phone capture is solved | [VGGT Table 1](https://arxiv.org/html/2503.11651) reports camera-pose AUC@30 on RealEstate10K/CO3Dv2 using ten random frames and H100. These are neither dimension accuracy percentages nor end-to-end phone-video-to-BIM timings. The paper normalizes point, depth and translation scale; an [author reply](https://github.com/facebookresearch/vggt/issues/204) confirms its output is not metric. A measured anchor and independent checks remain necessary. |
| VGGT makes bundle adjustment unnecessary and the default model is commercially usable | The [official repo](https://github.com/facebookresearch/vggt) includes optional COLMAP-format bundle adjustment; Table 1 reports a separate optimized result. Its custom commercial licence applies to the gated `VGGT-1B-Commercial` checkpoint and excludes military applications; the original checkpoint remains noncommercial. Do not treat an arbitrary VGGT derivative's code licence as permission for its weights. |
| GPT4Scene improves SQA3D from 40.7 to 60.7, establishing accurate dimensions | [The primary table](https://arxiv.org/html/2501.01428v1) mixes two metrics in that comparison: EM-1 is 40.7 to 57.4; EM-R1 is 46.7 to 60.7. These are scene-question-answering scores, not metre errors. Its BEV plus consistent instance markers is useful for source-bound naming and correspondence; the experimental reconstruction uses ScanNet and Mask3D, not demonstrated arbitrary-phone metrology. |
| Bonsai is the backend factory that should replace the IFC exporter | [IfcOpenShell](https://docs.ifcopenshell.org/introduction.html) supplies standalone C++/Python APIs; Bonsai is its Blender graphical authoring/viewing interface. Use a pinned, tested IfcOpenShell version for headless model inspection/enrichment, then Bonsai for an actual edit round-trip. A current documentation version is not evidence that a particular Bonsai version is the stable version installed on our worker. |
| Competitors only provide attractive meshes | [Matterport's own BIM service](https://matterport.com/bim) explicitly offers LOD 200 BIM files and a Revit workflow. Polycam also markets measurements, floor plans, CAD exports and APIs, as noted above. The defensible hypothesis is faster evidence-backed conversion and lower correction cost on a specified capture mode, not that semantic BIM is absent from the market. No claim about Luma's full current offering was verified here. |

FastVGGT speed ratios, SLAM3R frame rates, the quoted trajectory-error/failure comparisons, and the exact OpenUSD release/schema claim were not independently verified in this pass. Do not turn them into BrainSNN performance claims. Gaussian-splat display support, even when available, does not establish dimensional accuracy or semantic BIM authoring. LOD labels require explicit element and information requirements plus an inspected deliverable; they do not follow automatically from export or a human clicking review.

### Smallest useful Bonsai/IfcOpenShell follow-up

Preserve `robotics/scene_compiler/ifc_export.py` and its existing walls, slab, metre units and provenance. Add a separate, version-pinned validation/enrichment step instead of replacing the reconstruction or exporter:

1. Open the existing `scene.ifc` with IfcOpenShell. Record schema, units, element classes, storey containment, property sets and GUIDs; perform schema/EXPRESS and geometry checks. A successful parse alone is insufficient.
2. Preserve proposed opening location, dimensions, host-wall ID and review status in `scene.json`. On an approved opening, create `IfcOpeningElement` and the hosted void relationship; the documented [feature.add_feature API](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/feature/add_feature/index.html) shows this operation. Add a reviewed `IfcDoor` and [feature.add_filling](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/feature/add_filling/index.html) only when a door, rather than an empty opening, is supported.
3. Open that file in Bonsai, select a wall, inspect its properties and opening, make one deliberate dimension edit, save and reopen it. Verify opening attachment, relevant dimensions, GUID behavior and provenance after the edit. Preserve the original and edited files separately; earlier measurement checks become historical when geometry changes.
4. Repeat import in the intended downstream BIM application. Report the exact tested workflow as an editable IFC reference workflow until broader authoring behavior is demonstrated. This follow-up is planned; the backend measurement-evidence change does not claim it has executed Bonsai or authored these opening relationships.

## Proposed 30/60/90-day sequence

| Window | Deliverable | Decision gate |
|---|---|---|
| Days 1 to 30 | Ship the bounded backend report; connect a stable worker; complete one physical-room capture and target-BIM import; collect the three-room baseline and identify the dominant errors. Preserve explicit host-wall/opening relationships as the next BIM implementation slice. | Demonstrate actual held-out errors and correction time. If geometry fails, improve capture/geometry before adding models. |
| Days 31 to 60 | Qualify pinned MoGe-2, then DA3 metric only if it adds useful disagreement detection. Trial SAM 2 on touching-object cases. Add source-linked review of suggested identities, occlusion and inferred bases. | On a frozen comparison, show fewer missed errors or less correction time without worse held-out accuracy or concealed missing geometry. |
| Days 61 to 90 | Expand the held-out room/device set, test repeated captures and failure cases, complete IFC editing round-trips in the chosen BIM application and run a disclosed external comparison. Calibrate any intervals on a separate dataset before presenting them as coverage claims. | Publish a bounded evidence-backed capability statement with sample size, capture requirements, actual errors, missing-case rates, costs and supported workflows. |

The defensible asset would be a growing corpus of consented real captures, independently recorded measurements, corrected BIM elements and repeatable failure cases. The current code and this roadmap are an early foundation; performance and customer value must be demonstrated before claiming a comparative advantage.
