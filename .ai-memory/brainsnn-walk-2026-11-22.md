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
