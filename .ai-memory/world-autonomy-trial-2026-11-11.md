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

## Current-main integration — 2026-11-15

- Integrated main `0faecec8264ec69875409104321bd1a2044e9bdc`, preserving the as-built, operational twin and
  movement menu links. PR #287 had no inline review threads; its old CI did not establish current-main readiness.
- A source, review or settings change now terminates the trial worker, cancels the inline fallback between
  episodes and clears the old report/download. Late worker callbacks cannot publish a previous selection's report.
- Source selection also supersedes pending map-file reads; late success and failure callbacks cannot replace a
  newer selection. The browser regression forces both delayed-read outcomes without timing assumptions.
- Copy labels the default map as authored, describes user imports separately and distinguishes repeatable seeded
  outcomes from device-dependent measured latency. Physical and GPU qualification remain unchanged.
- Current integrated run: 16 autonomy Node contracts and all 378 World Node contracts passed; lint and production
  build passed. Browser regression includes a forced late worker reply after source reset and compiles locally.
- Local browser execution remains blocked by Chromium's Unix socket creation (EPERM); Playwright Chromium and
  WebKit bundles are absent. Current-head CI must execute the browser smoke before merge. No physical robot ran.
- After PR #279 merged, integrated main `e59f16108438f0cdae04c4dac082712b5cf04ded` while preserving the
  experimental Meshlets navigation entry, isolated build dependency, failed strict GPU qualification and all existing
  World Builder links. The autonomy module and its source-reset regressions are unchanged by that integration.

- November 15 review correction: v2 scores all truth boxes for minimum clearance (authored 30×30 room: prior
  9.825 m versus corrected 2.825 m), rejects blackout with a disabled front camera, distinguishes configuration
  from applied events, and preserves old sealed report bytes/version. UI derives blackout duration from events and
  shows the scoring version. 19 targeted and 407 combined Node tests passed; physical accuracy remains unverified.
