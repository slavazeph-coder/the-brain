---
type: project
description: Robot Behavior Engine first milestone — Reachy Mini text-to-motion in Arena, real CPU verification, GPU worker kit
---

# Robot Behavior Engine: Reachy Mini text-to-motion — 21 October 2026

Owner direction: Binh Pham's open-source reachy-motion-generator (LLM planner writes a motion recipe, small flow-matching model makes a 25 Hz trajectory) is valuable for XIO and BrainSNN **robot intelligence and animation, not 3D scanning accuracy**. Adopt the architecture as a separate, low-cost experiment; do **not** redirect the World Engine flagship (camera-to-3D reconstruction stays the main commercial priority). Milestone: text instruction in Arena → motion generated on the 4090 → replayed on a simulated Reachy Mini; then test whether customers pay before expanding to other robot bodies. Likely first customers: robotics distributors / reception and companion robot deployers. Owner's relevance scores (strategic, not measured): XIO Companion 9, Arena 8, Enterprise Robot API 7, 3D Scanner 2.

## What shipped (branch, not yet merged at time of writing)

- `/arena/motion/` page (`brainsnn-r3f-app/public/arena/motion/`), linked beside Rope strike in the Arcade. Plays 24 pre-generated upstream 27B examples with no worker; generates live when a worker is configured; variations, channel chart, recipe/idea, SDK move JSON download/open. Kinematic playback only, labelled as such.
- Viewer `src/arena/motion-renderer.js` (separate bundle via `scripts/build-motion.mjs`; three + urdf-loader 0.12.3 + self-hosted Draco decoder). Vendored Apache-2.0 IK/passive kinematics in `src/arena/reachy/`; model/meshes in `public/arena/motion/robot/` with ATTRIBUTIONS.md.
- Server `src/server/motionWorker.js`: `GET /api/motion/status`, `POST /api/motion/generate` (own `motion` rate tier 10/min, one in flight, n ≤ 4, prompt ≤ 300). Every returned frame is rebuilt and checked (rigid head pose, ±0.1 m, monotonic 25 Hz time, ≤ 28.8 s). Env: `MOTION_INFERENCE_URL/KEY/EFFORTS/TIMEOUT_MS`.
- Worker `robotics/arena/workers/motion/` (upstream API + bearer key + chunk-safe body cap + CPU engine + `repo@revision` pins + `--gpu-memory-utilization`), Dockerfile on vllm v0.30.0, docs `robotics/arena/docs/motion-worker.md`.

## Verified vs not

- Real 0.8B planner + generator + reachability ran on a 4-vCPU container: ~26–35 s/request (planner dominates; generator < 1 s). Real output flowed worker → website validator → Arena page playback → download, with the bearer key.
- Not done: any GPU run. Author's 0.17/0.29/0.8 s latencies are unverified on our hardware. RTX 4090 was unavailable per 17 Oct; check memory headroom beside resident text services before starting vLLM. GB10 (ARM64, sm_121) vLLM/FP8 path unqualified. Remote worker must be HTTPS + key; the outbound GPU bridge carries text only.
- Models drive Reachy Mini's 9 DoF only; humanoid/Unitree needs retargeting, safety and data. Check Pollen emotion/dance dataset terms and Qwen base licences before commercial weight redistribution.

Next: run the Docker worker on the 4090 when free, measure n = 1/2/4 latency and memory, set Railway `MOTION_INFERENCE_*`, then gauge paid interest.
