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

Every material is procedural, so the repo needs no image files. Each one is patterned enough for structure from
motion to find features. The camera walks once round the room, 0.95 m inside the walls at 1.5 m height, looking 50°
inward. It is 26 mm on a 36 mm sensor, about a phone's main camera.

`truth.json` is written in `scene.json`'s own convention (right-handed, y up, metres). It holds:

- every wall and object as centre, size and yaw;
- 44 named landmarks;
- six reference spans: one calibration span (the table's length) and five withheld spans;
- every camera's position and look direction.

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
