---
type: project
description: PR 294 coarse scan wall regressions, bounded ingestion and validation limits
---

# Registered laser scan input, November 13, 2026

- PR #294 branch `claude/laser-scan-input` already carried `provenance.voxelMetres` into
  `wall_face_cell()` at inspection head `d062a927dd9111a642ffc5fed584258546fbd42a`.
- Dedicated regressions reproduced false walls through desk/light bands under enlarged coverage cells, and
  regular 60/80 cm sampling being mistaken for doorways. Coarse coverage now requires independent height
  layers, and inferred opening gaps respect the sampling resolution. Sparse phone behavior is preserved.
- Component evidence, component fit and object naming pass the same scan coverage options as the compiler.
- Reader accumulation is bounded after every chunk on nested doubling voxel grids. Final output remains
  capped at 50,000 points and independent of reader chunk boundaries. This changes the sample relative to
  the old growth-factor thinner, so previous scan counts and object/name receipts need regeneration.
- ASCII and binary PLY normalize declared 16-bit colour types consistently.
- A fresh automated review found the same brightness-based ambiguity in LAS/LAZ. Those formats now always
  normalize their declared unsigned 16-bit channels, with dark/bright chunk-boundary regression coverage.
  The 22 survey-input tests passed, and actual authored LAS/LAZ round trips using laspy 2.6.1/lazrs 0.7.0
  preserved identical colours and points with one-point versus three-point chunks. These are not captures.
- A real Blender 4.3.2 compile of an authored 120,000-point 30 x 24 m room at a retained 64 cm voxel detected
  four walls and wrote GLB/IFC/USD; IfcOpenShell and OpenUSD reopened the IFC/USD outputs.
- The broad local run of `tests/world` and `tests/scene_compiler` passed 1,233 tests and 148 subtests.
  Four checks skipped: missing ONNX Runtime, missing PyTorch, and two real-photo COLMAP checks without
  `WORLD_COLMAP_TEST_CAPTURE`. Three final doorway/input-limit/budget regressions also passed separately.
  The focused run including real Blender export passed 325 tests and 53 subtests (2 real-photo skips).
- The original ETH3D registered input is not present in this executor. Its earlier 6-wall/8-object result is
  author-reported historical evidence, not a reproduction of the new thinner. Large registered real-scan,
  withheld dimensional, units/registration and worker peak-memory checks remain required.
- E57 still decodes one scan position before yielding chunks. LAS/LAZ/E57 have not been tested on physical
  capture files here. Input remains a worker command; website scan upload and structural/MEP inference are
  outside this change. No survey accuracy or physical robot-route claim is established.

See `docs/world-laser-scan-input.md` for executable regression and real-scan regeneration commands.
