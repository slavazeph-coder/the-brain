# World Builder autonomy trial

`/world/autonomy.html` puts a simulated sensor rig on a robot envelope, drives it on a reviewed World v1 map, and
runs a paired trial that breaks it on purpose. It answers the question raised about agent-built robot-dog sim stacks
(Airsup, October 2026): the sim stack looked real, but there was no measured trial and the world was not a real place.
Here the world is a reviewed capture of a real space, and every run is counted and sealed.

Everything runs in the browser. No worker, GPU, model or network call is involved, and no robot moves.

## The loop

| Layer | What it does | Source |
| --- | --- | --- |
| Sense | Ray casts from a roof lidar and front/rear depth cameras against the reviewed box geometry, walls along the floor edge, and any objects the trial adds. Range noise per published figures. | `autonomy.mjs` `sensorRig`, `castRay` |
| Map | Log-odds evidence on a 4 cm grid (coarser only when a map would exceed 600,000 cells). Returns below 5 cm count as floor, higher ones as obstacles. The robot classifies by measured height only; it never reads what was hit. The reviewed map is an optional prior. Lidar returns beyond 8 m are not mapped. | `integrateReturn`, `createMap`, `updateClearance` |
| Plan | 8-connected A* on a clearance field (Felzenszwalb distance transform), inflation cost, no corner cutting, string-pulled. Replans when the route is blocked, left behind, or due a refresh. | `planPath` |
| Act | MPPI on a unicycle model: sampled control sequences rolled out against the robot's own map, a footprint covered by circles along the heading, plus deterministic stop, turn and pure-pursuit candidates. A back-up/turn recovery when progress stalls. | `mppiControl`, `startRecovery` |
| Score | The true oriented footprint against ground truth: contact, keep-out intrusion, closest approach. The robot's software never sees this. | `scoreFootprint` |

Sensor figures, from the vendors' pages:

- 360° lidar: Livox MID-360 — 360° × −7°…52°, 0.1–40 m, 10 Hz, ≤2 cm range σ. <https://www.livoxtech.com/mid-360/specs>
- Depth camera: RealSense D435i — 87° × 58°, 0.3–3 m ideal range, <2 % error at 2 m. <https://realsenseai.com/products/depth-camera-d435i/>

The simulation uses these figures; it does not reproduce the devices (no reflectivity, multipath, motion blur or the
lidar's non-repetitive pattern).

## The trial

`runTrial(world, options)` samples start/goal tasks on the reviewed map (seeded), then runs every task twice with the
same seed: **control** (nothing broken) and **broken on purpose** (any of):

- a 0.5 × 0.5 × 0.45 m crate dropped on the route, at least 1.5 m and two stopping distances ahead of the bumper;
- a 0.9 m pallet stack on the route that the reviewed map does not contain;
- the front depth camera blacked out for 3.5 s, starting just before the crate drops;
- odometry drift (random-walk pose error, no localization correction).

Outcomes are `reached`, `contact`, `keep-out`, `no-route` (a safe stop), `stuck` and `timeout`. The report
(`brainsnn.autonomy-trial.v1`) carries the world snapshot and its SHA-256, the configuration, every task and run, a
paired summary with Wilson 95 % intervals, replan latency percentiles, crate detection timing, claims, limitations and
an integrity SHA-256 over the whole body. `verifyTrialReport` recomputes it; a seal shows the report was not edited,
not who ran it.

Representative local results on the authored sample floor (seed 7, ten tasks): cleaner, humanoid and vacuum envelopes
reach every goal in both conditions; a compact forklift whose roof lidar sits at 2.06 m reaches 3/10 with a camera
blackout and makes 7 contacts, because a 0.45 m crate is below every lidar beam inside the 8 m mapping range. That is
the kind of finding the trial exists to surface: sensor placement, not planning, decided the outcome.

## Run it

```bash
cd brainsnn-r3f-app
npm run test:world                                   # includes tests/world/autonomy.test.mjs
npm run build && NODE_ENV=production PORT=4180 node dist/server.cjs &
python ../tests/world/autonomy_browser_smoke.py      # WORLD_BROWSERS=chromium,webkit in CI
```

Open `http://127.0.0.1:4180/world/autonomy.html`. Tap the floor to send the robot somewhere; **Drop a crate in its
way** places one on the route ahead. A map saved in World Builder (Save map) or an exported World JSON can be loaded
under **Space**; like World Builder, a loaded map must be reviewed by the person before the robot runs on it.

## Boundaries

- Kinematic unicycle at 10 Hz; no physics engine, wheel slip, legged gait or contact dynamics. Humanoid and
  quadruped are planar body envelopes; no gait, footholds or MPC are simulated here.
- Ground truth is the reviewed map plus what the trial adds. Unknown and no-go areas are keep-out rules, not geometry.
- Replan milliseconds are wall-clock on the device that ran the trial.
- No real robot, learned policy or safety certification. A simulated pass is a reason to run a physical trial on the
  same route, not a substitute for one.
