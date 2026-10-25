# Gemini 4 Argon Robotics Integration Plan

## 1. Product Overview & Core Capabilities

We will integrate **Gemini 4 Argon (`gemini-4-argon`)** as the embodied robotics intelligence engine across both the **React Arena Tasks Studio (`/arena/tasks`)** and the **3D Robot Arena (`/arena/`)**, delivering four tightly coupled capabilities with structured action sequences and live 3D trajectory replay:

1. **Embodied Task Planner & 3D Policy Controller**
   - Translates mission goals, workspace bounds, and 3D scene state into validated, collision-aware action sequences (`move_to`, `pick`, `place`, `wait`, `request_help`) with 3D Cartesian waypoints `[x, y, z]`, gripper states, and step-by-step physical rationale.
   - Executes directly against the 3D tabletop kinematic engine (`BrainArena3D`) with live 3D trajectory rendering, waypoint markers, and timeline scrubbing.
2. **Multimodal Scene Perception & Grasp Pose Synthesis**
   - Captures the fixed 256×256 policy sensor camera frame alongside 3D object/obstacle telemetry and sends both to `gemini-4-argon` multimodal vision.
   - Synthesizes 6-DoF / 3D grasp poses (approach vector, pre-grasp hover point, grasp center, clearance margin, and confidence score) and highlights obstacle clearance zones before execution.
3. **Telemetry Failure Diagnosis & Reward Shaping Studio**
   - Inspects recorded episode traces (obstacle contacts, missed picks, moving-obstacle collisions, or target-shift perturbations at $t = 6.0\text{s}$).
   - Diagnoses the exact physical failure timestamp and root cause, proposes an updated dense reward shaping specification (reach weight, clearance penalty, grasp alignment bonus, jerk regularization), and generates a corrected recovery trajectory for immediate 3D replay.
4. **Natural Language Mission Command Center**
   - Lets operators issue free-form natural language missions (e.g., *"Deliver the cyan and mint blocks first while keeping 18 cm clearance from the moving obstacle, then pause over the goal bin"*) and watch Gemini 4 Argon compile and replay the full 3D trajectory in real time.

---

## 2. User Experience & Interface Architecture

### A. React Arena Tasks Studio (`/arena/tasks` — `src/app/ArenaTasks.jsx`)
- **Top Navigation & Workspace Header**: Clean editorial layout adhering to the BrainSNN design system with quick switching between curated benchmark tasks (*Tabletop Pick & Place*, *Deformable Cable Routing*, *Warehouse Aisle Navigation*, *Dynamic Obstacle Evasion*, and *Target-Shift Recovery*).
- **Split-Screen Interactive 3D Robotics Workbench**:
  - **Left / Center Stage — Live 3D Trajectory & Sensor Viewport**:
    - Interactive 3D WebGL canvas rendering the robot arm, blocks, static/moving obstacles, goal fixture, and planned 3D waypoint trajectory path with orbit/top camera controls and playback timeline scrubber.
    - Picture-in-picture **Policy Sensor Camera (256×256)** feed showing the exact visual observation frame sent to `gemini-4-argon`.
  - **Right Stage — Gemini 4 Argon Control Deck (4 Functional Tabs)**:
    1. **Mission & Policy Planner**: Natural language mission prompt input, challenge & seed selector, structured action sequence table (`step`, `skill`, `[x, y, z]`, `expectedOutcome`), and **Plan & Replay in 3D** control.
    2. **Scene Perception & Grasp Synthesis**: Captures the live sensor frame for multimodal `gemini-4-argon` analysis, displaying localized objects, obstacle risk vectors, and synthesized pre-grasp / grasp poses with one-click trajectory injection.
    3. **Telemetry Diagnosis & Reward Shaping**: Evaluates the latest run's contact events and trajectory trace, outputting failure root-cause analysis, interactive reward term sliders, and a **Synthesize Recovery Policy** action.
    4. **Benchmark Comparison**: Side-by-side episode metrics (blocks delivered, simulation steps, obstacle contacts, replan latency) comparing the scripted baseline against Gemini 4 Argon policies.

### B. Standalone 3D Robot Arena (`/arena/` — `public/arena/`)
- **Model Catalog & Starter Profiles (`models-data.js` & `arena-profiles.js`)**:
  - Registers **Gemini 4 Argon (`argon4`)** as a featured embodied planner and VLA controller across catalog robots (`panda`, `so101`, `aloha`, `stretch3`, `g1`, `go2`, `ur5e`, `fr3`) with a quick-pick starter button in the Arena profile bar.
- **In-Arena Gemini 4 Argon Command Bar & Built-In Worker (`arena-workspace.js`)**:
  - Adds an interactive **Gemini 4 Argon Mission & Trajectory Copilot** panel inside the Arena inspector so users can type a natural language instruction, run multimodal scene perception on the live canvas, or auto-connect the built-in `/api/arena/argon-worker` runtime to stream authoritative `gemini-4-argon` policy frames and replay trajectories on the timeline scrubber.

---

## 3. Backend & API Architecture (`server.ts`)

All `gemini-4-argon` calls will run strictly on the server via `@google/genai` with structured JSON schemas (`responseMimeType: "application/json"`, `responseSchema`), `thinkingLevel: "HIGH"` where deep spatial planning is needed, and automatic paid-key provisioning flow (`paid_model_flow`) support:

- **`POST /api/robotics/argon/plan`**:
  - Accepts `{ mission, robotId, challenge, seed, worldState, sensorImageBase64, rewardWeights }`.
  - Calls `gemini-4-argon` to generate a structured action plan (`summary`, `reasoningTrace`, `graspCandidates`, `waypoints`, and executable `actions` array of bounded `move_to | pick | place | wait | request_help` skills) and simulates/verifies the resulting 3D trajectory frames.
- **`POST /api/robotics/argon/perceive`**:
  - Accepts `{ sensorImageBase64, worldState, robotId, task }`.
  - Uses `gemini-4-argon` multimodal vision + spatial state to return scene understanding, obstacle clearance assessment, and ranked 3D grasp pose candidates.
- **`POST /api/robotics/argon/diagnose`**:
  - Accepts `{ episodeTrace, events, metrics, mission, currentRewardWeights }`.
  - Uses `gemini-4-argon` to diagnose collisions, stalls, or missed grasps, returning failure root causes, recommended reward-shaping coefficients, and a patched recovery action sequence.
- **Built-In Arena Protocol v1 Worker (`/api/arena/argon-worker/v1/*`)**:
  - Implements `/v1/capabilities`, `/v1/sessions`, `/v1/sessions/:id/frame`, and `/v1/sessions/:id/commands` backed by `gemini-4-argon` and the server-side `BrainArena3D` kinematic simulator so the 3D Robot Arena (`/arena/`) can connect and execute live Gemini 4 Argon sessions out of the box.

---

## 4. Verification & Quality Assurance

- Prompt for paid API key selection via the AI Studio paid model UI (`paid_model_flow`) before executing `gemini-4-argon` requests, while providing a deterministic physics-backed fallback trace if no key is configured yet.
- Verify that both `/arena/tasks` and `/arena/` compile cleanly, pass `compile_applet` and `lint_applet`, and render interactive 3D trajectory replays with zero console or runtime errors.
