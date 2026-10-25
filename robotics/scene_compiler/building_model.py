"""The building model (brainsnn.building.v1): each compiled element with an ID that survives a recompile, its
parameters, and where each parameter came from.

scene.json is what the compiler drew. building.json is what the model claims, parameter by parameter:
- A wall is the face the camera saw (observed), with its base and height (observed) and a thickness nobody measured
  (inferred). Its centreline is half a thickness behind the face, away from the room.
- Openings are hosted by wall ID at an offset along the face from its start, so a later edit that moves the wall
  carries them.
- Every parameter is observed, inferred, reviewed or unknown.

IDs:
- A model gets its ID from its points, so the same cloud always gives the same model and two captures never share one.
- An element gets its ID from the model ID and its own geometry, once. After that, identity is carried by matching:
  given the previous building.json, an element that matches a previous one (same kind, overlapping geometry) keeps
  that ID, and the rest are reported as added or removed.
- Matching works in one frame. A recapture is in a new frame and matches nothing until it is registered to the old
  one, and the report says so rather than guessing.

Stdlib only: it runs in Blender's Python as well as the worker's.
"""
from __future__ import annotations

import hashlib
import json
import math
import uuid

SCHEMA = 'brainsnn.building.v1'
MATCH = {'angle_degrees': 10.0, 'offset_m': .25, 'overlap': .5, 'object_iou': .3}
REVIEW_TOLERANCE_M = .02  # an inherited review stands while the element moved less than this
THICKNESS_BASIS = "the spread of the one face's points (at least 0.1 m): one side of the wall was seen, so not measured"


def points_digest(points) -> str:
    """SHA-256 of the cloud's ordered points, as compact JSON (the model ID's seed)."""
    return hashlib.sha256(json.dumps(points, separators=(',', ':')).encode()).hexdigest()


def _r(v, digits=6):
    return round(float(v), digits)


def _fresh_id(model_id, kind, key, taken):
    """An ID from the model and the element's geometry at 1 cm, unique in this model."""
    digest = hashlib.sha256(f'{model_id}|{kind}|{key}'.encode()).hexdigest()
    base = f'{kind}-{digest[:10]}'
    ident, n = base, 2
    while ident in taken:
        ident, n = f'{base}-{n}', n + 1
    return ident


def _wall(rec, room, storey):
    (cx, cy, cz), (length, height, thickness) = rec['centre'], rec['size']
    yaw = math.radians(rec.get('yaw_degrees', 0)); d = (math.cos(yaw), math.sin(yaw))
    start = (cx - d[0] * length / 2, cz - d[1] * length / 2); end = (cx + d[0] * length / 2, cz + d[1] * length / 2)
    left = (-d[1], d[0]); inward = 1.0 if (room[0] - cx) * left[0] + (room[1] - cz) * left[1] >= 0 else -1.0
    back = (-inward * left[0] * thickness / 2, -inward * left[1] * thickness / 2)  # away from the room
    return {'kind': 'wall', 'name': rec.get('name'), 'storey': storey,
            'face': {'start': [_r(start[0]), _r(start[1])], 'end': [_r(end[0]), _r(end[1])]},
            'base': _r(cy - height / 2), 'height': _r(height), 'thickness': _r(thickness),
            'interior': 'left' if inward > 0 else 'right',
            'centreline': {'start': [_r(start[0] + back[0]), _r(start[1] + back[1])], 'end': [_r(end[0] + back[0]), _r(end[1] + back[1])]},
            'provenance': {'face': 'observed', 'base': 'observed', 'height': 'observed', 'thickness': 'inferred', 'interior': 'inferred'},
            'basis': {'thickness': THICKNESS_BASIS, 'interior': 'the side of the face the floor lies on'},
            'supportPoints': rec.get('support_points')}


def _object(rec, storey):
    observed = 'observed' if rec.get('provenance') in ('observed', 'detected') else 'unknown'
    out = {'kind': 'object', 'name': rec.get('name'), 'storey': storey, 'label': rec.get('label'),
           'centre': [_r(v) for v in rec['centre']], 'size': [_r(v) for v in rec['size']], 'yaw_degrees': _r(rec.get('yaw_degrees', 0)),
           'provenance': {'position': observed, 'size': observed, 'base': 'inferred' if rec.get('base') == 'inferred' else observed,
                          'label': 'reviewed' if rec.get('labelReviewed') else ('suggested' if rec.get('label') not in (None, 'object') else 'unknown')},
           'supportPoints': rec.get('support_points')}
    for key in ('labelSource', 'detector', 'ifcClass'):
        if rec.get(key) is not None:
            out[key] = rec[key]
    return out


def _key(e):
    if e['kind'] == 'wall':
        return json.dumps([round(v, 2) for v in e['face']['start'] + e['face']['end']] + [round(e['base'], 2), round(e['height'], 2)])
    if e['kind'] == 'object':
        return json.dumps([round(v, 2) for v in e['centre'] + e['size']])
    if e['kind'] == 'slab':
        return json.dumps([round(v, 2) for v in e['footprint']['min'] + e['footprint']['max']] + [round(e['top'], 2)])
    return e['kind']


# ---------- matching ----------

def _wall_score(prev, cur):
    """Lower is closer; None when the two faces are not the same wall: more than 10 degrees apart, more than 25 cm
    off each other's line, or overlapping less than half the shorter one."""
    (ax, az), (bx, bz) = prev['face']['start'], prev['face']['end']; L = math.hypot(bx - ax, bz - az)
    (cx, cz), (dx, dz) = cur['face']['start'], cur['face']['end']; M = math.hypot(dx - cx, dz - cz)
    if L < 1e-9 or M < 1e-9:
        return None
    u = ((bx - ax) / L, (bz - az) / L); v = ((dx - cx) / M, (dz - cz) / M)
    if abs(u[0] * v[0] + u[1] * v[1]) < math.cos(math.radians(MATCH['angle_degrees'])):
        return None
    mx, mz = (cx + dx) / 2, (cz + dz) / 2; offset = abs((mx - ax) * -u[1] + (mz - az) * u[0])
    if offset > MATCH['offset_m']:
        return None
    t = sorted(((cx - ax) * u[0] + (cz - az) * u[1], (dx - ax) * u[0] + (dz - az) * u[1]))
    overlap = max(0.0, min(t[1], L) - max(t[0], 0.0)) / min(L, M)
    return None if overlap < MATCH['overlap'] else offset + (1 - overlap) * MATCH['offset_m']


def _footprint(e):
    (x, _, z), (sx, _, sz) = e['centre'], e['size']; yaw = math.radians(e.get('yaw_degrees', 0))
    hx = abs(sx * math.cos(yaw)) / 2 + abs(sz * math.sin(yaw)) / 2; hz = abs(sx * math.sin(yaw)) / 2 + abs(sz * math.cos(yaw)) / 2
    return x - hx, z - hz, x + hx, z + hz


def _object_score(prev, cur):
    a, b = _footprint(prev), _footprint(cur)
    inter = max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    iou = inter / union if union > 0 else 0.0
    return None if iou < MATCH['object_iou'] else 1 - iou


def _moved(prev, cur):
    """How far the element moved, in metres: its largest corner or end-point displacement."""
    if cur['kind'] == 'wall':
        ends = [(cur['face']['start'], prev['face']['start']), (cur['face']['end'], prev['face']['end'])]
        flipped = [(cur['face']['start'], prev['face']['end']), (cur['face']['end'], prev['face']['start'])]
        far = lambda pairs: max(math.dist(a, b) for a, b in pairs)
        return max(min(far(ends), far(flipped)), abs(cur['base'] - prev['base']), abs(cur['height'] - prev['height']))
    if cur['kind'] == 'object':
        return max(math.dist(cur['centre'], prev['centre']), max(abs(a - b) for a, b in zip(cur['size'], prev['size'])))
    if cur['kind'] == 'slab':
        return max(math.dist(cur['footprint']['min'], prev['footprint']['min']), math.dist(cur['footprint']['max'], prev['footprint']['max']), abs(cur['top'] - prev['top']))
    if cur['kind'] == 'storey':
        return abs(cur['elevation'] - prev['elevation'])
    return 0.0


def match(previous, current):
    """{current index: previous element} for elements of the same kind whose geometry overlaps, closest pairs first."""
    pairs = []
    for i, cur in enumerate(current):
        for prev in previous:
            if prev.get('kind') != cur['kind']:
                continue
            if cur['kind'] == 'wall':
                score = _wall_score(prev, cur)
            elif cur['kind'] == 'object':
                score = _object_score(prev, cur)
            elif cur['kind'] in ('slab', 'storey'):
                score = 0.0  # one floor, one storey: the scanned floor is the scanned floor
            else:
                continue
            if score is not None:
                pairs.append((score, i, prev['id']))
    by_id = {p['id']: p for p in previous}; out, used = {}, set()
    for _, i, ident in sorted(pairs, key=lambda p: (p[0], p[1], p[2])):
        if i not in out and ident not in used:
            out[i] = by_id[ident]; used.add(ident)
    return out


# ---------- the model ----------

def build(scene, points, previous=None):
    """building.json for a compiled scene. `previous` is the last building.json of the same capture, if any: its model
    ID, element IDs and review states carry over wherever the geometry still matches. The scene is not changed."""
    units = scene.get('units')
    prior = previous if isinstance(previous, dict) and previous.get('schema') == SCHEMA else None
    reason = None
    if previous is not None and prior is None:
        reason = 'The previous building model is not brainsnn.building.v1.'
    elif prior is not None and prior.get('units') != units:
        prior, reason = None, 'The previous building model is in other units; nothing was matched.'
    digest = points_digest(points)
    model_id = prior['model']['id'] if prior else str(uuid.uuid5(uuid.NAMESPACE_URL, 'brainsnn-building:' + digest))
    floor = next((o for o in scene.get('objects', []) if o.get('name') == 'floor_observed' and 'min' in o), None)
    walls = [w for w in scene.get('walls', []) if 'centre' in w and 'size' in w]
    if floor:
        room = ((floor['min'][0] + floor['max'][0]) / 2, (floor['min'][2] + floor['max'][2]) / 2)
    else:
        room = (sum(w['centre'][0] for w in walls) / max(1, len(walls)), sum(w['centre'][2] for w in walls) / max(1, len(walls)))
    floor_y = float(scene.get('floor_y', 0.0))
    elements = [{'kind': 'storey', 'name': 'Scanned floor', 'elevation': _r(floor_y), 'provenance': {'elevation': 'observed'},
                 'basis': {'elevation': 'the floor plane fitted to the points'}}]
    storey = 0  # the storey's index until IDs are assigned
    if floor:
        elements.append({'kind': 'slab', 'name': floor['name'], 'storey': storey,
                         'footprint': {'min': [_r(floor['min'][0]), _r(floor['min'][2])], 'max': [_r(floor['max'][0]), _r(floor['max'][2])]},
                         'top': _r(floor_y), 'provenance': {'footprint': 'observed', 'top': 'observed', 'thickness': 'unknown'},
                         'basis': {'footprint': "the 2nd to 98th percentile of the points in plan; the floor's outline was not traced"}})
    elements += [_wall(w, room, storey) for w in walls]
    elements += [_object(o, storey) for o in scene.get('objects', []) if o is not floor and 'centre' in o and 'size' in o]

    old = [e for e in (prior or {}).get('elements', []) if isinstance(e, dict) and isinstance(e.get('id'), str)]
    found = match(old, elements) if prior else {}
    taken = set()
    for i, e in enumerate(elements):
        prev = found.get(i)
        if prev is not None:
            e['id'] = prev['id']
            state = (prev.get('review') or {}).get('state', 'unreviewed')
            moved = _moved(prev, e)
            e['review'] = ({'state': 'needs-review', 'previousState': state, 'movedMetres': _r(moved, 4)}
                           if state != 'unreviewed' and moved > REVIEW_TOLERANCE_M else {'state': state})
        else:
            e['id'] = _fresh_id(model_id, e['kind'], _key(e), taken | {p['id'] for p in old})
            e['review'] = {'state': 'unreviewed'}
        taken.add(e['id'])
    storey_id = elements[0]['id']
    for e in elements[1:]:
        e['storey'] = storey_id
    wall_ids = {e['name']: e['id'] for e in elements if e['kind'] == 'wall'}
    for o in scene.get('openings', []) or []:
        elements.append({'id': o['id'], 'kind': o['kind'], 'storey': storey_id, 'host': wall_ids[o['hostWall']],
                         'offset': _r(o['offsetMeters']), 'width': _r(o['widthMeters']), 'height': _r(o['heightMeters']), 'sill': _r(o['sillMeters']),
                         'provenance': {'offset': 'reviewed', 'width': 'reviewed', 'height': 'reviewed', 'sill': 'reviewed'},
                         'basis': {'offset': "metres along the host's face from its start"},
                         'review': {'state': 'accepted', 'selfReported': True}})

    matched = {}
    for i in found:
        matched[elements[i]['kind']] = matched.get(elements[i]['kind'], 0) + 1
    kept = {e['id'] for e in elements}
    identity = {'previousModel': prior['model']['id'] if prior else None, 'matched': matched,
                'added': [e['id'] for i, e in enumerate(elements) if i not in found and e['kind'] not in ('opening', 'door')],
                'removed': [p['id'] for p in old if p['id'] not in kept and p.get('kind') not in ('opening', 'door')]}
    if reason:
        identity['note'] = reason
    elif prior and not found:
        identity['note'] = ('No element matched the previous model. A new capture is in its own frame: register it to the '
                            'previous one before its IDs can carry over.')
    return {'schema': SCHEMA, 'units': units, 'coordinateFrame': 'right-handed-y-up',
            'model': {'id': model_id, 'pointsSha256': digest, 'scale': scene.get('scale')},
            'elements': elements, 'unknown': {'cells': len(scene.get('unknown', [])), 'provenance': 'unknown',
                                              'basis': 'floor cells no reconstructed point reached; not free space'},
            'identity': identity}


def stamp(scene, building):
    """Write the model ID and each element's ID into the compiled scene's own records, by name, so every exporter
    can carry them."""
    ids = {(e['kind'], e.get('name')): e['id'] for e in building['elements'] if e.get('name') is not None}
    scene['model'] = {'id': building['model']['id'], 'schema': SCHEMA}
    for w in scene.get('walls', []):
        if ('wall', w.get('name')) in ids:
            w['id'] = ids[('wall', w['name'])]
    for o in scene.get('objects', []):
        key = ('slab', o.get('name')) if o.get('name') == 'floor_observed' else ('object', o.get('name'))
        if key in ids:
            o['id'] = ids[key]
    storey = next(e['id'] for e in building['elements'] if e['kind'] == 'storey')
    scene['storey'] = {'id': storey}
    return scene
