---
type: project
description: Minimal GT3 page with exact self-hosted geometry and actual WebGL acceptance
---

User priority: minimal interface and a genuinely working car, not more controls or
another static poster. Keep the canonical /sponsor/gt3/ path on www.brainsnn.com.
The old Sketchfab viewer, SDK and mocked provider tests are replaced by the exact
Black Snow Porsche geometry in a same-origin GLB and Three.js bundle. Attribution
and CC-BY-4.0 licence stay visible. Pinned build-time downloads have Git blob hash
verification; no protected model endpoint is used. No runtime third-party call.

The model starts automatically. One placement select and one proposal button.
Local brand/decal tools and detailed commercial information are collapsed.
Preserve the existing non-binding proposal API, signed sessions/CSRF, private
SQLite, owner controls, funding assumptions and disabled payments. The homepage,
robot sponsor studio, /lab, DNS and Railway resource settings are out of scope.

Rendering is demand-driven: controls update directly with pointer input, then one
scheduled render. No inertial frame backlog or constant turntable. Pixel ratio
is capped at 1.25, same-material draw geometry merged, and negative determinant
transforms have their triangle winding corrected (important for the wheels).
Visibility changes pause work; no fake ready state before a real render.

Acceptance uses actual GLB geometry and Three WebGL, not mocked model responses:
rendered triangle count, before/after pointer drag and camera changes, local
surface decals, desktop/mobile layouts, failure recovery, and actual isolated
proposal persistence. The live acceptance workflow performs only reads and
requires real rendered geometry on the published host. Chromium with software
WebGL proves functioning rendering, not physical iPhone frame rate. Inspect
screenshots and reports rather than inferring model success from a green build.
