# Interactive arena implementation

This change moves the Arena to the opening screen and keeps the original BrainSNN blue-black, cyan and violet colours and gradient B mark. The robot/model catalogue remains available through Discover.

## Implemented

- Exact robot/model selection across all 77 listed routes, with 17 model/controller families including GEAR-SONIC. Robot assets, model requirements and the Arena are separate tabs within the same selected experiment.
- A ready-to-play, explicitly scripted local practice arena. It supports five seeded scenarios, orbit and keyboard camera control, step/pause/reset, obstacles, lighting, moved targets, immutable recorded states, replay branches and JSON evidence.
- A fixed demo observation camera independent of the spectator camera. The legacy skill connector now sends this observation rather than the user's orbitable display.
- A worker connector that validates the body, model, checkpoint, camera/action/state/controller/timing contract and task before creating a named session. Tokens stay in memory. Old requests, stale frames and disconnected sessions cannot overwrite a new selection.
- Named-worker run/pause/step/reset, explicitly supported interventions, practice/benchmark locking, actual spectator/policy camera display and bounded recorded-frame replay. Recorded camera review does not restore physics state.
- A downloadable Panda/OpenPI LIBERO worker kit with an actual environment/policy loop, authenticated API, pinned source versions, checkpoint content manifest, fixed observation processing, task success checker, applied-action evidence and bounded session lifetimes.
- A campaign planner for up to 100,000 total episodes. Worker concurrency, seeds, budget, loading/storage/transfer allowances and user-measured pilot throughput are explicit. Plans export as unresolved drafts and do not launch compute.

## Execution status

The deployed Site is a static client. No GPU worker, model checkpoint or physical robot was provisioned during this change. The bundled adapter implements the native OpenPI Panda/LIBERO route. MolmoAct2, G1 SONIC/GR00T and SO-101 profiles expose their integration requirements and can connect to an independently implemented matching v1 worker; their adapters are not bundled.

The local practice arm is a bounded kinematic demonstration. Named robot assets use upstream viewers until an external worker supplies real observations. The worker kit must be installed and checked with its real dependencies and weights before a live inference claim. Server-authoritative causal branching, provider allocation/billing and a resumable cloud campaign queue remain separate backend work.

## Verification

JavaScript syntax checks cover every `dist/*.js`. The tests cover navigation and all listed pair routes, actual local controller actions, fixed camera invariants, immutable practice replay, worker lifecycle/contract validation, stale network responses, credential exclusion, task selection, recorded worker replay and campaign arithmetic/flows. Python tests exercise the real FastAPI routes with injected simulation/policy doubles and the worker's preprocessing, action validation, manifests, resets, resource cleanup and evidence.

The Python/browser contract test imports the actual worker profile and passes it through the frontend validator. These checks do not execute a downloaded learned policy, a MuJoCo GPU renderer or a browser pixel test. Browser QA was unavailable in this managed environment.

## Rebuild worker download

Run `python scripts/build-worker-kit.py` after any worker or documentation change. It recreates `dist/downloads/brainsnn-arena-worker.zip` and `dist/worker-setup.html` from checked-in source, excluding Python caches. The kit contains neither model weights nor credentials.
