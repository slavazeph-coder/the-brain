---
type: project
description: Native browser MuJoCo rope-strike physics, bounded motion search and recorded local instance packs
---

# Rope-strike physics — 17 October 2026

Owner supplied Mike Kalil's DeformX2 LinkedIn clip and explicitly requested this level of simulation and test instances on brainsnn.com. Build a real interactive physics task inside the existing robot arcade; preserve brand, upfront choices and public transparent pricing.

Motivating source: https://deformx.github.io/DeformY/ and arXiv2610.09573. Research uses GPU Cosserat rods, Isaac Sim robot dynamics, direction-conditioned flow matching and real-rope calibration. Its released DeformX repository still lists the newer GPU solver as forthcoming; the website is a remote-inference trajectory viewer, not browser physics. Do not claim our new native task reproduces that full research system.

New `/arena/deformable/` runs pinned official MuJoCo3.16.0 single-thread WASM in a WebWorker with 20 inextensible capsule/ball-joint rod segments, physical segment masses, explicit bending/twisting torques, gravity and contacts. The elasticity torque follows Apache2 MuJoCo cable.cc; its plugin is absent from the npm WASM, so our code applies those forces explicitly. A dynamic handle tracks a prescribed mocap trajectory; the displayed arm is a kinematic drawing, not simulated robot motors. A noncolliding tip-distance judge measures position only. No learned policy, full Cosserat continuum, calibrated hardware, acoustic crack or balloon fracture is established.

First frame paused; Run/Pause/Reset, orbit/top/front cameras, recorded timeline, target/controller/material edits and JSON exports. Find swing tests12 fixed controller candidates and independently reruns the frozen selected motion (13episodes maximum). Exact target/material/judge stay fixed; every candidate outcome and full recording is retained. This is parameter search, not policy training or a global optimum.

Local10/100-instance packs vary target ±6cm, elastic modulus ±15% and density ±10% with reproducible consecutive seeds. One simulation at a time, cancellation between cases,120s cap and explicit success/miss/error/unattempted accounting. Full recordings/journals stay in IndexedDB; single-run memory fallback is explicit, multi-run execution requires persistence, quota failures stop with retained prefix. Full archive export reads original recordings; hashes are consistency evidence, not execution attestation. These packs have no hosted compute charge and remain separate from paid named-policy runtime pricing and qualification.

Source: `brainsnn-r3f-app/public/arena/deformable/{rope-physics,simulation-worker,journal,app}.js`, task HTML/CSS; isolated Three renderer in `src/arena/deformable-renderer.js`. Build script self-hosts pinned loader/WASM/license and generates manifest; generated runtime assets are ignored by git and rebuilt from package-lock. Main homepage and arcade entry graphs never import the heavy runtime. Existing arcade links to the task; no new top-level product navigation.

Numerical validation:32 selected material/damping endpoint combinations passed. Native MuJoCo planar joint-stiffness reference matches custom bending within1e-9m; controlled timestep refinement .00025→.000125s changes tip0.185mm. Default actual hit min6.06mm, peak14.72m/s,8000steps×.00025s=2simulatedseconds. These are this model's measurements, not real-robot or learned-policy results. Actual timestep is deterministically capped .00025s, .000125 when damping<.0003; requested/effective dt and executed horizon exported. Zero damping unsupported; full parameter-space stability not proved.

Verification: actual physics test suite, actual worker/WASM ten-pack/search/full archives, cancellation, quota/storage/bootstrap errors and desktop/mobile UI; portable Node browser contracts committed under `robotics/arena/tests/deformable-*.{mjs,cjs}`. Docs `robotics/arena/docs/deformable-physics.md`. No GPU services/drivers/text models/ports/billing/provider calls changed. The named π0.5 GPU pilot remains unqualified.

Worktree `/Users/slavaz/the-brain-deformable-tests`, branch `codex/deformable-robot-tests`, base main21693385. Release verification will append the merge/deployment receipt.
