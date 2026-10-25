# Commercial-room benchmark

A meeting room whose every dimension is known exactly, rendered as a phone-style walkthrough, put through the real
World Builder pipeline, and scored against the truth. It answers the question a phone capture cannot: is the error
in the model, or in the tape? Here there is no tape. The room is defined in code.

It is a **synthetic test scene**. The pictures are renders, so lens distortion, motion blur, rolling shutter, auto
exposure and real clutter are missing. A good score here is necessary, not sufficient. Label it synthetic wherever
its numbers or frames are shown, and never present it as a customer site or as a real capture.

## The room

`build_office.py` builds a 6.0 × 4.8 × 2.7 m meeting room with 0.12 m walls. It has:

- a window, a door and a whiteboard;
- a 2.4 m table with six chairs;
- a credenza, a filing cabinet and a plant;
- posters, a clock, sockets and an acoustic panel.

Every material is procedural, so the repo needs no image files. The walls are patterned enough for structure from
motion to find features. The carpet and the plain furniture are not, and that is on purpose: low-texture floors
and furniture are what real offices have. The camera walks once round the room, 0.95 m inside the walls at 1.5 m height, looking 50°
inward. It is 26 mm on a 36 mm sensor, about a phone's main camera.

`truth.json` is written in `scene.json`'s own convention (right-handed, y up, metres). It holds:

- every wall and object as centre, size and yaw;
- 44 named landmarks;
- the reference spans from `office-spans.json`: one calibration span (the table's long edge, 2.4 m) and seven withheld
  spans, two of them across the room (5.5 and 5.7 m). They join corners a sparse cloud resolves, as a person would
  only tape between points they can find in the cloud;
- every camera's position and look direction.

## Results (October 25, 2026)

The room was rendered once, 60 frames at 960 × 540. Two reconstructions with `colmap-sparse` registered all 60 cameras
(20,908 and 20,844 points), and the camera alignment is within 7.5 mm RMS. The first two columns compile the first
reconstruction with and without the hand-off fixes, on #232's worker. The last column is the second reconstruction
on the merged code (#232 plus this branch), and it is the run the demo film is made from.

| | before | hand-off fixes | all fixes, second run |
|---|---|---|---|
| Model's up against true up | 9.4° | 0.3° | 0.3° |
| Model floor against the true floor | +58 cm (near table height) | +4.5 cm | +4.0 cm |
| Walls matched | 2 of 4 | 4 of 4 | 4 of 4 |
| Room width, depth error | not measurable | −1.8, −1.8 cm | −1.7, −1.5 cm |
| Wall face offset, median | 6.7 cm | 0.9 cm | 0.7 cm |
| Furniture matched (of 10) | 2 | 1 | 5 |
| Spurious objects | 3 | 1 | 2 |
| Withheld spans usable, within tolerance | 5 of 7, 5 | 7 of 7, 7 | 7 of 7, 7 |
| Worst withheld error | 4.1 cm | 2.0 cm | 1.9 cm (1.1%) |

What the runs found, in order:

1. **The hand-off's outlier trim cut the room's walls.** A 2nd–98th percentile box per axis drops the cloud's extremes,
   and a room's walls, floor and ceiling are its extremes. It dropped 2,306 points inside the room (11% of the wall
   points) to remove 75 outliers. Fixed: the box is widened by 15% of its size on every side, which drops 45 points
   inside the room.
2. **A floor the cameras barely saw was fitted 9.4° off level, at table height.** Under 1% of the points are on the
   carpet, so the floor fit settled on a tilted plane through wall bottoms and table tops. Fixed: a weakly supported
   floor is squared to the room's own axes, its largest planes. Up is the axis's +y side, the side the floor search
   samples. The floor is then the room's lowest points, and the heading turns to the walls. A well-seen floor (a
   quarter of the points or more) is unchanged. The first version took up's sign from the fitted plane, and the second
   reconstruction stood on its wall tops. The truth score now checks level and floor height for that reason: a rigid
   fit turns a model over and its walls still match.
3. **Sparse furniture stayed points.** An object needed 0.3% of the whole cloud, and 94% of this cloud is wall, so
   every chair (27 to 67 points) fell under the minimum. Fixed: 0.3% of the candidate points, at least 30.

Still open:

- **Furniture on a sparse cloud is partial.** Five of ten pieces are found, with sizes off by 40 cm at the median,
  because each piece carries only tens of points. The table's 139 points break into pieces at 10 cm cells. The
  dense CPU engine (`colmap-dense-cpu`) is the intended answer. Its pinned depth model could not be fetched in this
  environment, so it was not run here.
- **Compiled wall boxes are centred on the surface the camera saw**, so half of each wall's thickness stands inside
  the room. Between the boxes, the room reads 9 to 11 cm short. Moving each box outward by half its thickness is the
  fix. It changes every exported wall and the fit numbers, so it is left for review.
- **Furniture faces can become wall pieces.** In the upside-down run the credenza's front and the plant became short
  wall stretches. The truth score reports such pieces as stray rather than averaging them into the room. The upright
  run has none.

## Reference scale (October 25, 2026)

`robotics/world_worker/reference_scale.py` sets the scale from objects whose size a standard fixes: ISO 216 A4 and A3
and US Letter sheets, a 595 mm lay-in ceiling tile, and a EUR pallet. It works in three steps:

1. Claude marks the objects with rough corners.
2. The corners are found again in the image, and the face is measured on the plane of the reconstruction's own points.
3. A face whose proportions are more than 3% off the standard's is rejected.

Two or more references agreeing within 2% is `cross-checked`. The result is never called verified.

The room above was rendered again with A4 sheets (on the cork board, the teal wall and the table), an A3 sheet and a
can at their exact sizes. `run_reference_benchmark.py` reconstructed it (60 of 60 frames). Detection here is an
**oracle stand-in**: the true corners projected into the frames, with pixel noise in place of a model's pointing error.
Claude itself has not run on it yet: this environment had no working `ANTHROPIC_API_KEY`.

| Corner noise | Status | Scale against the truth | Detections used |
|---|---|---|---|
| 0 px | cross-checked (two sheets) | −0.45% | 4 of 9 |
| 5 px | cross-checked (two sheets) | −0.45% | 4 of 9 |
| 10 px | single reference | +0.3% | 1 of 9 |
| 15 px | none | — | 0 of 9 |
| 20 px | single reference | −1.4% | 1 of 9 |

What it shows:
- **Paper is small at room distance.** From 2–5 m the sheets are 40–70 px across, and the cork-board sheet is never
  large enough to use. Corner refinement recovers 20 px of pointing error to 0.05 px on a 300 px face, and 10 px to
  0.25 px on an A4-sized face. Beyond that, the given corners miss a small sheet altogether.
- **The capture rule that follows:** film each reference from about a metre for a second. Ceiling tiles and pallets
  are large enough from where people stand.
- **Rejections are explicit.** Grazing views of the table sheet failed the proportions check (13–15% off). Sides with
  no edge along them, and faces under 40 px, are reported with the reason.
- **The error budget at 0 px.** The wall sheet's corners land up to 1.75 px inside the paper, which costs −0.9%, and
  the wall plane from the points costs −0.4%.
- **The face must be measured on its own surface.** A sheet standing in front of a wall carries fewer points than the
  wall, so the largest plane around it can be the wall behind. That scales the model by the ratio of the two depths,
  and the proportions check still passes. The face is therefore measured on the front-most surface with points on the
  face itself. A plain face with no points, between surfaces at different depths, is refused. One case remains
  open: a plain face standing free in front of a single surface is still measured on that surface. Triangulating its
  corners from two frames would close it.

```sh
python scripts/world-demo/benchmark/run_reference_benchmark.py OUT            # oracle at 0/5/10/20 px
python scripts/world-demo/benchmark/run_reference_benchmark.py OUT --claude   # with ANTHROPIC_API_KEY set
```

## Run it

```sh
# 1. Render (Blender 4.2, CPU). --test 10 renders only frame 10, to check the room before a full run.
blender -b --python scripts/world-demo/benchmark/build_office.py -- OUT --frames 60 --width 960 --height 540

# 2. Run it through a worker whose job directory is on this machine. Keep the token in the environment only.
export WORLD_WORKER_URL=http://127.0.0.1:8040 WORLD_WORKER_TOKEN=...
python scripts/world-demo/benchmark/run_benchmark.py OUT --jobs <worker dir>/jobs

# 3. The card: the true plan with the compiled walls, objects and cameras on it, and the errors beneath.
python scripts/world-demo/benchmark/truth_card.py --truth OUT/truth.json --score OUT/truth-score.json \
  --measurements <worker dir>/jobs/<scene job>/output/scene-measurements.json --out OUT/card.png
```

`run_benchmark.py` runs each step the way a person does it in the site:

1. It uploads `walkthrough.mp4` and runs `colmap-sparse` (`worker_client.py`).
2. `pick_references.py` finds the reconstructed point at each landmark. It sets the scale from the calibration span
   alone and writes the withheld spans as measurement checks.
3. It uploads the metric hand-off with those checks embedded and runs `scene-usd` on it. That job reads the
   reconstruction's frames, and its own `scene-measurements.json` scores the withheld spans.
4. `score_against_truth.py` scores every compiled wall and object against the true room.

The job ids go to `OUT/run.json`.

## What each step is allowed to know

| Step | Uses the truth for | Never uses the truth for |
|---|---|---|
| `pick_references.py` | Finding which reconstructed point sits at each landmark. This uses a similarity fit of camera centres, and it reports how far the chosen point is from the landmark. | Scale. Metres come only from the calibration span, the way a person types one taped distance into the site. |
| The worker (`scene-usd`) | Nothing. It sees the hand-off and the reference spans, as it would from a phone. | |
| `score_against_truth.py` | Placing the compiled scene in the true room with a rigid fit (no scale) of the hand-off's cameras. A wrong scale shows up as error rather than being fitted away. | |

A landmark with no reconstructed point within `--radius` (5 cm by default) gives no endpoint, and its span is
reported as unusable, never estimated. A span check therefore measures the reconstruction and the point
picking together. The picked point's offset is written next to each check, so a reader can see how much of the
error is picking.

## Outputs

- `refs/dimension-checks.json`: the reference spans in the measurement-check schema, fingerprinted to the
  hand-off's points.
- `refs/references.json`: the alignment (its RMS and every camera pair), the calibration, each landmark's picked
  point and offset, and every span's true and reconstructed length.
- `truth-score.json`: each element against the truth.
  - Room width and depth between matched opposite walls.
  - Each wall face's offset and tilt, and how much of its length was covered.
  - Each object's size and centre error.
  - Missed and spurious objects.
  - The clear distance between opposite compiled wall boxes. A compiled wall is a box centred on the surface the
    camera saw, so half its thickness stands inside the room. A BIM user measuring between boxes reads that much
    less than the faces' distance.
  - The camera fit's RMS.

The alignment fits, the fingerprint, the score and the card are tested in `tests/world/test_benchmark_tools.py`.
