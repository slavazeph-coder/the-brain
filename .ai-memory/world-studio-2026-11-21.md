---
type: project
description: World Builder studio — one sticky bar for every tool and an in-place workbench for the separate tool pages
---

# World Builder studio — 2026-11-21

Owner asked for heavy visual improvement so the playground World Builder is all in
one place. Audit first: the playground was section 5 of a ~7,600 px page with five
overlapping menus, and 12 tools (10 World pages, the API guide and the Arena)
opened in new tabs. The fix is structural first, visual second.

- `public/world/studio.mjs` + `studio.css`. A sticky studio bar under the hero:
  Your world (mirrors `#workspace-project-name`), six chapters with short plain
  names and icons, and Find a tool. Data comes from `showcase-features.mjs`, so
  the bar and showcase never diverge. The bar stays one row at 1440 px (counts
  show from 1601 px), scrolls sideways on phones, and the panel opens below the
  bar after `stickBar()` scrolls it to its stuck position.
- Workbench: `#studio-workbench` iframe for `/world/*.html` and `/arena/index.html`
  (same origin, no frame restrictions). A plain click on a showcase standalone
  card opens it here; the card keeps `target=_blank` for modified clicks. World
  pages hide their site header via `siteHeader()`; the Arena keeps its own nav.
  A settling window keeps the workbench header in view while the frame's own
  anchor navigation would scroll the parent; any user input ends it.
- `showcase.mjs` exposes `openInPlace(feature)` and accepts `openPage`.
- Visual pass: compact hero, studio card language for Make it yours (4 × 2),
  showcase cards and the workspace frame. Contrast-mode rules stay authoritative
  (`html:not([data-contrast=more])` guards). No studio text under 13 px; all bar
  targets ≥ 44 px.
- Offline shell `world-shell-studio-v45`.
- Checks: `studio.test.mjs`, `studio_browser_smoke.py` (CI step after the
  showcase), updated `world_showcase_browser_smoke.py` (standalone cards open the
  workbench). Local Chromium: studio, showcase, browser, playground help, robot
  setup, what-if, scan workshop, stereo depth and open4dgs smokes pass.
  `splat_lamp_browser_smoke.py` fails identically on a clean checkout here
  (software-renderer pixel equality); WebKit is not installed in the Claude
  container, so GitHub CI decides WebKit.
