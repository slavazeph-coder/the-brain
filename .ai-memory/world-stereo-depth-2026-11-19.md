---
type: project
description: Calibrated stereo depth and StereoSplat export review prototype, implementation and validation boundaries
---

# See depth with two photos

The shared post referenced StereoSplat from the University of Amsterdam and Meta. Its code, released weights and XRStereo dataset carry CC BY-NC 4.0, with separate research terms on the FoundationStereo backbone. The independent browser implementation matches rectified photo pairs and imports authorized Gaussian PLY exports. No third-party model code or weights are included. [Upstream](https://github.com/facebookresearch/stereo-splat) · [Tool guide](../docs/world-stereo-depth.md)

The playground path is **Make it yours → See depth with two photos**, with fragment `#layer-tab-stereo`. Metric depth uses the provided physical baseline, pixel focal length and principal-point offset. Sparse textured patches are checked both ways. The browser can export the estimated points to a coloured, left-camera-local Y-up PLY. Missing correspondences and outliers remain possible. The independent authored stereo pair has three planes at 1, 1.5 and 2.4 m. All three matched distances were recovered in Chromium and WebKit. The example also runs offline.

Native StereoSplat Gaussian inspection preserves base colour, rotations, opacity and relative scales for the preview. The optional cameras.json supplies virtual render camera poses and calibrated projection. Upstream colourized depth PNGs do not encode metric pixel depths. Its supported CPU no-render export has a PLY with no camera sidecar. Original native format fixtures and physical image benchmarks stay outside production. A reported depth error applies only where a sample passed the matcher and reference checks. Real scene accuracy is uneven. The learned StereoSplat model was not run in this prototype.

The broad default searches the allowed disparity range up to 192 working pixels. A narrow range that excluded the true disparity yielded confidently incorrect matches on a repeating checkerboard. On four Middlebury scenes the accepted non-occluded grid coverage was 17–29%, median absolute depth error 3–7 mm, and scene-wise 95th percentile error 24–209 mm. The depth references used independent structured-light disparities and the published camera calibrations. [Middlebury datasets](https://vision.middlebury.edu/stereo/data/scenes2014/)
