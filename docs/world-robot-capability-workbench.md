# Robot capability and scan project workbenches

World Builder now connects a reviewed space, a declared robot, a physics recording, an arm check and imported robot telemetry in the existing native workspace. The scan project board handles batches of registered scans through the existing building compiler. Both activities can send bounded evidence summaries to the same **Saved projects** chooser.

## Where to find the tools

In the World Builder tool library:

- **Robots → Test your robot’s capabilities** opens the robot activity.
- **Buildings → Manage scan-to-BIM projects** opens the scan project board.
- **Save & share → Open saved projects** opens the existing authenticated project ledger.

Direct activity paths after deploying this revision:

```text
/world/index.html#layer-tab-robotcapability
/world/index.html#layer-tab-bimworkbench
```

These paths describe the implementation in this branch. They do not establish that the production website or worker has been updated.

## A useful first robot test

1. Open the example room or a reviewed map. Imported maps retain their existing scale and geometry review gates.
2. Open **Test your robot** and inspect **Robot dimensions, drivetrain and motor settings**. The catalogue supplies example footprints; additional mass, wheel and motion values are labelled authored assumptions. Import a capability JSON or enter the actual parameters and their source notes.
3. Choose a goal and select **Apply profile and prepare route**. The map planner and simulator use the same footprint, speed and clearance. The selected profile appears in the main robot picker as a custom profile.
4. Select waypoint feedback or predictive control (MPPI), then **Record run**. The differential model runs an actual free MuJoCo chassis with two driven wheel hinges. The alternative holonomic model is explicitly a planar force approximation.
5. Replay the body outline and recorded heading. Download the JSON recording, executable MJCF and body-pose OpenUSD replay. Contact failures, timeout and arrival remain distinct outcomes.
6. Inspect wheel work and any available motor, driver and thermal results. Electrical estimates require motor parameters. Thermal estimates additionally require a complete thermal model. Missing values remain unavailable.

A completed recording keeps its map, capability profile and hashes. Subsequent map or profile edits cannot relabel it. Starting a new recording, changing its driver or clearing the recorder also clears the parent analysis, preventing an old test from appearing under a new run.

The existing **Robot routes → Route to a spot → Record this robot going here** action also uses the selected capability profile. Legacy showroom recordings retain their v1 model and replay path.

## Reach and collision checks

**Reach a target** contains an editable generic six-axis arm, pose targets and starting joint angles. It solves position and orientation, enforces joint limits, checks nonadjacent link capsules and tests the interpolated joint-space path with conservative motion bounds. The output distinguishes a reachable pose from a collision-free configuration and path. A bounded numerical search failure is not proof that every possible configuration is unreachable.

The target frame is `base_link`: X forward, Y left, Z up. When a route recording exists, its first recorded body pose registers the frozen map into that local frame. Otherwise the base is assumed at the current map start, at floor height and facing map +X. This basis is retained in the report. Map obstacle rectangles are extruded to assumed 0.5 m boxes, transformed into the base frame and conservatively bounded. Arm mounting dimensions, chassis collision, grasping, torque, force and physical execution are not qualified by this check.

## Compare and improve a robot model

**Compare a real run** accepts bounded CSV/JSON telemetry, including native localization recordings. The UI initializes declared file units and frame conventions where supplied. Review those values, the spatial registration and the task-clock alignment before comparing.

Comparison uses the observed time plus the entered offset as reference time. It reports matched sample coverage and position/orientation errors, excludes unusable tracking states and avoids interpolation across long gaps. The chart uses the same transformed pairs as the metrics. Imported producer claims remain unverified source evidence; a low residual is not an attestation of real-world accuracy.

The encoder section displays actual imported left/right angle channels. A wheel-radius fit requires explicitly independent pose measurements, source provenance and an operator declaration. It produces a proposal without applying it. Successful fit sources are tracked by SHA-256, so renaming a fitted source cannot make that same data qualify as a held-out run during the session. Proposals retain their input profile, units, frame and source hash. See [robot evidence contracts](world-robot-evidence.md) for exact schemas and examples.

## Scan projects and shared evidence

The [scan project workbench](world-bim-workbench.md) supports separate projects, bounded parallel jobs, registered source intake, actual worker status, cancellation, retry, reload recovery and human review. Original blobs and manifests are stored in the browser; credentials are not. Remote jobs keep their original identities after reload, and uncertain submissions require reconciliation before further work.

Only artifacts returned by a completed worker job receive download controls. The current compiler can produce IFC, DXF, GLB, USD and drawings with its installed dependencies. Native RVT production and the reference video’s throughput are not claimed. LAS/LAZ/E57 and larger scans use the existing scanner preparation CLI before entering the board.

Both activities have an **Add … to Saved projects** action. It transfers a bounded summary to a new same-origin project page. The user selects the destination workspace and saves the source there. This handoff does not invent a server project, silently mark a physical trial as passed or upload worker credentials. Retain full recordings and source files alongside the summary when the dense data matters.

## Engineering seams

| Layer | Main implementation |
|---|---|
| Shared profile and source metadata | `public/world/robot-capability.mjs` |
| Waypoint and MPPI control | `public/world/robot-capability-controller.mjs` |
| Native drivetrain and replayable dynamics | `public/world/robot-capability-physics.mjs` |
| Named frames and quaternion adapters | `public/world/robot-frames.mjs` |
| Arm pose IK and swept path checks | `public/world/robot-arm.mjs` |
| Telemetry, comparison and wheel calibration | `public/world/robot-telemetry.mjs` |
| Motor, driver and thermal accounting | `public/world/robot-drive-analysis.mjs` |
| Native robot activity and evidence bundle | `public/world/robot-capability-ui.mjs` |
| Project queue and persistence | `public/world/bim-workbench.mjs` |
| Registered survey compiler admission | `robotics/world_worker/geometry.py`, `scene_usd.py`, `app.py` |

The browser modules live under `brainsnn-r3f-app/`. No new external package or hardware control endpoint is introduced. The website and worker changes require a coordinated rollout: compatible `scene-usd` adapters must advertise `registered_survey_cloud: true` after installing the matching code.

## Verification

From the repository root:

```bash
node --test tests/world/robot-capability*.test.mjs \
  tests/world/robot-frames.test.mjs tests/world/robot-arm.test.mjs \
  tests/world/robot-drive-analysis.test.mjs tests/world/robot-telemetry.test.mjs \
  tests/world/bim-workbench.test.mjs tests/world/worker-client.test.mjs

python -m pytest tests/world/test_bim_workbench_handoff.py \
  tests/world/test_showroom_episode_usd.py -q

python tests/world/robot_capability_browser_smoke.py
python tests/world/showroom_run_lifecycle_browser_smoke.py
node tests/world/bim-workbench-browser-smoke.mjs
```

The browser tests use the native public activity, genuine local MuJoCo, imported synthetic fixtures clearly labelled as such, real browser IndexedDB and an isolated worker protocol fixture. `BROWSER_EXECUTABLE` can select an installed Chromium binary. The Blender-backed test runs when Blender and the IFC reader dependencies are available; it asserts actual compiler outputs from an authored room fixture.

From `brainsnn-r3f-app/`, run `npm run test:world`, `npm run lint` and `npm run build` for the shared application gates. Build browser assets before running the smoke tests. These checks establish implementation behavior, not the accuracy of an actual robot or the user’s real survey.
