"""Simulation scene (GLB/USD) from a walkthrough: sparse COLMAP -> Arena hand-off -> Blender scene compiler.

It also accepts the browser's Arena point-cloud hand-off (input kind "cloud") instead of a video: COLMAP is skipped, and
a cloud the user scaled with a measured distance compiles to a metric scene with scene.usda.

Reuses sparse_colmap.run() for the reconstruction, mirrors the browser's toArenaCloud()
(brainsnn-r3f-app/public/world/visual-geometry.mjs) in Python so the worker hands the scene
compiler exactly what a user export would, then runs robotics/scene_compiler/scene_compiler.py
headless in Blender. Units stay arbitrary unless the request carries a user-measured scale;
nothing here verifies metric scale or authors collision geometry.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import time

try:
    from . import cad_export, detector_names, fit_check, measurement_check, object_names, sparse_colmap
    from .geometry import load_arena_cloud
except ImportError:
    import cad_export
    import detector_names
    import fit_check
    import measurement_check
    import object_names
    import sparse_colmap
    from geometry import load_arena_cloud

SCENE_COMPILER = Path(__file__).resolve().parents[1] / 'scene_compiler' / 'scene_compiler.py'
BUILDING_SCHEMA = 'brainsnn.building.v1'  # robotics/scene_compiler/building_model.py writes it
ARENA_MAX_POINTS = 50_000
BLENDER_TIMEOUT = 900


def read_ply(path: Path):
    """Rows [x, y, z, r, g, b] from the ASCII PLY that geometry.write_point_cloud emits (float32 like the browser)."""
    import numpy as np
    with path.open('r', encoding='ascii') as stream:
        header = [line.strip() for line in iter(stream.readline, '')]
        if 'format ascii 1.0' not in header[:3]:
            raise ValueError('Expected the ASCII PLY written by the reconstruction adapter.')
        body = header[header.index('end_header') + 1:]
    rows = []
    for line in body:
        if not line:
            continue
        x, y, z, r, g, b = line.split()
        rows.append([*np.array([x, y, z], dtype=np.float32).tolist(), int(r), int(g), int(b)])
    if not rows:
        raise ValueError('The reconstruction preview holds no points.')
    return rows


# ---------- toArenaCloud() port; each helper keeps the name and semantics of its JS original ----------
def frame_bounds(rows):
    """The box of kept points: per-axis 2nd-98th percentile core widened by 15% of its size on every side, when that
    trims real outliers, else the full extent. A room's walls are its own extremes, so the core alone cut them. As the
    browser does."""
    axes = [[row[j] for row in rows] for j in range(3)]
    full_lo, full_hi = [min(axis) for axis in axes], [max(axis) for axis in axes]
    full_radius = max(.001, math.hypot(*[hi - lo for lo, hi in zip(full_lo, full_hi)]) / 2)
    count = len(rows)
    if count < 50:
        return full_lo, full_hi, False
    ordered = [sorted(axis) for axis in axes]
    lo = [axis[math.floor(count * .02)] for axis in ordered]
    hi = [axis[min(count - 1, math.ceil(count * .98))] for axis in ordered]
    radius = max(.001, math.hypot(*[h - l for l, h in zip(lo, hi)]) / 2)
    pad = [(h - l) * .15 for l, h in zip(lo, hi)]
    lo, hi = [max(f, l - p) for f, l, p in zip(full_lo, lo, pad)], [min(f, h + p) for f, h, p in zip(full_hi, hi, pad)]
    return (lo, hi, True) if radius < full_radius * .9 else (full_lo, full_hi, False)


def fit_floor_plane(rows, iterations: int = 300):
    """RANSAC floor plane of a roughly Y-up cloud; deterministic LCG (seed 7), same candidate order as the browser."""
    if len(rows) < 50:
        return None
    radius = math.hypot(*[max(r[j] for r in rows) - min(r[j] for r in rows) for j in range(3)]) / 2
    tol = max(1e-6, radius * .015)
    ys = sorted(r[1] for r in rows)
    low_y = ys[math.floor(len(ys) * .5)]
    low = [r for r in rows if r[1] <= low_y]
    seed, best = 7, None

    def rand():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        return seed / 4294967296

    for _ in range(iterations):
        a, b, c = [low[math.floor(rand() * len(low))] for _ in range(3)]
        u, v = [b[j] - a[j] for j in range(3)], [c[j] - a[j] for j in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        length = math.hypot(*n)
        if length < 1e-9:
            continue
        n = [value / length for value in n]
        if abs(n[1]) < math.sqrt(.5):
            continue
        d = -(n[0] * a[0] + n[1] * a[1] + n[2] * a[2])
        inliers = above = 0
        for r in rows:
            s = n[0] * r[0] + n[1] * r[1] + n[2] * r[2] + d
            if abs(s) <= tol:
                inliers += 1
            elif s > 0:
                above += 1
        up = max(above, len(rows) - inliers - above)
        if not best or inliers > best['inliers'] or (inliers == best['inliers'] and up > best['up']):
            best = {'normal': n, 'inliers': inliers, 'above': above, 'up': up}
    if not best:
        return None
    flip = -1 if best['above'] < (len(rows) - best['inliers']) / 2 else 1
    return floor_along(rows, [value * flip for value in best['normal']], tol)


def floor_along(rows, n, tol, lowest: bool = False):
    """The floor plane with a given up-normal: the lowest dense layer along it (not merely the densest), or with
    `lowest`, the room's lowest points (median of the lowest 0.5%) for a floor the cameras barely saw. As the browser."""
    heights = [n[0] * r[0] + n[1] * r[1] + n[2] * r[2] for r in rows]
    lo, width = min(heights), 2 * tol
    counts: dict[int, int] = {}
    for h in heights:
        counts[math.floor((h - lo) / width)] = counts.get(math.floor((h - lo) / width), 0) + 1
    peak = max(counts.values())
    bin_index = next(i for i in range(max(counts) + 1) if counts.get(i, 0) >= peak * .8)
    # Through the layer itself, not its bin's centre (a layer can straddle a bin edge): the median of the chosen bin's own
    # points, so a denser surface in the next bin never wins, then of the points within tolerance of it. As the browser does.
    median = lambda v: sorted(v)[len(v) // 2]
    around = (median(sorted(heights)[:max(5, math.floor(len(heights) * .005))]) if lowest
              else median([h for h in heights if math.floor((h - lo) / width) == bin_index]))
    d = -median([h for h in heights if abs(h - around) <= tol])
    inliers = sum(abs(h + d) <= tol for h in heights)
    return {'normal': n, 'd': d, 'inlierFraction': inliers / len(rows), 'tolerance': tol}


def room_axes(rows, planes: int = 6, iterations: int = 200):
    """The room's own three axes from its largest planes: planes found one after another by RANSAC (LCG seed 13, the
    browser's sampling) and refined through their inliers, then the orthogonal frame their normals agree on most."""
    import numpy as np
    if len(rows) < 200:
        return None
    step = max(1, len(rows) // 20000)
    pts = np.asarray([r[:3] for i, r in enumerate(rows) if i % step == 0], float)
    radius = float(np.linalg.norm(pts.max(0) - pts.min(0))) / 2
    tol = max(1e-6, radius * .015)
    seed = 13

    def rand():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        return seed / 4294967296

    free, found = np.arange(len(pts)), []
    for _ in range(planes):
        if len(free) < 3:
            break
        best = None
        for _ in range(iterations):
            a, b, c = (pts[free[math.floor(rand() * len(free))]] for _ in range(3))
            raw = np.cross(b - a, c - a)
            if np.linalg.norm(raw) < 1e-12:
                continue
            n = raw / np.linalg.norm(raw); d = -float(n @ a)
            count = int((np.abs(pts[free] @ n + d) <= tol).sum())
            if best is None or count > best[2]:
                best = (n, d, count)
        if best is None or best[2] < .03 * len(pts):
            break
        ins = pts[free[np.abs(pts[free] @ best[0] + best[1]) <= tol]]
        n = np.linalg.eigh(np.cov(ins.T, bias=True))[1][:, 0]  # the direction of least spread
        if n @ best[0] < 0:
            n = -n
        on = np.abs(pts[free] @ n - float(n @ ins.mean(0))) <= tol
        found.append((n, int(on.sum()))); free = free[~on]
    cos10, sin10, frame = math.cos(math.pi / 18), math.sin(math.pi / 18), None
    for i in range(len(found)):
        for j in range(i + 1, len(found)):
            a, nb = found[i][0], found[j][0]
            if abs(a @ nb) > sin10:
                continue
            b = nb - (nb @ a) * a; b /= np.linalg.norm(b); axes = [a, b, np.cross(a, b)]
            score = sum(f[1] for f in found if any(abs(x @ f[0]) >= cos10 for x in axes))
            if frame is None or score > frame[1]:
                frame = (axes, score)
    return frame and {'axes': [list(map(float, x)) for x in frame[0]], 'support': frame[1] / len(pts), 'planes': len(found)}


def square_to_room(rows, plane):
    """A weakly supported floor (under a quarter of the points) squared to the nearest room axis within 20 degrees when
    the room's planes carry 30% of the points; the floor is the room's lowest points when the dense layer has over 5% of
    the room below it. None keeps the fitted plane. As the browser does."""
    if not plane or plane['inlierFraction'] >= .25:
        return None
    room = room_axes(rows)
    if not room or room['support'] < .3:
        return None
    n = plane['normal']; dot = lambda a: a[0] * n[0] + a[1] * n[1] + a[2] * n[2]
    near = max(room['axes'], key=lambda a: abs(dot(a)))
    angle = math.acos(min(1, abs(dot(near))))
    if angle < math.pi / 360 or angle > math.pi / 9:
        return None
    up = [v * math.copysign(1, near[1]) for v in near]  # the +y side, where the floor search looks (as the browser)
    layer = floor_along(rows, up, plane['tolerance'])
    below = sum(up[0] * r[0] + up[1] * r[1] + up[2] * r[2] < -layer['d'] - plane['tolerance'] for r in rows) / len(rows)
    return {**(floor_along(rows, up, plane['tolerance'], lowest=True) if below > .05 else layer), 'squaredToRoom': True,
            'roomAxes': [a for a in room['axes'] if a is not near]}


def room_yaw(plane, yaw):
    """The heading that runs a squared room's walls along X and Z: of its horizontal axes turned upright, the one nearest
    the floor band's own heading."""
    angles = []
    for a in plane['roomAxes']:
        h = align_to_floor([[a[0], a[1], a[2], 0, 0, 0]], {**plane, 'd': 0})[0]
        angles.append(math.atan2(h[0], h[2]))
    gap = lambda t: abs(math.fmod(math.fmod(t - yaw, math.pi) + 1.5 * math.pi, math.pi) - math.pi / 2)
    best = min(angles, key=gap)
    return yaw + (math.fmod(math.fmod(best - yaw, math.pi) + 1.5 * math.pi, math.pi) - math.pi / 2)


def floor_band(rows, y, half):
    """The floor footprint at a known height: the points within `half` of it."""
    band = [r for r in rows if abs(r[1] - y) <= half]
    if len(band) < 5:
        return None
    xs, zs = sorted(r[0] for r in band), sorted(r[2] for r in band)
    q = lambda v, f: v[min(len(v) - 1, math.floor(len(v) * f))]
    return {'y': y, 'origin': [q(xs, .02), q(zs, .02)], 'width': q(xs, .98) - q(xs, .02), 'depth': q(zs, .98) - q(zs, .02),
            'support': len(band) / len(rows), 'units': 'arbitrary'}


def align_to_floor(rows, plane):
    """Rotates rows so plane.normal becomes +Y and the plane passes through y=0."""
    n, d = plane['normal'], plane['d']
    c, s = n[1], math.hypot(n[0], n[2])
    if s < 1e-9:
        return [[r[0], r[1] + d * ((c > 0) - (c < 0)), r[2], r[3], r[4], r[5]] for r in rows]
    ax, az, t = -n[2] / s, n[0] / s, 1 - c
    R = [[c + ax * ax * t, -az * s, ax * az * t], [az * s, c, -ax * s], [ax * az * t, ax * s, c + az * az * t]]
    return [[sum(R[0][j] * r[j] for j in range(3)), sum(R[1][j] * r[j] for j in range(3)) + d,
             sum(R[2][j] * r[j] for j in range(3)), r[3], r[4], r[5]] for r in rows]


def floor_yaw(rows, tol):
    """Heading of the floor band's principal axis (PCA on x,z near y=0), radians from +Z."""
    band = [r for r in rows if abs(r[1]) <= tol]
    if len(band) < 20:
        return 0
    mx, mz = sum(r[0] for r in band) / len(band), sum(r[2] for r in band) / len(band)
    sxx = sum((r[0] - mx) ** 2 for r in band)
    sxz = sum((r[0] - mx) * (r[2] - mz) for r in band)
    szz = sum((r[2] - mz) ** 2 for r in band)
    return math.atan2(2 * sxz, szz - sxx) / 2


def rotate_y(rows, angle):
    c, s = math.cos(angle), math.sin(angle)
    return [[r[0] * c + r[2] * s, r[1], -r[0] * s + r[2] * c, r[3], r[4], r[5]] for r in rows]


def arena_transform(k: float, flip: int, plane, aligned: bool, yaw: float):
    """to_arena_cloud's mapping from source coordinates to hand-off coordinates as a 3 x 4 matrix [A | t]: scale and
    flip, then the floor alignment (align_to_floor), then the heading turn (rotate_y by -yaw)."""
    S = [[k, 0, 0], [0, k * flip, 0], [0, 0, k * flip]]
    A, t = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.0, 0.0, 0.0]
    if aligned:
        n, d = plane['normal'], plane['d']
        c, s = n[1], math.hypot(n[0], n[2])
        if s < 1e-9:
            t = [0.0, d * ((c > 0) - (c < 0)), 0.0]
        else:
            ax, az, v = -n[2] / s, n[0] / s, 1 - c
            A, t = [[c + ax * ax * v, -az * s, ax * az * v], [az * s, c, -ax * s], [ax * az * v, ax * s, c + az * az * v]], [0.0, d, 0.0]
    a = -yaw
    Ry = [[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]]
    mul = lambda X, Y: [[sum(X[i][m] * Y[m][j] for m in range(3)) for j in range(3)] for i in range(3)]
    M = mul(Ry, mul(A, S)); u = [sum(Ry[i][m] * t[m] for m in range(3)) for i in range(3)]
    return [[*M[i], u[i]] for i in range(3)]


def estimate_floor(rows, bins: int = 40):
    """Dominant low horizontal band of a Y-up cloud: a floor suggestion in cloud units, never a measurement."""
    if len(rows) < 50:
        return None
    ys = sorted(r[1] for r in rows)
    lo, hi = ys[0], ys[-1]
    span = (hi - lo) or 1
    counts = [0] * bins
    for y in ys:
        counts[min(bins - 1, math.floor((y - lo) / span * bins))] += 1
    limit = math.ceil(bins / 3)
    bin_index = 0
    for i in range(limit):
        if counts[i] > counts[bin_index]:
            bin_index = i
    y0, y1 = lo + (bin_index - 1) * span / bins, lo + (bin_index + 2) * span / bins
    band = [r for r in rows if y0 <= r[1] <= y1]
    xs, zs = sorted(r[0] for r in band), sorted(r[2] for r in band)

    def q(values, fraction):
        return values[min(len(values) - 1, math.floor(len(values) * fraction))]

    return {'y': lo + (bin_index + .5) * span / bins, 'origin': [q(xs, .02), q(zs, .02)],
            'width': q(xs, .98) - q(xs, .02), 'depth': q(zs, .98) - q(zs, .02),
            'support': len(band) / len(rows), 'units': 'arbitrary'}


def to_arena_cloud(rows, *, coordinate_frame: str = 'right-handed-y-up', source: str = 'World Builder reconstruction',
                   metres_per_unit=None, measurement: dict | None = None, budget: int = ARENA_MAX_POINTS):
    """Arena hand-off: 2nd-98th percentile core, COLMAP (y down, z forward) turned Y-up, floor-aligned only on a
    confident floor, heading squared to the floor band, thinned to the budget. Same keys as the browser export."""
    lo, hi, trimmed = frame_bounds(rows)
    flip = -1 if coordinate_frame == 'colmap' else 1
    metric = isinstance(metres_per_unit, (int, float)) and math.isfinite(metres_per_unit) and metres_per_unit > 0
    k = float(metres_per_unit) if metric else 1.0
    core = [[k * r[0], k * flip * r[1], k * flip * r[2], r[3], r[4], r[5]]
            for r in rows if all(lo[j] <= r[j] <= hi[j] for j in range(3))]
    step = max(1, math.ceil(len(core) / budget))
    fitted = fit_floor_plane(core)
    plane = square_to_room(core, fitted) or fitted
    squared = bool(plane and plane.get('squaredToRoom'))
    upright = align_to_floor(core, plane) if plane and (plane['inlierFraction'] >= .1 or squared) else None
    yaw = floor_yaw(upright, plane['tolerance']) if upright and plane else 0
    yaw = room_yaw(plane, yaw) if upright and squared else yaw
    aligned = rotate_y(upright, -yaw) if upright else core
    kept, units = aligned[::step], 'm' if metric else 'arbitrary'
    floor = (floor_band(aligned, 0, 2 * plane['tolerance']) or estimate_floor(aligned)) if upright and squared else estimate_floor(aligned)
    measurement = measurement or {}
    return {'version': 1, 'kind': 'colmap-sparse-point-cloud', 'units': units, 'coordinateFrame': 'right-handed-y-up',
            'sourceFrame': coordinate_frame, 'source': source, 'points': kept,
            'fromSource': arena_transform(k, flip, plane, upright is not None, yaw),
            'floorEstimate': floor and {**floor, 'units': units},
            'scale': {'source': 'user-measured', 'metresPerUnit': k, 'distance': measurement.get('distance'),
                      'spanUnits': measurement.get('span'), 'selfReported': True, 'verified': False} if metric else None,
            'provenance': {'totalPoints': len(rows), 'keptPoints': len(kept),
                           'outliersDropped': len(rows) - len(core) if trimmed else 0, 'thinned': step > 1,
                           'floorAligned': aligned is not core,
                           'floorTiltDegrees': round(math.degrees(math.acos(min(1, abs(plane['normal'][1])))), 1) if plane else None,
                           'floorYawDegrees': round(math.degrees(yaw), 1),
                           'floorInlierFraction': round(plane['inlierFraction'], 3) if plane else None,
                           **({'floorSquaredToRoom': True} if squared else {}), 'metricVerified': False}}


# ---------- Blender ----------
def name_step(cloud: dict, request: dict, work: Path, *, client=None, views=None, detector_model: Path | None = None, detect=None):
    """Suggested names for the separated objects. The vision model names them when the person asked for it with this
    hand-off; an on-worker detector (detector_model, or detect for tests) names them when it is configured and the model
    did not. Returns the names file for the compiler (or None) and what happened. Provider failures keep an unnamed
    scene possible; invalid source-bound reuse is rejected rather than attaching stale names."""
    source = request.get('source') if isinstance(request.get('source'), dict) else {}
    # A same-owner scene job can carry forward names on the identical cloud. The API resolves source_job and
    # enforces ownership; no browser-supplied filesystem path is read here. This avoids another model call when
    # the operator only adds an opening. Suggestions retain their original model/prompt and unreviewed state.
    if source.get('engine') == 'scene-usd' and not source.get('missing'):
        previous = Path(source['path']) / 'output'
        old_cloud, old_names = previous / 'arena-cloud.json', previous / 'object-names.json'
        if old_names.exists():
            if old_cloud.is_symlink() or old_names.is_symlink() or not old_names.is_file() or old_names.stat().st_size > 1024 * 1024:
                raise ValueError('Prior scene naming evidence is invalid.')
            prior = load_arena_cloud(old_cloud)
            if measurement_check.points_sha256(prior) != measurement_check.points_sha256(cloud) or prior['scale'] != cloud['scale']:
                raise ValueError('Prior scene names belong to different geometry or scale; reconstruct or name this scene again.')
            payload = json.loads(old_names.read_text())
            if not isinstance(payload, dict) or payload.get('schema') != 'brainsnn.object-names.v1':
                raise ValueError('Prior object naming evidence has an unknown schema.')
            work.mkdir(parents=True, exist_ok=True)
            path = work / 'object-names.json'
            shutil.copyfile(old_names, path)
            return path, {'status': 'reused', 'source_job': source.get('job'), 'model_executed': False,
                          'model': payload.get('model'), 'prompt_version': payload.get('prompt_version'),
                          'source_sha256': hashlib.sha256(old_names.read_bytes()).hexdigest()}
    providers = (['model'] if cloud.get('nameObjects') else []) + (['detector'] if detector_model or detect else [])
    attempts = []
    for provider in providers:
        try:
            if cloud['units'] != 'm':
                raise object_names.NamingSkipped('Naming needs a metric scene.')
            if not source or source.get('missing'):
                raise object_names.NamingSkipped('The reconstruction job is no longer on the worker, so there are no frames to crop.'
                                                 if source.get('missing') else 'No reconstruction job came with this request, so there are no frames to crop.')
            if 'fromSource' not in cloud:
                raise object_names.NamingSkipped('The hand-off does not record its transform from the reconstruction.')
            if provider == 'model' and client is None and not os.environ.get('ANTHROPIC_API_KEY'):
                raise object_names.NamingSkipped('This worker has no Anthropic API key configured.')
            if provider == 'detector' and detect is None:
                detect = detector_names.load(detector_model)
            names, evidence = object_names.name_objects(cloud, Path(source['path']), client=client, views=views,
                                                        detect=detect if provider == 'detector' else None)
            work.mkdir(parents=True, exist_ok=True)
            path = work / 'object-names.json'
            path.write_text(json.dumps(names, indent=2, allow_nan=False))
            return path, {'status': 'named', **evidence, **({'model_attempt': attempts[0]} if attempts else {})}
        except object_names.NamingSkipped as reason:
            attempts.append({'status': 'skipped', 'reason': str(reason)})
        except Exception as error:  # an API, network or detector error: the scene still compiles, unnamed
            attempts.append({'status': 'failed', 'reason': f'{type(error).__name__}: {str(error)[:200]}'})
    if not attempts:
        return None, None
    return None, {**attempts[-1], **({'model_attempt': attempts[0]} if len(attempts) > 1 else {})}


def previous_building(request: dict):
    """The building.json of the scene job this one recompiles, so element IDs carry over; None when there is none
    (a first compile, or a scene made before building models). The API resolves source_job and enforces ownership."""
    source = request.get('source') if isinstance(request.get('source'), dict) else {}
    if source.get('engine') != 'scene-usd' or source.get('missing'):
        return None
    path = Path(source['path']) / 'output' / 'building.json'
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('The previous building model is invalid.')
    if json.loads(path.read_text()).get('schema') != BUILDING_SCHEMA:
        raise ValueError('The previous building model has an unknown schema.')
    return path


def compile_scene(cloud: Path, out: Path, *, blender: str, names: Path | None = None, previous: Path | None = None):
    """Headless scene compiler; Blender only exits non-zero for Python errors when asked to."""
    out.mkdir(parents=True, exist_ok=True)
    command = [blender, '-b', '--python-exit-code', '1', '--python', str(SCENE_COMPILER), '--',
               '--cloud', str(cloud), '--out', str(out), *(['--names', str(names)] if names else []),
               *(['--previous-building', str(previous)] if previous else [])]
    subprocess.run(command, check=True, stdin=subprocess.DEVNULL, timeout=BLENDER_TIMEOUT)
    for name in ['scene.glb', 'scene.json', 'building.json']:
        if not (out / name).is_file() or (out / name).stat().st_size == 0:
            raise RuntimeError(f'Scene compiler did not write {name}.')
    scene = json.loads((out / 'scene.json').read_text())
    # USD and IFC are metric-only: each is present exactly when the compiler says it wrote it.
    for key, name in [('usd', 'scene.usda'), ('ifc', 'scene.ifc')]:
        if bool((scene.get(key) or {}).get('written')) != ((out / name).is_file() and (out / name).stat().st_size > 0):
            raise RuntimeError(f'Scene compiler {key.upper()} output does not match scene.json.')
    return scene


def building_summary(path: Path):
    """The model ID and what carried over from the previous model, for the job's evidence."""
    building = json.loads(path.read_text())
    counts = {}
    for element in building['elements']:
        counts[element['kind']] = counts.get(element['kind'], 0) + 1
    return {'schema': building['schema'], 'model_id': building['model']['id'], 'elements': counts, 'identity': building['identity']}


def blender_version(blender: str):
    probe = subprocess.run([blender, '--version'], capture_output=True, text=True, timeout=60)
    return probe.stdout.strip().splitlines()[0] if probe.stdout.strip() else None


def handoff_input(request: dict):
    """The one validated browser hand-off of a cloud request, or None for a walkthrough request."""
    inputs = request.get('inputs', [])
    if not any(item.get('kind') == 'cloud' for item in inputs):
        return None
    if request.get('schema') != 'brainsnn.adapter.v1' or len(inputs) != 1:
        raise ValueError('Send one point-cloud hand-off on its own.')
    path = Path(inputs[0]['path'])
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError('Adapter inputs must be regular local files.')
    cloud = load_arena_cloud(path)
    # COLMAP clouds are multi-view by construction; any other frame must say so (World Builder sets it from camera poses).
    if cloud['sourceFrame'] != 'colmap' and cloud.get('multiView') is not True:
        raise ValueError('The scene compiler needs a multi-view reconstruction; this hand-off does not come from one.')
    return cloud, {'kind': 'browser-handoff', 'name': str(inputs[0].get('name', ''))[:160],
                   'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def run(request: dict, *, blender: str, naming_client=None, naming_views=None, detector_model: Path | None = None, naming_detect=None):
    if not SCENE_COMPILER.is_file():
        raise RuntimeError(f'Scene compiler not found at {SCENE_COMPILER}.')
    if not Path(blender).is_absolute() or not Path(blender).is_file():
        raise RuntimeError('Blender must be an existing absolute path.')
    started = time.monotonic()
    out = Path(request['output_dir']).resolve()
    handoff = handoff_input(request)
    if handoff:
        cloud, source = handoff
        out.mkdir(parents=True, exist_ok=True)
        reconstruction, previous = None, []
    else:
        reconstruction = sparse_colmap.run(request)  # writes sparse-preview.ply, reconstruction.json, manifest.json
        scale = request['scale'] if isinstance(request.get('scale'), dict) else {}
        cloud = to_arena_cloud(read_ply(out / 'sparse-preview.ply'), coordinate_frame=reconstruction['coordinate_frame'],
                               source='sparse-preview.ply', metres_per_unit=scale.get('metres_per_unit'),
                               measurement=scale.get('measurement'))
        source = {'kind': 'walkthrough'}
        previous = json.loads((out / 'manifest.json').read_text())['artifacts']
    (out / 'arena-cloud.json').write_text(json.dumps(cloud, allow_nan=False))
    # Blender's own files (scene.blend) stay outside the published output, like colmap-work.
    work = out.parent / 'scene-work'
    names, naming = name_step(cloud, request, work, client=naming_client, views=naming_views, detector_model=detector_model, detect=naming_detect)
    scene = compile_scene(out / 'arena-cloud.json', work, blender=blender, names=names, previous=previous_building(request))
    if cloud.get('bimReview') and not scene.get('bimReview'):
        raise RuntimeError('The scene compiler did not apply the supplied BIM review. Update the complete worker checkout.')
    usd, ifc = (bool((scene.get(key) or {}).get('written')) for key in ['usd', 'ifc'])
    for name in ['scene.glb', 'scene.json', 'building.json'] + (['scene.usda'] if usd else []) + (['scene.ifc'] if ifc else []):
        shutil.copyfile(work / name, out / name)
    # CAD and estimating files from the same scene.json: a DXF plan, a Rhino model and a quantities sheet (metric only).
    try:
        cad = cad_export.export(scene, work)
    except Exception as error:  # like naming, a CAD export problem never fails the scene; the evidence says what happened
        cad = {'failed': f'{type(error).__name__}: {str(error)[:200]}'}
    cad_files = [name for key, name in (('dxf', 'scene-plan.dxf'), ('3dm', 'scene.3dm'), ('quantities', 'quantities.csv'))
                 if (cad.get(key) or {}).get('written')]
    for name in cad_files:
        shutil.copyfile(work / name, out / name)
    # The fit check: how closely the model follows the points, as numbers and as a heatmap of every point.
    try:
        fit = fit_check.export(scene, cloud['points'], work)
    except Exception as error:  # never fails the scene either
        fit = {'failed': f'{type(error).__name__}: {str(error)[:200]}'}
    fit_files = ['fit-check.json', 'fit-heatmap.ply'] if fit.get('written') else []
    for name in fit_files:
        shutil.copyfile(work / name, out / name)
    if fit.get('written'):  # the summary travels with the scene, so the site's scene dialog can say it
        scene['fit'] = {key: fit[key] for key in ('within_5cm', 'modelled_median_cm', 'by_kind', 'misfits')}
        (out / 'scene.json').write_text(json.dumps(scene, indent=1, allow_nan=False))
    if names:
        shutil.copyfile(names, out / 'object-names.json')
        naming['applied'] = (scene.get('naming') or {}).get('named', 0)
    # A dimensional audit is separate from model-to-points fit. Invalid supplied references fail the job instead
    # of silently becoming an unchecked success. Even matching held-out lengths never certify the whole scene.
    measurement_files = []
    if cloud['units'] == 'm':
        report = measurement_check.build_report(scene, cloud)
        report['sourceFiles'] = {
            'scene': {'sha256': hashlib.sha256((out / 'scene.json').read_bytes()).hexdigest()},
            'cloud': {'sha256': hashlib.sha256((out / 'arena-cloud.json').read_bytes()).hexdigest()}}
        (out / 'scene-measurements.json').write_text(json.dumps(report, indent=2, allow_nan=False))
        measurement_files = ['scene-measurements.json']
        measurements = {'written': True, 'status': report['status'], 'metric_verified': False}
    else:
        measurements = {'skipped': 'Dimensional checks require a metric scene.'}
    measured = ['The scale follows an entered distance: whether it was independently measured is self-reported, not verified.'] if cloud['units'] == 'm' else []
    named = ['Object names are suggestions from a vision model looking at the walkthrough frames; nobody has reviewed them.'] if names else []
    evidence = {'schema': 'brainsnn.scene-usd.v1', 'pipeline': 'scene-usd', 'input': source, 'units': cloud['units'],
                'coordinate_frame': 'right-handed-y-up', 'metric_verified': False, 'physics_ready': False,
                'policy_executed': False, 'model_weights_used': False, 'usd': scene.get('usd'), 'ifc': scene.get('ifc'), 'cad': cad, 'fit': fit,
                'naming': naming, 'measurements': measurements, 'bim_review': scene.get('bimReview'),
                'building': building_summary(work / 'building.json'),
                'reconstruction': {key: reconstruction[key] for key in ['pipeline', 'pycolmap_version', 'capture', 'reconstructed_points',
                                                                      'preview_points', 'mean_reprojection_error_pixels']} if reconstruction else None,
                'handoff': {'floorEstimate': cloud['floorEstimate'], 'scale': cloud['scale'], 'provenance': cloud['provenance'],
                            'sourceFrame': cloud['sourceFrame'], 'points': len(cloud['points'])},
                'compiler': {'script': SCENE_COMPILER.name, 'blender': blender_version(blender), 'schema': scene.get('schema'),
                             'counts': scene.get('counts'), 'floor_y': scene.get('floor_y'),
                             'walls': [{key: wall[key] for key in ['name', 'size', 'yaw_degrees', 'support_points']} for wall in scene.get('walls', [])]},
                'elapsed_seconds': round(time.monotonic() - started, 3),
                'review_required': (reconstruction['review_required'] if reconstruction else [])
                + ['Confirm walls and floor against the walkthrough before simulation'] + (['Check the measured distance before using metres'] if measured else [])
                + (['Check held-out tape or laser distances; model-to-points fit is not independent dimensional validation'] if measured else [])
                + (['Review the suggested object names before relying on them'] if names else []),
                'warnings': (reconstruction['warnings'] if reconstruction else [])
                + ['Unseen floor cells are exported as a tagged unknown volume, not free space.'] + measured + named}
    (out / 'scene-usd.json').write_text(json.dumps(evidence, indent=2, allow_nan=False))
    artifacts = [{'name': 'scene.glb', 'kind': 'visual', 'representation': 'triangle-mesh', 'coordinate_frame': 'right-handed-y-up', 'units': cloud['units']},
                 *([{'name': 'scene.usda', 'kind': 'visual', 'representation': 'triangle-mesh', 'coordinate_frame': 'right-handed-y-up', 'units': 'm'}] if usd else []),
                 *([{'name': 'scene.ifc', 'kind': 'bim'}] if ifc else []),
                 *({'name': name, 'kind': 'quantities' if name.endswith('.csv') else 'cad'} for name in cad_files),
                 {'name': 'building.json', 'kind': 'model'},
                 {'name': 'scene.json', 'kind': 'evidence'}, {'name': 'scene-usd.json', 'kind': 'evidence'},
                 *({'name': name, 'kind': 'evidence'} for name in fit_files),
                 *({'name': name, 'kind': 'evidence'} for name in measurement_files),
                 {'name': 'arena-cloud.json', 'kind': 'evidence'}, *([{'name': 'object-names.json', 'kind': 'evidence'}] if names else []), *previous]
    (out / 'manifest.json').write_text(json.dumps({'artifacts': artifacts}, allow_nan=False))
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-manifest', required=True)
    parser.add_argument('--blender', default=shutil.which('blender') or '/usr/bin/blender')
    parser.add_argument('--detector-model', type=Path, help='pinned EfficientDet-Lite2 .tflite; names objects on the worker when the vision model does not')
    args = parser.parse_args()
    request = Path(args.input_manifest)
    if request.stat().st_size > 65536:
        raise ValueError('Input manifest is too large.')
    evidence = run(json.loads(request.read_text()), blender=args.blender, detector_model=args.detector_model)
    reconstruction = evidence['reconstruction'] or {}
    print('SCENE_USD_OK', json.dumps({'input': evidence['input']['kind'], 'points': reconstruction.get('reconstructed_points', evidence['handoff']['points']),
                                      'registered': (reconstruction.get('capture') or {}).get('registered_images'),
                                      'reprojection_px': round(reconstruction['mean_reprojection_error_pixels'], 3) if reconstruction else None,
                                      'counts': evidence['compiler']['counts'], 'units': evidence['units'], 'usd': evidence['usd'],
                                      'elapsed_seconds': evidence['elapsed_seconds']}), flush=True)


if __name__ == '__main__':
    main()
