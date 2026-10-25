# World demo correction validation, October 24, 2026

Scope: replace the affected World Builder demo geometry and captions. No new demonstration footage or physical accuracy result was produced in this environment.

## Current upstream state

- [PR #228](https://github.com/slavazeph-coder/the-brain/pull/228) is merged at `db1cc173c4dfd8aab8e148261a2c1863bc6a5c00`, rather than still a draft. Its head was `54bc96c41201ef6e2df3d3d8d0f7ee7d087168fd`.
- Its [World Builder contracts](https://github.com/slavazeph-coder/the-brain/actions/runs/40127398734) and [CI](https://github.com/slavazeph-coder/the-brain/actions/runs/40127398772) succeeded, including production build and Chromium/WebKit browser contracts.
- [PR #229](https://github.com/slavazeph-coder/the-brain/pull/229) subsequently merged at `2f1f38e`. This is the base validated here. It refines the floor layer by its median in both JavaScript and Python, adds fit evidence, and records inferred furniture bases. Regeneration should include this follow-up.
- #229's [World contracts](https://github.com/slavazeph-coder/the-brain/actions/runs/40130916072) and [CI](https://github.com/slavazeph-coder/the-brain/actions/runs/40130916049) succeeded. The merge commit's Railway deployment status was successful. No unresolved #229 review threads remained at this check.

## Local checks on that base

| Check | Result | What this establishes |
|---|---|---|
| `cd brainsnn-r3f-app && npm run test:world` | 109 passed | Existing browser-side geometry, parser, map and worker-client contracts |
| `npm run lint` | Passed | Type checking |
| `npm run build` | Passed; existing chunk-size warning | Production app compiles |
| `python -m pytest tests/world/test_worker.py tests/world/test_tenant_isolation.py tests/world/test_densify.py tests/world/test_object_names.py tests/world/test_fit_check.py tests/world/test_cad_export.py -q` | 125 passed, 3 skipped | Worker, fit, naming and CAD contracts; skips include external capture/depth prerequisites |
| `python -m unittest tests.scene_compiler.test_geometry tests.scene_compiler.test_scene_usd tests.scene_compiler.test_ifc_export` | 37 passed | Compiler and export contracts, without Blender execution |
| Updated CI worker test command, including demo admission checks | 197 passed, 3 skipped | Full configured worker suite plus source/fit mismatch and stale-output rejection |
| Seeded tilted room with one point below the floor | Old version fails; current version passes | Reproduces the sparse-histogram regression on synthetic geometry, not the original room |

The seeded regression used 2,101 points, 25-degree synthetic tilt and LCG seed 19. At pre-#228 commit `30b833b`, floor inlier fraction was `0.0004759638`; on `2f1f38e` it was `0.7153736316` with a finite fitted offset. These are regression-test values, not new product accuracy claims.

At this initial validation stage, local Chromium installation failed because the downloaded browser archive was truncated/invalid. No local browser smoke was claimed for that stage. Hosted Chromium/WebKit results above are independent evidence of the CI browser contracts, which use explicit transport/synthetic fixtures where documented. They do not establish real-phone capture or physical robot performance. Later isolated browser, actual CPU worker and Blender execution is recorded in [the subsequent local worker qualification](world-worker-qualification-2026-10-24.md); that later evidence supersedes the initial environment limitation without reproducing the missing original room capture.

## Reference and recording limits

The original 10,925-point room reconstruction, source video, picked scale endpoints, corrected scene job, original films and private worker URL/token were not present in this checkout or supplied to this environment. The original reference comparison was therefore not reproduced. Blender and the naming environment were also unavailable at this initial stage. [Later local qualification](world-worker-qualification-2026-10-24.md) installed isolated Blender and exercised a separate photograph-sequence fixture; naming inference and the original reference comparison remain unqualified. Do not substitute that fresh reconstruction and describe it as the same-point comparison.

#228's six-object comparison and #229's later seven-object/four-name run are different receipts. Use only the scene, fit check, route and CAD evidence belonging to the run actually rendered. An entered 5.79 m distance is not an independently measured length. Point-to-model agreement, floor inlier support and physics stability do not establish physical dimensional accuracy.

See [the replacement runbook](../scripts/world-demo/REGENERATE.md) for source recovery, evidence preservation and executable recording/rendering commands. Missing original filenames and hashes remain explicitly unresolved there.
