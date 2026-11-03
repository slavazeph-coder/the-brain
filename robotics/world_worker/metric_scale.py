"""Estimated metric scale for a COLMAP reconstruction, from a monocular metric-depth model checked against the
reconstruction's own points.

COLMAP's units are arbitrary: the same walkthrough could be a dollhouse or a warehouse. MoGe-2 (Microsoft Research, MIT)
predicts each frame's 3D points in metres. At every pixel where COLMAP observed one of its 3D points, the model's metric
depth divided by that point's depth in the frame's camera is metres per reconstruction unit. The median over a frame's
points, then over evenly spaced frames, is the estimate; how much the frames disagree is reported with it.

It is a learned model's estimate, not a measurement. On three ETH3D scenes with laser-measured ground truth (12 DSLR
photos each, reconstructed by this worker) it read 6% high on office, 9% high on pipes and 16% high on the outdoor
terrace; the fixed 1.35 m phone-height guess it replaces was 198% high, 134% high and 37% low on the same scans. A model
can be further off on a scene unlike its training data, so the site labels it estimated and a measured distance always
replaces it. The frames' disagreement is reported but understates that error: it was 1 to 3% on all three scenes.
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path

# The author's ONNX export of MoGe-2 ViT-B with normals (419 MB). The weights are MIT (Ruicheng/moge-2-vitb-normal);
# the ONNX repo carries no licence tag of its own, so the base model's licence is the one recorded. ViT-S (140 MB) was
# 32% off on ETH3D terrace where ViT-B was 16%, so the larger one is pinned.
MODEL = {'repo': 'Ruicheng/moge-2-vitb-normal-onnx', 'revision': '2d247a122ada42ce700fe59273cd62e076da1f32',
         'file': 'model.onnx', 'sha256': 'bbf14e07a30f11e69d36ab861590123f5598ababcbc8946a063eb4a966f35a21',
         'base_model': 'Ruicheng/moge-2-vitb-normal', 'license': 'MIT'}
FRAMES = 10  # evenly spaced registered frames; 16 moved the ETH3D office estimate by under 1%
WIDTH = 644  # model input width (a multiple of 14); the height keeps the frame's aspect
TOKENS = 1200  # MoGe-2's resolution level: 1,200 was as accurate as 2,500 on ETH3D office and twice as fast on CPU
MIN_POINTS = 20  # a frame counts only with this many reconstructed points visible where the model found geometry
MIN_FRAMES = 3


def load_session(path, threads=2):
    """An ONNX Runtime session for the pinned checkpoint. A file that does not match the pinned hash is refused."""
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for part in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(part)
    if digest.hexdigest() != MODEL['sha256']:
        raise RuntimeError(f"{path} is not the pinned {MODEL['repo']}@{MODEL['revision'][:12]} {MODEL['file']}.")
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])


def shift_for_focal(points, mask, focal):
    """The depth shift that makes MoGe's affine points project through a known focal length.

    MoGe predicts points up to a shift along the viewing axis; with the focal length known (COLMAP refined it), the shift
    is the one whose projection f·(x, y)/(z + shift) lands back on each point's own pixel. `focal` is relative to half
    the image diagonal, as MoGe's normalised image coordinates are. Golden-section search over the valid range."""
    import numpy as np
    height, width = points.shape[:2]
    diagonal = (height * height + width * width) ** .5
    u, v = np.meshgrid((np.arange(width) - (width - 1) / 2) * 2 / diagonal, (np.arange(height) - (height - 1) / 2) * 2 / diagonal)
    step = max(1, min(height, width) // 64)
    keep = mask[::step, ::step]
    xyz = points[::step, ::step][keep].astype(np.float64)
    uv = np.stack([u[::step, ::step][keep], v[::step, ::step][keep]], -1)
    if len(xyz) < 10:
        return None

    def cost(shift):
        z = xyz[:, 2] + shift
        return np.inf if np.any(z <= 1e-6) else float(np.sum((focal * xyz[:, :2] / z[:, None] - uv) ** 2))
    lo = -float(xyz[:, 2].min()) + 1e-4
    hi = lo + 20 * (float(np.median(np.abs(xyz[:, 2]))) + 1)
    ratio = (5 ** .5 - 1) / 2
    a, b = lo, hi
    c, d = b - ratio * (b - a), a + ratio * (b - a)
    for _ in range(60):
        if cost(c) < cost(d):
            b = d
        else:
            a = c
        c, d = b - ratio * (b - a), a + ratio * (b - a)
    return (a + b) / 2


def metric_depth(session, rgb, focal_pixels):
    """Camera-axis depth in metres for an RGB array (H, W, 3), and where the model found geometry (not sky)."""
    import numpy as np
    image = (rgb.astype(np.float32) / 255).transpose(2, 0, 1)[None]
    points, _, mask, scale = session.run(None, {'image': image, 'num_tokens': np.array(TOKENS, dtype=np.int64)})
    points, mask = points[0], mask[0] > .5
    height, width = points.shape[:2]
    shift = shift_for_focal(points, mask, focal_pixels / ((height * height + width * width) ** .5 / 2))
    if shift is None:
        return None, None
    depth = (points[..., 2] + shift) * float(np.asarray(scale).reshape(-1)[0])
    return depth, mask & np.isfinite(depth) & (depth > 0)


def frame_ratio(model, image_id, depth, mask, sx, sy):
    """Median metres per unit over one frame's reconstructed points, and how many points it used (None below MIN_POINTS)."""
    import numpy as np
    image = model.image(image_id)
    pose = image.cam_from_world()
    height, width = depth.shape
    ratios = []
    for observation in image.points2D:
        if not observation.has_point3D():
            continue
        z = (pose * model.points3D[observation.point3D_id].xyz)[2]
        u, v = int(observation.xy[0] * sx), int(observation.xy[1] * sy)
        if z > 0 and 0 <= u < width and 0 <= v < height and mask[v, u]:
            ratios.append(depth[v, u] / z)
    return (float(np.median(ratios)), len(ratios)) if len(ratios) >= MIN_POINTS else (None, len(ratios))


def estimate(model, images: Path, session, frames: int = FRAMES) -> dict:
    """The scale estimate for a pycolmap Reconstruction whose frames are in `images`, or why there is none."""
    import numpy as np
    from PIL import Image
    started = time.monotonic()
    ids = sorted(model.reg_image_ids())
    chosen = [ids[i] for i in sorted(set(np.linspace(0, len(ids) - 1, min(frames, len(ids))).astype(int)))]
    per_frame = []
    for image_id in chosen:
        image = model.image(image_id)
        camera = model.camera(image.camera_id)
        with Image.open(images / image.name) as opened:
            rgb = opened.convert('RGB')
        source_width, source_height = rgb.size
        width = WIDTH
        height = max(14, int(round(source_height * width / source_width / 14)) * 14)
        sx, sy = width / source_width, height / source_height
        depth, mask = metric_depth(session, np.asarray(rgb.resize((width, height), Image.BICUBIC)), camera.mean_focal_length() * sx)
        if depth is None:
            continue
        ratio, points = frame_ratio(model, image_id, depth, mask, sx, sy)
        if ratio is not None and np.isfinite(ratio) and ratio > 0:
            per_frame.append({'image': image.name, 'metres_per_unit': round(ratio, 6), 'points': points})
    elapsed = round(time.monotonic() - started, 3)
    model_record = {k: MODEL[k] for k in ('repo', 'revision', 'file', 'sha256', 'base_model', 'license')}
    if len(per_frame) < MIN_FRAMES:
        return {'status': 'unavailable', 'model': model_record, 'frames_tried': len(chosen), 'frames_used': len(per_frame),
                'reason': 'Too few frames had reconstructed points where the depth model saw geometry. Measure a distance instead.',
                'elapsed_seconds': elapsed}
    values = np.array([frame['metres_per_unit'] for frame in per_frame])
    middle = float(np.median(values))
    q1, q3 = np.percentile(values, [25, 75])
    return {'status': 'estimated', 'metres_per_unit': middle,
            'frame_spread_percent': round(float((q3 - q1) / 2 / middle * 100), 2),
            'range_metres_per_unit': [float(values.min()), float(values.max())],
            'frames_tried': len(chosen), 'frames_used': len(per_frame), 'points_used': int(sum(f['points'] for f in per_frame)),
            'per_frame': per_frame, 'model': model_record, 'tokens': TOKENS, 'input_width': WIDTH,
            'method': 'median over frames of the median metric-depth / reconstruction-depth ratio at observed 3D points',
            'measured': False, 'metric_verified': False,
            'label': 'Estimated by a depth model, not measured. Measure one distance to confirm before relying on clearances.',
            'elapsed_seconds': elapsed}
