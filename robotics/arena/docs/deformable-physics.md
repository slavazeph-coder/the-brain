# Rope-strike simulation

The native BrainSNN task at `/arena/deformable/` runs actual MuJoCo physics in a browser worker. It is independent of the named Panda/π₀.₅ worker and never qualifies a learned-policy pilot. Opening the main arcade does not download its runtime; the task loads the pinned single-thread WebAssembly engine only when opened.

## What runs

- Twenty inextensible capsule segments, ball joints, explicit bending and twisting elasticity, gravity and MuJoCo contact handling.
- Physical length, radius, nominal density and elastic modulus. Segment masses use cylindrical cross-section volume rather than counting overlapping capsule endcaps repeatedly.
- A prescribed two-link drawing and attachment trajectory, driving a dynamically simulated handle through a mocap weld. Robot actuator loads and full robot dynamics are outside this model.
- A two-second episode with recorded rope/handle positions, qpos/qvel, commanded attachment poses, timing and the exact model/configuration.
- A geometric task judge: minimum rope-tip centre distance to the target centre, linearly interpolated between adjacent physics samples. The target has no collision/fracture geometry. Reaching its radius is a task success; missing at the horizon is a task miss.

The native cable plugin is not included in the published MuJoCo WASM package. The JavaScript elasticity calculation adapts the Apache-2.0 MuJoCo cable torque formulation, with straight reference curvature and equal/opposite world-space torques. The source records its origin and modifications. This task does not claim to execute that absent plugin.

The simulation uses no external inference service, customer token, remote GPU or trained policy. It is an approximate discrete elastic rod, not calibrated hardware, a full extensible Cosserat continuum, DeformX 2.0, supersonic whip acoustics or a balloon-fracture model. Physics execution and learned-policy execution are separate fields throughout the recordings.

## User flow

Open **Rope strike** from the existing arcade. The first frame is paused. Change the target, motion or rope parameters and choose **Run strike**. Run/Pause, Reset, the recorded timeline and fixed/orbit cameras inspect actual simulated states. Form changes apply to the next simulation, not to the outcome of an old recording.

**Find swing** explicitly evaluates twelve prescribed controller candidates, then resets and verifies the selected motion in one additional episode. Selection minimizes measured tip error with an earliest-candidate tie break. The target, rope and judge stay fixed during selection. This is a bounded parameter search, not training or a globally optimal motion guarantee. Every attempt and the verification outcome remain in the search report.

**10 / 100 local tests** vary target position, Young's modulus and density with consecutive reproducible seeds. A case consumes one complete simulation attempt. Successes, horizon misses, simulation errors and unattempted cases stay separate. Execution yields between episodes so Cancel can retain a completed prefix; a two-minute wall-clock cap also bounds each pack. These local tests have no hosted-compute charge and are separate from the public paid-policy pricing scenarios.

## Evidence and retention

The module stores complete recordings and campaign journals in this browser's IndexedDB, without uploading them. Each episode contains the configuration, model XML, sampled states, judge witness, measured compute time, runtime version and SHA-256 records. The runtime manifest identifies the pinned engine and expected published asset bytes; hashes establish consistency, not third-party execution attestation.

Simulation integration and render sampling use separate rates. Reported closest distance and peak tip speed use integration samples, while the viewer replays decimated frames. The closest-approach witness identifies the interpolated segment/time. A replay may therefore show a slightly different sampled minimum from the full-resolution judge; the final result retains the native judge measurement.

If storage is unavailable, a single run can still be exported from memory. Multi-episode testing requires storage. A failed recording write stops a pack and marks its retention gap instead of discarding runs silently. Full archive export reads every retained recording; summary/error accounting remains available when a recording cannot be read. Browser storage can be cleared or evicted, so export results before treating them as a permanent deliverable.

Reproduce an episode from its exact configuration and a fresh reset on the pinned runtime. qpos/qvel snapshots alone omit contact warm-start state and are not advertised as arbitrary mid-run restore checkpoints. Identical initial configurations are tested for reproducibility within a runtime; cross-version/cross-browser bitwise equality is not promised.

## Build and verification

From `brainsnn-r3f-app`:

```sh
npm ci --no-audit --no-fund
node scripts/build-deformable.mjs
node --test ../robotics/arena/tests/deformable-physics.mjs
node ../robotics/arena/tests/deformable-worker-browser.cjs
node ../robotics/arena/tests/deformable-ui-browser.cjs
npm run build
node scripts/test-arena-route.mjs --dist
```

The build copies the official MuJoCo 3.16.0 loader/WASM and Apache license from the pinned dependency, bundles the isolated Three renderer and generates a runtime manifest. Generated runtime files are ignored by git and rebuilt from the lockfile. No network downloads occur in that assembly step. The actual browser contract uses the real worker/WASM, not fixtures standing in for physics.

The meaningful numerical checks include finite supported cases, gravity response, reproducible reset, material sensitivity, a reachable target and an unreachable miss, independence of the target judge from physical motion, and timestep refinement. A controlled planar case compares custom elastic torques with native MuJoCo joint stiffness. These checks do not establish sim-to-real accuracy.

The requested timestep is capped deterministically at 0.00025 s, or 0.000125 s when material damping is below 0.0003 N·m·s/rad. The actual model timestep, requested timestep, executed steps and elapsed simulation time are retained. This changes integration resolution rather than adding hidden material damping. Validation covers 32 endpoint combinations of elastic modulus, radius, length, density and supported low/default damping. It does not establish stability for every possible parameter tuple.

## Research provenance and next fidelity gate

The motivating source is [CMU's Point It, Strike It](https://deformx.github.io/DeformY/), using a GPU Cosserat rod solver and a direction-conditioned policy. Its [paper](https://arxiv.org/abs/2610.09573) describes a different solver, robot, control contract and calibration procedure. The [released DeformX repository](https://github.com/DeformX/DeformX) and its CPU PyElastica-Mesh engine are useful references; the newer GPU implementation was still listed as forthcoming when inspected.

Matching that research requires a separately validated high-fidelity backend, supported GPU/ARM64 dependencies, actual policy weights and inference, matched observations/actions, calibrated material/drag/robot parameters and a defined direction/velocity success judge. Real-robot transfer requires physical measurements. A browser task or a plausible rendering does not substitute for those gates. Existing RTX 4090/GB10 worker isolation and text-service protections remain unchanged.
