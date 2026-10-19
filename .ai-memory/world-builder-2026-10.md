---
type: project
description: World Builder flagship development, real browser inference and reconstruction evidence; full public real-to-sim release still open
---

# World Builder — October 19, 2026

- Branch `feature/world-builder-flagship`, PR198; working tree `/Users/slavaz/the-brain-world-builder`. Preserve other branches/worktrees. No merge or deployment from this session.
- Root and `/world` use the cyan/violet flagship workspace. Classic remains `/?classic=1`, Arena `/arena/`. Exact requested hero leads; API guide `/world/api.html` describes private operator API only.
- Photo→Depth Anything V2 Small q8→local explorable point cloud works in actual HTTP Chromium and WebKit. Source pixels never uploaded on this path. Model/runtime downloads require product consent. Pin `onnx-community/depth-anything-v2-small@4472b7362082ad9968fee890ca0f1e5aca36b93d`, Transformers.js3.8.1, ONNX1.22.0-dev.20250409-89f8206ba4.
- **WebKit fix:** default JSEP/Asyncify WASM crashed during inference. Explicit matching plain-WASM mjs/binary paths fix observed failure (ORT#26827). Full cancel/retry/source comparison and download-only network checks pass. Phone-sized WebKit is not physical iPhone evidence.
- Local PLY/SPLAT viewer distinguishes points from Gaussian parameters, bounds input64MiB / display100kpoints, supports touch/keyboard. GLB50MiB via existing same-site Arena renderer with visualOnly option, no authored robot/floor. SPZ/KSPLAT conversion required.
- COLMAP CPU adapter really reconstructed11ETH Fountain photos:6041points,11cameras; decoded photograph-sequence MP4:6225points. Worker API tests and full browser→upload→reconstruct→signed ticket→viewer→binary export pass. The MP4 is a test fixture, not a physical phone walkthrough.
- RoomPlan/Arena import reuses existing Arena parser and preserves original concave/rotated floor polygon. Review flags reset. Planner blocks outside-floor and unknown space; exports preserve polygon; USDA rejects unsupported nonrectangles.
- MapAnything Apache adapter pins source,DINOsource,model/config hashes, blocks inference-time network and treats all geometry as unverified. CPU conversion tests do not prove GPU execution. Current staging/receipts in `docs/world-reconstruction-validation.md`; recheck before claims.
- Test entrypoints: `tests/world/*.test.mjs`, `test_worker.py`, `browser_smoke.py`, `visual-browser-smoke.mjs`, `worker_browser_smoke.py`. Actual screenshots/proofs under ignored `output/playwright/world/`.
- Current full requirement/remaining gates: `docs/world-studio-implementation.md`, original `docs/world-builder-flagship.md`. Outstanding dense GPU and generative model qualification, public tenant/storage/queue budgets, physical iPhone capture, geometry extraction/scale review, video LLM provenance, signed reports, measured gym+cleaner validation and deployment. Do not mark full goal complete from local previews.
