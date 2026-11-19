---
type: project
description: World Builder tabletop task authoring, native MuJoCo evidence and verified Google Robotics plugin handoff
---

# World Builder robot task builder

Zhutian Yang’s post demonstrates Google Antigravity’s Robotics plugin creating MuJoCo tasks using text and visual references. [Author’s post](https://www.linkedin.com/posts/zhutian-yang_anyone-can-create-high-quality-mujoco-sim-ugcPost-7529063850646634496-bEM_) · [Official plugin](https://github.com/google-deepmind/robotics-antigravity-plugin)

Product commit `73442c89` on `codex/world-robot-task-builder` extends `codex/world-feature-showcase`. In the existing World Builder, open Showcase → Try a robot → Make a robot task or `/world/index.html#layer-tab-robottask`. The workspace now has eight in-page tool tabs and the showcase covers 46 activities across six chapters. The review build has a separate production rollout.

The bundled simulation uses official MuJoCo 4.0.1 at 2 ms per step, 81 recorded samples over four seconds, a two-axis actuated pusher and a free puck. The local builder supports single-step reach and push tasks, editable goal distance, two travel limits and seeded layout. Top-down and orbitable 3D replays use the observed poses. Both views, exports and the WASM engine can work offline after first use. A captioned 6.55-second comparison plays inside the builder. The previous showcase film remains available.

Standalone MJCF, recorded controls and observations, and Antigravity ZIPs are generated on the device. An open-ended brief plus an original image or video can also be saved for Antigravity before running a starter. The optional site endpoint `POST /api/world/robot-task-draft` requires explicit submission and an owner session, checks inputs, uses the shared Gemini call allowance and asks Gemini 4 Hydrogen for a bounded reach/push draft. It supports short text and up to 2 MiB inline media. Choosing a reference alone keeps the file local. Production server and UI integration were tested against a controlled provider response. A live Google inference call still needs verification on a configured owner service.

Both standalone scenes passed Google's pinned native static audit at commit `9cb7f624c4d7c50859a39f1d49d088990429a83d` with zero errors and warnings. Independent native Python MuJoCo replay agreed on all five success/miss outcomes with final goal distances within 1.03 mm of the browser. In the 30 cm push, seed 42, the baseline puck finished 0.42 cm from the goal and the limited-travel run finished 17.42 cm away. These are simulated outcomes of a prescribed controller.

Verification includes 550 World and street tests, app tests, TypeScript, the production build, both Chromium and WebKit, offline operation, 320 px layout, keyboard operation and scoped axe checks. Receipt directories on the owner's machine are `brainsnn-research/2026-11-19/robot-task-builder` and `brainsnn-research/2026-11-19/mujoco-plugin-audit`.
