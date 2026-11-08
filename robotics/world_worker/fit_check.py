"""How closely a compiled scene follows the points it was compiled from, for fit-check.json and fit-heatmap.ply.

Every point's distance to the nearest element surface (the floor slab, a wall or an object box) is measured, overall,
per element and per kind. A point within MODELLED of a surface is explained by the model; farther, it is not modelled
(clutter too small to separate, the ceiling, stray points). An element whose own points sit a median of more than
MISFIT_MEDIAN from its surface is flagged as a misfit.

This is model-to-points: it says how faithfully the boxes follow the reconstruction. The reconstruction and the typed
scale carry their own error, so it is not a survey tolerance; a tape or laser check is.
"""
from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scene_compiler'))
from opening_geometry import wall_openings, wall_faces, door_parts

ON, MODELLED, MISFIT_MEDIAN, MISFIT_POINTS = 0.05, 0.15, 0.05, 20
CEILING = 2.4  # metres over the floor: points higher than the objects are separated up to (scene_compiler.OBJECT_MAX_HEIGHT)
# The heatmap ramp: green on the surface, yellow at ON, red at MODELLED; points farther than MODELLED are grey.
RAMP = ((0.0, (0, 200, 140)), (ON, (240, 220, 60)), (MODELLED, (240, 60, 60)))
UNMODELLED = (110, 118, 135)


def surfaces(scene):
    """Semantic surfaces, with optional exposed local faces for reviewed cut walls."""
    out = []
    for o in scene.get('objects', []):
        if 'centre' in o and 'size' in o:
            kind = 'floor' if o.get('name') == 'floor_observed' else 'object'
            out.append((o['name'], o.get('label'), kind, o['centre'], o['size'], o.get('yaw_degrees', 0)))
    for w in scene.get('walls', []):
        if 'centre' in w and 'size' in w:
            element = (w['name'], 'wall', 'wall', w['centre'], w['size'], w.get('yaw_degrees', 0))
            out.append((*element, wall_faces(w, scene['openings'])) if wall_openings(w, scene.get('openings', [])) else element)
    for leaf in door_parts(scene.get('walls', []), scene.get('openings', [])):
        out.append((leaf['name'], 'closed reference door', 'door', leaf['centre'], leaf['size'], leaf.get('yaw_degrees', 0)))
    return out


def distances(points, elements):
    """Distance (m) from each point to the nearest element surface, and that element's index. A box's length runs along
    (cos yaw, sin yaw) in the x-z plane and its size is [length, height, thickness] (scene_compiler)."""
    import numpy as np
    P = np.asarray([p[:3] for p in points], float).reshape(-1, 3)
    if not elements or not len(P):
        return np.full(len(P), np.inf), np.full(len(P), -1)
    best, near = np.full(len(P), np.inf), np.full(len(P), -1)  # a running minimum: 50,000 points x 200 objects stays small
    for k, (_, _, _, centre, size, yaw, *faces) in enumerate(elements):
        t = math.radians(yaw); ex, ez = np.array([math.cos(t), 0, math.sin(t)]), np.array([-math.sin(t), 0, math.cos(t)])
        d = P - np.asarray(centre, float)
        local = np.stack([d @ ex, d[:, 1], d @ ez], 1)
        if faces:
            dist = np.full(len(P), np.inf)
            for face_centre, face_size in faces[0]:
                q = np.abs(local - np.asarray(face_centre)) - np.asarray(face_size) / 2
                dist = np.minimum(dist, np.linalg.norm(np.maximum(q, 0), axis=1))
        else:
            q = np.abs(local) - np.asarray(size, float) / 2
            dist = np.abs(np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0))
        closer = dist < best; best[closer], near[closer] = dist[closer], k
    return best, near


def check(scene, points):
    """The fit-check summary of a scene against its points."""
    import numpy as np
    elements = surfaces(scene); dist, near = distances(points, elements)
    heights = np.asarray([p[1] for p in points], float) - float(scene.get('floor_y', 0)) if points else np.zeros(0)
    modelled = dist <= MODELLED
    cm = lambda v: round(float(v) * 100, 1)
    per = []
    for k, (name, label, kind, *_rest) in enumerate(elements):
        own = dist[(near == k) & modelled]
        median = float(np.median(own)) if len(own) else None
        per.append({'name': name, 'label': label, 'kind': kind, 'points': int(len(own)),
                    'median_cm': cm(median) if median is not None else None,
                    'p90_cm': cm(np.percentile(own, 90)) if len(own) else None,
                    'misfit': bool(len(own) >= MISFIT_POINTS and median > MISFIT_MEDIAN)})
    kinds = {}
    for kind in ('floor', 'wall', 'object', 'door'):
        own = dist[np.isin(near, [k for k, e in enumerate(elements) if e[2] == kind]) & modelled]
        if len(own): kinds[kind] = {'points': int(len(own)), 'median_cm': cm(np.median(own)), 'p90_cm': cm(np.percentile(own, 90))}
    n = len(dist); share = lambda m: round(float(m.sum()) / n, 3) if n else 0.0
    return {'schema': 'brainsnn.fit-check.v1', 'basis': 'model-to-points', 'units': scene.get('units'), 'points': n,
            'thresholds_cm': {'on': ON * 100, 'modelled': MODELLED * 100, 'misfit_median': MISFIT_MEDIAN * 100},
            'within': {'2cm': share(dist <= .02), '5cm': share(dist <= ON), '10cm': share(dist <= .10)},
            'modelled': {'points': int(modelled.sum()), 'share': share(modelled),
                         'median_cm': cm(np.median(dist[modelled])) if modelled.any() else None,
                         'p90_cm': cm(np.percentile(dist[modelled], 90)) if modelled.any() else None},
            'unmodelled': {'points': int((~modelled).sum()), 'share': share(~modelled),
                           'above_ceiling_band': int(((~modelled) & (heights > CEILING)).sum())},
            'by_kind': kinds, 'elements': per, 'misfits': [e['name'] for e in per if e['misfit']],
            'caveat': 'Model-to-points: how closely the boxes follow the reconstruction. Not a survey tolerance; '
                      'the reconstruction and the self-reported scale carry their own error.'}


def colour(d):
    """Heatmap colour of a distance in metres."""
    if not d <= MODELLED:
        return UNMODELLED
    for (d0, c0), (d1, c1) in zip(RAMP, RAMP[1:]):
        if d <= d1:
            f = (d - d0) / (d1 - d0)
            return tuple(round(a + (b - a) * f) for a, b in zip(c0, c1))
    return RAMP[-1][1]


def write_heatmap(points, dist, path):
    """Binary little-endian PLY in the scene's frame (right-handed, y up, metres): every point coloured by its distance."""
    head = (f'ply\nformat binary_little_endian 1.0\ncomment BrainSNN fit check: colour is the distance to the nearest model surface\n'
            f'comment green 0 cm, yellow {ON * 100:.0f} cm, red {MODELLED * 100:.0f} cm, grey farther (not modelled)\n'
            f'element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\n'
            'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode()
    with open(path, 'wb') as f:
        f.write(head)
        for p, d in zip(points, dist):
            f.write(struct.pack('<fffBBB', p[0], p[1], p[2], *colour(float(d))))


def export(scene, points, out):
    """Writes fit-check.json and fit-heatmap.ply into out (metric scenes only); returns the evidence the scene job records."""
    if scene.get('units') != 'm':  # centimetres need metres: an unscaled reconstruction gets no fit numbers, like USD, IFC and CAD
        return {'skipped': 'The fit check needs a metric scene.'}
    if not points or not surfaces(scene):
        return {'skipped': 'No points or no model surfaces to check.'}
    summary = check(scene, points)
    dist, _ = distances(points, surfaces(scene))
    (Path(out) / 'fit-check.json').write_text(json.dumps(summary, indent=1, allow_nan=False))
    write_heatmap(points, dist, Path(out) / 'fit-heatmap.ply')
    return {'written': True, 'points': summary['points'], 'within_5cm': summary['within']['5cm'],
            'modelled_median_cm': summary['modelled']['median_cm'], 'by_kind': summary['by_kind'], 'misfits': summary['misfits']}
