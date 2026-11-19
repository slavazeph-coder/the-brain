# Shared correspondence experiment for DeepBA

Checked November 16, 2026, America/Toronto. [Reference post](https://lnkd.in/p/dGMycR4A), [paper](https://arxiv.org/abs/2611.18256), [technical paper](https://arxiv.org/html/2611.18256v1), [project](https://cphjsn.github.io/deep-ba/), [website repository](https://github.com/cphjsn/deep-ba).

DeepBA estimates cameras and structure from pairwise image matches. The paper reports 2.04M parameters, not a 71-fold speedup. Its strongest published scale example uses 24 GB GPU memory; it also reports pitch drift and worse ETH3D translation accuracy than COLMAP. These are author results, not BrainSNN reproductions. Published centimetre scores use reference-frame alignment, not recovered phone scale.

The official repository at `3ff903c1fa3e4f020fb7e93fd322688c113a5c79` contains the project website. Its code link says coming soon, with no inference implementation, checkpoint or software licence available at inspection. The paper's licence does not grant rights to unpublished software. BrainSNN has not implemented or executed DeepBA.

## What this build adds now

The new offline `robotics.world_worker.match_graph_experiment` command prepares real CPU SIFT correspondences once, freezes them with the exact prepared-image hashes, and replays COLMAP from a private copy. It sits beside the existing [same-frame comparison](world-reconstruction-comparison.md) and [measured qualification](world-measured-qualification.md). It does not replace their three engines or the production reconstruction default.

| Output | Purpose and boundary |
|---|---|
| Prepared frames | Reuse the existing immutable 3–60-image case, including every requested frame. |
| Frozen database | Exact CPU matching result before any camera solve; a separate copy is used for replay. |
| Numeric correspondence archive | Original feature identities and verified pair endpoints in the actual prepared rasters. No invented tracks, solved absolute poses or reconstructed 3D enter this input. The database retains pairwise verification geometry. |
| Graph audit | Full-frame components, isolated views, degree and weak-link diagnostics. A separate graph uses the paper's 50-match pair criterion for screening only. |
| Replay receipt | Device, source/pack/code hashes, timings, failures, registration denominator and original pack immutability. |
| DeepBA status | Explicitly unavailable in this build. No COLMAP fallback is labelled DeepBA. |

The graph audit can reveal a disconnected capture or a weakly joined room sequence before spending time on a new solver. A connected graph can still contain repeated-pattern false matches, a stationary pan, planar ambiguities or wrong calibration. Graph screening is not a geometry, baseline, gravity, scale or safety certificate.

## Run it

Use the repository's isolated CPU comparison environment from the existing runbook. `pycolmap==4.2.1` is required. No new model download, paid API or GPU is needed for these commands.

```bash
# Prepare a rights-cleared local capture using the existing frame/provenance code.
python -m robotics.world_worker.reconstruction_comparison prepare \
  --video /absolute/path/to/room.mp4 --frames 32 --out /absolute/path/to/case-room

# Generate fresh matches without solving camera poses.
python -m robotics.world_worker.match_graph_experiment prepare \
  --case /absolute/path/to/case-room --out /absolute/path/to/matched-room --timeout 1800

# Recheck source files, frozen numeric data and recomputed diagnostics.
python -m robotics.world_worker.match_graph_experiment inspect \
  --case /absolute/path/to/case-room --pack /absolute/path/to/matched-room/pack

# Solve from a separate database copy, retaining failures as well as successes.
python -m robotics.world_worker.match_graph_experiment replay-colmap \
  --case /absolute/path/to/case-room --pack /absolute/path/to/matched-room/pack \
  --out /absolute/path/to/replayed-room --timeout 1800

# Read the implementation's recorded DeepBA availability boundary.
python -m robotics.world_worker.match_graph_experiment status
```

For photographs, use `--photos /absolute/path/to/photos` instead of `--video` in the first command. Create a new output directory for each preparation and replay. Do not edit source JPEGs, the capture receipt, frozen database or archive between runs. A source swap, changed hash, unsupported numerical data or oversized graph must fail rather than borrow another run's provenance. The command does not accept a retrospective arbitrary database as a fresh, source-bound experiment.

`--timeout` bounds the fresh native child and its process group. Parent source/pack validation is measured separately in the parent operation time and is outside that child deadline.

Matching and registration failures remain in the retained logs/receipts. Finishing preparation means the matching step completed, including when the audit reports isolated views. A replay is a CPU COLMAP result, not DeepBA inference or an author-benchmark reproduction. A detected video fold retains its result with `requires-review` and exit 2; execution/integrity failure returns 1. No successful execution automatically qualifies geometry. See command output for the exact artifact names and execution status.

## Preserve fair inputs and timings

All input frames stay in the denominator, even if a solver registers only one fragment. The pack retains complete verified pair arrays within explicit budgets and refuses excessive data instead of thinning one solver's matches silently. The 50-match diagnostic does not modify the database or establish a new sparse-phone acceptance threshold. Current COLMAP replay uses the full verified graph. A future paired DeepBA experiment must freeze and apply one identical admission/filtering policy to both arms before comparing them.

Correspondences preserve COLMAP's half-pixel coordinates and initial camera models, including radial distortion. They are not silently converted to centred-principal-point pinhole inputs or normalized coordinates. Any future DeepBA adapter must record its exact raster, lens and pixel transform, once the official interface is known. The archive is a BrainSNN interchange format, not a claimed upstream DeepBA API.

Report frontend matching, solving and export costs separately. Reusing cached matches does not make matching free. The receipt distinguishes whole parent-operation time, child-process time and measured internal stages. Parent operation time includes its input and post-result validation; it excludes parent interpreter/CLI import startup and final receipt serialization. Keep the preparation receipt alongside a moved pack to retain that operation cost. CPU COLMAP and a future GPU solver use different hardware paths, so their timings compare configured implementations. Repeat with rotated order and retain failures before making throughput claims. This experiment does not measure whole-room BIM generation time.

Initial focal/distortion values in the database are estimated priors, not independently calibrated intrinsics. Packs are bounded to 60 frames, 1,770 stored pairs, one million matches, 100,000 keypoints per frame, a 64 MiB numeric archive and a 2 GiB database. Oversized input is refused.

Source and artifact hashes detect changed retained files; they are not signed attestations against rewriting all records. Database/feature files can contain private capture information. Keep packs private and do not publish them wholesale.

## Acceptance for the next model experiment

Once official licensed code and weights exist, pin their commit and checkpoint hash before adding an inference arm. Start with 16–32 views on an accessible RTX 4090, record the actual match count, GPU peaks and end-to-end time, and qualify GB10 separately. The paper's parameter count does not establish a memory or speed budget on either machine.

Use three predeclared corrected phone captures, including repeated finishes and a low-texture case. Freeze one calibration span plus at least seven withheld physical readings before examining outputs, using the existing measured comparison protocol. Require every requested span to remain available, at least 20% lower median withheld error, no worse maximum error and at least twice the complete configured speed, across repeated runs. These are proposed engineering criteria, not obtained results. Camera checks still require separate dense-surface, openings, IFC/Rhino and robot-map review.

No metre scale follows from matching. User-entered scale stays distinct from measured scale, internal reprojection fit from independent accuracy, and simulated routes from physical robot validation. Geometry made by a learned solver must retain those evidence boundaries.

Estimated next-stage effort: 1–3 engineering days after usable upstream code/weights become available, plus capture annotation and review. Estimated additional provider charge for a small run on existing accessible hardware: $0; energy and hardware time are unmeasured. Main blockers are the upstream release/licence and an accessible corrected, independently annotated capture. No DeepBA GPU run or physical reconstruction validation is established by this build.

## Executed software checks

On this implementation, an independently authored five-view ray-cast room was prepared as ordinary photographs. Its camera truth and calibration sidecar were not supplied to matching or replay. Fresh CPU matching retained 10 pairs and 29,110 correspondences. Replay registered all 5 requested frames and reconstructed 4,329 points, with an internal mean reprojection error of 0.1393 pixels. The frozen database hash remained identical before and after the solve. These are authored software-fixture results, not a physical phone capture, independent metric accuracy or DeepBA inference.

Measured parent operation times were 3.858 seconds for matching/pack preparation and 1.504 seconds for replay on the shared test host. Their sum is 5.362 seconds from prepared frames, excluding parent interpreter/CLI imports, final run-receipt serialization and manual gaps. File caches were not flushed; no cross-model speedup is established. Dependencies: PyCOLMAP 4.2.1, NumPy 2.5.4, Pillow 13.0.0, Python 3.12.14; native CPU work uses two threads.

Negative checks also executed: three independent noise images produced zero verified pairs, three isolated views and `needsReview=true`. COLMAP replay returned failure with no sparse model, retained its logs/failure receipt and left the frozen database unchanged. Texture-free white images were rejected earlier by the existing capture-preparation quality check. Neither case was relabelled as a successful reconstruction.

The source-signature guard also refused an initial preparation when a module docstring changed during the run. That failed receipt was retained; the recorded successful room run uses the final stable source. Automated tests cover the same cancellation/tamper/budget boundaries, including the dense-cluster weak-link case and actual native CPU replay.

Focused qualification: 213 tests and 72 subtests passed, including 57 new graph/command tests and an actual native matching-to-replay regression. Two existing opt-in checks remained skipped. This result does not execute DeepBA, qualify CUDA/GB10 or replace physical capture validation.
