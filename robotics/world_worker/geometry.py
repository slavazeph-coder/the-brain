"""Bounded, unscaled point-cloud output shared by the reconstruction adapters."""
from __future__ import annotations
import json
import math
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


ARENA_CLOUD_MAX_POINTS = 50_000  # The browser's ARENA_MAX_POINTS hand-off budget.
ARENA_CLOUD_MAX_BYTES = 16 * 1024 ** 2
ARENA_CLOUD_MAX_GRID_CELLS = 250_000  # scene_compiler.MAX_GRID_CELLS


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load_arena_cloud(path: Path):
    """Reads a browser Arena point-cloud hand-off and returns only its validated fields.

    The scale stays exactly what the browser recorded: a metric cloud must say its metres-per-unit came from a distance
    the user measured, self-reported and unverified. Anything else (NaN, extra precision tricks, oversized input) is refused."""
    if path.stat().st_size > ARENA_CLOUD_MAX_BYTES:
        raise ValueError('Point-cloud hand-off is larger than 16 MiB.')
    def reject(constant):
        raise ValueError('Point-cloud hand-off contains a non-finite number.')
    try:
        value = json.loads(path.read_text(encoding='utf-8'), parse_constant=reject)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Point-cloud hand-off is not valid JSON.') from error
    if not isinstance(value, dict) or value.get('version') != 1 or value.get('kind') != 'colmap-sparse-point-cloud' \
            or value.get('coordinateFrame') != 'right-handed-y-up' or value.get('sourceFrame') not in ['colmap', 'right-handed-y-up'] \
            or value.get('units') not in ['m', 'arbitrary']:
        raise ValueError('Not a BrainSNN Arena point-cloud hand-off.')
    points = value.get('points')
    if not isinstance(points, list) or not 1 <= len(points) <= ARENA_CLOUD_MAX_POINTS:
        raise ValueError('The hand-off needs 1 to 50,000 points.')
    for row in points:
        if not (isinstance(row, list) and len(row) == 6 and all(_finite(v) for v in row)
                and all(abs(v) <= MAX_PREVIEW_COORDINATE for v in row[:3]) and all(0 <= v <= 255 for v in row[3:])):
            raise ValueError('Every point must be finite x, y, z within bounds plus red, green, blue from 0 to 255.')
    # Same bound as the scene compiler's unknown-space grid (scene_compiler.MAX_GRID_CELLS over the 2–98% footprint), so a
    # cloud with a few far-apart points is refused at upload instead of occupying the worker for its whole time budget.
    def core(axis):
        values = sorted(row[axis] for row in points)
        def at(q):
            i = (len(values) - 1) * q; lo = math.floor(i)
            return values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (i - lo)
        return at(.02), at(.98)
    (x0, x1), (z0, z1) = core(0), core(2)
    if (math.ceil(x1 / .5) - math.floor(x0 / .5)) * (math.ceil(z1 / .5) - math.floor(z0 / .5)) > ARENA_CLOUD_MAX_GRID_CELLS:
        raise ValueError('The cloud spans an area larger than 250 × 250 m at 0.5 m cells. Check the scale or remove stray points.')
    scale, units = value.get('scale'), value['units']
    if units == 'm':
        if not (isinstance(scale, dict) and scale.get('source') == 'user-measured' and _finite(scale.get('metresPerUnit'))
                and scale['metresPerUnit'] > 0 and scale.get('selfReported') is True and scale.get('verified') is False
                and all(scale.get(k) is None or (_finite(scale[k]) and scale[k] > 0) for k in ['distance', 'spanUnits'])):
            raise ValueError('A metric hand-off must carry its self-reported, unverified user-measured scale.')
        scale = {k: scale.get(k) for k in ['source', 'metresPerUnit', 'distance', 'spanUnits', 'selfReported', 'verified']}
    elif scale is not None:
        raise ValueError('A hand-off in arbitrary units cannot carry a scale.')
    floor = value.get('floorEstimate')
    if floor is not None:
        if not isinstance(floor, dict) or not _finite(floor.get('y')):
            raise ValueError('Invalid floor estimate.')
        # The compiler builds the floor at this height, so it must lie within the points it was estimated from (with a small
        # margin: the browser's histogram estimate of a perfectly flat cloud sits half a bin of a 1-unit span above it).
        ys = [row[1] for row in points]; margin = .05 * (max(ys) - min(ys)) + .05
        if not min(ys) - margin <= floor['y'] <= max(ys) + margin:
            raise ValueError('The floor estimate lies outside the points.')
        origin = floor.get('origin')
        floor = {**{k: floor[k] for k in ['y', 'width', 'depth', 'support'] if _finite(floor.get(k))}, 'units': units,
                 **({'origin': origin} if isinstance(origin, list) and len(origin) == 2 and all(_finite(v) for v in origin) else {})}
    provenance = value.get('provenance') if isinstance(value.get('provenance'), dict) else {}
    provenance = {k: v for k, v in list(provenance.items())[:20] if isinstance(k, str) and len(k) <= 40
                  and (v is None or isinstance(v, bool) or _finite(v))}
    source = value.get('source')
    return {'version': 1, 'kind': 'colmap-sparse-point-cloud', 'units': units, 'coordinateFrame': 'right-handed-y-up',
            'sourceFrame': value['sourceFrame'], 'source': source[:200] if isinstance(source, str) else 'browser hand-off',
            'points': points, 'floorEstimate': floor, 'scale': scale, 'provenance': {**provenance, 'metricVerified': False}}
