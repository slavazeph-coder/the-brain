---
type: project
description: World Engine first real video-to-3D flow — pycolmap CPU backend, visitor tickets, /scan upload and /world viewer, measured results
---

# World Engine: real video → 3D world — 21 October 2026

Owner correction: "we strolled away from what we are actually building — Turn your videos into 3D worlds." The Reachy Mini motion work (branch `claude/reachy-motion-arena`) is parked as a side experiment; the World Engine reconstruction flow is the product.

## What now works (branch `claude/world-engine-reconstruction`)

- Worker `robotics/arena/workers/site_scan`: `BRAIN_SITE_COLMAP=pycolmap` runs CPU COLMAP 4.2.1 from the pycolmap wheel via `colmap_cli.py` (no source build). No video upscaling; single shared camera for video; sequential matching, then all-pairs + remap if < 80 % of frames align. New `cameras.json` (camera centres/forward/down). Visitor access: website-signed single-use tickets (`BRAIN_SITE_TICKET_SECRET`) and per-scan access keys (`Authorization: Scan`), oldest finished visitor scan recycled at the job limit.
- Website: `GET /api/world/status`, `POST /api/world/ticket` (6/hour/IP, `WORLD_WORKER_URL`, `WORLD_TICKET_SECRET`). `/scan` "Build my 3D world" uploads straight to the worker (video, or 8–120 photos zipped in the browser) with progress; `/world/<id>#k=<key>` shows progress, then a three.js point view uprighted from the camera path, "Walk the path" first-person fly-through, stats, PLY/JSON downloads, private-link copy and delete. Key stays in the fragment and localStorage; brainsnn.com never sees the video.

## Measured (4-vCPU container, no GPU, Mip-NeRF 360 room as a 62 s video, real browser)

120/120 frames aligned, 15,020 points, 4 min 17 s end to end (upload 0.8 s). Sequential-only first version: 61/120 in a split walk. 45-photo ZIP: 29 s, 24/45 aligned (sparse sampling). Tests: 26 worker Python tests, 1,088 app unit tests, 6 World e2e (desktop + mobile) with a worker double, axe clean on /scan and /world.

## Not done / next

- Production is not connected: needs the worker deployed on a reachable HTTPS host plus `WORLD_*` on Railway and matching `BRAIN_SITE_TICKET_SECRET`/origins on the worker. Until then /scan says reconstruction is not connected.
- Output is a sparse, unscaled point cloud — not yet a photoreal "world". Gaussian-splat training (3DGRUT adapter exists, never run; gsplat is the alternative) needs a GPU; browser splat rendering (e.g. Spark, MIT) is the matching viewer step. No GPU timing measured yet. Worlds live 24 h on the worker; persistent storage is not built.
