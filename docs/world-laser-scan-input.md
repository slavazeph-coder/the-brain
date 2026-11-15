# Laser-scan input for the scene compiler (first step, November 13, 2026)

Scan-to-BIM firms start from a tripod laser scan (a Leica BLK360 or a FARO Focus), register the scan positions, and model
the building by hand in Revit: every beam, duct and column. World Builder started from a phone video instead, so its
geometry was sparse and its scale estimated. This is the first step toward the professional input: the scene compiler now
takes a registered laser scan directly.

## What it does

`robotics/world_worker/survey_cloud.py` reads one registered scan (PLY, LAS/LAZ or E57), thins it to one point per voxel
within the compiler's 50,000-point budget, turns the scanner's Z-up frame to the worker's Y-up frame, and writes
`arena-cloud.json` with `sourceFrame: "survey-scan"`. The scale record says `source: "scan-file"`: the metres are the
file's own, taken as declared and not verified.

```
python robotics/world_worker/survey_cloud.py --input office.ply --out run/ --compile --blender blender
```

The scene compiler accepts that hand-off without a second view (`measured_scan`) and writes the same outputs as for a
walkthrough: `scene.glb`, `scene.json`, `scene.usda` and `scene.ifc`.

## The initial check on a real scan (author-reported, before the ingestion changes below)

The ETH3D "office" scene (public, CC BY-NC-SA) holds two FARO scans of 24.1 and 24.5 million points. Registered with the
dataset's own alignment and exported as one 1 cm cloud (981,119 points):

| Step | Result |
|---|---|
| Read and thin | 40,698 points at 4.3 cm voxels, 1.7 s |
| Compile (Blender 4.2, CPU) | 25 s |
| Floor | 3.1 × 4.5 m, ceiling at 4.1 m |
| Walls | 6, all real: two side walls 4.1 m long and 3.21 m apart, the far wall, the entrance bay, and the near wall as two stretches either side of its doorway |
| Objects | 8 separated boxes (desks and smaller items), unnamed |
| Files | `scene.usda` (metres) and `scene.ifc` written |

Before the wall fix below, the same scan gave 7 walls, 2 of them false.
These counts and timings describe the original PR experiment. They have not been reproduced for the updated
streaming thinner and must not be presented as the new run's results.

## Why dense scans needed a stricter wall test

The wall finder was built for sparse reconstructions: it accepts a vertical plane with enough points in the band above
furniture. A laser scan puts points on everything, so a plane through desks, monitors and two hanging lamps collected
enough points to pass, and the office came out with two diagonal "walls" through the middle of the room.

What separates them is how completely a wall's own points cover its face, in 20 cm cells:

| Wall | Face covered |
|---|---|
| The five real walls of the first run | 54% to 100% |
| The two false diagonals | 13% and 30% |

For a `survey-scan` cloud a plane must now cover 40% of its face (`WALL_FACE_COVERAGE`), or its points stay free to
become objects. The cells are 20 cm, or twice the voxel the scan was thinned to when that is larger, so a
building-sized scan thinned coarsely to fit the point budget can keep its walls (Codex's finding on #294).
Simply enlarging cells can also turn a desk and a hanging light into one false wall. For cells larger than 20 cm,
the upper band must have at least two independent height samples separated by 20 cm, or the whole face must have
at least three. Jitter across a coverage-cell boundary does not count as another height layer. The 40% area
threshold, RANSAC support, minimum length and minimum height requirements remain in force.

For dense scans, an inferred doorway gap must also span at least the coverage cell, so regular 60 or 80 cm sampling
does not fragment a complete wall into dozens of short pieces. Smaller openings are unresolved at that resolution.
The scan options are passed consistently by the compiler, component evidence, component fit and object naming.
Only metric `survey-scan` clouds use scan sampling metadata. Walkthrough reconstructions are untouched: their real walls are often blank and sparsely covered, so the
test would wrongly reject them.

## Bounded ingestion and colour consistency

The retained sample is coarsened after each incoming chunk, rather than keeping the whole file's 2 cm samples until
the end. Grids double from 2 cm to 4 cm, 8 cm, 16 cm and so on. Nested grids preserve the first point and its colour
in each final voxel regardless of reader chunk boundaries. Between chunks the retained sample has at most the
requested budget, which must be an integer from 1 to 50,000. Transient allocations still include the current reader
chunk and NumPy's indexing/sorting arrays. E57's decoder still loads one scan position before yielding chunks.

This changes retained resolution and point selection compared with the old adaptive growth factors. Rerun the
original capture before comparing wall counts, object IDs, names or fit receipts; do not reuse the old compiled model.
Both ASCII and binary PLY now normalize each colour channel using its declared type. For example, 16-bit RGB
`(32768, 16384, 8192)` becomes `(128, 64, 32)` in all three supported PLY layouts.
LAS/LAZ always uses the format's declared unsigned 16-bit channels, including dark chunks whose values are all
below 256. Brightness is never used to guess bit depth separately for each reader chunk. Nonstandard LAS files
storing 8-bit values in 16-bit fields need normalization in the source exporter.
The follow-up LAS regression passed with both a fake decoder and actual authored LAS/LAZ files read by
laspy 2.6.1 and lazrs 0.7.0, using one-point and three-point chunks. Those are format checks, not physical captures.

## Regression checks for PR #294

The deterministic fixtures are authored geometry, not physical captures:

- A 12 m wall sampled every 40 cm fails the old fixed 20 cm coverage test and passes with the actual voxel resolution.
- Complete 24 m walls remain single walls at 20, 40, 60 and 80 cm spacing, both axis-aligned and rotated 37 degrees.
- Two thin desk/light bands are rejected at the same spacings, including samples either side of a bin boundary.
- A real wall remains detected in the same cloud as those bands; clutter points remain available to object separation.
- A resolved doorway still splits a coarse wall; phone reconstruction results retain their existing behavior.
- A 120,000-point authored 30 x 24 m room is thinned with an 8,000-point test budget. Its actual 64 cm voxel
  is recorded in the hand-off and the compiler detects four walls. A real headless Blender integration test exports
  GLB, IFC and USD; IfcOpenShell and OpenUSD reopen the IFC/USD files. This tests the software path, not survey accuracy.
- Ingestion is checked across 40 incoming chunks, including the retained bound before the next chunk is read,
  chunk-independent point/colour selection, invalid budgets, the 50,000-point contract and the total input cap.

Run the CPU and headless export regressions with the repository's test dependencies installed:

```sh
python -m pytest tests/world/test_survey_cloud.py tests/scene_compiler \
  tests/world/test_component_evidence.py tests/world/test_component_fit.py \
  tests/world/test_object_names.py tests/world/test_worker.py -q -ra
```

The Blender integration check skips explicitly when Blender is absent. Optional IFC/USD reopen checks require
IfcOpenShell and usd-core. The two real-photo COLMAP checks need `WORLD_COLMAP_TEST_CAPTURE`.

Local results on November 13: the focused suite passed 325 tests plus 53 subtests, with two real-photo checks
skipped. The broader `tests/world tests/scene_compiler` run passed 1,233 tests plus 148 subtests, with four skips
(ONNX Runtime, PyTorch and two physical-photo inputs unavailable). Three final doorway/input-limit/budget
regressions passed separately. Blender 4.3.2, IFC reopen and USD reopen all executed successfully.

Before relying on a real scan, rerun the exact registered ETH3D office input from the original experiment and a larger
registered scan that actually requires at least 40 cm thinning:

```sh
python robotics/world_worker/survey_cloud.py --input /data/registered-office-1cm.ply \
  --out /runs/office-pr294 --up z --compile --blender /usr/bin/blender
python robotics/world_worker/survey_cloud.py --input /data/registered-large-floor.ply \
  --out /runs/large-floor-pr294 --up z --compile --blender /usr/bin/blender
```

Check `survey-scan.json` for input SHA-256, actual `voxel_metres` and retained count. Compare source-to-model wall
residuals against the original registered points, manually review false/missing walls and openings, reopen IFC/USD,
and measure worker peak memory. Independently check units, registration and several withheld physical dimensions.
Model-to-input fit alone does not validate scanner accuracy or the resulting BIM against a survey.

## What it does not do yet

- **No upload on the site.** It is a worker command. The site's cloud hand-off (`geometry.load_arena_cloud`, 16 MiB of
  JSON) does not accept `survey-scan` yet, and there is no upload type for scan files of hundreds of megabytes.
- **No registration.** Export one unified cloud from the scanner's software, or an E57 whose scans carry their poses.
- **No beams, ducts, pipes or columns.** The compiler writes a floor, walls and boxed objects. Finding structural and
  MEP elements (cylinders for pipes and columns, boxes overhead for beams and ducts) is the next modelling step, and
  the result would be suggestions for a person to accept, as the hand-modelled BIM in the trade is.
- **Units and accuracy are not checked.** The file's coordinates are taken as metres. Nothing here measures how far the
  model's walls sit from the scan's points; `fit_check.py` does that for walkthrough scenes and should run here too.
- **Detail is capped at 50,000 points.** That is about 4 cm for one office and coarser for a whole floor.
- The wall classifier remains a geometry heuristic. The clutter regressions do not prove arbitrary furniture can
  never resemble a wall. Very coarse scans may lack the existing minimum high-band support or independent height
  layers; narrow openings and small objects remain unresolved. No physical robot route has been validated here.
- LAS/LAZ has been checked on authored files; PLY is the only format with the original physical-scan experiment.
  Physical-capture LAS/LAZ and E57 files still require validation.
