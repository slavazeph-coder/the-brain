---
type: project
description: BrainSNN Walk — phone-first /walk/ PWA modelled on myDAR's walk → tap → results → export flow
---

# BrainSNN Walk — 2026-11-22

The owner shared a LinkedIn post about myDAR (Morton Analytics; iOS 26 native, LiDAR iPhone, on-device COPC,
DTM, orthophoto, GeoPackage and Gaussian splat; Base $9.99/mo, Pro $29.99/mo). They asked to "clean up BrainSNN
and make it into an app like this".

## Advice given

- An exact copy needs native Swift/ARKit. Web pages on iPhone get no LiDAR or AR tracking. The container
  cannot build or run iOS code, so that work needs a Mac with Xcode and an Apple Developer account.
- Competing with myDAR head-on in GIS surveying is weak positioning. BrainSNN's distinct angle is
  walk → robot-ready world, using the existing World Builder pipeline.
- Nothing was deleted from the site. Cutting tools is a product decision left to the owner.

## What shipped (branch claude/happy-lamport-dsfa48, PR #333)

- The `/walk/` PWA: walks list, capture screen, results screen and read-only shared viewer.
  - Capture: camera, GPS, compass, wake lock, eight 64 px feature buttons, keys 1–8.
  - Results: 2D map in local metres, plus "Shape accuracy: Not measured" and "Map position ±X m (95% of fixes)".
  - Measuring between features gives ± hypot of both fixes' accuracy.
  - Exports: ZIP bundle, GeoJSON, GPX and CSV.
  - "Build the 3D world" hands the video to World Builder through capture-handoff.
- `server.ts` routes `/walk` → `/walk/`.
- The World Builder playground shortcuts link to Walk with `target="_top"`, because the homepage renders World Builder in an iframe.
- World SW cache is `world-shell-walk-studio-v55` (after merging main's unified playground).
- Tests: `walk-core.test.mjs` (13) and `walk_browser_smoke.py`. The smoke passed in Chromium locally. WebKit
  runs in CI on the camera-refused path. Docs are in `docs/brainsnn-walk.md`.

## Gotchas found

- `font: 700 17px/1.2 inherit` is invalid CSS and silently dropped every button to UA defaults.
  Use `font-family: inherit` plus separate properties.
- Author `display:` rules override `[hidden]`. Walk uses a global `[hidden]{display:none!important}`.

## Open

- Production deploy waits on the paused PR #333 merge.
- Native iOS LiDAR capture app producing `brainsnn.capture.v1`.
- GeoPackage export (needs sql.js).
- Pricing and paywall: none exists.

## Nov 23 — "go deeper, fix all"

- **GeoPackage export** (`walk-gpkg.mjs`): OGC GeoPackage 1.4, written in the browser with vendored sql.js 1.13.0
  (`public/walk/vendor`, MIT, sha256 recorded).
  - `track` LineString and `features` Point layers, plus a `walk_record` attributes table holding the full
    validated walk.
  - A `.gpkg` alone reopens read-only. GDAL 3.9.1 opened the browser-made file locally.
- **Surveyed marks**: `pinWalk()` shifts the walk by the marks' mean offset.
  - One mark reads "Unchecked".
  - Two or more marks state the largest leave-one-out miss.
  - `positionStatement()` is the single source of that statement for the UI and every export.
- **Map**: pinch, wheel and drag zoom, "Fit walk", and double tap.
- **CI root causes fixed**:
  - `camera-tour-video.mjs` capped per-frame advance (stall slows instead of skips; empty-video flake since 19 Nov).
  - `alive()` ESRCH race in `test_reconstruction_comparison.py`.
  - The `#provenance` inner_text reads in 7 smokes, collapsed on phones since #337.
- **Build**: `build-movement-pose.mjs` falls back from kaggle.com to `MOVENET_MIRROR`, then to brainsnn.com, with
  pinned hashes. The full `npm run build` passes here (Node fetch needs `NODE_USE_ENV_PROXY=1` in this sandbox only).
- **Local verification**:
  - `tests/world/requirements-ci.txt` installs fine in the scratch venv.
  - native capture, real-to-sim, site processing and scene smokes pass locally.
