"""Evidence-preserving terrain focus, inspired by ETH Zurich Watch Your Step.

Pure Python; no robot commands, learned policy, downloads or guessed hole filling.
BrainSNN (X,Y-up,Z) -> Isaac (X,-Z,Y). Grid indices are [left,forward].
The 102-value layout is [p1.xy, patch1(49), p2.xy, patch2(49)].
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

NX, NY, RESOLUTION = 33, 21, 0.05
ORIGIN = (-0.8, -0.5)
SCHEMA = 'brainsnn.foothold-focus.v1'
MAX_POINTS = 250_000
WARNINGS = [
    'Coverage is not load-bearing support, collision clearance or physical accuracy.',
    'Unknown, mixed-height and out-of-bounds cells are never replaced by flat ground.',
    'This scan snapshot is not a live elevation map; moving objects are not tracked.',
    'No locomotion policy, physics simulation or physical robot was executed.',
]


def number(value, bound=10000.0):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > bound:
        raise ValueError('Expected a finite bounded number, not a boolean or string.')
    return float(value)


def vector(value, length):
    if not isinstance(value, (list, tuple)) or len(value) != length:
        raise ValueError(f'Expected {length} coordinates.')
    return [number(v) for v in value]


def cloud_grid(cloud, base_position, yaw_rad=0.0, min_points=2, max_spread_m=0.03):
    """Bin observed points only. No interpolation, erosion, extrapolation or floor fill.

    Yaw is Isaac +Z-up (positive toward left), not a Three.js +Y Euler angle.
    Below-base vertical window is [base_y-2, base_y-0.05] metres. Vertical
    surfaces and multiple elevations can make cells ambiguous; this is NOT
    an approved walking surface classifier.
    """
    if not isinstance(cloud, dict) or cloud.get('units') != 'm' or cloud.get('coordinateFrame') != 'right-handed-y-up':
        raise ValueError('Explicit metre-scaled, right-handed Y-up source cloud required.')
    points = cloud.get('points')
    if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
        raise ValueError('Expected 1 to 250000 source points.')
    base = vector(base_position, 3); yaw = number(yaw_rad, 2 * math.pi)
    if type(min_points) is not int or not 1 <= min_points <= 100:
        raise ValueError('min_points must be an integer from 1 to 100.')
    spread = number(max_spread_m, 0.25)
    if spread <= 0:
        raise ValueError('A positive spread bound is required.')
    cells = [[] for _ in range(NX * NY)]; c, s = math.cos(yaw), math.sin(yaw)
    for row in points:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            raise ValueError('Every point needs XYZ coordinates.')
        x, y, z = vector(row[:3], 3)
        if not base[1] - 2 <= y <= base[1] - .05:
            continue
        dx, dy = x - base[0], -(z - base[2])
        sx, sy = c * dx + s * dy, -s * dx + c * dy
        if not ORIGIN[0] <= sx <= -ORIGIN[0] or not ORIGIN[1] <= sy <= -ORIGIN[1]:
            continue
        ix, iy = round((sx - ORIGIN[0]) / RESOLUTION), round((sy - ORIGIN[1]) / RESOLUTION)
        cells[iy * NX + ix].append(y)
    heights, reasons = [], []
    for cell in cells:
        reason = 'unobserved' if not cell else 'insufficient-points' if len(cell) < min_points else 'mixed-height' if max(cell) - min(cell) > spread else 'observed'
        reasons.append(reason)
        heights.append(base[1] - math.fsum(cell) / len(cell) - .5 if reason == 'observed' else None)
    return {'shape': [NY, NX], 'resolution_m': RESOLUTION, 'origin_xy_m': list(ORIGIN),
            'height_scan': heights, 'cell_status': reasons, 'base_position_brainsnn_m': base,
            'sensor_yaw_rad': yaw, 'min_points': min_points, 'max_spread_m': spread,
            'vertical_window_m': [base[1] - 2, base[1] - .05], 'source_point_count': len(points)}


def scan_anchor(value, origin):
    # Match the pinned model's float32 arithmetic before nearest-even rounding.
    f32 = lambda v: struct.unpack('f', struct.pack('f', v))[0]
    return round(f32(f32(f32(value) - f32(origin)) / f32(RESOLUTION)))


def sample_patches(height_scan, footholds_base, footholds_sensor=None):
    """Match upstream ij-flattening for known in-bounds cells; abstain otherwise.

    Supply separately transformed sensor coordinates for a tilted/offset base.
    Omitting them asserts coincident upright base and yaw-aligned sensor frames.
    Heights are sensor_z - surface_z - 0.5, in metres, not absolute elevations.
    """
    if not isinstance(height_scan, list) or len(height_scan) != NX * NY:
        raise ValueError('Expected the full 21 by 33 height scan (693 values).')
    scan = [None if v is None else number(v) for v in height_scan]
    if not isinstance(footholds_base, (list, tuple)) or len(footholds_base) != 2:
        raise ValueError('Exactly two footholds are required.')
    base = [vector(p, 2) for p in footholds_base]
    sensor = base if footholds_sensor is None else footholds_sensor
    if not isinstance(sensor, (list, tuple)) or len(sensor) != 2:
        raise ValueError('Exactly two sensor-frame footholds are required.')
    sensor = [vector(p, 2) for p in sensor]
    patches, raw = [], []
    for p, q in zip(base, sensor):
        ax, ay = [scan_anchor(q[i], ORIGIN[i]) for i in range(2)]
        indices, heights, statuses = [], [], []
        for ox in range(-3, 4):
            for oy in range(-3, 4):
                x, y = ax + ox, ay + oy
                inside = 0 <= x < NX and 0 <= y < NY
                index = y * NX + x if inside else None
                height = scan[index] if inside else None
                indices.append(index); heights.append(height)
                statuses.append('outside-map' if not inside else 'unknown' if height is None else 'observed')
        known = [v for v in heights if v is not None]
        patches.append({'foothold_base_xy_m': p, 'foothold_sensor_xy_m': q, 'anchor_xy': [ax, ay],
                        'indices': indices, 'heights': heights, 'status': statuses, 'known_count': len(known),
                        'height_range_m': max(known) - min(known) if known else None})
        raw.extend(p + heights)
    complete = all(v is not None for v in raw)
    return {'schema': SCHEMA, 'layout': 'p1.xy,h1[49],p2.xy,h2[49];patch=x-outer,y-inner',
            'patches': patches, 'input_values': 102, 'full_map_values': 693,
            'sample_complete': complete, 'observation_raw': raw if complete else None,
            'observation_clipped': [max(-1., min(1., v)) for v in raw] if complete else None,
            'validity_mask': [v is not None for p in patches for v in p['heights']],
            'physics_executed': False, 'robot_control_enabled': False, 'metric_verified': False,
            'checkpoint_compatible': False, 'warnings': list(WARNINGS)}


def inspect_cloud(cloud, query):
    if not isinstance(query, dict) or query.get('schema') != 'brainsnn.foothold-query.v1':
        raise ValueError('Expected a brainsnn.foothold-query.v1 query.')
    grid = cloud_grid(cloud, query.get('base_position_brainsnn_m'), query.get('yaw_rad', 0),
                      query.get('min_points', 2), query.get('max_spread_m', .03))
    result = sample_patches(grid['height_scan'], query.get('footholds_base_xy_m'))
    result.update(grid=grid, foothold_basis='operator-query-not-model-prediction',
                  source_basis='observed-point-binning-not-raycast', query=query)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--cloud', type=Path, required=True); p.add_argument('--query', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True); a = p.parse_args()
    if a.cloud.stat().st_size > 64 * 1024**2 or a.query.stat().st_size > 16384:
        raise ValueError('Input file size limit exceeded.')
    raw = a.cloud.read_bytes(); query_raw = a.query.read_bytes()
    result = inspect_cloud(json.loads(raw), json.loads(query_raw))
    result['source_cloud_sha256'] = hashlib.sha256(raw).hexdigest()
    result['query_sha256'] = hashlib.sha256(query_raw).hexdigest()
    with a.out.open('x', encoding='utf-8') as out:
        json.dump(result, out, indent=2, allow_nan=False); out.write('\n')
    print(json.dumps({'report': str(a.out), 'sample_complete': result['sample_complete'], 'robot_control_enabled': False}))


if __name__ == '__main__':
    main()
