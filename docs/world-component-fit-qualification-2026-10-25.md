# Component-fit software qualification, 25 October 2026

This records executed software checks. It does not establish physical phone-room
accuracy, survey tolerance, automatic doorway recognition or robot operation.

## Actual correction and native exports

The deterministic authored fixture in
`tests/scene_compiler/test_refine_components.py::solver_fixture` contains 5,000
points: a sampled floor and a wall whose lower half has a 30 mm depth bias.
Its scale is illustrative and explicitly unverified. No physical capture,
measurement, camera record or learned model is supplied.

The actual Blender 4.2.23 LTS executable compiled this fixture with the existing
explicit `--allow-unverified` experiment flag. The original component fitter
used 3,856 wall-member points; no residuals were removed from the statistics.
It emitted one eligible wall-placement candidate. Explicit selection, exact
report recomputation and a second successful native Blender process produced
the revision-1 bundle.

| Same-cloud diagnostic | Original | Reviewed candidate |
| --- | ---: | ---: |
| Median wall surface residual | 27.64 mm | 15.02 mm |
| 95th-percentile residual | 31.71 mm | 17.44 mm |
| Maximum residual | 82.74 mm | 78.52 mm |
| Wall length, height, thickness and cloud scale | Retained | Unchanged |

These numbers demonstrate correction against an intentionally biased
reconstruction, not improvement against physical ground truth.

`scripts/world-demo/verify_component_bundle.py` verified the actual generated
IFC and Rhino files, GLB identity/provenance, source preservation and all rebuild
artifact hashes. Component IDs survived. The selected wall became
operator-authored, prior review flags stayed false and the new report did not
inherit an observed-surface claim for the changed geometry. The original scene,
cloud, evidence and fit report were not modified.

The `component_fit` report CLI and the `refine_components --fit` review CLI also
ran against these same retained inputs. CLI review produced the controlled edit
contract and source snapshots in a fresh directory without invoking Blender.

## Actual scene worker and a negative source-binding result

A retained Fountain photo reconstruction, with 5,925 handoff points, ran through
the current scene worker and actual Blender in 2.51 seconds on this local host.
This timing includes scene compilation and local sidecars, not reconstruction,
upload or a full phone-to-BIM run. Its scale was an illustrative entered value,
not a physical measurement. The new report evaluated six components, proposed
zero eligible corrections and emitted review/recapture guidance.

The initially supplied retained camera job belonged to a different capture.
Its cloud did not match, so projected frame evidence correctly became
unavailable; the report did not attach those cameras to the Fountain components.
This run qualifies the missing/mismatched-camera behavior, not newly validated
camera associations. Existing positive camera-ledger regression tests cover
matching sources.

## Regression scope

Tests cover raw byte/type binding, recomputed complete memberships, edited
provenance, full outlier distributions, tilted/yawed planes, one-sided wall
placement, correction budgets, degenerate floor samples, unknown floor and
unsupported openings. A two-wall/hosted-door regression ensures another wall's
door cannot crash a component check or make its authored leaf explain wall
points. Refinement tests reject stale, changed and unsupported proposals,
require explicit IDs, preserve hosted relationships and publish no partial
bundle after a failed native process.

The final combined local Python suite passed 586 tests and 95 subtests, with two
opt-in capture checks skipped. Lint, the production build and all 131 Node World
Builder contracts passed. The 54 new fitting/refinement tests exercise the
new solver and review adapter. Native export tests use IfcOpenShell 0.9.0 and
rhino3dm 8.17.0.
The Python worker test environment includes NumPy, PyCOLMAP, PyAV and ONNX
Runtime; no new model weights or paid inference were used.

Local browser launch was unavailable: the Python Playwright environment expected
a browser revision not installed here, and the already installed Chromium
executable could not create its process-singleton socket on this host. No
local browser pass is claimed. The configured hosted Chromium and WebKit jobs
provide the browser checks at the pull request's exact commit.

## Remaining qualification

Real repeated phone-room captures with withheld tape/laser measurements remain
required. Automatic image-mask instance separation, detected openings, full
surface completeness, registered recapture merging, native Rhino/Grasshopper
editing and physical robot transfer are not established by this change.
