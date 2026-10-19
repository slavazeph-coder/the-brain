"""Bounded, unscaled point-cloud output shared by the reconstruction adapters."""
from __future__ import annotations
from pathlib import Path

MAX_PREVIEW_COORDINATE = 10_000_000  # Same bound as the browser PLY parser.


def write_point_cloud(path: Path, points, colours, *, coordinate_frame: str):
    import numpy as np
    points, colours = np.asarray(points), np.asarray(colours)
    if (points.ndim != 2 or points.shape[1:] != (3,) or not 1 <= len(points) <= 200_000
            or colours.shape != points.shape or not np.isfinite(points).all()
            or not np.isfinite(colours).all() or np.abs(points).max() > MAX_PREVIEW_COORDINATE
            or np.any(colours < 0) or np.any(colours > 255)):
        raise ValueError('Invalid or oversized point cloud.')
    if coordinate_frame not in ['right-handed-y-up', 'colmap']:
        raise ValueError('Unknown point-cloud coordinate frame.')
    with path.open('w', encoding='ascii') as output:
        output.write('ply\nformat ascii 1.0\ncomment BrainSNN visual preview; scale unverified\n'
                     f'element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\n'
                     'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n')
        for point, colour in zip(points, colours):
            output.write(f'{point[0]:.8g} {point[1]:.8g} {point[2]:.8g} '
                         f'{int(colour[0])} {int(colour[1])} {int(colour[2])}\n')
    return {'name': path.name, 'kind': 'visual', 'representation': 'point-cloud',
            'coordinate_frame': coordinate_frame, 'units': 'arbitrary',
            'point_count': len(points), 'bounds': {'min': points.min(axis=0).tolist(),
                                                'max': points.max(axis=0).tolist()}}
