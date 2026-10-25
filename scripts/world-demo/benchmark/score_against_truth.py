"""Every compiled wall and object of a benchmark run against the true room: model to truth, not model to points.

usage: python score_against_truth.py --truth truth.json --references references.json --job <scene job output> --out truth-score.json
The compiled scene is in the hand-off's metric frame, whose metres come only from the calibration span. It is placed
in the true room by a rigid fit (rotation and translation, no scale) of the hand-off's camera positions to the true
camera positions, so a wrong scale shows up as error instead of being fitted away. Matching:
- a compiled wall to the true wall whose inner face it runs along: within 20 degrees and 0.5 m;
- a compiled object to the nearest true object of the same kind (table, chair, cabinet, plant): plan centres within
  0.6 m.
Reported: room width and depth between matched opposite walls, each wall's offset from its true face, its tilt and
covered length, each object's size and centre error, missed and spurious objects, and floor area.
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
    t = math.radians(yaw_degrees); return np.array([math.cos(t), 0.0, math.sin(t)])


def score(truth, references, scene, cloud):
    A = np.asarray(cloud['fromSource'], float)
    to_cloud = lambda c: A[:, :3] @ np.asarray(c, float) + A[:, 3]  # reconstruction -> hand-off (metric) frame
    pairs = references['alignment']['pairs']
    R, t = rigid([to_cloud(p['reconstruction']) for p in pairs], [p['truth'] for p in pairs])
    place = lambda p: R @ np.asarray(p, float) + t
    turn = lambda d: R @ d
    cam_rms = float(np.sqrt(np.mean([np.sum((place(to_cloud(p['reconstruction'])) - p['truth']) ** 2) for p in pairs])))
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
        best = None
        for tw in true_walls:
            angle = math.degrees(math.acos(min(1, abs(float(d @ tw['dir'])))))
            offset = float((c - tw['face']) @ tw['normal'])  # + into the room
            along = float((c - tw['face']) @ tw['dir'])
            if angle <= 20 and abs(offset) <= .5 and abs(along) <= tw['size'][0] / 2 + .3 and (best is None or abs(offset) < abs(best['offsetMeters'])):
                best = {'true': tw['name'], 'offsetMeters': round(offset, 4), 'angleDegrees': round(angle, 2)}
        walls.append({'name': w['name'], 'lengthMeters': round(w['size'][0], 3), 'heightMeters': round(w['size'][1], 3), **(best or {'true': None})})
    per_wall = {}
    for tw in true_walls:
        mine = [w for w in walls if w['true'] == tw['name']]
        if mine:
            weight = sum(w['lengthMeters'] for w in mine)
            per_wall[tw['name']] = {'compiled': [w['name'] for w in mine], 'coveredMeters': round(weight, 3), 'trueLengthMeters': tw['size'][0],
                                    'offsetMeters': round(sum(w['offsetMeters'] * w['lengthMeters'] for w in mine) / weight, 4),
                                    'heightMeters': round(max(w['heightMeters'] for w in mine), 3), 'trueHeightMeters': tw['size'][1]}
    dims = {}
    for name, (a, b), true in (('width', ('wall_west', 'wall_east'), room['width']), ('depth', ('wall_north', 'wall_south'), room['depth'])):
        if a in per_wall and b in per_wall:  # each face moved by its offset (positive is into the room)
            measured = true - per_wall[a]['offsetMeters'] - per_wall[b]['offsetMeters']
            dims[name] = {'trueMeters': true, 'measuredMeters': round(measured, 4), 'errorMeters': round(measured - true, 4)}
        else:
            dims[name] = {'trueMeters': true, 'measuredMeters': None, 'reason': 'an opposite wall was not compiled'}
    # Objects.
    true_objects = [o for o in truth['objects'] if KIND.get(o['label'])]
    compiled = [o for o in scene.get('objects', []) if o.get('kind') == 'separated']
    used, objects = set(), []
    for o in compiled:
        c = place(o['centre']); kind = KIND.get(o.get('label'))
        cand = [(math.dist((c[0], c[2]), (to['centre'][0], to['centre'][2])), k) for k, to in enumerate(true_objects)
                if k not in used and (kind is None or KIND[to['label']] == kind)]
        dist, k = min(cand, default=(None, None))
        if dist is None or dist > .6:
            objects.append({'name': o['name'], 'label': o.get('label'), 'true': None}); continue
        used.add(k); to = true_objects[k]
        ms, ts = sorted(o['size'][::2], reverse=True), sorted(to['size'][::2], reverse=True)
        objects.append({'name': o['name'], 'label': o.get('label'), 'true': to['name'], 'trueLabel': to['label'],
                        'planCentreErrorMeters': round(dist, 4), 'base': o.get('base', 'observed'),
                        'sizeErrorMeters': {'length': round(ms[0] - ts[0], 4), 'width': round(ms[1] - ts[1], 4),
                                            'height': round(o['size'][1] - to['size'][1], 4)}})
    missed = [to['name'] for k, to in enumerate(true_objects) if k not in used]
    floor = next((o for o in scene.get('objects', []) if o.get('name') == 'floor_observed'), None)
    matched = [o for o in objects if o['true']]
    summary = {
        'roomWidthErrorMeters': dims['width'].get('errorMeters'), 'roomDepthErrorMeters': dims['depth'].get('errorMeters'),
        'wallFaceOffsetMedianMeters': round(float(np.median([abs(w['offsetMeters']) for w in per_wall.values()])), 4) if per_wall else None,
        'wallsMatched': f"{len(per_wall)} of {len(true_walls)}",
        'objectsMatched': f"{len(matched)} of {len(true_objects)}", 'spuriousObjects': sum(1 for o in objects if not o['true']),
        'objectSizeErrorMedianMeters': round(float(np.median([abs(v) for o in matched for v in o['sizeErrorMeters'].values()])), 4) if matched else None,
        'cameraFitRmsMeters': round(cam_rms, 4)}
    return {'schema': 'brainsnn.truth-score.v1', 'synthetic': True,
            'basis': 'model to truth: compiled elements against the exact scene definition, placed by a rigid camera fit',
            'summary': summary, 'room': dims, 'walls': per_wall, 'compiledWalls': walls, 'objects': objects, 'missedObjects': missed,
            'floor': {'trueAreaM2': room['floorArea'], 'compiledExtent': floor and [round(floor['size'][0], 3), round(floor['size'][2], 3)]},
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
