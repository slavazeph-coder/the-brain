# One robot sees. Another robot adapts.

The first BrainSNN spatial-intelligence loop, built on what already exists. A camera that walks a site a second time
(robot A's camera; today a phone) is located in the site's as-is scan. It finds what changed and records the change in
the shared World Project for review. It then shows how each robot of a different size has to adapt its route.

| Step | What runs | Built on |
| --- | --- | --- |
| Observe | Each walk frame is located in the as-is reconstruction. A frame that cannot be placed is reported with its reason, never guessed | `locate_photo.py` (visual positioning) |
| Understand | Frame pairs are matched and triangulated. Points on the as-is model measure the registration. What is off the model, gone from it, or hidden behind something plain is classed and grouped on a floor grid | `world_update.py` |
| Remember | The candidates become a proposed update, never applied. A plan of World Project requests records the source, evidence on the current as-is revision, and one proposed revision and change per robot. The plan only applies to the exact scan the walk was compared with | World Projects (#321), `world-update-plan.mjs` |
| Adapt | Each robot's footprint and height are routed on the as-is map and on the proposed map: unchanged, shortened, opened, rerouted, blocked or no route before | `world_update.py` |
| Share | Each adapted route is published as a proposal that applies only after that robot's change is approved, with its longest unseen stretch | World Project review |

## Run it this week, without a robot

1. **As-is scan.** Walk the room with BrainSNN Walk on an iPhone, which records native poses for gravity and metres.
   Reconstruct it the usual way (`colmap-sparse` with the capture bundle). Retain its `reconstruction.json` as the
   source of the project's as-is revision: the review plan is bound to that file.
2. **Change something real.** Move a box, cart or chair: put it in an aisle, or take it away.
3. **Walk it again.** Take a short video, or 4 to 16 photos, along the aisle. Tilt the phone down about 25° so the floor
   where things stand or stood is in view, and keep walking past the change so it is seen from at least two places.
   A phone at chest height does not see the floor within about 1.5 to 2 m of itself.
4. **Run the loop.** Use the COLMAP worker environment (`requirements-colmap.txt`). Pass the reconstruction job folder,
   which holds `colmap-work` and `artifacts/reconstruction.json`:

   ```bash
   python -m robotics.world_worker.world_update --reconstruction <job folder> --request request.json \
     --video walk.mp4 --out update/      # or: --frames a.jpg b.jpg ...
   ```

   ```json
   {"schema": "brainsnn.world-update-request.v1",
    "observer": {"id": "robot-a", "model": "Phone camera standing in for robot A"},
    "robots": [{"id": "robot-b", "model": "Cart AMR", "width_m": 0.7, "depth_m": 0.8, "height_m": 0.75, "margin_m": 0.08}],
    "route": {"start": [0, 0.6], "goal": [0, 3.2]}}
   ```

   Route points are floor coordinates in metres: `across` and `along` from `site_frame.floor_axes_model` in the result.
   Leave `route` out to use the walk's own first and last frames. Optional:
   - `assumed_depth_m` (default 0.5) is how deep an object seen from one side is assumed to be. Raise it for pallets.
   - `min_obstacle_height_m` (default 0.04) is the lowest point counted as an obstacle. Raise it if a noisy capture
     shows the floor as clutter.
5. **Record it for review:** `node examples/world-update-apply.mjs <project-id> update/project-requests.json` with an
   editor key. The plan is refused in two cases:
   - when the project's current as-is revision does not hold the scan the walk was compared with (`--any-baseline` overrides this knowingly);
   - when the same update was already recorded.

   A different named reviewer then confirms the evidence and approves or rejects each robot's change. The proposer
   cannot approve their own change, and approval waits for confirmed evidence.

Outputs in `update/`:
- `world-update.json`: frames, registration, candidates, routes and limits.
- `project-requests.json`: the review plan, bound to the exact bytes of `world-update.json` and of the as-is `reconstruction.json`.
- `world-update.svg`: the plan view.

## How a change is told apart from a gap in the scan

- **On the model:** a walk point within 10 cm of an as-is point is unchanged geometry. These points give the
  registration figures: median and 90th-percentile distance.
- **`added`:** a walk point off the model, where an as-is frame looked straight through that spot to a surface at least
  15 cm further away. The spot was empty then and is occupied now. This is change evidence.
- **`newly_observed`:** a walk point off the model that no as-is frame saw through. This is new coverage, such as the
  lower part of a wall the level as-is frames never saw. It is still an obstacle and still proposed.
- **`removed`:** as-is geometry that a walk frame now looks straight through to a surface at least 15 cm further away,
  and that the walk never saw again. A moved object shows up as one removal and one addition.
- **`occluder`:** a featureless object, such as a plain box, gives the walk no points of its own. It shows up because
  it hides the as-is scene behind it from at least three walk frames, and from at least 75% of the frames that view it.
  In addition, no seen ray crosses that space near the floor. Hidden rays that pass a known change or as-is geometry
  are explained and do not count. The walk cannot tell where along its rays a plain object stands, so the whole hidden
  region is proposed as blocked. The evidence says to walk around it.
- **Assumed depth:** unseen space behind a change, and behind as-is geometry, is treated as occupied up to
  `assumed_depth_m`. The march stops at the first cell where the walk saw the floor or unchanged geometry. A walk that
  sees only an object's front cannot tell its depth, and a route must not clip its back corner. These cells are listed
  separately as `assumed_cells`.
- **Nothing passes under what was not seen:** new geometry blocks every robot unless the walk saw the floor beneath it
  from a camera lower than it. A crate's top strip seen from 1.5 m looks just like a table edge.

## Stress test: 21 rendered scenarios scored against authored truth

`tests/world/world_update_sweep.py` builds each scene, runs the loop and scores the result against the authored geometry.
For each robot, it compares the loop's outcome with a planner run on the true room. It also measures whether every
adapted route keeps the robot's clearance radius from the true obstacles, within one 10 cm cell. The as-is scan is five
level frames, or ten frames ("richer" and the removal cases) with five more tilted 20° down. The walk is four frames
tilted 15° down, unless stated otherwise. Robot A is a 0.45 m square, 0.6 m tall; robot B is 0.7 × 0.8 m, 0.75 m tall.

| Scenario | Placed | Change found (as) | False change | Removal found | Coverage | robot-a | robot-b | Safe |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| crate in the aisle | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| unchanged room | 4/4 | 0/0 | 0 | 0/0 | - | unchanged | unchanged | yes |
| crate beside the route | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | unchanged | unchanged | yes |
| crate near the walker | 4/4 | 1/1 (newly_observed) | 0 | 0/0 | 0.28 | rerouted | rerouted (truth: blocked) | NO |
| small box 0.3 m | 4/4 | 1/1 (newly_observed) | 0 | 0/0 | 1.0 | rerouted | blocked (truth: rerouted) | yes |
| thin pole 0.12 m | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| low step 5 cm | 4/4 | 1/1 (newly_observed) | 0 | 0/0 | 0.98 | rerouted | rerouted | yes |
| overhang 0.70-0.80 m | 4/4 | 1/1 (added) | 2 | 0/0 | 0.18 | blocked (truth: unchanged) | blocked (truth: rerouted) | yes |
| plain grey crate | 4/4 | 1/1 (occluder) | 0 | 0/0 | 1.0 | blocked (truth: rerouted) | blocked (truth: rerouted) | yes |
| dim, noisy, JPEG 70 | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| blurred walk | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| wider lens (f 520) | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| longer lens (f 800) | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| level walk | 4/4 | 1/1 (added) | 0 | 0/0 | 0.98 | rerouted | rerouted | yes |
| two frames | 2/2 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| unchanged, dim and noisy | 4/4 | 0/0 | 0 | 0/0 | - | unchanged | unchanged | yes |
| clutter: three boxes | 4/4 | 3/3 (added, newly_observed) | 0 | 0/0 | 1.0, 1.0, 1.0 | blocked | blocked | yes |
| crate, richer as-is scan | 4/4 | 1/1 (added) | 0 | 0/0 | 1.0 | rerouted | rerouted | yes |
| crate removed | 4/4 | 0/0 | 0 | 1/1 | - | shortened | opened (truth: shortened) | yes |
| crate moved | 4/4 | 1/1 (added) | 0 | 1/1 | 0.93 | rerouted | rerouted | yes |
| crate unchanged | 4/4 | 0/0 | 0 | 0/0 | - | unchanged | no-route-before (truth: unchanged) | yes |

"(truth: …)" means the loop's outcome differed from planning on the true room. "Safe" means every adapted route kept
its clearance from the true obstacles.

**Final run (Nov 25): 20 of 21 safe.**
- **Placement:** every frame was placed within 1.1 mm, and the median registration distance was at most 0.8 cm.
- **Conservative misses:** where the outcome differs from the truth, all but one case is the loop being more cautious
  than the true room requires (`blocked`, `opened`, `no-route-before`). These need a reviewer or a better walk; they do
  not put a robot at risk.
- **The one unsafe row** is the blind zone below.

**What the first run found:** 9 of 21 scenarios were unsafe. A robot would have driven into a small box, a thin pole, a
plain grey crate, a 5 cm step, an overhang, clutter, a crate seen only at eye level, and an as-is crate's unseen back.
In the first four, the object was never detected. The fixes:
- removal and occluder detection;
- the floor-beneath rule;
- assumed depth for as-is geometry;
- a 4 cm obstacle floor (rendered floor noise is 2.4 cm at the 99th percentile).

Two of the misses were partly the fixture, not the loop. The renderer stretched one texture over every box face, and
it had no anti-aliasing, so small or grazing faces turned to noise a camera would not see. Boxes are now textured at a
physical scale and every pixel averages four rays.

**Robustness:** dim, noisy and JPEG-70 frames, blur, a wider or longer lens, a level walk and a two-frame walk all
place every frame and find the crate. Frames are placed within 1 mm; registration median is below 1 cm.

**Still not solved:**
- **Blind zone:** an object close to the walker that neither scan saw. A phone tilted 15° at 1.5 m height does not see
  the floor within about 1.6 m. The loop cannot propose what nobody saw. Each route reports its longest unseen stretch;
  walk past changes and tilt down.
- **Featureless objects** are found but not measured: the whole hidden region is blocked, which can block a goal
  behind it. The robot outcome is then "blocked" where a planner on the true room would reroute.
- **Overhangs** block every robot until the floor beneath is seen from below them. A low robot camera would clear them.
- **Low remnants:** a removed object's base, within 15 cm of the floor the walk now sees, cannot be shown gone. It stays
  in the map with its assumed depth.

## Limits

These are stated in every result:
- **Removals** are found only where the walk looked straight through the old spot to a surface behind it. Anything the
  walk did not look past stays in the map, which is the safe side.
- **Unobserved space.** Cells no frame observed count as free, apart from assumed depth and hidden regions. Each route
  reports `unobserved_fraction` and `longest_unseen_m`.
- **Planning preview only.** This is a 2D grid preview with a circumscribed footprint. It is not a Nav2 run, not
  execution, and not a safety certification.
- **Metres.** They come from the phone's native tracking, not from a tape-checked span. Run the
  [real-room acceptance](sales/site-to-sim-pilot.md#real-room-acceptance-do-this-before-the-first-outreach-email)
  before quoting any accuracy.
- **Not yet a hosted engine.** It runs on the CLI. Hosting it as a worker engine needs a request upload kind.

## Tests

- `tests/world/test_world_update.py` (CI, about 3 minutes):
  - request checks, the planner and ray geometry;
  - the review plan, kept in step with the Node test;
  - rendered walks: crate, unchanged room, an unplaceable frame, an eye-level walk, a plain crate, a moved crate, a
    removed crate, and an unmoved crate.
- `tests/world/world-update-plan.test.mjs`: the plan on the real World Project service. It checks the baseline binding
  and the duplicate refusal, and that only an independent reviewer with confirmed evidence can approve.
- `tests/world/world_update_sweep.py --out <folder>`: the 21-scenario sweep above (about 25 minutes).

## Next

- **A real room.** Run the steps above on a real room and publish the result next to the rendered one.
- **Depth:** iPhone LiDAR depth, or a robot depth camera, would measure featureless objects and the near floor that a
  single camera cannot.
- **Hosted engine:** upload kind `world-update`, source job, and a button in World Builder.
- **Robot camera ingestion:** ROS 2 bag image topics with odometry, replacing the phone, so a robot is robot A.
- **Map output:** write the approved proposed map as a Nav2 map, alongside the existing `nav2-map.pgm` exporter.
