---
type: project
description: Source-bound local equipment knowledge, sourced spares/issues and authored motion on World Builder components
---

`/world/twin.html` and the compiled-scene BIM workflow share `operational-twin-ui.mjs`. The overlay is local/session-only; export JSON to retain it. Exact scene byte hash, component source/content hashes and revision prevent stale overlays. Stable IDs join IFC Pset_BrainSNN.ComponentId and Rhino componentId without modifying existing exports.

Plain-text documents have explicit revisions and SHA-256 digests. Answers are local keyword-retrieved exact excerpts, not language-model instructions. Sourced spares require a linked document and locator. Dependency links and issue status are operator authored. Revolute/prismatic preview uses rest-world matrices and carries assembly descendants; walls/floors cannot join moving assemblies. It never changes original geometry, metric evidence or robot maps. No dynamics, collision checks or physically measured mechanism claims.

The crane fixture is authored software test data, including the invented spare and issue. Treedis TAI reference post `https://lnkd.in/p/gQ2N-v2v` resolves to Omer Shamay's Nov 11 crane demonstration; its counts and turnaround belong to that company report, not BrainSNN.

Build `scripts/build-twin-renderer.mjs` in npm build/predev. WebGL is deferred; a software SVG proxy view provides the same source and joint transforms without WebGL. CPU contract tests: `tests/world/operational-twin.test.mjs`. Real HTTP UI tests: `tests/world/operational_twin_browser_smoke.py`; CI runs Chromium and WebKit with explicitly authored fixtures. A real machine/manual and independently measured joint poses remain necessary before robotics/dynamics qualification.
