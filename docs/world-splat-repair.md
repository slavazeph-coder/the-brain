# Source-preserving Gaussian appearance repair

The `splat-repair` adapter executes the real CPU Fast Fill copy core from
[NicolasDrum/splat-repair](https://github.com/NicolasDrum/splat-repair/tree/8487b80bdb512650a7cbc1a8165af62c34b9567d),
commit `8487b80bdb512650a7cbc1a8165af62c34b9567d`. It removes a reviewed selection
of existing Gaussian splats and synthesizes a replacement from nearby donors.
This is **generated appearance**, not recovered measurements, collision geometry,
an occupancy map, or a qualified robot world.

The focused upstream CPU modules are vendored without edits in
`robotics/splat_repair/_vendor/`. `UPSTREAM.json` records each original path and
SHA-256; the adapter verifies those bytes before execution. Apache-2.0 `LICENSE`
and upstream `NOTICE` accompany them. No upstream example scan, pretrained model,
GPU renderer, font, desktop UI, or Deep Fill model is bundled. The notice's font
attribution is retained as part of the unmodified upstream notice; fonts are not
included.

## Installation and execution

Use the worker's existing NumPy dependency plus
`pip install -r robotics/splat_repair/requirements.txt` (SciPy 1.17.1).
Python 3.12 is the tested runtime. This CPU path needs no CUDA, GPU, model weights,
network access, or external executable. Deep Fill is unavailable and requests for
it fail explicitly; there is no success-shaped substitute or fallback.

Both invocation forms work:

```sh
python -m robotics.world_worker.splat_repair --input-manifest /private/job/adapter-input.json
python /app/robotics/world_worker/splat_repair.py --input-manifest /private/job/adapter-input.json
```

The absolute-file form resolves imports from its own trusted repository path,
independent of the current working directory and `PYTHONPATH`. Standard worker
subprocess timeout/cancellation applies; the adapter launches no detached child
process or background job. HTTP auth, owner binding, quotas and registration are
the surrounding worker's responsibility.

## Input contract

Use the standard `brainsnn.adapter.v1` manifest with exactly two inputs. Input
paths must be absolute regular files, and `output_dir` must be an empty directory
(or absent) under an existing private job directory. Uploaded names and request
JSON never become paths.

```json
{
  "schema": "brainsnn.adapter.v1",
  "inputs": [
    {"kind": "splat", "path": "/private/uploads/original.ply"},
    {"kind": "repair", "path": "/private/uploads/repair.json"}
  ],
  "output_dir": "/private/job/output"
}
```

The original `.ply` is at most 64 MiB and contains 120–200,000 vertices. ASCII and
binary little-endian PLY 1.0 are accepted. It must be a Gaussian file with float32
or float64 `x/y/z`, `f_dc_0..2`, `opacity` (logit), `scale_0..2` (log scales), and
`rot_0..3` (WXYZ quaternion). Spherical harmonics are complete degree 0, 1, 2 or 3:
zero, 9, 24 or 45 contiguous `f_rest_*` properties in standard PLY channel-major
order. Up to 96 scalar properties are supported; every extra scalar property and
its declared type are retained. Faces, list properties, additional elements,
big-endian input, partial SH bands, invalid quaternions and nonfinite values are
rejected. This profile does not silently thin a large file or convert an ordinary
XYZ point cloud into Gaussians.

Numerical guards are deliberately bounded: coordinate magnitudes ≤1e6, opacity
logits ≤80 in magnitude, SH coefficients ≤100 in magnitude, log scales between
−16 and 8, and quaternion norms between 1e−8 and 1e8. These are computational
limits, not unit calibration or physical validation.

The request is at most 256 KiB; duplicate/unknown JSON fields are rejected:

```json
{
  "schema": "brainsnn.splat-repair-request.v1",
  "sourceSha256": "<64 lowercase hexadecimal characters of the exact original PLY>",
  "method": "fast-fill",
  "selection": {"indices": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
                             15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
                             28, 29]},
  "parameters": {
    "mode": "auto",
    "density": 1.0,
    "roughness": 1.0,
    "colorSmooth": 0.5,
    "seed": 0
  },
  "reviewed": true
}
```

Replace the example indices with the reviewed original vertex IDs: 30–20,000
unique JSON integers covering at most one quarter of this exact source. Browser preview thinning must
never renumber them. A selection is a set and is sorted for execution. Parameter
defaults apply when `parameters` is `{}`. `mode` is `auto`, `rim`, or `patch`;
`density` is 0.25–2, `roughness` 0–2, `colorSmooth` 0–1, and `seed` an unsigned
32-bit integer. No request can supply Python code, filesystem paths, model names,
weights, or an external painted volume.

The local rim's spacing and diameter screen the surface grid before upstream
allocation (at most 65,536 conservatively estimated grid cells). A job produces
at most 50,000 new splats, 200,000 total output splats and a 64 MiB repaired PLY.
Unsuitable selections and upstream `NothingToFill` failures remain failures;
the adapter never publishes a deletion-only result as a successful fill. This
first profile repairs selected existing splats, not a completely empty scan hole
that would require an explicitly defined 3-D paint volume.

## Outputs and provenance

All six files are staged and the output directory is published atomically only
after successful repair and a second original-source byte check:

| File | Meaning |
| --- | --- |
| `original.ply` | Exact original uploaded bytes, including header and attributes. |
| `repaired.ply` | Binary little-endian Gaussian PLY; retained source rows first, generated rows last; original property names, order and types. |
| `repair-request.json` | Canonical reviewed request with all exposed defaults made explicit. |
| `repair-mapping.json` | Selected and actually removed original indices, retained original indices, generated output indices, actual donor original indices, backing mask, both PLY hashes. |
| `repair-receipt.json` | Source/output hashes and sizes, counts, declared types, effective upstream parameters, pinned source hashes, Python/NumPy/SciPy versions, screening bounds, and explicit qualification limits. |
| `manifest.json` | Standard adapter manifest; `.ply` artifacts have kind `gaussian-appearance`, JSON artifacts have kind `evidence`. |

Upstream ghost cleanup can remove more rows than the reviewed selection; the
mapping records **actual** removed IDs separately. A private integer donor
attribute travels through the genuine upstream copy operations, so donor IDs are
not guessed by nearest-neighbor matching after the repair. New positions and
appearance use upstream results. Extra generated properties come from that
recorded donor; normals or other custom physical attributes are not recomputed.

Every retained vertex record is copied directly from its original typed record,
including full SH bands, float64 values and custom scalar attributes. The CPU
engine computes generated Gaussian values in float32; the output stores them in
the input's declared types. The original file remains unchanged. Given identical
input, parameters and numerical runtime, seeded output is deterministic; the
receipt records versions rather than promising identical floating-point results
across architectures or different SciPy/NumPy builds.

The receipt schema is `brainsnn.splat-repair.v1`, with `appearanceOnly=true`,
`generatedGeometry=true`, `measuredGeometry=false`, `metric_verified=false`,
`physics_ready=false`, `robotReady=false`, `collisionGeometryProduced=false`,
`occupancyMapProduced=false`, and `deepFillUsed=false`. A consumer must preserve
these labels and keep repaired appearance out of metric/robot map generation.

## Verification

```sh
python -m pytest tests/world/test_splat_repair.py -q
```

The authored, unrestricted Gaussian fixture has a known planar surface, a coloured
blemish, full degree-3 SH, double-precision coordinates/confidence and integer
custom attributes. Tests execute the pinned upstream algorithm and check actual
fill coverage and colour replacement, exact retained records/original bytes,
real donor mappings, source/output hashes, deterministic default execution,
ASCII input and absolute-file invocation from a private directory. Adversarial
tests cover malformed PLY/JSON, source/index mismatch, oversized or dispersed
selections, nonfinite values, symlinks and existing-output preservation. These
are software/fixture checks; they do not establish real-scan quality, metric
accuracy, physical safety, or a production deployment.
