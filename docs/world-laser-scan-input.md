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

## The check on a real scan

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
become objects. Walkthrough reconstructions are untouched: their real walls are often blank and sparsely covered, so the
test would wrongly reject them.

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
- `component_evidence.py`, `component_fit.py` and `object_names.py` call `analyse()` without the dense flag, so they must
  pass it before a scan goes through the full scene engine.
- LAS/LAZ and E57 reading is written against `laspy` and `pye57` but only PLY has been run on a real file.
