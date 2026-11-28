# One robot sees. Another robot adapts. (Nov 25)

Owner direction: one company (XIO AI is the customer platform; BrainSNN is the spatial-intelligence engine); extend the
#321 World Projects foundation, no new backend. First milestone: "One robot sees. Another robot adapts", using recorded
observations first. No robot is available, so a phone stands in for robot A's camera and robots B and on are
footprints.

- **Code:**
  - `robotics/world_worker/world_update.py` (CLI: `--reconstruction --request --frames|--video --out`).
  - `public/world/world-update-plan.mjs` (applies `project-requests.json` with the projects SDK).
  - `examples/world-update-apply.mjs`.
  - Docs: `docs/world-update-loop.md`.
- **Pipeline:**
  1. Locate walk frames with `locate_photo.locate`. `features()` was factored out of it with no behaviour change.
  2. Triangulate pairs with DLT and keep points with ≤2 px reprojection and ≥2° parallax.
  3. Classify each point: on the model (≤10 cm), `added` (an as-is frame saw through the spot to a surface ≥15 cm
     further away), or `newly_observed`.
  4. Group points on a 10 cm floor grid.
  5. Assume unseen space behind a change, up to `assumed_depth_m` (0.5), is occupied. Without this, the cart's route
     clipped the crate's unseen back corner.
  6. Run per-robot A* on the as-is map and on the proposed map.
- **#321 plan:**
  - Steps: addSource, then evidence on the as-is revision, then a proposed revision and a change per robot.
  - It is never applied. A different named reviewer must approve, and approval waits for confirmed evidence.
  - Proven against the real service in `tests/world/world-update-plan.test.mjs`.
- **Frame gotcha:** the aligned reconstruction is in `arkit_world_to_output_basis` (diag(1,-1,-1)) coordinates, so
  model y is DOWN. Up = basis @ [0,1,0].
- **Measured (rendered room only):**
  - 4/4 frames located within 1 mm; registration median 7.5 mm.
  - The crate is found across −0.89..0.29 m (truth −0.9..0.3).
  - Both robots reroute; the control walk shows no change; an 8-frame H.264 video works.
- **Not done:**
  - A real room.
  - Removals: something moved away stays in the map.
  - A hosted engine (needs a `world-update` upload kind).
  - ROS bag ingestion and Nav2 map output of the approved state.
- **Open:** what N49P's criticism says. The owner never pasted it.

## Deeper test round (Nov 25, "Do deeper to test and improve")

- **Sweep:** `tests/world/world_update_sweep.py` runs 21 rendered scenarios and scores them against authored truth.
  - Truth planner on the real geometry; route clearance against true solids.
  - Output: `sweep.json` and `sweep.md`. It is slow, so CI runs the decisive cases only.
- **First sweep: 9/21 unsafe.** Robots would have driven into:
  - a small box, a thin pole and a plain grey crate
  - a 5 cm step
  - a crate seen only at eye level (the robot "passed under" its seen top strip)
  - an as-is crate's unseen back
  - a crate in the near blind zone
  - clutter
  - an overhang
- **Fixes:**
  - **Removal detection:** the walk sees through as-is geometry. Removals give a new `shortened` outcome, and a moved
    object shows up as one removal plus one addition.
  - **Floor-beneath rule:** new geometry blocks every robot unless the floor beneath it was seen from a lower camera.
  - **Assumed depth for as-is geometry too.**
  - **Occluder detection for plain objects:** cells hidden by ≥75% of viewing frames (≥2), cleared only by near-floor
    rays, with hidden rays cut at known changes. The whole hidden region is blocked.
  - **Obstacle floor:** lowered from 8 cm to 4 cm (request-adjustable); rendered floor noise is 2.4 cm at p99.
  - **Unseen route stretches:** reported per route (`longest_unseen_m`).
- **Renderer artifacts fixed in the fixture, not the loop:** physical texture scale for boxes and 2×2 supersampling.
  Grazing faces had aliased to noise.
- **Plan hardening:**
  - `as_is_scan` binds the plan to the reconstruction.json SHA-256. The applier refuses a different baseline unless
    `baseline: 'any'`.
  - The applier refuses re-recording the same update.
- **Still failing:** an object in the walker's near blind zone that neither scan saw. A phone tilted 15° at 1.5 m does
  not see the floor within about 1.6 m. That needs capture guidance or depth sensing, not code.
- **Final sweep (all fixes): 20/21 safe.** The one unsafe row is the near-walker blind zone.
  - Six outcomes are more cautious than the truth (blocked, opened, no-route-before), never riskier.
  - Frames were placed within 1.1 mm; median registration was at most 0.8 cm.
  - The table is in `docs/world-update-loop.md`.
- **Tests:** `test_world_update.py` has 35 tests (about 3 min in CI). `world-update-plan.test.mjs` has 4 against the
  real service.
- **Shipped:** merged in #340 on Nov 28 (see "Shipped" below).

## Developer platform (Nov 27, "dev platform for API side and client side, playful and easy")

- **Where:** `/platform/`, built from `brainsnn-r3f-app/public/platform/*`, served like `/walk`. Docs:
  `docs/developer-platform.md`.
- **Views:** home (sandbox, checklist, planner toy, quickstart), API explorer (39 operations, prefilled bodies,
  curl/JS/Python), projects with a plain-language client review page, keys, usage, processing, docs.
- **Sandbox:** an in-browser World Projects API used through the SDK's `fetchImpl`.
  `tests/world/platform-sandbox.test.mjs` holds it to the real handlers step by step, including 15 refusals.
- **Links:** the front door API door and the nav "API" now go to `/platform/`. `browser_smoke.py`, `routeMeta.js` and
  its tests, and `layers_browser_smoke.py` are updated.
- **Verified locally:**
  - the browser smoke (live key + sandbox, phone, axe on 6 pages);
  - all 1,128 app unit tests;
  - a production build that serves `/platform/`;
  - the layers and front-door checks on the production build.
- **Shipped:** merged in #340 on Nov 28.

## Calm homepage (Nov 27, owner pasted nuancelabs.ai)

- **What changed:** the homepage was rebuilt in a calm, light register (`.fd-calm` in `front-door.css`), with a
  Newsreader display face (`@fontsource/newsreader`, self-hosted).
- **Sections:** formats strip, the five-step loop, a dark band with an animated reroute, the doors, and a closing wash.
- **Unchanged (pinned by tests):** headline, doors and nav.
- **Network:** environment hosts added with the owner's approval: nuancelabs.ai, www., platform., and
  framerusercontent.com.
- **Rest of the site:** still dark. A light theme for World Builder and Walk is the owner's call.

## Shipped (Nov 28): #340 merged as bfde750a

- **What went to main:** the loop, `/platform/`, the calm homepage and the pilot kit. Codex reviewed every push;
  about 17 findings were fixed, each with a test that fails on the old code. Two were safety bugs in the loop:
  - corner cutting: an "unchanged" route that now clips a new obstacle, and simplified shortcuts slipping between
    blocked cells. `segment_steps`, `line_cells` and `path_free` fix both;
  - candidates depended on the robots asked about. A crate seen only above a short robot produced nothing.
    Candidates now go up to `candidate_ceiling_m` (5 m).
- **Reporting fix:** unseen-space metrics are measured along the published segments (`route_visibility`).
- **Sweep after all fixes:** the table is identical, 20 of 21 safe. If the widened band is also used for
  `low_seen`, wall tops stop the assumed-depth march and coverage drops. Keep `low_seen` on the robot band.
- **CI lessons:**
  - The World Projects workflow shares one Postgres across steps. A test that counts projects or keys needs its own
    `tenantId` (`startProjectPlatformFixture({ tenantId })`).
  - Browser steps must wait for the new result, not for an element the previous result already shows. Reproduce
    such races by delaying `page.route('**/api/world/v1/**')` by about 400 ms.
- **Owner pushes to this branch too:** #341 added tests. On a rejected push, fetch and merge; never force.
- **Network:** Node's built-in `fetch` in this sandbox needs `NODE_USE_ENV_PROXY=1` to reach the internet.
- **Codex cadence:** each push draws about two yellow findings, mostly sandbox parity. Rule used: fix safety bugs and
  red CI before merging; defer the rest to a follow-up PR.
