"""Dense points on CPU for a COLMAP reconstruction: monocular depth for each registered frame, aligned to that frame's own
structure-from-motion points, and kept only where neighbouring frames agree.

A single-image depth model predicts relative inverse depth, which is wrong by an unknown scale and shift per frame and
can invent surfaces. Fitting 1/z = s·d + t to the frame's triangulated points fixes the scale and shift in the
reconstruction's own units. Checking every lifted point against the depth predicted for nearby frames removes most
invented surfaces: a point is kept only if at least `min_agree` neighbours see the same depth within `tolerance`.
The result is denser than the sparse cloud, never metric by itself, and still a visual reconstruction, not surveyed
collision geometry.
"""
from __future__ import annotations
import hashlib, math
from pathlib import Path

# The same Apache-2.0 checkpoint the site runs on the device (public/world/depth-worker.mjs), as full-precision ONNX.
MODEL = {'repo': 'onnx-community/depth-anything-v2-small', 'revision': '4472b7362082ad9968fee890ca0f1e5aca36b93d',
         'file': 'onnx/model.onnx', 'sha256': 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c',
         'base_model': 'depth-anything/Depth-Anything-V2-Small', 'license': 'Apache-2.0'}
MODEL_EDGE = 518  # the model's processor target; inputs are resized to a multiple of 14 around it
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)


def load_session(path, threads=4):
    """An ONNX Runtime session for the pinned checkpoint. A file that does not match the pinned hash is refused."""
    import onnxruntime as ort
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for part in iter(lambda: stream.read(1024 ** 2), b''): digest.update(part)
    if digest.hexdigest() != MODEL['sha256']:
        raise RuntimeError(f"{path} is not the pinned {MODEL['repo']}@{MODEL['revision'][:12]} {MODEL['file']}.")
    options = ort.SessionOptions(); options.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])


def model_size(width, height):
    """The processor's keep-aspect resize: scale by whichever of 518/w, 518/h is closer to 1, then round to 14s."""
    sw, sh = MODEL_EDGE / width, MODEL_EDGE / height
    scale = sh if abs(1 - sh) < abs(1 - sw) else sw
    return max(14, round(width * scale / 14) * 14), max(14, round(height * scale / 14) * 14)


def predict_disparity(session, image):
    """Relative inverse depth (larger is nearer) at model resolution for a PIL RGB image."""
    import numpy as np
    from PIL import Image
    w, h = model_size(*image.size)
    x = (np.asarray(image.convert('RGB').resize((w, h), Image.BICUBIC), np.float32) / 255 - MEAN) / STD
    out = session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0]
    return np.asarray(out, np.float32).reshape(h, w)


def fit_inverse_depth(d, z, rounds=3, keep=0.8):
    """Least-squares 1/z = s·d + t over a frame's SfM points (d: disparity at their pixels, z: their camera depth),
    refitted `rounds` times on the `keep` fraction with the smallest residuals (never dropping a point within 1%).
    Returns (s, t, relative error, n) or None when the fit is unusable: too few points, a single depth, or a
    non-positive slope (the depth order disagrees with the geometry)."""
    import numpy as np
    d, inv = np.asarray(d, float), 1.0 / np.asarray(z, float)
    use = np.isfinite(d) & np.isfinite(inv) & (inv > 0)
    d, inv = d[use], inv[use]
    if len(d) < 20 or np.ptp(d) <= 0: return None
    idx = np.arange(len(d))
    for _ in range(rounds):
        A = np.stack([d[idx], np.ones(len(idx))], 1)
        (s, t), *_ = np.linalg.lstsq(A, inv[idx], rcond=None)
        residual = np.abs(s * d + t - inv) / inv
        idx = np.flatnonzero(residual <= max(np.quantile(residual, keep), 0.01))
        if len(idx) < 20 or np.ptp(d[idx]) <= 0: return None
    if s <= 0: return None
    return float(s), float(t), float(np.median(residual[idx])), int(len(idx))


def depth_map(disparity, s, t, z_range):
    """Camera depth from aligned disparity; NaN where the fit gives no depth or one outside z_range (from SfM points)."""
    import numpy as np
    inv = s * disparity + t
    z = np.where(inv > 1e-9, 1.0 / np.maximum(inv, 1e-9), np.nan)
    return np.where((z >= z_range[0]) & (z <= z_range[1]), z, np.nan)


def backproject(z, K, cam_from_world, stride):
    """World points (N, 3) and their (row, col) pixels for every `stride`-th pixel with a depth. K is 3×3 for this map's
    resolution; cam_from_world is 3×4 (COLMAP convention: x right, y down, z forward)."""
    import numpy as np
    rows, cols = np.mgrid[stride // 2:z.shape[0]:stride, stride // 2:z.shape[1]:stride]
    depth = z[rows, cols]; ok = np.isfinite(depth); rows, cols, depth = rows[ok], cols[ok], depth[ok]
    cam = np.stack([(cols + 0.5 - K[0, 2]) / K[0, 0] * depth, (rows + 0.5 - K[1, 2]) / K[1, 1] * depth, depth], 1)
    R, tvec = cam_from_world[:, :3], cam_from_world[:, 3]
    return (cam - tvec) @ R, np.stack([rows, cols], 1)


def agreement(points, z, K, cam_from_world, tolerance):
    """Which points another frame sees (inside its image, in front of it) and, of those, which match its depth."""
    import numpy as np
    cam = points @ cam_from_world[:, :3].T + cam_from_world[:, 3]
    front = cam[:, 2] > 1e-9
    u = np.full(len(points), -1); v = np.full(len(points), -1)
    u[front] = np.floor(cam[front, 0] / cam[front, 2] * K[0, 0] + K[0, 2]).astype(int)
    v[front] = np.floor(cam[front, 1] / cam[front, 2] * K[1, 1] + K[1, 2]).astype(int)
    inside = front & (u >= 0) & (v >= 0) & (u < z.shape[1]) & (v < z.shape[0])
    seen = np.zeros(len(points), bool); agree = np.zeros(len(points), bool)
    there = z[v[inside], u[inside]]; known = np.isfinite(there)
    seen[np.flatnonzero(inside)[known]] = True
    agree[np.flatnonzero(inside)[known]] = np.abs(cam[inside, 2][known] - there[known]) <= tolerance * there[known]
    return seen, agree


def voxel_mean(points, colours, size):
    """One point per occupied voxel: the mean position and colour of the points in it."""
    import numpy as np
    keys = np.floor(points / size).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.reshape(-1)
    out_p = np.zeros((len(counts), 3)); out_c = np.zeros((len(counts), 3))
    np.add.at(out_p, inverse, points); np.add.at(out_c, inverse, colours)
    return out_p / counts[:, None], out_c / counts[:, None]


def fuse(frames, stride=4, neighbours=4, min_agree=2, tolerance=0.02, max_points=50_000):
    """Frames: dicts with z (aligned depth map), K, cam_from_world (3×4), rgb (H×W×3 at the map's resolution) and
    centre. Lifts each frame, keeps points that at least `min_agree` of its nearest `neighbours` frames confirm, and
    voxel-thins the union to at most `max_points`. Returns (points, colours, stats)."""
    import numpy as np
    centres = np.array([f['centre'] for f in frames])
    kept_p, kept_c, lifted = [], [], 0
    for i, f in enumerate(frames):
        pts, px = backproject(f['z'], f['K'], f['cam_from_world'], stride); lifted += len(pts)
        order = np.argsort(np.linalg.norm(centres - centres[i], axis=1))
        votes = np.zeros(len(pts), int)
        for j in [j for j in order if j != i][:neighbours]:
            _, agree = agreement(pts, frames[j]['z'], frames[j]['K'], frames[j]['cam_from_world'], tolerance)
            votes += agree
        ok = votes >= min_agree
        kept_p.append(pts[ok]); kept_c.append(f['rgb'][px[ok, 0], px[ok, 1]].astype(float))
    points, colours = np.concatenate(kept_p) if kept_p else np.zeros((0, 3)), np.concatenate(kept_c) if kept_c else np.zeros((0, 3))
    confirmed = len(points)
    if confirmed == 0: return points, colours, {'lifted': lifted, 'confirmed': 0, 'points': 0, 'voxel': None}
    extent = float(np.max(np.percentile(points, 98, axis=0) - np.percentile(points, 2, axis=0)))
    size = extent / 2000
    while True:
        thin_p, thin_c = voxel_mean(points, colours, size)
        if len(thin_p) <= max_points: break
        size *= 1.25
    return thin_p, thin_c, {'lifted': lifted, 'confirmed': confirmed, 'points': len(thin_p), 'voxel': size}


def frames_from_model(model, images_dir, session, log=print):
    """Aligned depth frames for every registered image of a pycolmap Reconstruction. A frame whose depth cannot be
    aligned to its own SfM points is skipped and counted, never guessed. Returns (frames, stats)."""
    import numpy as np
    from PIL import Image
    frames, skipped, errors = [], 0, []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id); camera = model.camera(image.camera_id)
        with Image.open(Path(images_dir) / image.name) as source:
            rgb_full = source.convert('RGB')
        disparity = predict_disparity(session, rgb_full)
        h, w = disparity.shape; sx, sy = w / camera.width, h / camera.height
        K = camera.calibration_matrix().copy(); K[0] *= sx; K[1] *= sy
        M = np.asarray(image.cam_from_world().matrix())
        tracked = [p for p in image.points2D if p.has_point3D()]
        xyz = np.array([model.points3D[p.point3D_id].xyz for p in tracked]).reshape(-1, 3)
        z = xyz @ M[:, :3].T[:, 2] + M[2, 3] if len(xyz) else np.zeros(0)
        cols = np.clip((np.array([p.xy[0] for p in tracked]) * sx).astype(int), 0, w - 1)
        rows = np.clip((np.array([p.xy[1] for p in tracked]) * sy).astype(int), 0, h - 1)
        front = z > 0
        fit = fit_inverse_depth(disparity[rows[front], cols[front]], z[front]) if front.sum() else None
        if not fit or fit[2] > 0.25:
            skipped += 1; continue
        s, t, error, n = fit; errors.append(error)
        lo, hi = np.percentile(z[front], [2, 98])
        frames.append({'name': image.name, 'z': depth_map(disparity, s, t, (0.5 * lo, 2.0 * hi)), 'K': K, 'cam_from_world': M,
                       'rgb': np.asarray(rgb_full.resize((w, h))), 'centre': np.asarray(image.projection_center()), 'fit_points': n})
    stats = {'frames': len(frames), 'skipped_frames': skipped,
             'median_alignment_error': float(np.median(errors)) if errors else None}
    log(f'aligned depth for {len(frames)} frames ({skipped} skipped), median relative error {stats["median_alignment_error"]}')
    return frames, stats
