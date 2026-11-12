# Repeated phone reconstruction qualification

This is the next layer above the same-frame comparison harness. It snapshots
source-derived frames and annotated physical readings before inference, rotates
engine order, retains every failed or unstarted trial, and recomputes scores from
the retained camera artifacts. It never changes the production engine.

The earlier comparison PR #239 was closed to keep only main open, not because
its benchmark had been merged. This implementation carries that isolated harness
onto current main, including the current consecutive-frame COLMAP fold check.
The VGGT refinement arm remains **BrainSNN native-track VGGT+BA**, not a reproduction
of the paper's detector-assisted BA recipe.

## Prepare and measure

Use the isolated environment and approved checkpoint setup in
[the comparison guide](world-reconstruction-comparison.md). No model/API service
or paid cloud resource is started by planning. Execution is local and offline.
Begin on an idle RTX 4090; GB10 needs its own compatible CUDA/PyTorch qualification.

Select three separate rights-cleared captures before looking at outputs:

| Case condition | What to include |
|---|---|
| `ordinary-interior` | A room with stationary textured detail and visible floor junctions |
| `low-texture` | Plain walls or repeated finishes that may defeat matching |
| `reflective` | Glass or reflections, retaining the difficult region |

Run once per capture, using different output folders:

```sh
python -m robotics.world_worker.reconstruction_comparison prepare \
  --video /data/room-ordinary.mp4 --frames 32 --out /data/cases/ordinary
python -m http.server 8000 --bind 127.0.0.1 --directory /data/cases/ordinary
```

Open `http://127.0.0.1:8000/annotate.html`. Mark the same physical landmarks in at
least two views each. Enter one tape/laser calibration distance, at least seven
withheld distances, actual instrument, reading date and uncertainty. Download
`annotations.json` into that case. Repeat for `/data/cases/plain` and
`/data/cases/glass`. References must come from the corresponding physical capture,
with endpoints visible across views. Choose spans in different directions,
including an opening and room diagonals. Do not substitute standard-size guesses.

Create `/data/qualification-inputs.json` with actual absolute paths:

```json
{
  "schema": "brainsnn.qualification-inputs.v1",
  "cases": [
    {"id": "ordinary", "condition": "ordinary-interior", "case": "/data/cases/ordinary", "annotations": "/data/cases/ordinary/annotations.json"},
    {"id": "plain", "condition": "low-texture", "case": "/data/cases/plain", "annotations": "/data/cases/plain/annotations.json"},
    {"id": "glass", "condition": "reflective", "case": "/data/cases/glass", "annotations": "/data/cases/glass/annotations.json"}
  ]
}
```

The paths above are examples. No footage or physical readings are supplied with
the code. Original media stays outside git; the plan copies only retained
prepared images, their original-source provenance and the frozen worksheet.

## Freeze and execute

```sh
python -m robotics.world_worker.reconstruction_qualification plan \
  --inputs /data/qualification-inputs.json --out /data/experiment-01 --repeats 3

python -m robotics.world_worker.reconstruction_comparison preflight \
  --vggt-source /opt/vggt \
  --vggt-checkpoint /models/vggt-commercial/model.safetensors

python -m robotics.world_worker.reconstruction_qualification run \
  --plan /data/experiment-01/plan.json \
  --vggt-source /opt/vggt \
  --vggt-checkpoint /models/vggt-commercial/model.safetensors \
  --timeout 120 --max-seconds 3600
```

The default matrix has 9 trials and 27 fresh engine processes. Within each case,
three repetitions rotate all three engines through first position. Processes run
sequentially. Operating-system caches are not flushed. Repeat trials on the same
video are not independent physical captures. CPU COLMAP versus CUDA VGGT compares
the configured implementations rather than equal-hardware algorithmic speed.

`--timeout` bounds each process. `--max-seconds` is an admission budget across the
matrix; remaining time is shared across each trial's arms. Validation, scoring
and process cleanup add overhead. Exhausted work stays in the denominator. This
is a time budget, not an electricity or dollar meter. No automatic cloud purchase,
worker deployment or model download occurs. Use `--engines colmap` for a CPU smoke
run; it cannot establish a challenger result.

An experiment directory is single-use. Do not overwrite or resume only the
successful subset. A changed worksheet or implementation requires a fresh plan.
After interruption, preserve the original evidence and produce the full partial
report with:

```sh
python -m robotics.world_worker.reconstruction_qualification report \
  --plan /data/experiment-01/plan.json
```

## Read the decision

Read `qualification.md` and `qualification.json`; individual runs retain camera
artifacts, measurements, logs, runtime/dependency records and internal fit metrics.
Hashes detect changes to retained evidence; they do not independently attest the
operator, hardware, capture condition or physical readings.

A candidate is ready for **further geometry review** only when every requested
trial across all three conditions and at least three repetitions has:

- All seven or more withheld spans available for baseline and candidate.
- At least 20% lower median withheld absolute error, no worse maximum error, and
  at least 2x complete configured processing speed including shared preparation.
- Every withheld span for both arms within the predeclared demo-review tolerance
  `max(0.05 m, 0.02 * reference distance)`. This additional absolute screen prevents
  a relative improvement over an unusable baseline from being treated as usable.
- No detected folded COLMAP reconstruction. Passing that detector does not prove
  that other layout errors are absent. VGGT has no equivalent fold qualification.

One case or one repetition is supported for initial debugging and remains an
incomplete experiment design. Explicit `--allow-synthetic` plans and runs retain
synthetic labels and cannot qualify for the physical comparison screen. Exit 0
means evidence processing finished, not that the candidate passed. Exit 2 retains
incomplete/failed execution evidence; exit 1 indicates invalid inputs or setup.

Production promotion, BIM surfaces, gravity, survey accuracy and physical robot
validation always remain unapproved here. Camera-landmark distances cannot
establish dense wall accuracy, unseen openings, floor coverage, collision
clearances, friction or mass. Before a product demo claims those outcomes, retain
separate corrected scene exports, source-bound component review, destination-app
reopening evidence and an appropriately labelled simulation or physical trial.

## Verification and estimated effort

```sh
python -m pytest tests/world/test_reconstruction_comparison.py \
  tests/world/test_comparison_measurements.py tests/world/test_comparison_vggt.py \
  tests/world/test_reconstruction_qualification.py -q
```

Tests use authored geometry and explicit fake engine transports for orchestration;
native PyCOLMAP tests exercise actual refinement separately. They do not execute
VGGT weights or supply physical-room validation. The existing synthetic self-test
is also available through `reconstruction_comparison self-test --out FRESH_DIR`.

Estimated operator effort: one engineering day after capture readings, target GPU
environment and approved weights are available. Estimated local compute budget:
up to US$10 excluding labour, not a measured bill or guarantee. Main blockers:
paired tape/laser readings, local approved checkpoint access and an idle qualified
GPU. Record actual elapsed time, allocator peaks and electricity cost separately.
