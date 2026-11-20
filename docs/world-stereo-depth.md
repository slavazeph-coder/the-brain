# See depth with two photos

Open **Make it yours → See depth with two photos**. Try the example first. Each camera sees the scene from a slightly different spot. A nearby object shifts farther across the two pictures than a distant object.

## Use a calibrated pair

Use synchronized views of the same scene from a calibrated, horizontally rectified stereo rig. Rectification puts corresponding points on the same image row. Supply the original image dimensions, focal lengths and principal points in pixels of those rectified images, and the distance between the camera centers in metres. A baseline alone is insufficient. Keep the left and right images in capture order. Two unrelated photos or an unsynchronized moving subject can give convincing but incorrect matches.

Choose **Open a calibration JSON file** for repeated work with one rig. Its fields are `width`, `height`, `fx`, `fy`, `cxLeft`, `cxRight`, `cy` and `baselineMeters`. The example file shows the exact layout. The working raster fits within 960 × 720 pixels. Focal lengths and principal points are adjusted together during resizing. The default search spans the supported disparity range, up to 192 working pixels. Use **Change the distance range** when you know the near and far limits of the scene. If actual depths fall outside that interval, a repeated pattern can produce a plausible but wrong match. [Example calibration](../brainsnn-r3f-app/public/world/examples/stereo/calibration.json)

The browser compares textured patches along an image row and checks matches in both directions. It leaves gaps where there is insufficient texture, ambiguous repetition or an occlusion. For a matched pixel, the distance along the optical axis is `fx × baseline / ((xLeft − xRight) − (cxLeft − cxRight))`. The coloured point-cloud download uses the first left camera as origin, X right, Y up, and negative Z forward. Compare estimates with a separately measured distance before using them for a physical decision. The downloadable points represent estimated scene locations.

## Review a StereoSplat result

Under **Open a StereoSplat export**, select `gaussians.ply`. Add `cameras.json` and the exported colour or depth PNGs to inspect them together. The tool reads selected files locally. You can orbit the Gaussian scene, choose a render camera to see its projected centers, or inspect an original image. Camera positions use `−Rᵀt` from the sidecar’s world-to-camera transform. The file describes virtual render views. It cannot establish the baseline of the physical rig or authenticate the selected PLY.

The viewer accepts a standard little-endian, float32 Gaussian PLY up to 1 GiB, sampling at most 20,000 complete source rows for the display. Orbit preview uses the base spherical harmonic colour. The camera projection displays sampled centers. Exported RGB PNGs preserve the exporting renderer’s original appearance. The upstream depth PNGs carry visualization colours and do not contain recoverable per-pixel distances. A PLY-only export also works. [Upstream demo and output contract](https://github.com/facebookresearch/stereo-splat/blob/c05eaa507a09723dbe99a3fcda4d6f28c2845161/scripts/demo.py)

## Research model

StereoSplat produces a static set of Gaussians from rectified stereo imagery. The researchers’ demo accepts calibrated left/right images and, for a moving camera sequence, metric camera poses. Its CPU export path uses `--device cpu --no-render`; novel-view rendering uses CUDA. The released decoder, weights and XRStereo data are under CC BY-NC 4.0, and its FoundationStereo dependency has separate research-use terms. The playground uses an independent patch matcher and accepts exports that users have permission to open. Model inference takes place in the upstream environment. [Project and setup](https://github.com/facebookresearch/stereo-splat) · [StereoSplat licence](https://github.com/facebookresearch/stereo-splat/blob/c05eaa507a09723dbe99a3fcda4d6f28c2845161/LICENSE) · [FoundationStereo licence](https://github.com/NVlabs/FoundationStereo/blob/6e8806816b533e4d13ddbb95ffa907b797060a62/LICENSE)
