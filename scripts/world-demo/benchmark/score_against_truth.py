"""Every compiled wall and object of a benchmark run against the true room: model to truth, not model to points.

usage: python score_against_truth.py --truth truth.json --references references.json --job <scene job output> --out truth-score.json
The compiled scene is in the hand-off's metric frame, whose metres come only from the calibration span. It is placed
in the true room by a rigid fit (rotation and translation, no scale) of the hand-off's camera positions to the true
camera positions, so a wrong scale shows up as error instead of being fitted away. Matching:
- a compiled wall to the true wall whose inner face it runs along: within 20 degrees and 0.5 m;
- a compiled object to the nearest true object of the same kind (table, chair, cabinet, plant): plan centres within
  0.6 m.
Reported: how far the model's up is from true up and its floor from the true floor, room width and depth between
matched opposite walls, each wall's offset from its true face, its tilt and
covered length, stray wall pieces (a stretch matched to a wall but more than 15 cm off its main stretch), each object's size and centre error, missed and spurious objects, and floor area; and every compiled
footprint and camera placed in the true plan, for truth_card.py.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

KIND = {'table': 'table', 'dining table': 'table', 'desk': 'table', 'chair': 'chair', 'couch': 'chair', 'cabinet': 'cabinet',
        'potted plant': 'plant', 'plant': 'plant'}


def rigid(src, dst):
    """Kabsch: rotation R and translation t with dst ~ R src + t, no scale."""
    src, dst = np.asarray(src, float), np.asarray(dst, float); ms, md = src.mean(0), dst.mean(0)
    U, _, Vt = np.linalg.svd((dst - md).T @ (src - ms)); E = np.eye(3); E[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ E @ Vt; return R, md - R @ ms


def plan(yaw_degrees):
    """The length direction of a scene element: (cos yaw, sin yaw) in the x-z plane, as scene_compiler writes it."""
    t = math.radians(yaw_degrees); return np.array([math.cos(t), 0.0, math.sin(t)])


def footprint(centre, d, length, thickness):
    """An element's plan rectangle as four [x, z] corners: length along d, thickness across it."""
    n = np.array([-d[2], 0, d[0]]); c = np.asarray(centre, float)
    return [[round(float(q[0]), 4), round(float(q[2]), 4)] for q in
            (c + a * d * length / 2 + b * n * thickness / 2 for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)))]


def score(truth, references, scene, cloud):
    A = np.asarray(cloud['fromSource'], float)
    to_cloud = lambda c: A[:, :3] @ np.asarray(c, float) + A[:, 3]  # reconstruction -> hand-off (metric) frame
    pairs = references['alignment']['pairs']
    R, t = rigid([to_cloud(p['reconstruction']) for p in pairs], [p['truth'] for p in pairs])
    place = lambda p: R @ np.asarray(p, float) + t
    turn = lambda d: R @ d
    cam_rms = float(np.sqrt(np.mean([np.sum((place(to_cloud(p['reconstruction'])) - p['truth']) ** 2) for p in pairs])))
    # Level and floor: the rigid fit can turn a model over and still match its walls, so the model's own up and its
    # floor plane (scene floor_y, under the cameras' centre) are checked against the true room's.
    level = math.degrees(math.acos(max(-1.0, min(1.0, float(turn(np.array([0.0, 1.0, 0.0]))[1])))))
    hub = np.mean([to_cloud(p['reconstruction']) for p in pairs], axis=0)
    floor_height = float(place([hub[0], scene.get('floor_y', 0.0), hub[2]])[1])
    room = truth['room']
    # Walls: the true wall's inner face is its centre moved half a thickness toward the room.
    true_walls = []
    for w in truth['walls']:
        d = plan(w['yaw_degrees']); n = np.array([-d[2], 0, d[0]]); c = np.asarray(w['centre'], float)
        if n @ (np.array([room['width'] / 2, 0, room['depth'] / 2]) - c) < 0: n = -n
        true_walls.append({**w, 'dir': d, 'normal': n, 'face': c + n * w['size'][2] / 2})
    walls = []
    for w in scene.get('walls', []):
        c = place(w['centre']); d = turn(plan(w['yaw_degrees'])); d[1] = 0; d /= np.linalg.norm(d)
        # The face the camera saw: recorded when the compiler placed the box behind it, else the box's centre plane.
        face = place(w['faceCentre']) if 'faceCentre' in w else c
        best = None
        for tw in true_walls:
            angle = math.degrees(math.acos(min(1, abs(float(d @ tw['dir'])))))
            offset = float((face - tw['face']) @ tw['normal'])  # + into the room
            along = float((face - tw['face']) @ tw['dir'])
            if angle <= 20 and abs(offset) <= .5 and abs(along) <= tw['size'][0] / 2 + .3 and (best is None or abs(offset) < abs(best['offsetMeters'])):
                best = {'true': tw['name'], 'offsetMeters': round(offset, 4), 'angleDegrees': round(angle, 2)}
        walls.append({'name': w['name'], 'lengthMeters': round(w['size'][0], 3), 'heightMeters': round(w['size'][1], 3),
                      'thicknessMeters': round(w['size'][2], 3), 'standsInRoomMeters': 0.0 if 'faceCentre' in w else w['size'][2] / 2,
                      **(best or {'true': None}),
                      'plan': footprint(c, d, w['size'][0], w['size'][2])})
    per_wall, stray = {}, []
    for tw in true_walls:
        mine = [w for w in walls if w['true'] == tw['name']]
        if mine:
            # The wall is its longest stretch and every stretch in line with it (within 15 cm); a stretch further in is a
            # stray piece (a furniture face taken for wall), reported as such rather than averaged into the room's size.
            main = max(mine, key=lambda w: w['lengthMeters'])
            stray += [{'name': w['name'], 'nearWall': tw['name'], 'lengthMeters': w['lengthMeters'], 'offsetMeters': w['offsetMeters']}
                      for w in mine if abs(w['offsetMeters'] - main['offsetMeters']) > .15]
            mine = [w for w in mine if abs(w['offsetMeters'] - main['offsetMeters']) <= .15]
            weight = sum(w['lengthMeters'] for w in mine)
            per_wall[tw['name']] = {'compiled': [w['name'] for w in mine], 'coveredMeters': round(weight, 3), 'trueLengthMeters': tw['size'][0],
                                    'offsetMeters': round(sum(w['offsetMeters'] * w['lengthMeters'] for w in mine) / weight, 4),
                                    'heightMeters': round(max(w['heightMeters'] for w in mine), 3), 'trueHeightMeters': tw['size'][1],
                                    'thicknessMeters': round(sum(w['thicknessMeters'] * w['lengthMeters'] for w in mine) / weight, 3),
                                    'standsInRoomMeters': round(sum(w['standsInRoomMeters'] * w['lengthMeters'] for w in mine) / weight, 4)}
    dims = {}
    for name, (a, b), true in (('width', ('wall_west', 'wall_east'), room['width']), ('depth', ('wall_north', 'wall_south'), room['depth'])):
        if a in per_wall and b in per_wall:  # each face moved by its offset (positive is into the room)
            measured = true - per_wall[a]['offsetMeters'] - per_wall[b]['offsetMeters']
            # A box centred on the surface it saw (compilers before October 25) has half its thickness in the room, and
            # the clear distance a BIM user reads between two boxes is shorter than the faces' by that much. A box placed
            # behind its face has none in the room.
            clear = measured - per_wall[a]['standsInRoomMeters'] - per_wall[b]['standsInRoomMeters']
            dims[name] = {'trueMeters': true, 'measuredMeters': round(measured, 4), 'errorMeters': round(measured - true, 4),
                          'betweenBoxesMeters': round(clear, 4), 'betweenBoxesErrorMeters': round(clear - true, 4)}
        else:
            dims[name] = {'trueMeters': true, 'measuredMeters': None, 'reason': 'an opposite wall was not compiled'}
    # Objects.
    true_objects = [o for o in truth['objects'] if KIND.get(o['label'])]
    compiled = [o for o in scene.get('objects', []) if o.get('kind') == 'separated']
    placed = []
    for o in compiled:
        c = place(o['centre']); d = turn(plan(o.get('yaw_degrees', 0))); d[1] = 0; d /= np.linalg.norm(d)
        placed.append((c, footprint(c, d, o['size'][0], o['size'][2])))
    # Closest pairs first, over the whole room, so the order objects were compiled in does not decide a match.
    pairs_by_distance = sorted((math.dist((c[0], c[2]), (to['centre'][0], to['centre'][2])), i, k)
                               for i, (o, (c, _)) in enumerate(zip(compiled, placed)) for k, to in enumerate(true_objects)
                               if KIND.get(o.get('label')) in (None, KIND[to['label']]))
    match, used = {}, set()
    for dist, i, k in pairs_by_distance:
        if dist <= .6 and i not in match and k not in used: match[i] = (dist, k); used.add(k)
    objects = []
    for i, o in enumerate(compiled):
        shape = placed[i][1]
        if i not in match:
            objects.append({'name': o['name'], 'label': o.get('label'), 'true': None, 'plan': shape}); continue
        dist, k = match[i]; to = true_objects[k]
        ms, ts = sorted(o['size'][::2], reverse=True), sorted(to['size'][::2], reverse=True)
        objects.append({'name': o['name'], 'label': o.get('label'), 'true': to['name'], 'trueLabel': to['label'],
                        'planCentreErrorMeters': round(dist, 4), 'base': o.get('base', 'observed'),
                        'sizeErrorMeters': {'length': round(ms[0] - ts[0], 4), 'width': round(ms[1] - ts[1], 4),
                                            'height': round(o['size'][1] - to['size'][1], 4)}, 'plan': shape})
    missed = [to['name'] for k, to in enumerate(true_objects) if k not in used]
    floor = next((o for o in scene.get('objects', []) if o.get('name') == 'floor_observed'), None)
    matched = [o for o in objects if o['true']]
    summary = {
        'roomWidthErrorMeters': dims['width'].get('errorMeters'), 'roomDepthErrorMeters': dims['depth'].get('errorMeters'),
        'wallFaceOffsetMedianMeters': round(float(np.median([abs(w['offsetMeters']) for w in per_wall.values()])), 4) if per_wall else None,
        'wallsMatched': f"{len(per_wall)} of {len(true_walls)}", 'strayWallPieces': len(stray),
        'unmatchedWallPieces': sum(1 for w in walls if not w['true']),
        'objectsMatched': f"{len(matched)} of {len(true_objects)}", 'spuriousObjects': sum(1 for o in objects if not o['true']),
        'objectSizeErrorMedianMeters': round(float(np.median([abs(v) for o in matched for v in o['sizeErrorMeters'].values()])), 4) if matched else None,
        'cameraFitRmsMeters': round(cam_rms, 4), 'levelErrorDegrees': round(level, 2), 'floorHeightErrorMeters': round(floor_height, 4)}
    return {'schema': 'brainsnn.truth-score.v1', 'synthetic': True,
            'basis': 'model to truth: compiled elements against the exact scene definition, placed by a rigid camera fit',
            'summary': summary, 'room': dims, 'walls': per_wall, 'strayWallPieces': stray, 'compiledWalls': walls, 'objects': objects, 'missedObjects': missed,
            'floor': {'trueAreaM2': room['floorArea'], 'compiledExtent': floor and [round(floor['size'][0], 3), round(floor['size'][2], 3)]},
            'cameras': [[round(float(q[0]), 4), round(float(q[2]), 4)] for q in (place(to_cloud(p['reconstruction'])) for p in pairs)],
            'caveat': 'A rendered test room with exact dimensions: real captures add lens, motion and lighting error this does not.'}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--truth', type=Path, required=True); ap.add_argument('--references', type=Path, required=True)
    ap.add_argument('--job', type=Path, required=True); ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    result = score(json.loads(a.truth.read_text()), json.loads(a.references.read_text()),
                   json.loads((a.job / 'scene.json').read_text()), json.loads((a.job / 'arena-cloud.json').read_text()))
    a.out.write_text(json.dumps(result, indent=1)); print(json.dumps(result['summary'], indent=1))


if __name__ == '__main__':
    main()
