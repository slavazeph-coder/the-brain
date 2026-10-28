# Green Gardens scene workspace

Native component inside BrainSNN World Builder. The source editor, browser
navigation and current exports share one scene instance. The component has no
iframe, external processing account, remote upload or top-level navigation.

## Integration

Lazy-import `./street/workspace.mjs` and call:

```js
const workspace = await mountStreetWorkspace(container, {
  onStatus(message, error) {},
  onChange(state) {},
  onToolChange(tool) {}, // internal tabs/dialogs; parent setTool stays silent
  signal, // optional AbortSignal, cancels loading and disposes a mounted view
});
workspace.setActive(true); // pauses simulation and renderer when false
workspace.setTool('edit'); // edit | simulate | evidence | export
workspace.getState();
workspace.getManifest();
await workspace.exportFile('glb'); // glb | usd | json
workspace.dispose();
```

Mount once and switch activity when moving between workspace tools. Internal
Objects/Evidence navigation and export-dialog transitions call `onToolChange`.
This callback only reports state: update the parent toolbar without reactivating
the scene. Parent `setTool` calls are silent, and closing Export restores the
previous edit/evidence/simulate tool. Hiding the workspace closes Export silently. Capture
files and worker credentials stay with the parent World Builder. Mounting does
not align an uploaded capture to this independent geographic scene. Keyboard
walking and search shortcuts require focus inside the component. The factory
cleans failed mounts so the same container can be retried. Dispose aborts
listeners, cancels animation, releases GPU/canvas assets and revokes downloads.

Scene edits are stored on this device under `brainsnn.street-studio.edits.v1`,
with scene version checks. JSON export/import makes them portable. A hidden
visual object still blocks browser navigation and retains collision in USD.
GLB excludes individually hidden visuals. View-layer toggles do not remove
objects from an export. Dynamic preview actors and editor overlays are excluded.

## Geometry and interpretation

The baseline contains 272 named objects, 23,732 triangles, 168 municipal forms
and six preserved courtyard holes. Three buildings have authored roofs,
facades, 65 windows and 13 decorative doors. These details are assumptions;
doors do not create unobserved interiors.

The ground is a 2 m grid interpreted from 179,636 classified 2023 ground
returns. Buildings use municipal footprint/height reference data. No current
as-built, video alignment or survey accuracy is asserted. The public bundle
contains no original capture video or private frame thumbnails.

Scene coordinates use metres, Y up, X grid east and Z negative grid north,
with the EPSG:2958 origin and CGVD2013 height offset in the manifest.

## Navigation and interchange

Browser execution is `kinematic-navigation`, using A* and continuous swept
circle clearance against the actual polygon footprints, holes, steps, trunks
and movable barrier. Terrain supplies actor height and configured slope and
step limits. This is geometric motion, not a force/contact or sensor simulator.

Current USD includes the actual meshes, semantic/source labels, static mesh
collision and a configured 20 kg barrier body. Physical coefficients and robot
settings are assumptions. GLB carries visual objects, IDs and provenance.
No Isaac Sim, Unity or Unreal import/contact qualification is claimed. The
baseline ZIP includes original geometry, source records and generation tools.

## Development

Renderer source: `src/world/street/{scene-view,software-view}.mjs`. Build it with
`node scripts/build-street-renderer.mjs` from `brainsnn-r3f-app`. Three.js is
bundled from the application's pinned dependency lockfile; no runtime CDN is
needed. The Canvas2D compatibility renderer uses the same geometry and object
state when WebGL is unavailable.

## Sources and licences

Contains information licensed under the **Open Government Licence – Toronto**:
[City of Toronto 3D Massing](https://open.toronto.ca/dataset/3d-massing/), 2025
release; [licence](https://open.toronto.ca/open-data-licence/).

Contains information licensed under the **Open Government Licence – Canada**:
TRCA GTA_2023 LiDAR, distributed by Natural Resources Canada CanElevation;
[licence](https://open.canada.ca/en/open-government-licence-canada). Exact source
URLs, dates and interpretation details are in `assets/reference/`.

No Google imagery or photogrammetry was extracted. The map pin is an area
anchor, not a solved source-camera pose.
