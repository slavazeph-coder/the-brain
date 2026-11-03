"""One photo to a 3D point preview in estimated metres, with MoGe-2 (the scan scale model, metric_scale.py).

The photo is prepared like a scan frame (EXIF orientation applied, metadata stripped, 1280-px edge). MoGe-2 predicts its
3D points up to a depth shift, plus a metric scale. Without a scan, the focal length is unknown, so the focal length and
the shift are solved together: they are the pair under which every point projects back onto its own pixel. Points the
model marks as no geometry (sky, infinity) and points at depth edges, where a pixel straddles two surfaces, are dropped.

It is a preview of what the photo shows, in metres estimated by a learned model: not measured, not generative (nothing
is invented behind what the camera saw), and never a collision map. Hidden surfaces are simply missing.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

try:
    from . import metric_scale, sparse_colmap
    from .geometry import write_point_cloud
except ImportError:
    import metric_scale
    import sparse_colmap
    from geometry import write_point_cloud

MODEL_EDGE = 644  # the longer side of the model input, a multiple of 14 (metric_scale.WIDTH)
EDGE_TOLERANCE = 0.04  # a pixel whose 3x3 neighbourhood spans more than 4% of its depth straddles two surfaces
MAX_POINTS = 120_000


def solve_focal_and_shift(points, mask):
    """MoGe's own recovery when the camera is unknown: for each candidate shift, the focal length that best projects
    the points onto their pixels has a closed form; the shift is the one with the smallest projection error.
    Returns (focal relative to half the image diagonal, shift), or None without enough geometry."""
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

    def fit(shift):
        z = xyz[:, 2] + shift
        if np.any(z <= 1e-6):
            return np.inf, None
        q = xyz[:, :2] / z[:, None]
        focal = float(np.sum(q * uv) / max(np.sum(q * q), 1e-12))
        return float(np.sum((focal * q - uv) ** 2)), focal
    lo = -float(xyz[:, 2].min()) + 1e-4
    hi = lo + 20 * (float(np.median(np.abs(xyz[:, 2]))) + 1)
    ratio = (5 ** .5 - 1) / 2
    a, b = lo, hi
    c, d = b - ratio * (b - a), a + ratio * (b - a)
    for _ in range(60):
        if fit(c)[0] < fit(d)[0]:
            b = d
        else:
            a = c
        c, d = b - ratio * (b - a), a + ratio * (b - a)
    shift = (a + b) / 2
    error, focal = fit(shift)
    return (focal, shift) if focal and focal > 0 and np.isfinite(error) else None


def depth_edges(depth, tolerance=EDGE_TOLERANCE):
    """True where the 3x3 neighbourhood's depth range exceeds `tolerance` of the pixel's depth."""
    import numpy as np
    padded = np.pad(depth, 1, mode='edge')
    stack = np.stack([padded[i:i + depth.shape[0], j:j + depth.shape[1]] for i in range(3) for j in range(3)])
    return (stack.max(0) - stack.min(0)) > tolerance * np.maximum(depth, 1e-6)


def metric_points(session, rgb):
    """Camera-frame points in metres (x right, y down, z forward) for an RGB array, the keep mask, and the camera."""
    import numpy as np
    height, width = rgb.shape[:2]
    image = (rgb.astype(np.float32) / 255).transpose(2, 0, 1)[None]
    points, _, mask, scale = session.run(None, {'image': image, 'num_tokens': np.array(metric_scale.TOKENS, dtype=np.int64)})
    points, mask, scale = points[0].astype(np.float64), mask[0] > .5, float(np.asarray(scale).reshape(-1)[0])
    if not (np.isfinite(scale) and scale > 0):
        raise ValueError('The depth model gave no metric scale for this photo.')
    solved = solve_focal_and_shift(points, mask)
    if solved is None:
        raise ValueError('The depth model found too little geometry in this photo to place it in 3D.')
    focal, shift = solved
    points[..., 2] += shift
    points *= scale
    depth = points[..., 2]
    keep = mask & np.isfinite(points).all(-1) & (depth > 0)
    keep &= ~depth_edges(np.where(keep, depth, 0))
    focal_pixels = focal * (height * height + width * width) ** .5 / 2
    return points, keep, {'focal_pixels': focal_pixels, 'width': width, 'height': height}


def run(request: dict, model: Path) -> dict:
    import numpy as np
    from PIL import Image
    inputs = request.get('inputs', [])
    if request.get('schema') != 'brainsnn.adapter.v1' or len(inputs) != 1 or inputs[0].get('kind') != 'image':
        raise ValueError('A metric photo preview needs exactly one photo.')
    session = metric_scale.load_session(model, sparse_colmap.THREADS)  # a wrong file is refused before any work
    started = time.monotonic()
    out = Path(request['output_dir']).resolve()
    out.mkdir(parents=True, exist_ok=True)
    prepared = out.parent / 'photo-metric-work' / 'photo.jpg'
    prepared.parent.mkdir(parents=True, exist_ok=True)
    preparation = sparse_colmap.prepare_photo(Path(inputs[0]['path']), prepared, with_evidence=True)
    with Image.open(prepared) as opened:
        photo = opened.convert('RGB')
    scale = MODEL_EDGE / max(photo.size)
    size = tuple(max(14, int(round(side * scale / 14)) * 14) for side in photo.size)
    rgb = np.asarray(photo.resize(size, Image.BICUBIC))
    points, keep, camera = metric_points(session, rgb)
    kept = int(keep.sum())
    if kept < 1000:
        raise ValueError('Too little of this photo could be placed in 3D. Try a photo with more visible surfaces.')
    xyz, colours = points[keep], rgb[keep]
    if len(xyz) > MAX_POINTS:
        pick = np.linspace(0, len(xyz) - 1, MAX_POINTS).astype(int)
        xyz, colours = xyz[pick], colours[pick]
    # The site's photo previews are right-handed with y up and the camera looking down -z.
    visual = write_point_cloud(out / 'photo-metric.ply', xyz * [1, -1, -1], colours, coordinate_frame='right-handed-y-up')
    depth = points[..., 2][keep]
    fov = 2 * np.degrees(np.arctan(camera['width'] / 2 / camera['focal_pixels']))
    evidence = {
        'schema': 'brainsnn.photo-metric.v1', 'engine': 'photo-metric',
        'photo': {'sha256': preparation['sourceSha256'], 'source_width': preparation['sourceWidth'],
                  'source_height': preparation['sourceHeight'], 'model_input': list(size)},
        'model': {k: metric_scale.MODEL[k] for k in ('repo', 'revision', 'file', 'sha256', 'base_model', 'license')},
        'tokens': metric_scale.TOKENS,
        'camera': {'estimated_horizontal_fov_degrees': round(float(fov), 2), 'focal_pixels_at_model_input': round(float(camera['focal_pixels']), 2),
                   'source': 'estimated from the photo by the model; no EXIF or calibration used'},
        'depth_metres': {'p5': round(float(np.percentile(depth, 5)), 3), 'median': round(float(np.median(depth)), 3),
                         'p95': round(float(np.percentile(depth, 95)), 3)},
        'points': {'kept': kept, 'published': len(xyz), 'dropped_as_no_geometry_or_edges': int(keep.size - kept)},
        'units': 'metres, estimated by a depth model; not measured', 'coordinate_frame': 'right-handed-y-up, camera at the origin looking down -z',
        'measured': False, 'metric_verified': False, 'generative': False, 'collision_ready': False,
        'hidden_surfaces': 'not reconstructed: only surfaces the photo shows',
        'label': 'A 3D preview of one photo in estimated metres. Not measured, nothing invented behind what the camera saw, '
                 'and not a collision map. For a map, walk the space and reconstruct it.',
        'elapsed_seconds': round(time.monotonic() - started, 3)}
    (out / 'photo-metric.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [visual, {'name': 'photo-metric.json', 'kind': 'evidence'}]}))
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-manifest', required=True)
    parser.add_argument('--model', type=Path, required=True, help='the pinned MoGe-2 ViT-B ONNX file (metric_scale.MODEL)')
    args = parser.parse_args()
    request = Path(args.input_manifest)
    if request.stat().st_size > 65536:
        raise ValueError('Input manifest is too large.')
    run(json.loads(request.read_text()), args.model)


if __name__ == '__main__':
    main()
