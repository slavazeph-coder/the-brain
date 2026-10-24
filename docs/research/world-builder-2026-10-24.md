# BrainSNN World Builder research brief, October 24, 2026

Reporting window: October 17 to October 24, 2026, first brief. Publication dates below come from the original papers. Sources and code availability were checked; external benchmarks were not reproduced in this session. Effort and incremental costs are estimates, not measured results. Hardware access must be confirmed before running GPU work.

## Most useful developments

### 1. SceneRig: validate placement with physics, not appearance alone

Submitted October 20. [Paper](https://arxiv.org/abs/2610.28585), [code](https://github.com/Red-Fairy/SceneRig), [results and benchmark protocol](https://red-fairy.github.io/SceneRig/).

SceneRig couples geometric inspection, bounded object-pose edits and physical settling. This is useful to BrainSNN's separated objects and inferred furniture bases: a plausible render or stable scene can still put objects in the wrong place.

The authors report 80% recorded-trajectory replay success versus 36% for SimFoundry, and 69% real/sim episode-outcome agreement versus 54%, on their manipulation protocols. These are different metrics. Crucially, the robot experiments replace monocular estimates with measured RGB-D depth, calibrated intrinsics and camera-to-robot registration. They do not validate phone-only metric reconstruction. Cluttered rooms remain difficult; objects are rigid bodies without recovered articulation or deformation.

Reproduction is feasible in principle but expensive in setup: the repo documents Linux x86_64, CUDA 12.6+, roughly 150 GB disk, multiple isolated model environments, Blender/Isaac and gated SAM 3/SAM 3D weights. A 4090 is the more practical initial target; GB10 ARM64 compatibility is not established by these instructions. Estimate: 3 to 5 engineering days for a bounded reproduction, or 1 to 2 days to borrow its validation approach without adopting the full stack. API/model costs need a separate capped trial.

### 2. AOV-GS: choose the next scan view using semantic novelty

Submitted October 21. [Paper](https://arxiv.org/abs/2610.29374), [full paper](https://arxiv.org/pdf/2610.29374), [code and pipeline commands](https://github.com/OptimusFaber/AOV-GS), [Replica dataset](https://github.com/facebookresearch/Replica-Dataset), [Matterport3D dataset and access terms](https://niessner.github.io/Matterport/).

Frozen SAM and CLIP features re-rank geometrically promising next views. BrainSNN could borrow this as capture guidance: ask the user for a useful additional angle rather than processing an incomplete fixed walkthrough. It is an exploration method, not a replacement for geometry or the route planner.

Authors report language-field mIoU gains of 1.3 percentage points on eight Replica scenes and 1.8 points on five Matterport3D scenes. Their Habitat evaluation supplies RGB-D and oracle ground-truth camera poses, with no estimated-pose noise. Four of eight Replica scenes regress against geometry-only exploration; office2 drops 3.9 points without CorrCLIP. Dark rooms, clutter, fragmented masks and narrow objects remain weaknesses. These results do not establish phone reconstruction accuracy or physical route clearance.

Code and benchmark configurations are public. Reported hardware is a 16 GB RTX 4070 Ti SUPER; a 4090 is a reasonable trial target, not a reproduced compatibility result. The repo needs at least 30 GB disk and Habitat/SplaTAM/SAM/CLIP dependencies. Its CUDA 11.7 Docker path is not a qualified GB10 installation. Estimate: 2 to 3 engineering days for one matched scene comparison, then assess benefit before integrating.

### 3. OmniRay: useful lens-distortion research, not ready to integrate

Submitted October 22. [Paper](https://arxiv.org/abs/2610.31645), [project and detailed benchmarks](https://nam1410.github.io/omniray/).

A composite per-pixel ray model supports pinhole, fisheye, panoramic and other central-camera geometries without supplied intrinsics. This matters when people use phone ultrawide lenses. However, the project still marks code and models TBD, so reproduction is blocked.

The reported geometry is up to scale, and benchmark comparisons apply per-image median scale alignment. Relative Chamfer distance and ray-angle error do not demonstrate centimetre accuracy. Results are not uniformly better: CO3Dv2 geometry metrics trail competitors. Keep it on the watchlist; integration effort and GPU memory cannot yet be responsibly estimated from a runnable release.

## Highest-impact experiment: physical phone capture with held-out measurements

Do this before adding another reconstruction model:

1. Record three independent 30 to 60 second captures of one static room with the same phone's 1x lens, no lens switching. Include floor texture, doorways and furniture bases.
2. Mark and independently measure six identifiable distances with a tape or laser. Use only one to set reconstruction scale; hold five back for evaluation. Record endpoints, units, instrument and measurement uncertainty.
3. Run corrected current geometry through the real worker. Preserve the original capture, SHA-256 hashes, calibration picks, entered distance, reconstruction, arena cloud, object names, scene/CAD exports, fit check and route output. Never substitute a synthetic fixture for the capture.
4. Measure held-out distance errors and floor angle; compare ten manually labelled obstacle/doorway footprints against the proposed map. Preserve unknown cells. Use existing review gates before planning.
5. Proposed acceptance targets, not achieved results: all three floors within 2 degrees of the independent level reference; each held-out length within the greater of 5 cm or 2%; no planned route crossing a labelled obstacle or unknown cell. Record failures and coverage, not only the best run.

Estimate: half a day to one engineering day and a US$0 to US$20 incremental trial budget with existing phone, measuring tools and local compute. This is a budget estimate, not measured electricity or cloud cost. Main blocker: the physical capture and independent measurement record. A passing simulated route still needs a separate supervised physical-robot trial.

Point-to-model fit answers how closely the compiled model follows the reconstruction. Independent held-out measurements test physical scale and shape. A typed distance is not measured merely because the file schema calls it user-measured; record whether it was actually measured. A laser-scanner benchmark such as ETH3D remains a separate dataset evaluation, not proof that this phone capture meets a survey tolerance.

## Benefit from DeepMind through a bounded reasoning adapter

[Gemini Robotics ER overview](https://ai.google.dev/gemini-api/docs/robotics-overview) documents `gemini-robotics-er-2-preview` and its streaming endpoint through the Gemini Developer API. [Task orchestration](https://ai.google.dev/gemini-api/docs/robotics-orchestration) shows custom function calling with an explicitly mock robot API. These are existing API capabilities, not newly published research in this reporting window or proof of an end-to-end BrainSNN integration.

Recommended role: ER 2 suggests object references and task steps; BrainSNN supplies source-bound geometry, coordinate transforms, uncertainty, a reviewed map and deterministic simulation/planning tools. Let ER 2 call bounded functions such as inspect_scene, request_additional_view, propose_route and evaluate_route. Keep route feasibility and review decisions in BrainSNN. Image points are not metric 3D coordinates without the reconstruction/calibration transform.

Compare a fixed task set with and without ER 2, measuring task completion, unsupported assertions, invalid tool calls, latency and cost. Begin with offline recorded scenes and simulated routes. Do not claim that API access grants VLA weights, local GB10/4090 inference, robot-control compatibility or Trusted Tester SDK privileges. The separate Robotics SDK's restricted model, fine-tuning, robot and simulator features require the applicable access; verify each before choosing that route.

BrainSNN's potential contribution is a reproducible camera-to-evaluation scene package with independent measurements and explicit failure cases. That is a proposal for making the product useful to robotics teams, not evidence of DeepMind interest or a partnership. No model was invoked for this brief and no authenticated API access was qualified.
