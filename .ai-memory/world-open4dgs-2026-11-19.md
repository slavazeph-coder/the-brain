---
type: project
description: World Builder's Open4DGS viewer, local camera synchronization and operator-run reconstruction
---

# Open4DGS moving scenes

The user requested the ASU Open4DGS layer shared by Michael Rubloff. The public playground entry is **Make it yours → Watch a moving scene**. The authored studio example, camera clips, ASU per-frame Gaussian PLY sequences, and supported single-clip TRIGSBIN v1 exports open locally. The viewer supports scrubbing, play/pause and 3D orbit on desktop and phone. The point preview is used when WebGL2 is unavailable. Dynamic appearance is separate from measured geometry, collision and robot inputs.

The local clip workflow marks a shared event, previews the overlapping video interval and downloads a source-bound camera setup. The supplied FFmpeg extractor writes frame-matched image folders. A separate operator-run CLI processes calibrated views and masks through the pinned ASU preparation, TRiGS CUDA training, evaluation and export. The script records the selected timing method, capture fingerprint and resumable stages. The PLY preview converter retains actual source rows and frame times when the full export exceeds the browser limits. [Capture and training guide](../scripts/world-open4dgs/README.md)

Core v0.1.0 is pinned to `3cac7ba62d930e3ce56cb532bb60870e4ebf6db5` (MIT); TRiGS v0.1.0 is `ed7a84aff1aeccd18dfb48d2806e521255ccf9ef` (AGPL-3.0). The official checked-out exporters ran locally on an original authored checkpoint. They produced 16 genuine output frames at 10 fps and a single-clip TRIGSBIN. Torch reference checks covered position, rotation and opacity. Two browser engines tested both import routes, file privacy and phone layouts, and extracted 25 matched images from each of two offset source videos. GPU reconstruction from a real capture remains unqualified on our infrastructure. The ASU gated datasets have separate usage terms and are not part of our example. [Upstream](https://github.com/ASU-NEM-Labs/open4dgs-core)
