# BrainSNN Fleet Learning Phase 2: source-bound log import and offline evaluation

Updated 2026-11-02. All examples here are **authored synthetic**. No data from a deployed robot was supplied; no robot was controlled. Physical test and independently measured reference validation are **not complete**.

## What was added

- `robotics/world_worker/fleet_nav2.py`: imports the real `nav2-map.pgm` plus its SHA-256-bound `nav2-map.json` and YAML exported from BrainSNN World Builder. Preserves image-to-ROS y orientation, exact scene source checksum, map revision and scale basis. Occupied and unknown cells are blocked. Requires ROS REP-103 ENU positions already resolved to the `map` frame. No implicit odom-to-map transform.
- `robotics/world_worker/fleet_nav2.py`: parses a bounded ROS2-pose CSV, validates exact SHA, monotonic timestamps, no sampling gap greater than 2 seconds, finite pose and velocity, bounded reported localization std, speed plausibility and continuous disc clearance against the static candidate grid. CSV is not direct `rosbag2` ingestion; export/transform first.
- `robotics/world_worker/fleet_campaign.py`: 24 held-out starts, goal-only A* baseline versus the same-scene experience-guided A* from Phase 1. Static route segments are checked against a separately supplied grid. Candidate false-free cells are reported. No physics, learned policy or physical contacts.
- `/world/fleet-evaluation.html`: a local browser-only report viewer with sample results, per-task flags, hashes and prominent negative-result labels. No operator uploads are transmitted by the page.
- Phase 2 video renders the synthetic result honestly, including the baseline performing better when a reference obstacle was missing from the candidate map.

## Run a complete authored example

```bash
python -m robotics.world_worker.fleet_campaign --sample ../private-fleet-fixture-001
python -m unittest discover -s tests/world -p 'test_fleet_*.py' -v
python tests/world/fleet_evaluation_browser_smoke.py  # optional Playwright + chromium
python scripts/world-demo/fleet-learning/render_phase2.py \
  --fixture ../private-fleet-fixture-001 \
  --out ../private-fleet-phase2.mp4
```

The sample creates `candidate-map/`, `reference-map/`, `robot-poses.csv`, `telemetry-manifest.json`, `import-receipt.json` and `fleet-campaign-report.json`. Generated reference has one extra authored obstacle. In the sample, among 24 same-scene held-out starts, goal-only is reference-clear in **21/24** and experience-guided in **17/24**. Neither is a physics collision result. Both average 9.65 metres in the **authored grid**, with no average distance advantage. This is a negative result for the source-corridor preference, not evidence of learning from a real fleet.

## Real pilot input contract

1. Export `nav2-map.pgm`, `nav2-map.yaml`, `nav2-map.json` from the same reviewed World Builder scene job. Keep all three exact files together. A map's `scale.source: user-measured` is still an operator statement, **not independent survey accuracy**.
2. Export ROS 2 pose records from `nav_msgs/Odometry` or localization into the **map** frame after verifying the required tf2 transform (poses are in `header.frame_id`, twists in `child_frame_id`). Only then create a UTF-8 CSV with the exact header:
   `timestamp_ns,x_m,y_m,yaw_rad,linear_m_s,angular_rad_s,position_std_m,frame_id`.
   Units must be REP-103 SI. The importer does not ingest raw `.mcap` or `.db3` and does not perform tf2 interpolation. Sample a sufficiently dense trajectory. Record calibrated odometry, localization quality and transform provenance separately.
3. Create a strict `brainsnn.fleet-telemetry.v1` manifest with `csv_sha256`, `map_revision_sha256` (SHA of original `nav2-map.json`), `pgm_sha256`, `coordinate_convention: ROS-REP-103-ENU`, `pose_frame_id: map`, `task`, `source_type: operator-reported-recording`, `learning_consent: true`, `outcome: success`, `reviewed: true`, and robot `{id,radius_m,max_speed_m_s}`. The import receipt explicitly reports **operator-reported**, not authenticated hardware provenance.
4. Supply a second independently generated, spatially aligned reference map with its own PGM, YAML, JSON, hash and physical measurement evidence. The software verifies file integrity and frame-origin equality. **It cannot verify that the operator actually surveyed the site**. Do not label it survey-verified without independent records.
5. Supply a reviewed `brainsnn.follower-profile.v1` JSON `{schema,reviewed:true,robot_id,footprint_radius_m,safety_margin_m,max_speed_m_s}`. The CLI uses `footprint_radius_m+safety_margin_m` for all offline plans. Measure the actual robot body and validate obstacle sensing and stop logic separately.
6. Run the offline import and comparison:

```bash
python -m robotics.world_worker.fleet_campaign \
  --candidate-map /private/reconstruction-nav2 \
  --reference-map /private/measured-nav2-reference \
  --poses-csv /private/teacher-poses.csv \
  --telemetry-manifest /private/teacher-manifest.json \
  --follower-profile /private/follower-reviewed.json \
  --task-count 24 \
  --out /private/new-fleet-evaluation-001
```

## Release gates and outstanding dependencies

- `map.sha256` and CSV source SHA must match exact recorded data; scene map revisions invalidate all old episodes.
- All imported source paths must be reviewed successes, consented for learning and use the explicit `map` frame. Any missing/unknown coverage blocks the map.
- Real robot motion remains **disabled**. Do not derive control, torques or joint actuation from source paths. Static clearance is not a validated controller, dynamic physics or Nav2 localization.
- A target-robot pilot needs real logs, physically measured obstacle/robot sizes, true reference-map alignment, brake/E-stop/human supervision, dynamic obstacle detection, safety procedures, and 20+ actual runs. All are **pending**.
- No checkpoint, imitation model, VLA policy or GPU training job has been produced. Existing GB10/RTX 4090 hardware could be used in a later replay/training phase, but GPU cost and throughput are unmeasured. This offline code uses Python standard library and CPU only.

**Estimated remaining engineering effort:** 2 to 5 days for a vendor-specific log exporter plus localization-frame verification; 3 to 6 days for a bounded Isaac/MuJoCo offline motion replay after physics assets are available; physical field trials, validation and data collection depend on the robot and test facility. These are estimates, not committed schedules or costs.

Primary source conventions: [ROS REP-103](https://reps.openrobotics.org/rep-0103/), [nav_msgs/Odometry](https://github.com/ros2/common_interfaces/blob/rolling/nav_msgs/msg/Odometry.msg), [Nav2 map exporter](https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_map_server/src/map_io.cpp) and [rosbag2/MCAP guide](https://mcap.dev/guides/getting-started/ros-2). Research context: [CEL paper](https://arxiv.org/abs/2610.25736). No CEL code or benchmark is reproduced here.
