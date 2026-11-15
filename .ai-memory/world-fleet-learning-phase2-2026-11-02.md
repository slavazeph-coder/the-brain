---
type: project
description: BrainSNN Fleet Learning Phase 2 source-bound ROS pose import and same-scene counterexample
---

# Fleet Learning Phase 2 (2026-11-02)

Draft PR #278: https://github.com/slavazeph-coder/the-brain/pull/278

- Phase 1 synthetic reviewed episode retrieval / footprint-aware A* is in robotics/world_worker/fleet_learning.py.
- Phase 2 imports exact BrainSNN nav2-map PGM, YAML and JSON hashes, ROS map-frame trajectory CSV and review/consent manifests, with static conservative disc clearance, timestamps, source hashes and operator-reported authenticity labels: robotics/world_worker/fleet_nav2.py.
- robotics/world_worker/fleet_campaign.py tests 24 held-out starts with baseline A* versus experience-guided A* and a separately authored synthetic reference obstacle. Negative result: 21/24 baseline reference-clear versus 17/24 guided, both 9.65 m mean route length in authored units. 1 false-free cell. Not a physical/survey result, not trained policy.
- /world/fleet-evaluation.html is an offline browser report viewer; report and demo video sources are in scripts/world-demo/fleet-learning/.
- Local 33 Python unit tests and Chromium smoke passed on Nov 2; hosted CI rerun for latest branch head not confirmed.
- Exact real robot logs, measured independent map, runtime tests and hardware safety gate remain unavailable. No production robot controller added.
- Full command and safety contract: docs/world-fleet-learning-phase2.md.
