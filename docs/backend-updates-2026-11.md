# Backend updates: what was checked, what changed, what is next (November 13, 2026)

A review of the backend against current releases and three outside examples the owner sent, with what was done about
each. Versions were read from PyPI and npm on November 12; the repository's own pins were read from the code.

## Done

| Change | Where | State |
|---|---|---|
| Pillow 12.1.0 → 13.0.0 on the worker (77 known advisories), and uploads opened with only the JPEG, PNG and WebP decoders | #288 | Live on the worker since the #289 deploy |
| The hosted worker brought up to main | #289 | Live: a visitor photo job returned its preview in 7 s after the redeploy |
| MuJoCo 4.0.0 → 4.0.1 in the Arena | #290 | Merged. The five fixed episodes are identical on 4.0.1 |
| `scene.frag` for Unreal Engine (FragmentsUnreal), converted in the browser from `scene.ifc` | #291 | Open |
| Three review findings: capture-report timeline, what-if bound to its robot, fleet separation at occupied starts | #291, #292 | #292 merged; #291 open |
| A registered laser scan as scene-compiler input, with a wall test for dense clouds | #294 | Open. A worker command, not on the site |

`pip-audit` was clean on the worker's other production pins, and `npm audit` reports 0 vulnerabilities on the site.

## Two things worth knowing

- **The hosted worker does not deploy from main.** Railway service `world-worker` builds branch
  `deploy/world-worker-20261027`. A worker change on main is live only after main is merged into that branch, as #271
  and #289 did. The capture-report fix in #291 needs the next such merge.
- **This session cannot start GitHub workflows** (the API answers 403), so it cannot run GPU Remote Validation. Every GPU
  step below is one "Run workflow" click for the owner.

## Version gaps checked against the registries

| Component | Pinned | Latest | Where it runs | What it needs |
|---|---|---|---|---|
| vLLM | 0.8.5.post1 (cu124) | 0.33.0 | GPU text service | The GPU box. One click, below |
| Isaac Lab / Isaac Sim | 0.47.2 (Lab 2.3.0) / 5.1 | 3.0.0 / 6.2 | G1 trial runner | The GPU box and an API migration |
| MuJoCo (Arena Python worker) | 3.2.3 | 4.0.1 | LIBERO simulation worker | Re-baselining: MuJoCo 3.4 changed box-box contact and is reported to shift LIBERO results |
| robosuite | 1.4.1 | 1.5.2 | same | With the MuJoCo move |
| Python (Arena worker image) | 3.10 (end of life) | 3.12 | same | With the MuJoCo move |
| usd-core | 25.8 | 26.11 | Worker and three CI jobs | Worth doing with native USD splat prims, once a GPU produces splats |
| bpy (Blender) | 4.2.23, the last 4.2 LTS release | 4.5.16 LTS | Scene compiler | Re-run the scene compiler tests and compare outputs |
| onnxruntime | 1.22.1 | 1.31.1 | MoGe-2 scale and photo preview | Re-run the ETH3D scale benchmark before and after |
| FastAPI / uvicorn / pydantic | 0.128.2 / 0.48.0 / 2.13.5 | 0.162.5 / 0.54.0 / 2.14.3 | Worker API | No advisory; routine |
| anthropic SDK | 2.3.0 | 2.8.0 | Object naming, reference scale | A plain bump: the pin is already past the release that changed the API version |
| lerobot | v3.0 dataset adapter | 0.7.0 | Arena interop | When a second policy family is added |

Left alone on the site because each needs its own migration: vite 8, express 5, TypeScript 7, three.js 0.187,
`@google/genai` 3, motion 14, lucide 1, stripe 23.

## Corrections to the pasted survey

Its headline versions were right. These points did not match the repository:

- Nothing in the code uses SAM, so SAM 3.1 would be a new addition, not a drop-in swap. Object naming uses OWLv2 and
  Claude.
- The GPU text service is configured for `Qwen3-4B-Instruct-2507`, not Qwen3-VL-8B.
- The site already calls `gemini-3.5-flash` with `gemini-3.1-flash-lite` as fallback, not Gemini 2.5 Flash.
- `@mujoco/mujoco` 4.0.1 is on npm and is now what the Arena runs.
- LeRobot is at 0.7.0.
- The Hugging Face repository names and revisions for Qwen3.6 could not be checked from this session (the proxy refused
  the Hugging Face API). Confirm them before pinning.

## GPU box: what is proven and the next click

GPU Remote Validation run 6 (November 2) passed phases 3 to 6 on the GB10: SSH from a GitHub runner, the GPU, real CUDA
execution and workspace persistence. Phases 7 to 15 were skipped, so no runtime is deployed there.

To install the current vLLM in its own environment (the workflow creates `/workspace/slava/vllm-venv` and leaves the
machine's system Python alone):

1. GitHub → Actions → "GPU Remote Validation (remote GPU box)" → Run workflow, on `main`.
2. `level`: `install`. `install_vllm`: on. `vllm_version`: `0.33.0`.
3. Read `07-vllm-install.txt` in the run's evidence package. vLLM 0.27 and later are reported to build correctly for
   the GB10's GPU; this run is what confirms it on this machine.

The model level then needs `model_repo`, an immutable 40-character `model_revision` and `allow_model_download`. Lyra 1's
approved trial (docs/hermes-gpu-tasks.md, task 5) is a separate batch job with its own conditions.

## Stale things found on the way

- `brand-brain-preview` is a Railway service still running an old branch (`brainsnn-brand-brain-v01`) with none of the
  security fixes. Remove it or redeploy it; that is the owner's call.
- The repository-root `Dockerfile` uses Node 20, which is end of life, and no Railway service builds it.
- Three CI-only workflows pin Pillow 11.3.0, and `robotics/arena` pins 12.1.0 and 12.2.0. The Arena worker image is on
  Python 3.10, which Pillow 13 does not support, so those move with the Arena image.

## The three outside examples

### FragmentsUnreal (Arkoun Merchant): yes, usable now
An Apache 2.0 Unreal Engine plugin that loads That Open `.frag` building models with their BIM data. World Builder
already writes `scene.ifc`, so #291 adds `scene.frag`, converted in the browser. Not done: opening the file in Unreal
Engine ourselves, and the facilities layer in that demo (sensors, work orders), which is a product of its own.

### Scan to BIM (AltiGeo Ireland): the input is reachable, the detail is not yet
Their model comes from a Leica BLK360 scan, registered in Cyclone, then modelled by people in Revit down to beams, ducts
and columns. #294 takes the same kind of input: a real FARO scan became a floor, six correct walls and eight objects with
IFC and USD in under half a minute. The gap is detail and review, in this order:

1. Upload a scan file on the site, and let the cloud hand-off accept `survey-scan`.
2. Measure how far the model sits from the scan (`fit_check.py`) and show it; surveyors judge a model by that.
3. Suggest columns, beams, pipes and ducts from shape (cylinders and overhead boxes) for a person to accept.
4. A point-cloud-to-model reveal for sharing, made from a scan the owner is allowed to publish. The ETH3D scan used for
   the check is CC BY-NC-SA, so it is for evaluation and cannot be used in marketing.

### Human movement from video (SwRI ENABLE): a first page exists; the physics does not
`/world/movement.html` (#293) takes hand-marked hip, knee and ankle points for knee angles, and imports OpenSim results
and a supplied vertical force. ENABLE finds the body automatically and estimates ground forces, joint loads, muscle
forces and energy use with a musculoskeletal model. What could honestly be added next:

- automatic body landmarks in the browser (MediaPipe Pose, Apache 2.0), replacing the hand marking;
- a vertical ground-force estimate from the body's centre-of-mass acceleration, with the person's mass and height
  entered by the user, labelled as an estimate from video and not validated against a force plate.

Muscle forces and energy use need a musculoskeletal solver (OpenSim Moco is the open one) and validation data. Claiming
them from a phone video without that would not be honest, so they stay out until there is a validation set.
