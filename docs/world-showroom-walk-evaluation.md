# Compare a camera walk with withheld photographs

Use the offline evaluator to check which details a camera preview preserves when a real photograph exists at the requested time. It accepts output from the BrainSNN renderer or a separately run model. The process produces a directory of posed source images for rendering, then a private score report and side-by-side pictures.

## Prepare the input

Install NumPy, Pillow and SciPy in your Python environment. Use a single sequence of undistorted photos with a common image size. The camera JSON contains a `cameras` list. Each source record uses its original image filename, width, height, a 3×4 OpenCV `world_to_camera` matrix and `parameters` equal to `[f,cx,cy]` in pixels. The coordinate axes point right, down and forward. This reader supports the SIMPLE_PINHOLE camera model. Rectify photos with other lens models before preparing the input.

Supply two separate timestamp files. Each maps filenames to objects with numeric `timeSeconds` values. The source file covers the fitted camera records. The second file lists withheld photos whose capture times fall between source cameras. Reserve these photos **before** fitting the cameras, estimating depth, building the point cloud or tuning the renderer.

```sh
python3 scripts/world-demo/evaluate_showroom_walk.py prepare \
  --cameras capture/reconstruction.json --images capture/images \
  --times capture/source-times.json --holdout-times capture/withheld-times.json \
  --out model-input
```

The new directory contains only the source photographs and `requests.json`. Each target specifies camera dimensions, intrinsics, a requested pose, and the two bracketing source IDs. The evaluator estimates target position and intrinsics linearly in time and interpolates rotation with SLERP. Actual camera motion between the shots may differ. The evaluator reads withheld image pixels during scoring.

## Render or submit a method

The public showroom offers its own camera preview. To run its actual browser renderer against a prepared pack, see `scripts/world-demo/render_showroom_walk_predictions.mjs`; it produces a prediction manifest and binary support masks. For external inference, pass the source photos and requested target cameras to your generator, converting its coordinate conventions as necessary. Return one raster per target in the same framing and aspect ratio. A method manifest lives beside its image files. Record SHA-256 over the exact file bytes.

```json
{
  "schema": "brainsnn.walk-predictions.v1",
  "method": "Renderer name and version",
  "requestSha256": "<SHA-256 of requests.json>",
  "targets": [{
    "id": "withheld-01.jpg",
    "image": "prediction-01.png",
    "sha256": "<SHA-256 of prediction-01.png>",
    "mask": "coverage-01.png",
    "maskSha256": "<SHA-256 of coverage-01.png>"
  }]
}
```

The optional mask is an opaque black-and-white PNG at the prediction resolution. White identifies pixels the method could render from the available evidence. Keep the actual displayed background in the prediction. Every requested frame must have one result.

## Score the output

```sh
python3 scripts/world-demo/evaluate_showroom_walk.py score \
  --pack model-input --references capture/withheld-images \
  --cloud capture/cloud.npz --cloud-inputs capture/cloud-inputs.json \
  --predictions predictions/results.json --out walk-scores
```

The cloud NPZ contains matching `xyz` and `rgb` arrays of shape N×3, with XYZ in the camera coordinate system's world frame and RGB in unsigned 8-bit color. The optional cloud-input receipt contains `{"images":["source-01.jpg","source-02.jpg"]}` with the actual contributing filenames. The evaluator checks those declared inputs against the source list. A missing receipt leaves the provenance unverified. Omit `--predictions` to run just the baselines.

The first baseline retrieves a source image by camera-center distance divided by local source spacing plus rotation angle divided by 45 degrees. The second projects the cloud colors with a nearest-depth test and uses the nearest photo for pixels with no geometry. The score plates show the raw cloud projection so gaps remain visible. The default evaluation raster is 320 pixels wide. Full-frame mean absolute RGB error uses a 0–255 scale, where lower is better. The output also gives point coverage, error over the same point-supported pixels for each method, and, when supplied, matched errors over the prediction's support mask. A method can improve on covered pixels and still be worse across the whole frame.

Optional `--annotations boxes.json` supplies a list of `{"image":"withheld-01.jpg","objectId":"cart-a","box":[left,top,right,bottom]}` records, with normalized coordinates in [0,1]. Optional `--groups members.npz` maps the same object IDs to point indices in this exact cloud. The report includes rectangular-region image error and the intersection over union of each manual box with the visible object-point envelope (2nd to 98th percentile). That envelope is approximate and can omit real object surfaces.

## v23 showroom result

The private run used 48 input photographs and eight additional photographs excluded from the archived reconstruction. All eight were scored at 320×180. Their camera poses were interpolated from the input sequence. Four of the eight had previously been used for a manual box check. These results describe one showroom.

| Method | Whole-frame RGB error | RGB error on pixels covered by BrainSNN's two-view preview |
| --- | ---: | ---: |
| Nearest source photo | 46.14 | 45.28 |
| Native point colors with nearest-photo fill | 44.23 | 43.68 |
| BrainSNN two-view RGB-D with gaps visible | 55.33 | 39.09 |
| BrainSNN two-view RGB-D with endpoint-photo gap fill | 41.45 | 39.09 |

Two-view reprojection supplied evidence for 78.13% of the image pixels. Its error was lower than nearest-photo retrieval on the matched supported pixels in seven of eight views. Its displayed gaps raised full-frame error. Filling unsupported pixels from the closer-in-time endpoint reduced whole-frame error on six of the eight frames compared with nearest-photo retrieval. The fill method was chosen after viewing the initial results on these eight photographs. Its gain needs confirmation on a fresh capture. The median visible-point-envelope IoU was 0.49 over six manually drawn cart boxes. No learned model was used for these figures. ViewNeXt can be evaluated with the same handoff after inference and weights are available. [ViewNeXt repository](https://github.com/phai-lab/ViewNext)


## Fresh practice-room check

After fixing the renderer and gap-fill method, two new Blender Cycles reference images were rendered at the exact midpoint poses between consecutive practice-room cameras. The three existing source photos and their mesh-derived depth were the only input views. No parameters were retuned. The two-view preview with endpoint fill scored **11.02** mean whole-frame RGB error, compared with **30.38** for the nearest source photo, **14.84** for source point colors with nearest-photo fill, and **32.15** for the preview with unsupported areas visible. Depth supported 82.09% of pixels. On that same area, two-view RGB-D scored **6.58** and nearest-photo retrieval scored **29.98**. This is a controlled simulation with known camera motion.
