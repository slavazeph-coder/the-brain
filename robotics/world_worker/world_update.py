"""One robot sees, another adapts: turn a recorded walk into a reviewed world update and per-robot routes.

Observe: every frame of a later walk (robot A's camera; today a phone) is located in the site's as-is reconstruction
with the same visual positioning as locate_photo, and frames that cannot be placed are reported, not guessed.
Understand: frame pairs are matched and triangulated. A point on the as-is model is unchanged geometry and measures how
well the walk registered. Off the model, at robot height, the evidence is classed:
  added           an as-is frame looked straight through the spot to a surface further away: empty then, occupied now;
  newly_observed  no as-is frame saw that space: new coverage, still an obstacle;
  removed         a walk frame now looks straight through as-is geometry, and the walk never saw it again;
  occluder        something hides the as-is scene from nearly every walk frame facing it and no seen ray crosses it near
                  the floor, yet it shows no features of its own (a plain box): the whole hidden region is proposed.
An object seen from one side is assumed to reach assumed_depth_m behind its visible face (for as-is geometry too), and
new geometry blocks every robot unless the walk saw the floor beneath it from a camera lower than it.
Remember: the candidates become a proposed update for the shared world state. Nothing is applied here: the update is a
plan of World Project requests (source, evidence on the as-is revision, one proposed revision and change per robot),
bound to the exact as-is scan it was compared with, that a different named reviewer must approve.
Adapt: each robot's footprint (circumscribed, plus margin) and height are routed on the as-is map and on the proposed
map: unchanged, shortened (a removal opened a shorter way), rerouted, blocked, or no route before.
Share: each robot's adapted route is published as a proposal that applies only after its change is approved.

Limits are stated in every result (LIMITS). tests/world/world_update_sweep.py scores the loop on rendered rooms whose
truth is authored, including where it still fails.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import itertools
import json
import math
import re
import time
from pathlib import Path

try:
    from . import locate_photo as lp
    from . import sparse_colmap
except ImportError:
    import locate_photo as lp
    import sparse_colmap

SCHEMA = 'brainsnn.world-update.v1'
REQUEST_SCHEMA = 'brainsnn.world-update-request.v1'
PLAN_SCHEMA = 'brainsnn.project-request-plan.v1'
MAX_FRAMES = 16
MAX_ROBOTS = 8
MAX_GRID_CELLS = 250_000
MAX_SOURCE_BYTES = 524_288  # one retained World Project source
ROBOT_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,39}$')
THRESHOLDS = {
    'cell_m': 0.1,                 # floor grid resolution
    'min_obstacle_height_m': 0.04,  # below this a point counts as floor (request may raise it for a noisy capture)
    'height_tolerance_m': 0.05,    # triangulation noise allowed above a robot's height (a box exactly as tall still counts)
    'near_model_m': 0.10,          # a walk point this close to an as-is point is unchanged geometry
    'max_reprojection_px': 2.0,    # a triangulated point must reproject this well in both frames
    'min_parallax_degrees': 2.0,   # and be seen from directions at least this far apart
    'free_space_radius_px': 12.0,  # as-is observations this close to a point's projection describe its line of sight
    'free_space_margin_m': 0.15,   # an as-is surface at least this much further away means the spot was seen empty
    'min_cell_points': 3,          # points that make a grid cell an obstacle
    'min_candidate_points': 15,    # points that make a connected group of cells a candidate
    'min_added_points': 8,         # points seen empty before that make a candidate "added" rather than "newly observed"
    'assumed_depth_m': 0.5,        # unseen space behind a change, up to this deep, is assumed occupied (request may change it)
    'min_removed_points': 6,       # as-is points the walk looked straight through that make a removal
    'min_occluder_cells': 3,       # cells hidden from three or more frames (and most that view them), crossed by no seen ray
}
LIMITS = [
    'A removal is found only where the walk looked straight through the old spot to a surface behind it; anything the '
    'walk did not look past stays in the map (the safe side).',
    'Grid cells no frame observed count as free when planning; each route\'s unobserved_fraction says how much of it relies on that. '
    'The exceptions: unseen space directly behind a change or as-is geometry (up to assumed_depth_m) and regions a plain '
    'object hides are assumed occupied, because a walk that sees only an object\'s front cannot tell how deep it is.',
    'A phone at chest height tilted slightly down does not see the floor within about 1.5 to 2 m of itself: an object '
    'closer than that is seen only from above, or not at all. Keep walking past changes.',
    'A 2D grid planning preview with a circumscribed footprint: not a Nav2 run, not execution, not a safety certification.',
    'Metres come from the phone\'s native tracking (ARKit), not from a tape-measured check of this site.',
]


# ---------------------------------------------------------------- request

def _number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name} must be a number from {low} to {high}.')
    return float(value)


def _text(value, name, limit=160):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f'{name} must be text of 1 to {limit} characters.')
    return value.strip()


def _shape(value, name, allowed, required=()):
    if not isinstance(value, dict):
        raise ValueError(f'{name} must be an object.')
    extra = set(value) - set(allowed)
    if extra:
        raise ValueError(f'{name} has unsupported fields: {", ".join(sorted(extra))}.')
    missing = [key for key in required if key not in value]
    if missing:
        raise ValueError(f'{name} needs {", ".join(missing)}.')


def _point(value, name):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f'{name} must be [across, along] floor coordinates in metres.')
    return [_number(v, name, -1e4, 1e4) for v in value]


def read_request(data) -> dict:
    """The operator's request: which robots adapt, along which route, optionally how the site frame is declared."""
    _shape(data, 'The world-update request', ['schema', 'observer', 'robots', 'route', 'site_frame', 'assumed_depth_m',
                                              'min_obstacle_height_m'], ['schema', 'robots'])
    if data['schema'] != REQUEST_SCHEMA:
        raise ValueError(f'Use schema {REQUEST_SCHEMA}.')
    observer = data.get('observer', {'id': 'robot-a', 'model': 'Phone camera standing in for robot A'})
    _shape(observer, 'observer', ['id', 'model'], ['id', 'model'])
    if not isinstance(observer['id'], str) or not ROBOT_ID.fullmatch(observer['id']):
        raise ValueError('observer.id must be lower-case letters, digits and hyphens.')
    robots = data['robots']
    if not isinstance(robots, list) or not 1 <= len(robots) <= MAX_ROBOTS:
        raise ValueError(f'List 1 to {MAX_ROBOTS} robots to adapt.')
    checked = []
    for index, robot in enumerate(robots):
        _shape(robot, f'robots[{index}]', ['id', 'model', 'width_m', 'depth_m', 'height_m', 'margin_m'],
               ['id', 'model', 'width_m', 'depth_m', 'height_m'])
        if not isinstance(robot['id'], str) or not ROBOT_ID.fullmatch(robot['id']):
            raise ValueError(f'robots[{index}].id must be lower-case letters, digits and hyphens.')
        checked.append({'id': robot['id'], 'model': _text(robot['model'], f'robots[{index}].model'),
                        'width_m': _number(robot['width_m'], 'width_m', .05, 5), 'depth_m': _number(robot['depth_m'], 'depth_m', .05, 5),
                        'height_m': _number(robot['height_m'], 'height_m', .1, 5),
                        'margin_m': _number(robot.get('margin_m', 0), 'margin_m', 0, 1)})
    if len({robot['id'] for robot in checked}) != len(checked):
        raise ValueError('Robot ids must be unique.')
    route = data.get('route', {'from': 'walk'})
    if isinstance(route, dict) and route.get('from') == 'walk':
        _shape(route, 'route', ['from'])
        route = {'from': 'walk'}
    else:
        _shape(route, 'route', ['start', 'goal'], ['start', 'goal'])
        route = {'start': _point(route['start'], 'route.start'), 'goal': _point(route['goal'], 'route.goal')}
    frame = data.get('site_frame')
    if frame is not None:
        _shape(frame, 'site_frame', ['up', 'metres_per_unit', 'floor_level'])
        frame = dict(frame)
        if 'up' in frame:
            if not isinstance(frame['up'], list) or len(frame['up']) != 3:
                raise ValueError('site_frame.up must be a 3D direction.')
            frame['up'] = [_number(v, 'site_frame.up', -1e3, 1e3) for v in frame['up']]
            if math.hypot(*frame['up']) < 1e-6:
                raise ValueError('site_frame.up must not be zero.')
        if 'metres_per_unit' in frame:
            frame['metres_per_unit'] = _number(frame['metres_per_unit'], 'site_frame.metres_per_unit', 1e-6, 1e6)
        if 'floor_level' in frame:
            frame['floor_level'] = _number(frame['floor_level'], 'site_frame.floor_level', -1e4, 1e4)
    return {'schema': REQUEST_SCHEMA, 'observer': {'id': observer['id'], 'model': _text(observer['model'], 'observer.model')},
            'robots': checked, 'route': route, 'site_frame': frame,
            'assumed_depth_m': _number(data.get('assumed_depth_m', THRESHOLDS['assumed_depth_m']), 'assumed_depth_m', 0, 3),
            'min_obstacle_height_m': _number(data.get('min_obstacle_height_m', THRESHOLDS['min_obstacle_height_m']),
                                             'min_obstacle_height_m', .02, .3)}


# ---------------------------------------------------------------- geometry helpers

def pairs_within(query, reference, radius):
    """Every (query, reference) index pair closer than `radius`, with its distance; exact, bucketed by `radius`."""
    import numpy as np
    q, r = np.asarray(query, dtype=float), np.asarray(reference, dtype=float)
    empty = np.zeros(0, dtype=int)
    if not len(q) or not len(r):
        return empty, empty, np.zeros(0)
    dim = q.shape[1]
    origin = np.minimum(q.min(axis=0), r.min(axis=0))
    rv = np.floor((r - origin) / radius).astype(np.int64)
    qv = np.floor((q - origin) / radius).astype(np.int64)
    span = np.maximum(rv.max(axis=0), qv.max(axis=0)) + 3
    if float(np.prod(span.astype(float))) > 2 ** 62:
        raise ValueError('The points span too large a region for this radius.')

    def key(v):
        out = np.zeros(len(v), dtype=np.int64)
        for axis in range(dim):
            out = out * span[axis] + (v[:, axis] + 1)
        return out

    order = np.argsort(key(rv), kind='stable')
    sorted_keys = key(rv)[order]
    found_q, found_r, found_d = [], [], []
    for offset in itertools.product((-1, 0, 1), repeat=dim):
        k = key(qv + np.array(offset))
        lo, hi = np.searchsorted(sorted_keys, k, 'left'), np.searchsorted(sorted_keys, k, 'right')
        counts = hi - lo
        total = int(counts.sum())
        if not total:
            continue
        qi = np.repeat(np.arange(len(q)), counts)
        ri = order[np.repeat(lo - (np.cumsum(counts) - counts), counts) + np.arange(total)]
        d = np.linalg.norm(q[qi] - r[ri], axis=1)
        keep = d <= radius
        found_q.append(qi[keep]); found_r.append(ri[keep]); found_d.append(d[keep])
    if not found_q:
        return empty, empty, np.zeros(0)
    return np.concatenate(found_q), np.concatenate(found_r), np.concatenate(found_d)


def floor_axes(up):
    import numpy as np
    up = np.asarray(up, dtype=float)
    up = up / np.linalg.norm(up)
    ref = np.array([1., 0., 0.]) if abs(up[0]) < .9 else np.array([0., 0., 1.])
    across = ref - ref.dot(up) * up
    across /= np.linalg.norm(across)
    return up, across, np.cross(up, across)


def floor_level(heights):
    """The lowest well-populated 2 cm level of the as-is points: the floor."""
    import numpy as np
    h = np.asarray(heights, dtype=float)
    lo, hi = np.percentile(h, [.5, 99.5])
    h = h[(h >= lo) & (h <= hi)]
    if len(h) < 50 or hi - lo < .1:
        raise ValueError('Too few as-is points to find the floor. Declare site_frame.floor_level.')
    edges = np.arange(lo, hi + .02, .02)
    counts, _ = np.histogram(h, edges)
    dense = np.flatnonzero(counts >= max(10, .02 * len(h)))
    if not len(dense):
        raise ValueError('No floor level stands out in the as-is points. Declare site_frame.floor_level.')
    centre = (edges[dense[0]] + edges[dense[0] + 1]) / 2
    return float(np.median(h[np.abs(h - centre) <= .03]))


def site_frame(source_dir: Path, declared):
    """Up direction and metres per model unit: from the native-capture alignment, or declared by the operator."""
    import numpy as np
    record = Path(source_dir) / 'artifacts' / 'reconstruction.json'
    alignment = None
    if record.is_file():
        alignment = (json.loads(record.read_text()).get('native_capture') or {}).get('alignment')
    declared = declared or {}
    if alignment and alignment.get('applied') and alignment.get('arkit_world_to_output_basis'):
        basis = np.asarray(alignment['arkit_world_to_output_basis'], dtype=float)
        frame = {'up': (basis @ [0., 1., 0.]).tolist(), 'metres_per_unit': 1.0,
                 'basis': 'native capture: gravity and metres from the phone tracking (not tape-verified)'}
        if 'up' in declared or 'metres_per_unit' in declared:
            raise ValueError('This reconstruction is aligned to its native capture; do not declare up or metres_per_unit.')
    elif 'up' in declared and 'metres_per_unit' in declared:
        frame = {'up': declared['up'], 'metres_per_unit': declared['metres_per_unit'], 'basis': 'declared by the operator'}
    else:
        raise ValueError('The reconstruction has no native-capture alignment, so up and scale are unknown. Capture with '
                         'BrainSNN Walk (native poses) or declare site_frame.up and site_frame.metres_per_unit.')
    if 'floor_level' in declared:
        frame['floor_level'] = declared['floor_level']
    return frame


class Grid:
    def __init__(self, uv, cell):
        import numpy as np
        lo, hi = np.min(uv, axis=0) - 2 * cell, np.max(uv, axis=0) + 2 * cell
        self.cell, self.origin = cell, lo
        self.shape = tuple(int(n) for n in np.ceil((hi - lo) / cell).astype(int) + 1)
        if self.shape[0] * self.shape[1] > MAX_GRID_CELLS:
            raise ValueError('The site is too large for one planning grid at this resolution.')

    def index(self, uv):
        import numpy as np
        ij = np.floor((np.asarray(uv, dtype=float) - self.origin) / self.cell).astype(int)
        return np.clip(ij, 0, np.array(self.shape) - 1)

    def centre(self, ij):
        import numpy as np
        return self.origin + (np.asarray(ij, dtype=float) + .5) * self.cell

    def counts(self, uv):
        import numpy as np
        out = np.zeros(self.shape, dtype=int)
        if len(uv):
            ij = self.index(uv)
            np.add.at(out, (ij[:, 0], ij[:, 1]), 1)
        return out


def inflate(occupied, radius_cells):
    import numpy as np
    r = int(math.ceil(radius_cells))
    padded = np.pad(occupied, r)
    out = np.zeros_like(occupied)
    n, m = occupied.shape
    for di in range(-r, r + 1):
        for dj in range(-r, r + 1):
            if di * di + dj * dj <= radius_cells * radius_cells:
                out |= padded[r + di:r + di + n, r + dj:r + dj + m]
    return out


def astar(free, start, goal):
    """8-connected A* with an octile heuristic; diagonal moves may not cut an obstacle corner."""
    start, goal = tuple(int(v) for v in start), tuple(int(v) for v in goal)
    if not free[start] or not free[goal]:
        return None
    n, m = free.shape
    h = lambda c: (lambda dx, dy: max(dx, dy) + (math.sqrt(2) - 1) * min(dx, dy))(abs(c[0] - goal[0]), abs(c[1] - goal[1]))
    best, parent, queue = {start: 0.}, {}, [(h(start), 0., start)]
    while queue:
        _, cost, cell = heapq.heappop(queue)
        if cell == goal:
            path = [cell]
            while cell in parent:
                cell = parent[cell]
                path.append(cell)
            return path[::-1]
        if cost > best.get(cell, math.inf):
            continue
        i, j = cell
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            a, b = i + di, j + dj
            if not (0 <= a < n and 0 <= b < m) or not free[a, b]:
                continue
            if di and dj and not (free[i + di, j] and free[i, j + dj]):
                continue
            step = cost + (math.sqrt(2) if di and dj else 1.)
            if step < best.get((a, b), math.inf):
                best[(a, b)], parent[(a, b)] = step, cell
                heapq.heappush(queue, (step + h((a, b)), step, (a, b)))
    return None


def line_cells(a, b):
    """Every cell a straight segment between two cell centres passes through (a supercover). Where it crosses exactly
    at a grid corner, both side cells count, which is A*'s no-corner-cutting rule; sampling points can miss them."""
    (x, y), (x1, y1) = (int(a[0]), int(a[1])), (int(b[0]), int(b[1]))
    nx, ny = abs(x1 - x), abs(y1 - y)
    sx, sy = (x1 > x) - (x1 < x), (y1 > y) - (y1 < y)
    cells, ix, iy = [(x, y)], 0, 0
    while ix < nx or iy < ny:
        d = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx  # which cell boundary the segment reaches first
        if d == 0:
            cells += [(x + sx, y), (x, y + sy)]
            x, y, ix, iy = x + sx, y + sy, ix + 1, iy + 1
        elif d < 0:
            x, ix = x + sx, ix + 1
        else:
            y, iy = y + sy, iy + 1
        cells.append((x, y))
    return cells


def line_free(free, a, b):
    return all(free[cell] for cell in line_cells(a, b))


def simplify(path, free):
    """Fewest waypoints with a clear straight line between consecutive ones."""
    out, i = [path[0]], 0
    while i < len(path) - 1:
        j = len(path) - 1
        while j > i + 1 and not line_free(free, path[i], path[j]):
            j -= 1
        out.append(path[j])
        i = j
    return out


def longest_unseen(path, observed):
    """Longest run of consecutive path cells nobody observed, in cells (diagonal steps count sqrt 2)."""
    best = run = 0.
    for a, b in zip(path, path[1:]):
        run = run + math.dist(a, b) if not observed[b] else 0.
        best = max(best, run)
    return best


def route_length(points):
    return sum(math.dist(points[k], points[k + 1]) for k in range(len(points) - 1))


# ---------------------------------------------------------------- the loop

def observe(workspace: Path, frames, scratch: Path):
    """Locate each walk frame in the as-is model and keep its features for triangulation."""
    import numpy as np
    import pycolmap
    located, records = [], []
    for index, frame in enumerate(frames):
        work = scratch / f'frame-{index:02d}'
        out = lp.locate(workspace, Path(frame), work)
        record = {'index': index, 'name': Path(frame).name, 'sha256': out['photo']['sha256'], 'located': out['located'],
                  'inliers': out.get('inliers', 0), 'inlier_ratio': out.get('inlier_ratio', 0)}
        if out['located']:
            record['mean_reprojection_error_pixels'] = out['mean_reprojection_error_pixels']
            keypoints, descriptors = lp.features(work / 'located-photo.jpg')
            cam = out['camera']
            camera = pycolmap.Camera(model=cam['model'], width=cam['width'], height=cam['height'], params=cam['parameters'])
            keypoints = np.asarray(keypoints, dtype=float)[:, :2]
            located.append({'index': index, 'P': np.asarray(out['world_to_camera'], dtype=float),
                            'centre': np.asarray(out['camera_center'], dtype=float), 'camera': camera,
                            'keypoints': keypoints, 'descriptors': descriptors,
                            'normalized': np.asarray(camera.cam_from_img(keypoints), dtype=float)})
            record['camera_center_model'] = [round(float(v), 4) for v in out['camera_center']]
        else:
            record['reason'] = out.get('reason')
        records.append(record)
    return located, records


def triangulate(a, b, thresholds):
    """Mutual ratio-test matches between two located frames, triangulated (DLT) and kept only when well conditioned."""
    import numpy as np
    pairs = lp.match(a['descriptors'], b['descriptors'])
    if len(pairs) < 8:
        return np.zeros((0, 3)), np.zeros((0, 2)), np.zeros((0, 2))
    xa, xb = a['normalized'][pairs[:, 0]], b['normalized'][pairs[:, 1]]
    Pa, Pb = a['P'], b['P']
    A = np.stack([xa[:, :1] * Pa[2] - Pa[0], xa[:, 1:2] * Pa[2] - Pa[1],
                  xb[:, :1] * Pb[2] - Pb[0], xb[:, 1:2] * Pb[2] - Pb[1]], axis=1)
    X = np.linalg.svd(A)[2][:, -1, :]
    keep = np.abs(X[:, 3]) > 1e-12
    X = X[:, :3] / np.where(keep, X[:, 3], 1)[:, None]
    for frame, observed in ((a, a['keypoints'][pairs[:, 0]]), (b, b['keypoints'][pairs[:, 1]])):
        cam = X @ frame['P'][:, :3].T + frame['P'][:, 3]
        keep &= cam[:, 2] > 1e-6
        safe = np.where(keep[:, None], cam, [0., 0., 1.])
        error = np.linalg.norm(np.asarray(frame['camera'].img_from_cam(safe), dtype=float) - observed, axis=1)
        keep &= error <= thresholds['max_reprojection_px']
    ra, rb = X - a['centre'], X - b['centre']
    cosine = (ra * rb).sum(axis=1) / np.maximum(np.linalg.norm(ra, axis=1) * np.linalg.norm(rb, axis=1), 1e-12)
    keep &= cosine <= math.cos(math.radians(thresholds['min_parallax_degrees']))
    return X[keep], a['keypoints'][pairs[:, 0]][keep], b['keypoints'][pairs[:, 1]][keep]


def as_is_views(model):
    """Each as-is frame as (camera, rotation, translation, observed pixels, observed 3D points)."""
    import numpy as np
    views = []
    for image_id in model.reg_image_ids():
        image = model.image(image_id)
        pose = image.cam_from_world()
        observed = [(p.xy, model.points3D[p.point3D_id].xyz) for p in image.points2D if p.has_point3D()]
        if observed:
            views.append((model.camera(image.camera_id), pose.rotation.matrix(), np.asarray(pose.translation),
                          np.array([xy for xy, _ in observed], dtype=float), np.array([xyz for _, xyz in observed], dtype=float)))
    return views


def walk_views(located, observations):
    """Each walk frame as the same tuple, from the points it helped triangulate and where it saw them."""
    import numpy as np
    views = []
    for index, frame in enumerate(located):
        pixels, points = observations[index]
        if len(pixels):
            views.append((frame['camera'], frame['P'][:, :3], frame['P'][:, 3], np.concatenate(pixels), np.concatenate(points)))
    return views


def seen_through(views, points, unit, thresholds):
    """How many views looked through each point to surfaces clearly further away. For as-is views: the spot was
    empty then. For walk views and as-is points: the geometry there is gone now."""
    import numpy as np
    support = np.zeros(len(points), dtype=int)
    if not len(points):
        return support
    margin = thresholds['free_space_margin_m'] / unit
    for camera, R, t, obs_xy, obs_xyz in views:
        obs_depth = (obs_xyz @ R.T + t)[:, 2]
        cam = points @ R.T + t
        front = np.flatnonzero(cam[:, 2] > 1e-6)
        if not len(front):
            continue
        uv = np.asarray(camera.img_from_cam(cam[front]), dtype=float)
        inside = (uv[:, 0] >= 0) & (uv[:, 0] < camera.width) & (uv[:, 1] >= 0) & (uv[:, 1] < camera.height)
        front, uv = front[inside], uv[inside]
        qi, ri, _ = pairs_within(uv, obs_xy, thresholds['free_space_radius_px'])
        near = np.bincount(qi, minlength=len(front))
        deeper = np.bincount(qi, weights=obs_depth[ri] > cam[front[qi], 2] + margin, minlength=len(front))
        support[front] += (near >= 2) & (deeper >= .75 * np.maximum(near, 1))
    return support


def behind(grid, group, cameras, seen, depth):
    """Cells hidden behind a group of cells from these cameras, up to `depth`, stopping at cells in `seen`."""
    import numpy as np
    cells, out = set(group), set()
    step = grid.cell / 2
    for cell in group:
        centre = grid.centre(cell)
        for camera in cameras:
            direction = centre - camera
            norm = float(np.linalg.norm(direction))
            if norm < 1e-6:
                continue
            direction = direction / norm
            for k in range(1, int(depth / step) + 1):
                q = tuple(int(v) for v in np.floor((centre + direction * k * step - grid.origin) / grid.cell))
                if not (0 <= q[0] < grid.shape[0] and 0 <= q[1] < grid.shape[1]) or (q not in cells and seen[q]):
                    break
                if q not in cells:
                    out.add(q)
    return out


def ray_cells(grid, origin, targets, cell_of, in_band, step, stop_short, stop_at=None):
    """For rays from `origin` to each target: (ray index, flat cell index) of every sample `in_band`, ending
    `stop_short` before the target so the target's own surface is not counted. With `stop_at` (cells), a ray that passes
    any such cell in band is dropped whole: what hides its target is already known. Unique per ray and cell."""
    import numpy as np
    if not len(targets):
        return np.zeros(0, dtype=int), np.zeros(0, dtype=int)
    span = targets - origin
    length = np.linalg.norm(span, axis=1)
    count = np.maximum(((length - stop_short) / step).astype(int), 0)
    total = int(count.sum())
    if not total:
        return np.zeros(0, dtype=int), np.zeros(0, dtype=int)
    ray = np.repeat(np.arange(len(targets)), count)
    k = np.arange(total) - np.repeat(np.cumsum(count) - count, count)
    samples = origin + span[ray] * ((k + .5) * step / length[ray])[:, None]
    keep = in_band(samples)
    ray, samples = ray[keep], samples[keep]
    ij = grid.index(cell_of(samples))
    flat = ij[:, 0] * grid.shape[1] + ij[:, 1]
    if stop_at is not None and len(ray):
        explained = np.zeros(len(targets), dtype=bool)
        explained[ray[stop_at.reshape(-1)[flat]]] = True
        ray, flat = ray[~explained[ray]], flat[~explained[ray]]
    pairs = np.unique(ray.astype(np.int64) * (grid.shape[0] * grid.shape[1]) + flat)
    return pairs // (grid.shape[0] * grid.shape[1]), pairs % (grid.shape[0] * grid.shape[1])


def unexplained_occlusion(located, observations, model_xyz, grid, to_floor, height, unit, band_top, thresholds, explained):
    """Cells where something hides the as-is scene without showing features (a plain box, say): at robot height they
    lie on rays to as-is points that two or more walk frames could not see again, and on no ray to a point they did see.
    Returns per-cell counts of such frames and the cells that a seen ray crossed."""
    import numpy as np
    free = np.zeros(grid.shape[0] * grid.shape[1], dtype=bool)
    hidden_frames = np.zeros(grid.shape[0] * grid.shape[1], dtype=int)
    in_band = lambda p: (height(p) >= thresholds['min_obstacle_height_m']) & (height(p) <= band_top)
    # A ray clears a cell only where it passes near the floor: one that grazes over an object proves nothing below it.
    near_floor = lambda p: (height(p) >= -.05) & (height(p) <= .15)
    # A seen ray clears space up to 5 cm before the surface it reached; a hidden ray counts only 15 cm short of its point.
    step, short, seen_short = grid.cell / 2 / unit, thresholds['free_space_margin_m'] / unit, .05 / unit
    radius, margin = thresholds['free_space_radius_px'], thresholds['free_space_margin_m'] / unit
    for index, frame in enumerate(located):
        pixels, points = observations[index]
        if not len(pixels):
            continue
        pixels, points = np.concatenate(pixels), np.concatenate(points)
        R, t, camera = frame['P'][:, :3], frame['P'][:, 3], frame['camera']
        seen_depth = (points @ R.T + t)[:, 2]
        cam = model_xyz @ R.T + t
        front = np.flatnonzero((cam[:, 2] > 1e-6) & (cam[:, 2] * unit < 10))
        if not len(front):
            continue
        uv = np.asarray(camera.img_from_cam(cam[front]), dtype=float)
        inside = (uv[:, 0] >= 0) & (uv[:, 0] < camera.width) & (uv[:, 1] >= 0) & (uv[:, 1] < camera.height)
        front, uv = front[inside], uv[inside]
        qi, ri, _ = pairs_within(uv, pixels, radius)
        near = np.bincount(qi, minlength=len(front))
        same = np.bincount(qi, weights=np.abs(seen_depth[ri] - cam[front[qi], 2]) <= margin, minlength=len(front))
        _, cells = ray_cells(grid, frame['centre'], model_xyz[front[same > 0]], to_floor, near_floor, step, seen_short)
        free[cells] = True
        _, cells = ray_cells(grid, frame['centre'], points, to_floor, near_floor, step, seen_short)  # what this frame saw itself
        free[cells] = True
        _, cells = ray_cells(grid, frame['centre'], model_xyz[front[near == 0]], to_floor, in_band, step, short, explained)
        hidden_frames += np.bincount(cells, minlength=len(free)) >= 3  # three hidden rays per cell: not one missed match
    return hidden_frames.reshape(grid.shape), free.reshape(grid.shape)


def components(mask):
    """8-connected groups of True cells."""
    import numpy as np
    seen = np.zeros_like(mask, dtype=bool)
    groups = []
    for start in zip(*np.nonzero(mask)):
        if seen[start]:
            continue
        stack, group = [start], []
        seen[start] = True
        while stack:
            i, j = stack.pop()
            group.append((int(i), int(j)))
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    a, b = i + di, j + dj
                    if 0 <= a < mask.shape[0] and 0 <= b < mask.shape[1] and mask[a, b] and not seen[a, b]:
                        seen[a, b] = True
                        stack.append((a, b))
        groups.append(group)
    return groups


def update(workspace: Path, source_dir: Path, frames, request: dict, scratch: Path, thresholds=THRESHOLDS) -> dict:
    import numpy as np
    started = time.monotonic()
    thresholds = {**thresholds, 'min_obstacle_height_m': request.get('min_obstacle_height_m', thresholds['min_obstacle_height_m'])}
    if not 2 <= len(frames) <= MAX_FRAMES:
        raise ValueError(f'Give 2 to {MAX_FRAMES} frames of the walk.')
    frame_info = site_frame(source_dir, request.get('site_frame'))
    unit = frame_info['metres_per_unit']
    up, across, along = floor_axes(frame_info['up'])
    model = lp.selected_model(workspace)
    model_xyz = np.array([p.xyz for p in model.points3D.values()], dtype=float)
    if len(model_xyz) < 50:
        raise ValueError('The as-is reconstruction has too few points to compare a walk against.')
    to_floor = lambda xyz: np.column_stack([xyz @ across, xyz @ along]) * unit
    level = frame_info.get('floor_level')
    if level is None:
        level = floor_level(model_xyz @ up * unit)
    height = lambda xyz: xyz @ up * unit - level
    robots = request['robots']
    max_height = max(robot['height_m'] for robot in robots)
    result = {'schema': SCHEMA, 'loop': ['observe', 'understand', 'remember', 'adapt', 'share'],
              'observer': request['observer'],
              'site_frame': {'basis': frame_info['basis'], 'up_model': [round(float(v), 6) for v in up],
                             'floor_axes_model': {'across': [round(float(v), 6) for v in across], 'along': [round(float(v), 6) for v in along]},
                             'floor_level_m': round(level, 4), 'units': 'm', 'as_is_points': int(len(model_xyz))},
              'thresholds': dict(thresholds), 'limits': LIMITS,
              'policy_executed': False, 'physical_validated': False, 'metric_verified': False}

    # Observe
    located, records = observe(workspace, frames, scratch)
    for record in records:
        if 'camera_center_model' in record:
            centre = np.asarray(record['camera_center_model'])
            record['floor_position_m'] = [round(float(v), 3) for v in to_floor(centre[None])[0]]
            record['height_m'] = round(float(height(centre[None])[0]), 3)
    result['observe'] = {'frames': records, 'submitted': len(frames), 'located': len(located)}
    if len(located) < 2:
        result['status'] = 'not-enough-located-frames'
        result['remember'] = {'status': 'nothing-proposed', 'requires_review': True, 'applied': False, 'candidate_ids': []}
        result['elapsed_seconds'] = round(time.monotonic() - started, 3)
        return result

    # Understand
    clouds, observations, viewpoint = [], [([], []) for _ in located], []
    camera_height = [float(height(frame['centre'][None])[0]) for frame in located]
    for (ia, a), (ib, b) in itertools.combinations(enumerate(located), 2):
        points, pixels_a, pixels_b = triangulate(a, b, thresholds)
        clouds.append(points)
        viewpoint.append(np.full(len(points), max(camera_height[ia], camera_height[ib])))
        for index, pixels in ((ia, pixels_a), (ib, pixels_b)):
            observations[index][0].append(pixels)
            observations[index][1].append(points)
    walk = np.concatenate(clouds) if clouds else np.zeros((0, 3))
    walk_viewpoint = np.concatenate(viewpoint) if viewpoint else np.zeros(0)  # the higher camera of each point's pair
    qi, _, distance = pairs_within(walk * unit, model_xyz * unit, thresholds['near_model_m'])
    nearest = np.full(len(walk), np.inf)
    np.minimum.at(nearest, qi, distance)
    on_model = np.isfinite(nearest)
    walk_height = height(walk) if len(walk) else np.zeros(0)
    in_band = (walk_height >= thresholds['min_obstacle_height_m']) & (walk_height <= max_height + thresholds['height_tolerance_m'])
    off = np.flatnonzero(~on_model & in_band)
    views = as_is_views(model)
    support = seen_through(views, walk[off], unit, thresholds)
    registration = {'walk_points': int(len(walk)), 'frame_pairs': len(clouds), 'on_as_is_model': int(on_model.sum()),
                    'off_model_in_robot_band': int(len(off))}
    if on_model.any():
        registration.update(median_distance_m=round(float(np.median(nearest[on_model])), 4),
                            p90_distance_m=round(float(np.percentile(nearest[on_model], 90)), 4))

    # Grid over everything the planner may need
    route = request['route']
    if route.get('from') == 'walk':
        ends = [to_floor(located[0]['centre'][None])[0], to_floor(located[-1]['centre'][None])[0]]
    else:
        ends = [np.asarray(route['start']), np.asarray(route['goal'])]
    model_uv = to_floor(model_xyz)
    lo, hi = np.percentile(model_uv, [.5, 99.5], axis=0)
    extent = np.vstack([lo, hi, ends, to_floor(np.array([f['centre'] for f in located]))])
    grid = Grid(extent, thresholds['cell_m'])
    model_height = height(model_xyz)
    observed = (grid.counts(model_uv[model_height <= max_height]) + grid.counts(to_floor(walk))) > 0

    # Candidate changes: off-model points in the band, grouped on the floor grid
    off_uv = to_floor(walk[off])
    cell_counts = grid.counts(off_uv)
    cell_min = np.full(grid.shape, np.inf)
    if len(off):
        ij = grid.index(off_uv)
        np.minimum.at(cell_min, (ij[:, 0], ij[:, 1]), walk_height[off])
    candidates, candidate_cells = [], {}
    ij = grid.index(off_uv) if len(off) else np.zeros((0, 2), dtype=int)
    labels = np.full(grid.shape, -1)
    for number, group in enumerate(components(cell_counts >= thresholds['min_cell_points'])):
        for cell in group:
            labels[cell] = number
        members = labels[ij[:, 0], ij[:, 1]] == number
        count = int(members.sum())
        if count < thresholds['min_candidate_points']:
            continue
        seen_empty = int((support[members] > 0).sum())
        uv = off_uv[members]
        heights = walk_height[off][members]
        cid = f'candidate-{len(candidates) + 1}'
        candidates.append({
            'id': cid, 'class': 'added' if seen_empty >= thresholds['min_added_points'] else 'newly_observed',
            'points': count, 'points_seen_empty_before': seen_empty,
            'footprint_m': {'across': [round(float(uv[:, 0].min()), 3), round(float(uv[:, 0].max()), 3)],
                            'along': [round(float(uv[:, 1].min()), 3), round(float(uv[:, 1].max()), 3)]},
            'footprint_area_m2': round(len(group) * thresholds['cell_m'] ** 2, 3),
            'height_m': [round(float(heights.min()), 3), round(float(heights.max()), 3)],
            'cells': sorted([list(cell) for cell in group])})
        candidate_cells[cid] = group
    # Removed: as-is geometry in the band that a walk frame now looks straight through, and that the walk never saw again.
    band_all = np.flatnonzero((model_height >= thresholds['min_obstacle_height_m'])
                              & (model_height <= max_height + thresholds['height_tolerance_m']))
    gone = np.zeros(len(model_xyz), dtype=bool)
    if len(band_all) and len(walk):
        through = seen_through(walk_views(located, observations), model_xyz[band_all], unit, thresholds)
        again, _, _ = pairs_within(model_xyz[band_all] * unit, walk * unit, thresholds['near_model_m'])
        seen_again = np.zeros(len(band_all), dtype=bool)
        seen_again[again] = True
        gone[band_all] = (through > 0) & ~seen_again
    gone_index = np.flatnonzero(gone)
    gone_uv = model_uv[gone_index]
    gone_ij = grid.index(gone_uv) if len(gone_index) else np.zeros((0, 2), dtype=int)
    removed_points, removed_cells = {}, {}
    labels = np.full(grid.shape, -1)
    gone_cells = grid.counts(gone_uv) >= 1
    for number, near in enumerate(components(inflate(gone_cells, 1))):  # one removal: gone points within a cell of each other
        group = [cell for cell in near if gone_cells[cell]]
        for cell in group:
            labels[cell] = number
        members = labels[gone_ij[:, 0], gone_ij[:, 1]] == number
        count = int(members.sum())
        if count < thresholds['min_removed_points']:
            continue
        uv, heights = gone_uv[members], model_height[gone_index[members]]
        cid = f'candidate-{len(candidates) + 1}'
        candidates.append({
            'id': cid, 'class': 'removed', 'points': count, 'points_seen_through_now': count,
            'footprint_m': {'across': [round(float(uv[:, 0].min()), 3), round(float(uv[:, 0].max()), 3)],
                            'along': [round(float(uv[:, 1].min()), 3), round(float(uv[:, 1].max()), 3)]},
            'footprint_area_m2': round(len(group) * thresholds['cell_m'] ** 2, 3),
            'height_m': [round(float(heights.min()), 3), round(float(heights.max()), 3)],
            'cells': sorted([list(cell) for cell in group])})
        removed_points[cid], removed_cells[cid] = gone_index[members], group
    kept = np.ones(len(model_xyz), dtype=bool)
    for indices in removed_points.values():
        kept[indices] = False
    cameras = to_floor(np.array([f['centre'] for f in located]))

    # An object seen from one side may be deeper than its visible face: assume the unseen space behind it is occupied.
    # The march behind a change stops where the walk saw the floor or unchanged as-is geometry: proof the space is not
    # part of the object. (Points on the object itself, such as a slab's top, are no such proof.)
    floor_points = np.abs(walk_height) < thresholds['min_obstacle_height_m']
    low_seen = (grid.counts(to_floor(walk[floor_points])) + grid.counts(to_floor(walk[on_model & in_band]))) > 0
    assumed_cells = {}
    for candidate in candidates:
        if candidate['class'] == 'removed':
            candidate.update(assumed_depth_m=0, assumed_cells=[], assumed_area_m2=0)
            continue
        hidden = behind(grid, candidate_cells[candidate['id']], cameras, low_seen, request['assumed_depth_m'])
        assumed_cells[candidate['id']] = sorted(hidden)
        candidate.update(assumed_depth_m=request['assumed_depth_m'], assumed_cells=sorted([list(c) for c in hidden]),
                         assumed_area_m2=round(len(hidden) * thresholds['cell_m'] ** 2, 3))

    # The as-is map is sparse geometry seen from the as-is cameras: the same unseen depth is assumed behind it, stopping
    # where the as-is scan saw the floor.
    as_is_cameras = to_floor(np.array([-(R.T @ t) for _, R, t, _, _ in views])) if views else cameras
    as_is_floor = grid.counts(model_uv[np.abs(model_height) < thresholds['min_obstacle_height_m']]) > 0

    def with_depth(occupied):
        out = occupied.copy()
        for cell in behind(grid, [tuple(c) for c in np.argwhere(occupied)], as_is_cameras, as_is_floor, request['assumed_depth_m']):
            out[cell] = True
        return out

    # Occluders: something hides the as-is scene from three or more frames and no seen ray crosses it near the floor,
    # yet it shows no features of its own (a plain box).
    band_top = max_height + thresholds['height_tolerance_m']
    # Known: as-is geometry and changes, each with its assumed depth, grown by a cell so sparse points leave no gaps.
    explained = with_depth(grid.counts(model_uv[band_all]) > 0)
    for cid, group in candidate_cells.items():
        for cell in group + assumed_cells[cid]:
            explained[cell] = True
    explained = inflate(explained, 1)
    hidden_frames, carved = unexplained_occlusion(located, observations, model_xyz, grid, to_floor, height, unit,
                                                  band_top, thresholds, explained)
    # Count only frames that view the cell (its centre at mid robot height in the image): a plain object hides the scene
    # from nearly every frame facing it, while a missed match or a sliver of shadow hides it from a few.
    mid = (thresholds['min_obstacle_height_m'] + band_top) / 2
    centres = grid.centre(np.argwhere(np.ones(grid.shape, dtype=bool)))
    probes = (centres[:, :1] * across + centres[:, 1:] * along + (level + mid) * up) / unit
    viewing = np.zeros(len(probes), dtype=int)
    for frame in located:
        cam = probes @ frame['P'][:, :3].T + frame['P'][:, 3]
        ahead = cam[:, 2] > 1e-6
        uv = np.full((len(probes), 2), -1.)
        uv[ahead] = np.asarray(frame['camera'].img_from_cam(cam[ahead]), dtype=float)
        viewing += ahead & (uv[:, 0] >= 0) & (uv[:, 0] < frame['camera'].width) & (uv[:, 1] >= 0) & (uv[:, 1] < frame['camera'].height)
    viewing = viewing.reshape(grid.shape)
    suspect = (hidden_frames >= 3) & (hidden_frames >= .75 * viewing) & ~carved & ~explained
    suspect = inflate(suspect, 1) & ~carved & ~explained  # close one-cell gaps left by sparse hidden rays
    # The walk cannot tell where along its rays a plain object stands or how far back it reaches, and everything behind
    # it is hidden too: the whole hidden region is proposed as blocked until someone walks around it.
    for group in components(suspect):
        front = sorted(group)
        if len(front) < thresholds['min_occluder_cells']:
            continue
        centres = np.array([grid.centre(c) for c in front])
        cid = f'candidate-{len(candidates) + 1}'
        candidates.append({
            'id': cid, 'class': 'occluder', 'points': 0, 'frames_hidden': int(max(hidden_frames[c] for c in front)),
            'footprint_m': {'across': [round(float(centres[:, 0].min() - grid.cell / 2), 3), round(float(centres[:, 0].max() + grid.cell / 2), 3)],
                            'along': [round(float(centres[:, 1].min() - grid.cell / 2), 3), round(float(centres[:, 1].max() + grid.cell / 2), 3)]},
            'footprint_area_m2': round(len(front) * thresholds['cell_m'] ** 2, 3),
            'height_m': [thresholds['min_obstacle_height_m'], round(band_top, 3)],
            'cells': [list(c) for c in front], 'assumed_depth_m': 0, 'assumed_cells': [], 'assumed_area_m2': 0})
        candidate_cells[cid], assumed_cells[cid] = front, []

    result['understand'] = {'registration': registration, 'candidates': candidates,
                            'grid': {'cell_m': grid.cell, 'origin_m': [round(float(v), 4) for v in grid.origin], 'shape': list(grid.shape)}}

    # Remember
    added = [c['id'] for c in candidates]
    result['remember'] = {'status': 'proposed' if added else 'nothing-proposed', 'requires_review': True, 'applied': False,
                          'candidate_ids': added, 'base': "the project's current as-is revision",
                          'review': 'A different named principal confirms the evidence and approves each robot\'s change before it applies.',
                          'project_requests': 'project-requests.json'}

    # Adapt. New geometry blocks every robot unless the walk saw the floor beneath it from a camera lower than it: a
    # surface seen above a robot's height says nothing about the space under it (a crate's top looks like a table's).
    under_seen = np.full(grid.shape, -np.inf)  # negated, so maximum.at keeps the lowest camera height
    if floor_points.any():
        fij = grid.index(to_floor(walk[floor_points]))
        np.maximum.at(under_seen, (fij[:, 0], fij[:, 1]), -walk_viewpoint[floor_points])
    under_seen = -under_seen  # lowest camera height that saw the floor in each cell (inf: never)

    def blocks(cell, reach_height):
        lowest = cell_min[cell] if np.isfinite(cell_min[cell]) else 0.
        return lowest <= reach_height or not under_seen[cell] < lowest

    start, goal = grid.index(np.array(ends))
    plans, share = [], []
    for robot in robots:
        band = (model_height >= thresholds['min_obstacle_height_m']) & (model_height <= robot['height_m'] + thresholds['height_tolerance_m'])
        before_occupied = with_depth(grid.counts(model_uv[band]) >= thresholds['min_cell_points'])
        after_occupied = with_depth(grid.counts(model_uv[band & kept]) >= thresholds['min_cell_points'])
        reach_height = robot['height_m'] + thresholds['height_tolerance_m']
        for cid, group in candidate_cells.items():
            for cell in group + assumed_cells[cid]:
                if blocks(cell, reach_height):
                    after_occupied[cell] = True
        radius = math.hypot(robot['width_m'], robot['depth_m']) / 2 + robot['margin_m']
        before_free = ~inflate(before_occupied, radius / grid.cell)
        after_free = ~inflate(after_occupied, radius / grid.cell)
        plan = plan_routes(before_free, after_free, start, goal)
        as_metres = lambda path: [[round(float(v), 3) for v in grid.centre(cell)] for cell in path]
        entry = {'id': robot['id'], 'model': robot['model'], 'footprint_m': [robot['width_m'], robot['depth_m']],
                 'height_m': robot['height_m'], 'margin_m': robot['margin_m'], 'clearance_radius_m': round(radius, 3),
                 'outcome': plan['outcome']}
        for when in ('before', 'after'):
            path = plan[when]
            if path:
                waypoints = as_metres(simplify(path, before_free if when == 'before' else after_free))
                entry[when] = {'length_m': round(route_length(waypoints), 3), 'waypoints': waypoints,
                               'cells': len(path), 'unobserved_fraction': round(float(np.mean([not observed[c] for c in path])), 3),
                               'longest_unseen_m': round(longest_unseen(path, observed) * grid.cell, 2)}
            else:
                entry[when] = None
        entry['changed_by'] = []
        if plan['outcome'] in ('shortened', 'opened'):
            for cid, group in removed_cells.items():
                mask = np.zeros(grid.shape, dtype=bool)
                for cell in group:
                    mask[cell] = True
                reach = inflate(mask, radius / grid.cell)
                if any(reach[cell] for cell in plan['after']):
                    entry['changed_by'].append(cid)
        if plan['outcome'] in ('rerouted', 'blocked'):
            for cid, group in candidate_cells.items():
                mask = np.zeros(grid.shape, dtype=bool)
                for cell in group + assumed_cells[cid]:
                    mask[cell] = blocks(cell, reach_height)
                reach = inflate(mask, radius / grid.cell)
                if any(reach[cell] for cell in plan['before']):
                    entry['changed_by'].append(cid)
        plans.append(entry)
        share.append({'robot_id': robot['id'], 'outcome': plan['outcome'], 'status': 'proposed', 'requires_review': True,
                      'applies_after': f"the change proposed for {robot['id']} is approved in the World Project",
                      'route': entry['after']['waypoints'] if entry['after'] else None,
                      'route_longest_unseen_m': entry['after']['longest_unseen_m'] if entry['after'] else None})
    result['adapt'] = {'route': {'start_m': [round(float(v), 3) for v in ends[0]], 'goal_m': [round(float(v), 3) for v in ends[1]],
                                 'from': 'walk' if route.get('from') == 'walk' else 'request'},
                       'robots': plans}
    result['share'] = share
    result['status'] = ('change-detected' if any(c['class'] in ('added', 'removed', 'occluder') for c in candidates)
                        else 'new-coverage-only' if candidates else 'no-change-detected')
    result['elapsed_seconds'] = round(time.monotonic() - started, 3)
    result['_render'] = {'grid': grid, 'before_occupied': before_union(grid, model_uv, model_height, robots, thresholds),
                         'candidate_cells': candidate_cells, 'assumed_cells': assumed_cells, 'removed_cells': removed_cells,
                         'candidates': candidates, 'plans': plans,
                         'frames': [r['floor_position_m'] for r in records if r.get('floor_position_m')], 'ends': ends,
                         'observed': observed}
    return result


def before_union(grid, model_uv, model_height, robots, thresholds):
    tallest = max(robot['height_m'] for robot in robots)
    band = (model_height >= thresholds['min_obstacle_height_m']) & (model_height <= tallest + thresholds['height_tolerance_m'])
    return grid.counts(model_uv[band]) >= thresholds['min_cell_points']


def path_free(free, path):
    """Whether a cell path is still drivable under A*'s own rules: every cell free, and no diagonal step cutting a
    blocked corner. Checking cells alone would keep a route that now clips a new obstacle beside a diagonal step."""
    if not all(free[cell] for cell in path):
        return False
    for (i, j), (a, b) in zip(path, path[1:]):
        if a != i and b != j and not (free[a, j] and free[i, b]):
            return False
    return True


def plan_routes(before_free, after_free, start, goal):
    before = astar(before_free, start, goal)
    if before is None:
        after = astar(after_free, start, goal)
        return {'outcome': 'opened' if after else 'no-route-before', 'before': None, 'after': after}
    if path_free(after_free, before):
        # Still clear; a removal may also have opened a shorter way (more than one cell shorter).
        after = astar(after_free, start, goal)
        if after and route_length(after) < route_length(before) - 1:
            return {'outcome': 'shortened', 'before': before, 'after': after}
        return {'outcome': 'unchanged', 'before': before, 'after': before}
    after = astar(after_free, start, goal)
    return {'outcome': 'rerouted' if after else 'blocked', 'before': before, 'after': after}


# ---------------------------------------------------------------- remember: World Project request plan

def project_requests(result: dict, update_text: str) -> dict:
    """The #321 World Project requests that record this update for review. `$as_is` is the project's current as-is
    revision and `$<ref>` an id created by an earlier step; both, and expected_version, are read when the plan runs."""
    data = update_text.encode('utf-8')
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError('The world update is larger than one retained project source (512 KiB).')
    sha = hashlib.sha256(data).hexdigest()
    plan = {'schema': PLAN_SCHEMA, 'source_sha256': sha,
            'placeholders': {'$as_is': "the project's current as-is revision id",
                             '$<ref>': 'the id created by the earlier step with that ref'},
            'expected_version': "read from the project immediately before each step", 'steps': []}
    scan = (result.get('source') or {}).get('reconstruction_sha256')
    if scan:
        # The walk was compared with this exact scan: the plan applies only where it is the current as-is revision's source.
        plan['as_is_scan'] = {'name': 'reconstruction.json', 'sha256': scan}
    candidates = result.get('understand', {}).get('candidates', [])
    if not candidates:
        plan['note'] = 'No candidate change was detected, so nothing is proposed.'
        return plan
    located = result['observe']['located']
    plan['steps'].append({'ref': 'source', 'action': 'addSource', 'body': {
        'name': f'world-update-{sha[:12]}.json', 'media_type': 'application/json', 'content_text': update_text, 'sha256': sha}})
    evidence = []
    for index, candidate in enumerate(candidates):
        if candidate['class'] == 'removed':
            claim = (f"{result['observer']['model']} ({result['observer']['id']}) looked straight through as-is geometry "
                     f"{candidate['footprint_m']['across'][0]}..{candidate['footprint_m']['across'][1]} m across and "
                     f"{candidate['footprint_m']['along'][0]}..{candidate['footprint_m']['along'][1]} m along the floor, "
                     f"{candidate['height_m'][0]}..{candidate['height_m'][1]} m high, to surfaces behind it: it is gone "
                     f"({candidate['points']} as-is points seen through and not seen again).")
            ref = f"evidence-{candidate['id']}"
            evidence.append('$' + ref)
            plan['steps'].append({'ref': ref, 'action': 'addEvidence', 'body': {
                'revision_id': '$as_is', 'source_id': '$source', 'component_id': candidate['id'], 'kind': 'observed',
                'claim': claim[:2000], 'value': candidate['footprint_area_m2'], 'unit': 'm2',
                'locator': {'note': f"world-update.json understand.candidates[{index}]; {located} located walk frames"},
                'uncertainty': result['thresholds']['cell_m']}})
            continue
        if candidate['class'] == 'occluder':
            claim = (f"{result['observer']['model']} ({result['observer']['id']}) could not see the as-is scene behind "
                     f"{candidate['footprint_m']['across'][0]}..{candidate['footprint_m']['across'][1]} m across and "
                     f"{candidate['footprint_m']['along'][0]}..{candidate['footprint_m']['along'][1]} m along the floor from "
                     f"{candidate['frames_hidden']} frames, and saw nothing through that space: something without visible "
                     "features (a plain surface) probably stands there. Its shape is not measured: walk around it so the camera sees its "
                     "sides and the floor behind it.")
            ref = f"evidence-{candidate['id']}"
            evidence.append('$' + ref)
            plan['steps'].append({'ref': ref, 'action': 'addEvidence', 'body': {
                'revision_id': '$as_is', 'source_id': '$source', 'component_id': candidate['id'], 'kind': 'inferred',
                'claim': claim[:2000], 'value': candidate['footprint_area_m2'], 'unit': 'm2',
                'locator': {'note': f"world-update.json understand.candidates[{index}]; {located} located walk frames"},
                'uncertainty': 'Footprint is the hidden region up to the assumed depth; the object itself was not measured.'}})
            continue
        kind = ('was seen empty in the as-is scan and is now occupied' if candidate['class'] == 'added'
                else 'was not seen in the as-is scan')
        claim = (f"{result['observer']['model']} ({result['observer']['id']}) observed new geometry "
                 f"{candidate['footprint_m']['across'][0]}..{candidate['footprint_m']['across'][1]} m across and "
                 f"{candidate['footprint_m']['along'][0]}..{candidate['footprint_m']['along'][1]} m along the floor, "
                 f"{candidate['height_m'][0]}..{candidate['height_m'][1]} m high; the spot {kind} "
                 f"({candidate['points']} triangulated points, {candidate['points_seen_empty_before']} seen empty before). "
                 f"A further {candidate.get('assumed_area_m2', 0)} m2 behind it was not seen and is assumed occupied.")
        ref = f"evidence-{candidate['id']}"
        evidence.append('$' + ref)
        plan['steps'].append({'ref': ref, 'action': 'addEvidence', 'body': {
            'revision_id': '$as_is', 'source_id': '$source', 'component_id': candidate['id'], 'kind': 'observed',
            'claim': claim[:2000], 'value': candidate['footprint_area_m2'], 'unit': 'm2',
            'locator': {'note': f"world-update.json understand.candidates[{index}]; {located} located walk frames"},
            'uncertainty': result['thresholds']['cell_m']}})
    route = result['adapt']['route']
    for robot in result['adapt']['robots']:
        before, after = robot['before'], robot['after']
        summary = {'unchanged': 'its as-is route stays clear', 'shortened': 'space opened up; a shorter route is now clear',
                   'opened': 'it had no route before; the change opened one',
                   'rerouted': 'its as-is route is blocked; a new route avoids the change',
                   'blocked': 'no route fits its footprint any more', 'no-route-before': 'it had no route before this change either'}[robot['outcome']]
        plan['steps'].append({'ref': f"revision-{robot['id']}", 'action': 'createRevision', 'body': {
            'label': f"Proposed: as-is plus observed change, for {robot['id']}"[:160], 'kind': 'proposed', 'source_ids': ['$source'],
            'robot': {'model': robot['model'], 'width_m': max(robot['footprint_m']), 'margin_m': robot['margin_m']},
            'task': {'kind': 'route', 'goal': (f"Drive from {route['start_m']} to {route['goal_m']} (floor metres). "
                                               f"Outcome: {robot['outcome']}"
                                               + (f", {after['length_m']} m" if after else '')
                                               + (f" (was {before['length_m']} m)" if before and robot['outcome'] in ('rerouted', 'shortened') else '')
                                               + '.')[:2000]},
            'parent_revision_id': '$as_is'}})
        plan['steps'].append({'ref': f"change-{robot['id']}", 'action': 'createChange', 'body': {
            'base_revision_id': '$as_is', 'proposed_revision_id': f"$revision-{robot['id']}",
            'title': f"Observed change: adapt {robot['id']}"[:160],
            'reason': (f"{result['observer']['id']} saw {len(candidates)} candidate change(s) on its walk; for {robot['id']} "
                       f"({robot['footprint_m'][0]} x {robot['footprint_m'][1]} m, {robot['height_m']} m tall) {summary}. "
                       'Planning preview only; confirm the evidence and approve before any robot uses this route.')[:2000],
            'evidence_ids': list(evidence)}})
    return plan


# ---------------------------------------------------------------- share: plan view

COLOURS = ['#2563eb', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#4f46e5', '#dc2626']


def svg(render) -> str:
    grid = render['grid']
    n, m = grid.shape
    scale = max(4, min(16, int(640 / max(n, m))))
    width, height = max(n * scale, 420), m * scale + 64 + 18 * len(render['plans'])
    x = lambda u: (u - grid.origin[0]) / grid.cell * scale
    y = lambda v: (m - (v - grid.origin[1]) / grid.cell) * scale
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
           'font-family="system-ui, sans-serif" font-size="12">',
           f'<rect width="{width}" height="{height}" fill="#ffffff"/>']
    for i in range(n):
        for j in range(m):
            fill = '#475569' if render['before_occupied'][i, j] else ('#f1f5f9' if render['observed'][i, j] else None)
            if fill:
                out.append(f'<rect x="{i * scale}" y="{(m - 1 - j) * scale}" width="{scale}" height="{scale}" fill="{fill}"/>')
    classes = {c['id']: c['class'] for c in render['candidates']}
    for cid, group in render['assumed_cells'].items():
        for i, j in group:
            out.append(f'<rect x="{i * scale}" y="{(m - 1 - j) * scale}" width="{scale}" height="{scale}" fill="#fed7aa"/>')
    for cid, group in render['removed_cells'].items():
        for i, j in group:
            out.append(f'<rect x="{i * scale + 1}" y="{(m - 1 - j) * scale + 1}" width="{scale - 2}" height="{scale - 2}" '
                       'fill="#99f6e4" stroke="#0d9488" stroke-width="1.5"/>')
    for cid, group in render['candidate_cells'].items():
        fill = {'added': '#f97316', 'occluder': '#a78bfa'}.get(classes[cid], '#fdba74')
        for i, j in group:
            out.append(f'<rect x="{i * scale}" y="{(m - 1 - j) * scale}" width="{scale}" height="{scale}" fill="{fill}"/>')
    for index, plan in enumerate(render['plans']):
        colour = COLOURS[index % len(COLOURS)]
        for when, dash in (('before', ' stroke-dasharray="6 4" opacity="0.6"'), ('after', '')):
            if plan[when] and not (when == 'after' and plan['outcome'] == 'unchanged' and plan['before']):
                points = ' '.join(f'{x(u):.1f},{y(v):.1f}' for u, v in plan[when]['waypoints'])
                out.append(f'<polyline points="{points}" fill="none" stroke="{colour}" stroke-width="2.5"{dash}/>')
    for u, v in render['frames']:
        out.append(f'<circle cx="{x(u):.1f}" cy="{y(v):.1f}" r="3" fill="#0f172a"/>')
    (su, sv), (gu, gv) = render['ends']
    out.append(f'<circle cx="{x(su):.1f}" cy="{y(sv):.1f}" r="6" fill="none" stroke="#0f172a" stroke-width="2"/>')
    out.append(f'<rect x="{x(gu) - 6:.1f}" y="{y(gv) - 6:.1f}" width="12" height="12" fill="none" stroke="#0f172a" stroke-width="2"/>')
    top = m * scale + 18
    legend = ['Grey: as-is obstacles. Orange: proposed addition (pale: assumed behind it).',
              'Violet: hidden by something plain. Teal: proposed removal. Nothing is applied.',
              'Dashed: route before. Solid: adapted route. Dots: walk frames.']
    for index, line in enumerate(legend):
        out.append(f'<text x="6" y="{top + 18 * index}" fill="#0f172a">{line}</text>')
    for index, plan in enumerate(render['plans']):
        colour = COLOURS[index % len(COLOURS)]
        text = f"{plan['id']}: {plan['outcome']}" + (f", {plan['after']['length_m']} m" if plan['after'] else '')
        out.append(f'<text x="6" y="{top + 18 * (index + len(legend))}" fill="{colour}">{escape(text)}</text>')
    out.append('</svg>')
    return '\n'.join(out)


def escape(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# ---------------------------------------------------------------- entry points

def run(source_dir: Path, frames, request: dict, out: Path) -> dict:
    """Run the loop on a recorded walk against a completed reconstruction job folder, and write its files."""
    source_dir, out = Path(source_dir), Path(out)
    workspace = source_dir / 'colmap-work'
    if not (workspace / 'database.db').is_file() or not (workspace / 'sparse' / sparse_colmap.SELECTED_MODEL).is_file():
        raise ValueError('Choose a completed reconstruction folder (with colmap-work) of this site.')
    checked = read_request(request)
    out.mkdir(parents=True, exist_ok=True)
    result = update(workspace, source_dir, [Path(f) for f in frames], checked, out / 'work')
    render = result.pop('_render', None)
    result['source'] = {'reconstruction': source_dir.name}
    record = source_dir / 'artifacts' / 'reconstruction.json'
    if record.is_file():
        result['source']['reconstruction_sha256'] = hashlib.sha256(record.read_bytes()).hexdigest()
    text = json.dumps(result, indent=1, allow_nan=False)
    (out / 'world-update.json').write_text(text)
    plan = project_requests(result, text)
    (out / 'project-requests.json').write_text(json.dumps(plan, indent=1, allow_nan=False))
    artifacts = [{'name': 'world-update.json', 'kind': 'evidence'}, {'name': 'project-requests.json', 'kind': 'evidence'}]
    if render:
        (out / 'world-update.svg').write_text(svg(render))
        artifacts.append({'name': 'world-update.svg', 'kind': 'preview'})
    (out / 'manifest.json').write_text(json.dumps({'artifacts': artifacts}))
    return result


def main():
    parser = argparse.ArgumentParser(description='One robot sees, another adapts: a reviewed world update from a recorded walk.')
    parser.add_argument('--reconstruction', required=True, help='completed reconstruction job folder (holds colmap-work)')
    parser.add_argument('--request', required=True, help=f'{REQUEST_SCHEMA} JSON: robots, route')
    walk = parser.add_mutually_exclusive_group(required=True)
    walk.add_argument('--frames', nargs='+', help='photos from the later walk, in walking order')
    walk.add_argument('--video', help='video of the later walk')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    request = Path(args.request)
    if request.stat().st_size > 65536:
        raise ValueError('The request is too large.')
    out = Path(args.out)
    frames = args.frames
    if args.video:
        images = out / 'walk-frames'
        images.mkdir(parents=True, exist_ok=True)
        sparse_colmap.extract_video(Path(args.video), images, max_images=MAX_FRAMES)
        frames = sorted(images.glob('image_*.jpg'))
    result = run(Path(args.reconstruction), frames, json.loads(request.read_text()), out)
    print(json.dumps({'status': result['status'], 'located': result['observe']['located'],
                      'candidates': [c['id'] + ':' + c['class'] for c in result.get('understand', {}).get('candidates', [])],
                      'robots': {r['id']: r['outcome'] for r in result.get('adapt', {}).get('robots', [])}}))


if __name__ == '__main__':
    main()
