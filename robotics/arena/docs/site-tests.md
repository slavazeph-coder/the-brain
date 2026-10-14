# Test your space

Open `/arena/#playground?robot=g1&model=groot&task=Supported+reach&seed=42&view=site`.
The existing Arena tab also has a prominent **Test your space** entry. Robot,
model, task and seed are preserved when switching between the two views.

## Working browser flow

1. Try the clearly labelled sample floor, or choose **Capture**.
2. Import a BrainSNN scene or supported RoomPlan CapturedRoom JSON. Local photos
   and videos are capture references; selecting them does not reconstruct a room.
   A self-contained GLB or supported ASCII USDZ supplies appearance only.
3. Review the floor, obstacles, start, goal and measured scale. RoomPlan binary
   USDZ is not supported by the installed browser parser; use CapturedRoom JSON
   for geometry and convert visual geometry to GLB when needed.
4. Choose a mobile planning envelope, verify its assumptions and calculate a
   route. The separate generic cleaning envelope enables floor coverage.
5. Replay the route, change an obstacle or destination, and run again. Export
   the reviewed scenario and a report that states the calculation assumptions.

The planner evaluates the reviewed floor polygon and obstacle geometry, using
a circular envelope that contains the robot and a 5 cm margin. Edges are checked
for collisions, including thin walls. Coverage does not pass through walls.
Grid and computation limits are bounded, and planning runs in a Web Worker so
large maps do not block the interface. Conservative geometry can reject narrow
passages; travel duration assumes constant speed and excludes turn time.

## Real capture processing

The optional [private reconstruction worker](site-scan-worker.md) accepts a
phone walkthrough or a ZIP of overlapping photographs. A real COLMAP pipeline
extracts camera positions and sparse geometry, which can be opened in the
browser as a point cloud. The optional, operator-configured visual adapter can
produce additional dense reconstruction artifacts for an external simulator.

Reconstruction is not installed or provisioned by the website. The authenticated
worker must be set up and validated on the operator's computer first. Missing
dependencies remain unavailable, rather than producing a synthetic completion.
Worker credentials remain in browser memory. Captures go directly to that
worker only after the user explicitly starts reconstruction. Private captures
are never deployed in the public Arena directory.

## Meaning of a result

This release is a **geometric planning estimate**. It does not execute the
selected GR00T or other learned policy, simulate humanoid balance, or measure
cleaning quality. A moving proxy in the browser is a replay of the computed
path, not a robot dynamics result. The existing Arena runtime remains a separate
interface for actual physics and compatible policy workers.

An imported visual asset does not silently become collision geometry or a
policy camera observation. A reconstruction requires metric scale, orientation
and geometry review. Actual deployment readiness requires testing the same
site and configuration on the physical robot, then comparing observed results.

## Source and verification

- Browser entry and interface: `brainsnn-r3f-app/public/arena/site-workspace.js`.
- Planner and import contract: `brainsnn-r3f-app/public/arena/site-core.js`.
- Deferred Three.js source: `brainsnn-r3f-app/src/arena/site-renderer.js`.
- Build its committed standalone bundle with `npm run build` in the app or
  `node scripts/build-site-renderer.mjs`. It is excluded from the homepage graph.
- Scan service: `robotics/arena/workers/site_scan/`.
- Tests: `node robotics/arena/scripts/check-arena.cjs` and the site scan Python
  tests documented in the worker guide.

CPU contract tests do not establish successful CUDA reconstruction or rendering
on a particular GPU. Verify those with a real capture on the intended worker.
