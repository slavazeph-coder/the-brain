# BrainSNN Fleet Learning Lab: experience before policy training

Status: **synthetic prototype**, 2 November 2026. The web route is `/world/fleet-learning.html`; World Builder links to it in its navigation. This implementation does not ingest a deployed robot or train a policy.

## What is implemented

- A reviewed, successful episode contains task, robot footprint, grid path, source provenance and a scene fingerprint.
- Only compatible and reviewed successes can enter retrieval. Failed, unreviewed, wrong-task and mismatched-scene records are rejected.
- A* planning uses the source corridor as a weak prior, replanning for another robot's larger footprint. Unknown map cells block the route.
- The browser lab runs the same **type of synthetic challenge** with two editable-by-code footprint sizes, a narrow passage and a detour, with JSON evidence export.
- The backend emits explicit `simulation_plan_only`, `policy_finetuned: false` and `physical_robot_validated: false` fields.

The authored site uses 26 by 18 cells at 0.4 m/cell. Robot A radius is 0.20 m and crosses a narrow opening in 7.6 m. Robot B radius is 0.54 m and must go around the top via a 13.2 m synthetic route. All distances are computed from the authored grid. They are **not survey readings**. No real deployed robot supplied these movements. Results are a deterministic software demo, not a benchmark of CEL or a robot learning achievement.

## Run

From the repository root:

```sh
python -m robotics.world_worker.fleet_learning
python -m unittest discover -s tests/world -p 'test_fleet_learning.py' -v
```

Open `brainsnn-r3f-app/public/world/fleet-learning.html` through the website or a static local web server. Click **Record teacher**, then **Transfer to follower** or **Test copied path**. Download the JSON evidence to inspect the authored source and replanned route.

The film can also be rendered with the separate demonstration renderer. Its proof sidecar records exact scene fingerprint, path cells, authorship flags and video SHA-256. Never call this file a live website capture or a real-robot result.

## Research basis, not reimplementation

- [Collective Experience Learning / FERT primary paper](https://arxiv.org/abs/2610.25736) and [project page](https://cel-robot-learning.github.io/), October 2026. Authors report 79.2% to 98.3% phone-packaging success with 96 training robots and 120 evaluation trials on withheld **same-model** robots, not a cross-morphology demonstration. In one 4-robot condition, reported success drops to 50.8%.
- [RLinf](https://github.com/RLinf/RLinf) is open source under Apache 2.0 and supports embodied RL infrastructure. As of this implementation the repository explicitly says CEL-specific code **will release soon**.
- [X-Sim](https://portal.cs.cornell.edu/X-Sim/) shows object-centric real-to-sim-to-real manipulation and helps define later research, but it is not incorporated into this navigation prototype.

Our simple retrieval + footprint-aware replanner is independently authored software. It does **not** implement FERT, imitation learning, diffusion policies or reinforcement learning.

## Safe next integration

1. Save timestamped real fleet episodes with robot configuration, calibrated pose transforms, action coordinate frames, joint/velocity logs, sensor checksums, task/outcome review and operator approval. Keep raw private capture separate from shared features.
2. Bind episodes to an *immutable* World Builder model and map revision. Do not use the source robot's coordinates if a scene relocalization, scale change or unknown area invalidates them.
3. Replay source trajectories in Arena and compare retargeting to a goal-only A* baseline across 20+ held-out tasks. Report successes, collisions, minimum clearances, false-free map areas and failures; use a **measured** reference map.
4. Only then add trainable policies, behind an operator-approved, robot-specific adapter and offline evaluation gates. Running on GB10 or RTX 4090 requires confirmed compatible weights and runtime. Compute and engineering effort are **estimates**, not benchmarks.
5. Keep deployment disabled by default. No motor commands should be generated from a raw replay, unverified geometry or a novel target body.

Physical robot validation requires localization, actual obstacle sensing, E-stop, human supervision, signed policy provenance, speed/torque limits, contact safety and reference measurements. Neither a phone-derived camera geometry fit nor a self-consistent simulated route satisfies these gates.
