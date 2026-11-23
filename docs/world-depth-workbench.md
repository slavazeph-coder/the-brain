# Photo and video depth review

The native depth workbench reviews an image or a bounded video as camera-depth observations. Its default worker engine is **`metric-depth-sequence`**, using the repository’s existing pinned MoGe-2 ViT-B ONNX model and metric camera solve. The browser shows the matching image, a depth grid, frame timing and point/pixel probes. Each video frame remains an independent model estimate.

This is a model-neutral review layer. It does not register a shared world, estimate camera poses, complete hidden surfaces, create BIM, or establish robot collision geometry. Estimated metres remain unverified until checked against independent measurements. The existing reconstruction and measured-scene workflows remain separate destinations with their own evidence requirements.

## Default and optional backends

| Backend | State | Temporal method | Evidence boundary |
|---|---|---|---|
| MoGe-2 ViT-B | Default Railway adapter, using the existing build-time model provision | Independent inference and focal/scale solve for each retained frame | No temporal-consistency claim; frame scale and focal estimates can vary |
| Depth Pro 2-S connector | Optional local code path, absent from enabled adapter configurations and visitor grants | Official buffered joint-video method when multiple frames actually run | Requires separate written permission and locally pinned source/checkpoints before optional imports or inference |

The MoGe model metadata comes directly from `metric_scale.MODEL`: base model `Ruicheng/moge-2-vitb-normal`, recorded MIT license, ONNX repository `Ruicheng/moge-2-vitb-normal-onnx`, revision `2d247a122ada42ce700fe59273cd62e076da1f32`, file `model.onnx`, SHA-256 `bbf14e07a30f11e69d36ab861590123f5598ababcbc8946a063eb4a966f35a21`. The baseline calls `metric_scale.load_session`, which verifies the file hash before creating an ONNX Runtime CPU session. It then invokes the existing `photo_metric.metric_points` solve. No model is downloaded at runtime.

References: [MoGe-2 base model](https://huggingface.co/Ruicheng/moge-2-vitb-normal), [pinned ONNX export](https://huggingface.co/Ruicheng/moge-2-vitb-normal-onnx/tree/2d247a122ada42ce700fe59273cd62e076da1f32), and the [Depth Pro 2 source repository](https://github.com/apple-aiml-research/ml-depth-pro-2).

Apple’s default model terms exclude product development and commercial services. No Apple weights were downloaded or executed for this integration. `depth_pro2_backend.py` is a separately gated connector: it checks a local written-permission receipt, pinned source modules, model/config hashes and optional focal-model hash before loading. Its provenance records an operator declaration, not a software determination that the legal rights are sufficient. Changing a configuration flag is not a substitute for obtaining the necessary rights. There is no enabled public or visitor Depth Pro 2 engine.

## User workflow

1. Choose one photo or a video up to 60 seconds.
2. Connect the existing processing session and consent to sending that source.
3. Run the available default engine. The workbench lists a model as available only when the connected worker advertises that configured engine.
4. Review the source image and camera-Z depth at the same grid locations. Move through video frames by retained source time where available; missing timing stays explicitly unavailable.
5. Save the review JSON or a selected frame’s point preview. Keep the model/source provenance alongside those outputs.

An authored browser example demonstrates the controls without claiming model inference. The real processing path uploads the original source and retrieves actual worker artifacts.

## Bounded processing

`robotics/world_worker/depth_sequence.py` accepts exactly one `image` or `video` input through the existing `brainsnn.adapter.v1` worker manifest.

| Resource | Bound |
|---|---|
| Source file | Existing worker limits: image 200 MiB; video 2 GiB |
| Source raster | At most 24 megapixels and 4:1 aspect ratio |
| Photo dimensions | At least 256 pixels on each side |
| Video dimensions | At least 128 pixels on each side |
| Video length/rate | At most 60 seconds; declared average rate at most 240 fps |
| Retained video frames | Default 16; trusted operator CLI can select 1–32 |
| Prepared image edge | At most 1,280 pixels |
| MoGe prediction raster | At most 644-pixel edge, resized to the existing model’s patch multiples |
| Review raster | At most 160 × 160 samples; often smaller because integer-stride sampling preserves exact source pixel locations |
| Review range | Default maximum camera-Z 100 m; trusted CLI can set a positive limit up to 1,000 m |
| Embedded frame JPEG | At most 128 KiB |
| Sequence JSON | At most 16 MiB |

Photographs use the existing EXIF-upright preparation and metadata-stripping path. Animated images are refused. The backend does not claim lens undistortion or use an unverified source camera calibration.

Video decoding uses bounded local FFprobe/FFmpeg subprocesses. Container signatures select the MOV/MP4 or Matroska/WebM demuxer; local protocol restrictions, disabled MOV external references, codec and pixel bounds, output-frame caps, bounded diagnostics and deadlines constrain decoding. Output JPEGs are private intermediate files, not independently invented observations.

## Source timing

The video path selects original decoded frames instead of applying an `fps` filter that can duplicate or synthesize frame timing. `-copyts` keeps the source clock. A private, bounded metadata-filter file records each selected frame’s decoder-exposed PTS, with the original stream time base supplied by FFprobe. The filter deletes any source value of its timing marker and writes a constant marker; source metadata and stderr are never parsed as timestamp evidence. The exported seconds are computed from those values, including a nonzero source start time.

Sampling interval and output index are not timestamps. Missing, unparseable or non-increasing PTS produce `timeSeconds: null` and `timestampBasis: "not-available"`. A still photograph has `timeSeconds: null` and `timestampBasis: "still-image"`. The pipeline does not invent a camera trajectory or treat frames as registered because their timestamps are known.

## Image, depth and camera alignment

The MoGe wrapper predicts at its own bounded input raster. The exported frame records `inputWidth`/`inputHeight` for that raster, and `sourceWidth`/`sourceHeight` for the decoded source dimensions. These are distinct from the smaller review grid.

The writer chooses one integer stride and samples **the same pixel indices** from the RGB image, geometry mask and camera-Z depth. It divides `fx`, `fy`, `cx` and `cy` by that stride. Pixel `(0, 0)` remains the first pixel centre. There is no depth interpolation, filling or extra temporal smoothing. The review JPEG uses those same sampled RGB pixels, with ordinary JPEG colour compression.

For review pixel `(u, v)` and optical-axis depth `Z`, lifting is:

```text
X = (u - cx) * Z / fx
Y = (v - cy) * Z / fy
Z = depth[v * width + u]
```

`Z` is not Euclidean distance along a normalized ray. Invalid, nonfinite, nonpositive, model-masked and beyond-range values remain `null`. The existing MoGe solve also excludes depth-edge pixels; that operation is retained in frame provenance.

## Artifact contract

`depth-sequence.json` is an evidence artifact with schema `brainsnn.depth-sequence.v1`:

```json
{
  "schema": "brainsnn.depth-sequence.v1",
  "engine": "metric-depth-sequence",
  "source": {"sha256": "…", "kind": "video", "name": "walk.mp4"},
  "model": {"repo": "…", "revision": "…", "license": "MIT"},
  "units": "m",
  "coordinateFrame": "camera-x-right-y-down-z-forward",
  "depthConvention": "camera-z",
  "maxDepthMeters": 100,
  "scale": {"basis": "model-estimated", "verified": false},
  "registration": {"available": false, "cameraPosesAvailable": false},
  "temporal": {"mode": "independent-frames", "consistencyEnforced": false},
  "provenance": {"inferenceExecuted": true, "collisionReady": false},
  "frames": [{
    "index": 0,
    "timeSeconds": 5,
    "timestampBasis": "source-pts",
    "width": 129,
    "height": 79,
    "depth": [2.1, null],
    "camera": {"fx": 60, "fy": 60, "cx": 64.3, "cy": 39.1},
    "imageDataUrl": "data:image/jpeg;base64,…",
    "inputWidth": 644,
    "inputHeight": 392
  }]
}
```

The excerpt abbreviates hashes, image data and the depth array. A real depth array has exactly `width * height` entries. Every frame also records its review sampling and bounded valid/invalid depth statistics. Missing geometry does not receive a guessed value.

When the first frame has valid geometry, `depth-first-frame.ply` is written with the existing manifest kind **`visual`** and representation **`point-cloud`**. Its camera-to-preview conversion is `[X, -Y, -Z]`, placing the camera at the origin and looking down negative Z in the existing Y-up viewer. The generic visual metadata retains the existing unverified-scale convention; the sequence records the numerical estimated metres. An empty first frame produces no fabricated PLY. No world, BIM, collision or pose artifact is emitted.

## Operator integration

The default trusted adapter command is:

```bash
python robotics/world_worker/depth_sequence.py \
  --input-manifest /absolute/path/to/adapter-request.json \
  --model /absolute/path/to/pinned-moge-2-vitb-normal.onnx \
  --max-frames 16 \
  --max-depth-metres 100
```

Railway’s existing Docker build already installs and checks the pinned model at `/opt/brainsnn-models/moge-2-vitb-normal.onnx`. Its adapter configuration enables `metric-depth-sequence` with one image/video input and a 900-second process limit. The example and GB10 entries remain disabled until the local paths and runtime are provisioned. The website proxy and worker tenant allowlists include the MoGe engine under their existing session quotas; the restricted optional backend is excluded from visitor grants.

The neutral Python seam is `run_with_backend(request, backend, engine=..., max_frames=..., max_depth_metres=...)`. A backend reports `model_metadata`, `temporal_metadata`, and `predict_image(rgb)`. A multi-frame joint backend additionally provides `predict_sequence(frames, timestamps_seconds=[actual PTS or None])`. Predictions contain matching camera-Z depth, boolean mask, RGB raster when resized, and `fx/fy/cx/cy` intrinsics. Uploaded request options cannot select a backend, permission file or model checkpoint.

Still-image and single-frame runs explicitly report that no cross-frame method was applied, even when the configured backend can process joint video. Video inference covers the retained sample of at most 16 frames by default, not every source frame. A joint backend distinguishes configured overlap blending from blending actually applied to this sequence; the writer aggregates explicit applied flags and claims only that it adds no further smoothing. Missing execution provenance never becomes an inference-executed claim.

## Verification and current qualification

```bash
python -m pytest tests/world/test_depth_sequence.py \
  tests/world/test_photo_metric.py tests/world/test_site_worker_deploy.py -q
```

Contract tests cover camera-Z lifting, exact grid/intrinsic alignment, invalid/sky/range masking, bounded media/model inputs, pinned model refusal, no fabricated empty-frame PLY, joint-frame order and timestamp handoff, decoder output/deadline limits, and actual visitor engine grants. Existing camera-solve and deployment regressions also pass.

A real FFmpeg test decodes an authored MP4 whose original source timestamps start at five seconds and whose metadata contains attempted timestamp impersonation. Selected exported times match original FFprobe frame PTS, rather than source comments, output index or a guessed frame rate. Separate shared-writer fixtures contain an explicitly authored constant-depth predictor and record `inferenceExecuted: false`; they qualify decoding and browser/writer interoperability, not learned model accuracy.

No cached pinned MoGe checkpoint or ONNX Runtime was found in the local development environment for this change. The optional actual inference test therefore skips explicitly. To qualify an already installed local model, run:

```bash
WORLD_DEPTH_SEQUENCE_MODEL=/absolute/path/to/pinned-moge-model.onnx \
  python -m pytest tests/world/test_depth_sequence.py \
  -k installed_pinned_moge_photo_and_video_inference -q
```

The test checks the pinned bytes and executes the real photo/video model path without downloading. An authored test image can establish execution, not physical depth accuracy. A deployed acceptance should additionally use representative permitted source media and independent distance checks. No Depth Pro 2 weight or hardware execution was qualified in this implementation.
