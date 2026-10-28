# Native capture reconstruction

The CPU `colmap-sparse` worker accepts one `brainsnn.capture.v1` JSON sidecar and 3–11 original JPEG/PNG photos. This works through the existing authenticated upload, consent, owner quotas, cancellation, timeout, retention and artifact-download paths. It does not provide a native iPhone or Android capture app.

The worker binds every frame to its exact uploaded filename and SHA-256, validates original dimensions, monotonic timestamps, a pinhole calibration and rigid ARKit camera-to-world pose, and requires normal tracking for every frame. Upload names must be unique flat filenames. ZIP archives, path references, EXIF-rotated images, nonzero skew and declared lens distortion are rejected. An actual capture producer must supply correctly oriented, calibrated rasters; stripping orientation metadata alone is not a calibration correction.

The adapter transforms the calibration through image resizing and converts integer-centre coordinates to COLMAP's half-pixel convention. Each image gets a separate PINHOLE camera, and these intrinsic parameters remain fixed during matching and bundle adjustment. Geometry and camera poses are solved from image matches. The existing consecutive-image fold checks still run.

The solved model is then aligned to the native camera poses after position and attitude agreement checks. Poses are used for this checked post-solve alignment, **not as optimization constraints**. A stationary capture cannot establish scale; contradictory trajectories fail before successful artifacts are published. Position/attitude thresholds are rejection guards, not physical accuracy guarantees.

Output includes `native-capture.json`, bound by SHA-256 from `reconstruction.json`, plus the normal point cloud and camera-frame ledger. Original timestamps remain bound to source image hashes in the native evidence; image sources do not acquire invented video PTS. Saved COLMAP cameras and points share the same transformed coordinates as the artifacts. The native scale is only an estimate: public `units` remains `arbitrary`, `metric_verified` remains false, and independent dimensions are still required before using a model as measured geometry.

## Submit a capture

Install the worker's Python dependencies in an isolated environment. Put the sidecar and its original images in one folder, using the schema documented in `world-simready-launch-20261027.md`. The site and worker must both run this revision; the configured `colmap-sparse` engine must advertise `capture` among its input kinds.

```sh
python scripts/world-demo/native_capture_submit.py \
  --site https://www.brainsnn.com \
  --bundle /data/capture/capture.json \
  --root /data/capture \
  --out /data/capture-result \
  --consent
```

The CLI validates the complete local bundle before upload. It reads `BRAINSNN_PASSCODE` from the environment or prompts without echo; no passcode is accepted as an argument or written into artifacts. It uploads in bounded chunks, starts one `colmap-sparse` job, waits at most 3,700 seconds by default, requests cancellation on timeout, then SHA-256 checks every downloaded artifact. Use a fresh output directory. The endpoint must be an HTTPS origin you control and intend to send these images to.

## Qualification boundary

The automated test renders a textured room with independently authored cameras, runs real PyCOLMAP feature extraction, matching and reconstruction, checks the pose alignment and fixed camera intrinsics, and reopens the persisted model and camera evidence. This verifies a synthetic integration path. Real native-device capture, rolling-shutter/lens behavior, noisy tracking and held-out physical-room dimensions still require qualification. Ordinary photos and videos retain their existing reconstruction path.
