"""Rectangular wall cuts shared by mesh, USD and CAD exports.

Semantic walls stay intact in scene.json/IFC; these are the remaining solid
pieces, not additional walls. Reviewed reference doors are closed thin leaves.
"""
from __future__ import annotations
import math


def wall_openings(wall, openings):
    return [o for o in openings if o.get('hostWall') == wall['name']]


def _piece(wall, a0, a1, y0, y1, name):
    length, height, thickness = wall['size']
    angle = math.radians(wall.get('yaw_degrees', 0))
    along = (a0 + a1) / 2 - length / 2
    base = wall['centre'][1] - height / 2
    return {**wall, 'name': name, 'hostWall': wall['name'],
            'centre': [wall['centre'][0] + along * math.cos(angle), base + (y0 + y1) / 2,
                       wall['centre'][2] + along * math.sin(angle)],
            'size': [a1 - a0, y1 - y0, thickness]}


def wall_parts(wall, openings):
    """Exact non-overlapping rectangular decomposition of a wall minus its voids."""
    holes = wall_openings(wall, openings)
    if not holes:
        return [wall]
    length, height, _thickness = wall['size']
    xs = sorted({0.0, length, *(o['offsetMeters'] for o in holes),
                 *(o['offsetMeters'] + o['widthMeters'] for o in holes)})
    result = []
    for x0, x1 in zip(xs, xs[1:]):
        if x1 - x0 <= 1e-8:
            continue
        middle = (x0 + x1) / 2
        cuts = sorted((o['sillMeters'], o['sillMeters'] + o['heightMeters']) for o in holes
                      if o['offsetMeters'] < middle < o['offsetMeters'] + o['widthMeters'])
        cursor = 0.0
        for y0, y1 in cuts + [(height, height)]:
            if y0 - cursor > 1e-8:
                result.append(_piece(wall, x0, x1, cursor, y0, f"{wall['name']}_part_{len(result) + 1}"))
            cursor = max(cursor, y1)
    return result


def door_parts(walls, openings):
    by_name = {w['name']: w for w in walls}
    result = []
    for opening in openings:
        if opening['kind'] != 'door':
            continue
        wall = by_name[opening['hostWall']]
        o = _piece(wall, opening['offsetMeters'], opening['offsetMeters'] + opening['widthMeters'],
                   opening['sillMeters'], opening['sillMeters'] + opening['heightMeters'], f"door_{opening['id']}")
        o['size'][2] = min(.05, wall['size'][2])
        o.update(label='door', provenance='operator-reviewed-reference', kind='door',
                 note='Closed reference leaf; no swing, clearance or physical passability validation.')
        result.append(o)
    return result


def wall_faces(wall, openings):
    """Exposed local-axis rectangles of a cut wall, excluding internal prism seams.

    Each rectangle is (local centre, size), with one zero size coordinate. This
    lets fit checking measure actual boundary surfaces rather than invisible
    faces introduced by decomposing the wall into renderable boxes.
    """
    length, height, thickness = wall['size']; holes = wall_openings(wall, openings)
    xs = sorted({0.0, length, *(o['offsetMeters'] for o in holes),
                 *(o['offsetMeters'] + o['widthMeters'] for o in holes)})
    ys = sorted({0.0, height, *(o['sillMeters'] for o in holes),
                 *(o['sillMeters'] + o['heightMeters'] for o in holes)})
    solid = {(i, j) for i in range(len(xs) - 1) for j in range(len(ys) - 1)
             if not any(o['offsetMeters'] < (xs[i] + xs[i + 1]) / 2 < o['offsetMeters'] + o['widthMeters']
                        and o['sillMeters'] < (ys[j] + ys[j + 1]) / 2 < o['sillMeters'] + o['heightMeters'] for o in holes)}
    faces = []
    for i, j in sorted(solid):
        x0, x1, y0, y1 = xs[i] - length / 2, xs[i + 1] - length / 2, ys[j] - height / 2, ys[j + 1] - height / 2
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        for z in (-thickness / 2, thickness / 2):
            faces.append(([cx, cy, z], [x1 - x0, y1 - y0, 0]))
        for neighbor, x in (((i - 1, j), x0), ((i + 1, j), x1)):
            if neighbor not in solid: faces.append(([x, cy, 0], [0, y1 - y0, thickness]))
        for neighbor, y in (((i, j - 1), y0), ((i, j + 1), y1)):
            if neighbor not in solid: faces.append(([cx, y, 0], [x1 - x0, 0, thickness]))
    return faces


def plan_wall_parts(wall, openings, *, minimum_headroom=2.0, closed_doors_block=True, floor_y=None):
    """Floor-plan cut only for an unfilled floor-level void with at least 2 m headroom.

    Raised windows, low voids and closed reference doors remain blocked. This is
    a conservative planar convention, not a robot-specific height proof.
    """
    base = wall['centre'][1] - wall['size'][1] / 2
    floor = base if floor_y is None else floor_y
    cuts = sorted((o['offsetMeters'], o['offsetMeters'] + o['widthMeters'])
                  for o in wall_openings(wall, openings)
                  if (o['kind'] == 'opening' or not closed_doors_block)
                  and base + o['sillMeters'] <= floor + .02
                  and base + o['sillMeters'] + o['heightMeters'] >= floor + minimum_headroom)
    if not cuts:
        return [wall]
    length, height, _ = wall['size']; result = []; cursor = 0.0
    for x0, x1 in cuts + [(length, length)]:
        if x0 - cursor > 1e-8:
            result.append(_piece(wall, cursor, x0, 0, height, f"{wall['name']}_plan_{len(result) + 1}"))
        cursor = max(cursor, x1)
    return result
