# BrainSNN Walk

`/walk/` is a phone-first, installable web app: walk a space, tap features as you pass them, and get a
map whose accuracy figures say what the phone actually measured. It is modelled on the shape of
field-capture apps (walk → tap → results → export) and reuses the World Builder for 3D.

Everything runs in the browser. Walks live in IndexedDB on the phone (`brainsnn-walks-v1`), and nothing
is uploaded unless the person exports, shares, or chooses **Build the 3D world** and then approves
processing inside World Builder.

## What a walk records

| Data | Source | Notes |
| --- | --- | --- |
| GPS track | `navigator.geolocation.watchPosition`, high accuracy | Each fix keeps the browser's reported horizontal accuracy, which the Geolocation spec defines as a 95% confidence radius in metres. |
| Features | One tap on a type button (or keys 1–8, Space/Enter repeats the last type) | Type, time, the nearest fix within 10 s, compass heading when granted, a JPEG frame from the camera, and the video time. |
| Video | `MediaRecorder` on the rear camera, 2 Mbit/s | Capped at 120 MiB (about 8 minutes). When full, video stops and the walk carries on. |

A feature dropped with no fix in the last 10 s is placed after the walk only if a fix arrives within
10 s of it. Otherwise it keeps no position. Positions are never interpolated or invented.

## The two figures

- **Map position** is the 95th percentile of the walk's per-fix accuracy radii (nearest rank). It is
  withheld, with a reason, when there are fewer than 3 fixes. Indoors there is usually no fix.
- **Shape accuracy** is always **Not measured**. A phone camera walk does not measure shapes or
  distances. The 3D build in World Builder stays scale-unverified until someone checks a known length.

Track length ignores steps shorter than the jitter the two fixes allow (`clamp(0.25 × (accA + accB), 2 m,
10 m)`), so standing still adds nothing. Fixes worse than 50 m stay out of the drawn line and the length,
but still count toward the map-position figure. Measuring between two features reports the distance
± `hypot(accA, accB)`.

## Exports

- **Walk bundle (.zip)**: `walk.json` (`brainsnn.walk.v1`), `walk.geojson`, `walk.gpx`, `features.csv`,
  `README.txt`, `photos/*.jpg`, and optionally `video.mp4`/`video.webm`. The ZIP is stored (uncompressed)
  and written by `walk-zip.mjs`.
- GeoJSON, GPX and CSV individually. CSV cells that start with `= + - @` are prefixed with `'` so a shared
  walk cannot run a spreadsheet formula.

On phones with the Web Share API the file goes to the share sheet. Otherwise it downloads.

**Open a shared walk** reads a bundle read-only. The reader refuses unsafe paths, duplicate names,
encryption, ZIP64, checksum mismatches and entries that inflate past their declared size. It accepts
deflated entries where the browser has `DecompressionStream`. **Keep a copy on this phone** turns a shared
walk into an editable local one.

## Build the 3D world

This button stages the walk's video through the existing same-origin handoff
(`world/capture-handoff.mjs`, 128 MiB, 20-minute expiry). It then opens
`/world/index.html#handoff=<id>`. Reconstruction still needs an explicit worker consent in World Builder.

## Files and serving

- `public/walk/`: `index.html`, `walk.mjs` (screens), `walk-core.mjs` (pure logic), `walk-map.mjs`
  (canvas map), `walk-store.mjs` (IndexedDB), `walk-zip.mjs`, `walk.css`, `manifest.webmanifest`, `sw.js`.
- `server.ts` serves `/walk/` and redirects `/walk` to `/walk/` so relative module URLs resolve.
- The service worker caches the shell as `brainsnn-walk-vN`. Bump `N` whenever the shell changes.

## Tests

- `tests/world/walk-core.test.mjs`: geometry, accuracy figures, gaps, feature placement, exports, ZIP
  round trip and hostile-bundle refusal.
- `tests/world/walk_browser_smoke.py` walks a simulated 58 m route in a real browser, with a fake camera
  and moving emulated GPS. Chromium exercises the camera, video, photos and the World Builder handoff.
  WebKit deliberately exercises the camera-refused path.

## Not in this version

- **LiDAR, ARKit tracking and on-device Gaussian splats.** iPhone Safari gives web pages no LiDAR depth or
  AR tracking, so these need a native iOS capture app. Such an app would also produce the existing
  `brainsnn.capture.v1` bundle (see `world-native-capture.md`).
- GeoPackage, COPC and orthophoto exports.
- Survey-control pins.
- A basemap. The map draws in local metres with a scale bar and north arrow, and no tiles are fetched.
