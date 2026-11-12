"""A Gaussian-splat PLY (3DGRUT / Inria layout) made compact for the viewer: the 32-byte .splat record the browser reads
(position f32×3, scale f32×3, colour u8×4 from f_dc + opacity, rotation u8×4), sorted by opacity×volume so a sampled
prefix keeps the Gaussians that matter. Appearance only: the output says so in its evidence. No dependency beyond numpy.
Floaters and the few huge background Gaussians are dropped (position core percentile, max scale) so the room, not the
halo, sets the viewer's framing. --frame colmap turns the COLMAP world (y down, z forward) to the viewer's y-up.
usage: python splat_compact.py IN.ply OUT.splat [--max-gaussians N] [--max-scale M] [--core-percentile P] [--min-opacity O] [--frame colmap|y-up] [--metrics metrics.json] [--evidence OUT.json]"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path

MAX_INPUT_BYTES = 2 * 1024 ** 3
MAX_GAUSSIANS = 2_000_000
VIEWER_LIMIT_BYTES = 64 * 1024 ** 2  # artifact-review.mjs: visual artifacts over this are not offered
SH_C0 = 0.28209479177387814
NEEDED = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2']


def read_gaussian_ply(path: Path):
    """Vertices of a binary little-endian Gaussian PLY as a numpy structured array; only the properties the viewer uses."""
    import numpy as np
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError('Expected a regular PLY file under 2 GB.')
    with path.open('rb') as f:
        header = b''
        while not header.endswith(b'end_header\n'):
            chunk = f.readline()
            if not chunk or len(header) > 65536:
                raise ValueError('PLY header is missing or oversized.')
            header += chunk
        lines = header.decode('ascii', 'replace').splitlines()
        if lines[0] != 'ply' or 'format binary_little_endian 1.0' not in lines[1:3]:
            raise ValueError('Expected a binary little-endian PLY (the 3DGRUT / Inria Gaussian export).')
        count, props, in_vertex = None, [], False
        for line in lines:
            m = re.fullmatch(r'element (\w+) (\d+)', line)
            if m:
                in_vertex = m.group(1) == 'vertex'
                if in_vertex: count = int(m.group(2))
                continue
            m = re.fullmatch(r'property (\w+) (\w+)', line)
            if m and in_vertex:
                kind = {'float': '<f4', 'float32': '<f4', 'double': '<f8', 'uchar': 'u1', 'uint8': 'u1'}.get(m.group(1))
                if not kind: raise ValueError(f'Unsupported PLY property type {m.group(1)}.')
                props.append((m.group(2), kind))
        if count is None or not 1 <= count <= MAX_GAUSSIANS * 4:
            raise ValueError('PLY vertex count missing or beyond the supported range.')
        names = [n for n, _ in props]
        missing = [n for n in NEEDED if n not in names]
        if missing:
            raise ValueError('Not a complete Gaussian PLY; missing ' + ', '.join(missing))
        data = np.fromfile(f, dtype=np.dtype(props), count=count)
    if len(data) != count:
        raise ValueError('PLY body is shorter than its header declares.')
    return data


def compact(data, *, max_gaussians: int, max_scale: float = 0.5, core_percentile: float = 0.5, min_opacity: float = 0.02, frame: str = 'y-up'):
    """The 32-byte records, most opaque first, without the floaters and the oversized background fillers.
    Returns (bytes, kept, total, dropped: dict)."""
    import numpy as np
    total = len(data)
    xyz = np.stack([data['x'], data['y'], data['z']], 1).astype(np.float32)
    scale = np.exp(np.stack([data['scale_0'], data['scale_1'], data['scale_2']], 1).astype(np.float32))
    opacity = 1 / (1 + np.exp(-np.clip(data['opacity'].astype(np.float32), -20, 20)))
    rgb = np.clip(0.5 + SH_C0 * np.stack([data['f_dc_0'], data['f_dc_1'], data['f_dc_2']], 1).astype(np.float32), 0, 1)
    rot = np.stack([data['rot_0'], data['rot_1'], data['rot_2'], data['rot_3']], 1).astype(np.float32)
    rot /= np.maximum(np.linalg.norm(rot, axis=1, keepdims=True), 1e-8)
    finite = np.isfinite(xyz).all(1) & np.isfinite(scale).all(1) & np.isfinite(rot).all(1) & np.isfinite(rgb).all(1)
    if frame == 'colmap':  # diag(1,-1,-1): a half turn about x; the local quaternion turns with it, the scales do not
        xyz = xyz * np.array([1, -1, -1], np.float32)
        rot = np.stack([-rot[:, 1], rot[:, 0], -rot[:, 3], rot[:, 2]], 1)
    lo = np.percentile(xyz[finite], core_percentile, axis=0) if finite.any() else np.zeros(3); hi = np.percentile(xyz[finite], 100 - core_percentile, axis=0) if finite.any() else np.zeros(3)
    pad = 0.15 * (hi - lo)
    in_core = ((xyz >= lo - pad) & (xyz <= hi + pad)).all(1)
    small = scale.max(1) <= max_scale
    opaque = opacity >= min_opacity
    keep = finite & in_core & small & opaque
    dropped = {'not_finite': int((~finite).sum()), 'outside_core': int((finite & ~in_core).sum()), 'oversized': int((finite & in_core & ~small).sum()),
               'transparent': int((finite & in_core & small & ~opaque).sum())}
    order = np.argsort(np.where(keep, -opacity, 1.0), kind='stable')[:min(max_gaussians, int(keep.sum()))]
    if len(order) == 0:
        raise ValueError('No Gaussians survive the filters.')
    out = np.zeros(len(order), dtype=np.dtype([('p', '<f4', 3), ('s', '<f4', 3), ('c', 'u1', 4), ('r', 'u1', 4)]))
    out['p'] = xyz[order]; out['s'] = scale[order]
    out['c'][:, :3] = np.rint(rgb[order] * 255); out['c'][:, 3] = np.rint(opacity[order] * 255)
    out['r'] = np.clip(np.rint(rot[order] * 128 + 128), 0, 255)
    return out.tobytes(), len(order), total, dropped


def held_out(metrics_path: Path | None):
    """3DGRUT's metrics.json (held-out PSNR / SSIM / LPIPS), or None. Read-only; the numbers are the training run's own."""
    if not metrics_path or not metrics_path.is_file() or metrics_path.stat().st_size > 1_000_000:
        return None
    m = json.loads(metrics_path.read_text())
    keys = {'psnr': 'mean_psnr', 'ssim': 'mean_ssim', 'lpips': 'mean_lpips'}
    found = {k: round(float(m[v]), 4) for k, v in keys.items() if isinstance(m.get(v), (int, float))}
    return found or None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('ply', type=Path); p.add_argument('out', type=Path)
    p.add_argument('--max-gaussians', type=int, default=MAX_GAUSSIANS); p.add_argument('--metrics', type=Path)
    p.add_argument('--evidence', type=Path); p.add_argument('--max-scale', type=float, default=0.5); p.add_argument('--core-percentile', type=float, default=0.5)
    p.add_argument('--min-opacity', type=float, default=0.02); p.add_argument('--frame', choices=['y-up', 'colmap'], default='y-up')
    a = p.parse_args()
    if not (0 < a.max_scale <= 100 and 0 <= a.core_percentile < 50 and 0 <= a.min_opacity < 1):
        raise SystemExit('filters out of range')
    if not 1 <= a.max_gaussians <= MAX_GAUSSIANS:
        raise SystemExit(f'--max-gaussians must be 1..{MAX_GAUSSIANS}')
    data = read_gaussian_ply(a.ply)
    blob, kept, total, dropped = compact(data, max_gaussians=a.max_gaussians, max_scale=a.max_scale, core_percentile=a.core_percentile, min_opacity=a.min_opacity, frame=a.frame)
    a.out.write_bytes(blob)
    evidence = {'schema': 'brainsnn.visual-splat.v1', 'kind': 'gaussian-splat', 'role': 'appearance',
                'source_ply_sha256': hashlib.sha256(a.ply.read_bytes()).hexdigest(), 'splat_sha256': hashlib.sha256(blob).hexdigest(),
                'gaussians_total': total, 'gaussians_written': kept, 'dropped': dropped, 'filters': {'max_scale_m': a.max_scale, 'core_percentile': a.core_percentile, 'min_opacity': a.min_opacity, 'frame': a.frame}, 'coordinate_frame': 'right-handed-y-up' if a.frame == 'colmap' else 'as exported', 'bytes': len(blob), 'fits_viewer_limit': len(blob) <= VIEWER_LIMIT_BYTES,
                'held_out': held_out(a.metrics), 'metric_verified': False, 'collision_geometry': False,
                'note': 'Trained appearance of the registered frames. Not planning geometry: the reviewed map stays the only collision surface. '
                        'Sharp where the camera looked, soft where it did not; the held-out numbers say how close, on frames the model never saw.'}
    if a.evidence:
        a.evidence.write_text(json.dumps(evidence, indent=2))
    print(f"SPLAT_OK gaussians {kept}/{total} dropped {dropped} bytes {len(blob)} fits_viewer {evidence['fits_viewer_limit']} held_out {evidence['held_out']}")


if __name__ == '__main__':
    main()
