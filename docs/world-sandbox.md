# One World Builder sandbox

World Builder now hosts the Green Gardens street scene inside the existing
`brainsnn-r3f-app/public/world/` document. Capture, Edit, Simulate, Evidence and
Export use a shared toolbar. The scene selector chooses the current planning
map or the geographic street prototype. No second hosted application, account,
processing service or nested street iframe is required.

## Open and use

The native scene route is:

`/world/index.html?sandbox=street&scene=green-gardens#workspace`

The home and `/world/` React shell also forward supported `sandbox`, `scene`
and `tool` parameters. **Explore the street block** opens the same native scene.
The default page still starts with the existing authored planning map.

1. Select an object in the canvas or outliner to inspect its stable ID,
   geometry, parent, collision intent and source.
2. Select **Move barrier** to edit its position, dimensions or rotation. Each
   accepted edit updates the visual scene and navigation collision together.
3. Run the route, walk the scene, or inspect context, collider and source layers.
4. Open **Capture** to add local sources or use the existing processing worker.
   **Return to scene** keeps the street's current objects and edits.
5. Export current GLB, USD or JSON. JSON can restore edits for the same baseline
   version. The ZIP is explicitly the original baseline package.

The scene link identifies a baseline and tool. It does not transfer local edits,
source media, processing credentials or a worker job. Export JSON to move edits
between devices. Street edits are saved locally under the existing versioned
`brainsnn.street-studio.edits.v1` key.

## Shared interface, preserved scene contracts

`sandbox-session.mjs` holds only navigation descriptors and stale-operation
tokens. `sandbox-ui.mjs` delegates to the current workspace. The existing
capture, processing, calibration, BIM, Omniverse and map modules retain their
state and source-bound review rules.

The street controller is lazy loaded from `street/workspace.mjs`. Native shadow
DOM scopes its styles and identifiers. It owns its renderer, scene graph,
navigation and edit/export state. Switching away pauses its simulation and
rendering; disposal aborts loading and listeners and releases resources.

The street's 272 objects, terrain and six courtyard holes do **not** pass through
the older `brainsnn.world.v1` indoor-map normalizer, whose bounded planar model
cannot represent them faithfully. Captures are not automatically registered to
the street reference. Compiled capture models continue to use their existing
checked scene reviewer. A background reconstruction can complete without
switching away from the street or opening a modal over it.

## Sources and limits

The scene combines City of Toronto 2025 massing reference geometry, a ground
surface interpreted from 179,636 classified 2023 LiDAR returns, and explicitly
authored facade, window, door, paving and prop detail. The original capture video
and private frame thumbnails are not in the public package. Source records and
attribution are under `public/world/street/assets/reference/`; licensing and
coordinate details are in the street README and exported manifest.

Browser execution is clearance-aware **kinematic navigation**. It does not run
forces, contact dynamics, robot sensors or learned policies. Current USD carries
collision and rigid-body intent, with assumed physical parameters. No Isaac Sim,
Unity or Unreal import/contact qualification is asserted. Scale, source dates,
authored assumptions and lack of video registration remain visible in the UI
and exports.

## Build and verification

`npm run build` bundles the street renderer separately through
`scripts/build-street-renderer.mjs`; it does not enter the homepage Vite graph.
The component uses the app's locked Three.js dependency and has a Canvas2D
compatibility renderer when WebGL is unavailable. There is no runtime CDN.

`npm run test:world` includes navigation, stale mount, capture-return, lifecycle,
atomic edit, actual-scene route and USD export regressions. The production
browser gate runs `tests/world/street_browser_smoke.py` against the existing
Express service in Chromium and WebKit, on desktop and phone-sized viewports.
It checks real template loading, source handoff, retained edits, tool sync,
single-instance lifecycle and downloaded JSON bytes.

The service worker version changes with the shell. New small shell modules are
cached for offline startup; the street payload loads and caches only when used.
The normal GitHub CI and Railway website release path applies. The private
reconstruction worker's deployment branch and configuration are unchanged.
