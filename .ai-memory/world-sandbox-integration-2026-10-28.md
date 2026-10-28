---
type: project
description: Owner-requested native Street Studio integration into the production World Builder sandbox
---

# World Builder shared sandbox — October 28, 2026

Owner requested: “Build this into brainsnn.com. Perhaps make all things happen
in one sandbox.” The Street Studio prototype source was recovered from its
existing Site commit d695e50446587c686e4db497abeeb49849e60666. Integration is in
the production `brainsnn-r3f-app`, based on main 9db39cb, not the older UI folder.

The existing World Builder document now has one shared Capture / Edit /
Simulate / Evidence / Export toolbar and a scene selector. The Green Gardens
scene mounts natively in an open shadow root; it does not add another iframe.
The existing outer React WorldHome shell remains and forwards safe scene/tool
query choices. Direct route: `/world/index.html?sandbox=street&scene=green-gardens`.

Street geometry stays in its full object schema. Do not route it through the
80×80 m / 128-object indoor planar normalizer: that loses terrain and courtyard
holes. Capture and worker client state stay with the parent. Switching scenes
pauses render/navigation and retains local edits; asynchronous capture
completion cannot replace an active street or open its model-review modal.
Captures are not registered to the municipal scene merely by sharing a session.

Public assets include 272 objects and 23,732 triangles, municipal/LiDAR source
records and baseline GLB/USD/ZIP. Original phone media and frame thumbnails are
omitted. Current exports preserve stable IDs and source labels; hidden visuals
retain browser collision and USD collision. Scene links omit media, edits and
credentials. The scene uses the existing local edit key and same-version JSON
restoration.

Keep the distinction between kinematic browser navigation and engine dynamics.
No physical, Isaac, Unity or Unreal validation is claimed. Source geometry,
interpreted terrain and authored detail remain labelled. Full workflow and
verification details: `docs/world-sandbox.md`.

Initial local full gates passed 214 World JS tests, 1,093 app tests and 73
analysis tests, typecheck and production build. Browser QA through the actual
production server observed 272 objects, barrier dimension change, Capture →
return preserving edits, moving route and prepared JSON export. New CI smoke
covers Chromium/WebKit desktop/phone and real JSON download. Recheck the exact
release head's CI and Railway status before describing the integration as live.

The local memory-sync helper is absent; this note is committed with the feature.
Do not change the private worker's `deploy/world-worker-20261027` root Railway
configuration. Website service follows main and waits for checks.
