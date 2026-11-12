---
type: project
description: Autonomy trial page — simulated lidar/depth sensing, 4 cm log-odds map, A*, MPPI and a paired break-it-on-purpose trial on reviewed World maps
---

# Autonomy trial — 2026-11-11

Owner shared Lukas Timm's LinkedIn post on Konstantin Saifoulline's (Airsup) agent-built robot-dog sim stack
(simulated MID-360 lidar + two D435i, 4 cm grid, A*, MPPI, crate replan in 27 ms, footholds + convex MPC) and asked
to build the layers BrainSNN was missing. Lukas's critique: no shown agent loop/tests, sim only, no measured trial.

- New page `/world/autonomy.html` (`autonomy-ui.mjs`, worker `autonomy-worker.mjs`), core `autonomy.mjs`.
  Linked from World Builder's More menu. No three.js; 2D canvas.
- Built: sensor ray casting from published MID-360/D435i figures, log-odds 4 cm map with reviewed-map prior,
  Felzenszwalb clearance field, 8-connected A*, MPPI (circle-covered footprint, stop/turn/pure-pursuit candidates),
  recovery, ground-truth scoring, paired control-vs-broken trials (crate, unmapped pallet, front-camera blackout,
  drift), Wilson intervals and a SHA-256 sealed `brainsnn.autonomy-trial.v1` report with verify.
- Not built on purpose: legged footholds/convex MPC. Humanoid/quadruped are planar envelopes, labelled so.
- The robot's software never reads ground truth; contacts are scored against truth. Unknown/no-go are keep-out
  rules, not geometry. Loaded maps require person review, as World Builder does.
- Local: 15 node tests (tests/world/autonomy.test.mjs), 309 World JS tests, 1,094 app + 73 analysis tests,
  typecheck, build, Chrome desktop+phone smoke (tests/world/autonomy_browser_smoke.py, added to CI).
- Finding worth repeating: forklift envelope with roof lidar at 2.06 m hits a 0.45 m crate 7/10 times when the
  front camera blacks out — sensor placement, not planning, decides it. Guide: docs/world-autonomy-trial.md.
