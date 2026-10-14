# BrainSNN Robot Hub: discovery that leads to a useful experiment

Research and implementation brief · 13 October 2026

## The position

**Discover a robot brain. Test the match. Learn from the failure.**

BrainSNN should specialize in the step between finding a model and proving it useful on a particular robot. Hugging Face already has robotics models, LeRobot, datasets, model cards, Spaces and collections. Claiming that nobody provides a robotics hub would be inaccurate. The opportunity is a more direct workflow around the robot, environment, controller and evidence, backed by XIO's access to physical deployments.

For C10, the eventual research claim should be measurable: an adaptive test system finds more meaningful failures than an equally funded fixed or random suite, and those failures help improve later held-out performance. That result has not been demonstrated by this prototype.

## What to adopt from Hugging Face

Use consistent model cards, searchable metadata, official source links and personal collections. Hugging Face documents model-card metadata for filtering and discovery, and collections for organizing related artifacts. BrainSNN can link to upstream weights and repositories rather than duplicate their storage at the beginning.

The robotics-specific additions should be:

1. **Embodiment before popularity:** filter by robot body, then distinguish an upstream documented workflow from a custom adaptation.
2. **A complete control contract:** record camera views, state order, units, action representation, normalization and control frequency.
3. **A model–robot–world bundle:** keep the exact checkpoint, robot revision, environment, seed and controller together.
4. **Evidence beside the model:** show measured success, interventions, latency, cost and replays under named conditions.
5. **Useful failures:** save a regression suite and eventually generate harder tests based on observed weaknesses.

Do not use a universal robot IQ number, fabricated popularity metrics, or an attractive model name attached to the demo script. A video model, a task imitation policy and a skill-planning VLM perform different jobs.

Sources: [Model cards](https://huggingface.co/docs/hub/en/model-cards), [Collections](https://huggingface.co/docs/hub/en/collections), [LeRobot](https://huggingface.co/docs/lerobot/en/index), [Robotics models](https://huggingface.co/models?pipeline_tag=robotics).

## Expanded model coverage

The catalog has 16 distinct families, grouped by their role. The original Qwen3-VL, SmolVLA, ACT, π₀.₅, MolmoAct2, OpenVLA-OFT and GR00T entries remain. Nine additions broaden the experiments users can plan:

| Addition | Useful reason to include it | Important qualification |
|---|---|---|
| Octo | A smaller generalist with language or goal-image conditioning. | WidowX examples require the documented controller, observations and history window. |
| RDT-1B | A bimanual diffusion-policy route. | Language and vision encoders add requirements beyond the policy parameter count. |
| π₀-FAST | An autoregressive action-token alternative. | Match the action tokenizer and exact checkpoint; Gemma conditions remain relevant. |
| Diffusion Policy | A task-trained baseline for manipulation. | Requires a task checkpoint or training, not a generic language-model endpoint. |
| X-VLA | Soft-prompt adaptation and documented benchmark routes. | Preserve its action conventions and environment configuration. |
| WALL-OSS 0.5 | A newer cross-embodiment research candidate. | The selected weight card does not state an explicit license; code licensing is insufficient. |
| Cosmos Reason 2 | Physical-scene reasoning and skill-planning research. | Text output needs a validated adapter and a separate robot controller. |
| Cosmos Predict 2.5 | World-video generation experiments. | Generated video is not a physics rollout or proof of task completion. |
| LingBot-VA | Joint video/action modeling. | Evaluate its action outputs in matched physics; keep predicted and observed video separate. |

Every entry in `dist/models-data.js` carries official sources, requirements and licensing notes. `documentedRobotIds` is narrower than proposed `robotIds`. A documented workflow is an upstream reference, not a tested BrainSNN integration. `checkpointsByRobot` contains only explicit mappings; unresolved plans retain a null checkpoint instead of attaching the wrong robot weights.

Primary sources: [Octo](https://huggingface.co/rail-berkeley/octo-base-1.5), [RDT](https://huggingface.co/robotics-diffusion-transformer/rdt-1b), [π₀-FAST](https://huggingface.co/docs/lerobot/en/pi0fast), [Diffusion Policy](https://github.com/real-stanford/diffusion_policy), [X-VLA](https://huggingface.co/docs/lerobot/xvla), [WALL-OSS](https://huggingface.co/x-square-robot/wall-oss-0.5), [Cosmos Reason](https://huggingface.co/nvidia/Cosmos-Reason2-2B), [Cosmos Predict](https://huggingface.co/nvidia/Cosmos-Predict2.5-2B), [LingBot-VA](https://huggingface.co/docs/lerobot/en/lingbot_va).

## Expanded robot coverage

The original six platforms are joined by UR5e, Franka FR3, Kinova Gen3, xArm7, PiPER, WidowX 250S and TIAGo. There are 13 researched robot platforms in total. Each has an official model preview, upstream viewer, asset license and an integration route.

All 13 previews use unchanged upstream 500×500 gallery assets. Combined image transfer size is approximately 383 KB, down from over 9 MB for the original six previews. Exact source commits and hashes are recorded in `dist/assets/robots/attributions.json`. Robot assets do not imply physical ownership, a partnership, or policy compatibility.

Source: [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie).

## Interaction and visual changes

The homepage restores BrainSNN's actual visible gradient B mark and the official dark blue-black, cyan and violet palette. The desktop hero pairs a real robot preview with a model and a demo entry point. On phones, discovery controls receive priority over the decorative hero.

Users can search; filter by robot, role, task and documented workflow; compare up to three models; inspect official requirements; bookmark models and robots; create a test plan; and export its JSON. Filter and detail URLs are reusable. The demo action explicitly selects the scripted controller so a named policy is never implied. Saved items and plans are local to the browser.

## Build the real platform in this order

**First:** run one actual Qwen skill endpoint through the existing bounded adapter, record its decisions and test fixed seeds. This proves model-driven interaction, not physical robot dynamics.

**Second:** integrate SO-101 with a matched SmolVLA checkpoint and an ACT baseline, or reproduce one published Panda/LIBERO setup. Use the exact camera, state, controller and normalization contract.

**Third:** store versioned runs and replay artifacts in a durable backend. Introduce verified run identities and a private regression suite before opening public comparison tables.

**Fourth:** add queued GPU workers with measured throughput, spending caps and durable checkpoints. Providers such as Vast are implementation choices; reproducible evaluations are the product.

**Fifth:** add public model submissions, organization accounts and verified community results. A moderated compatibility manifest is more useful than a large unverified model count.

This update is an interactive research hub and planning prototype. It does not host model weights, provision workers, execute the named VLA policies or operate physical robots. Interaction and source checks do not substitute for browser pixel review or real-model validation.
