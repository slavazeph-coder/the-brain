"""Strict source, measurement, limit and result contracts; no simulator imports."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path

SCHEMA = 'brainsnn.g1-trial.v1'
REVISION = '20009c33639a55c100c21e0c4747bec13b22f161'
REPO = 'leggedrobotics/foothold-prediction-model'
LOCK = {
    'demo/model_10000.pt': (10748863, '36a397aa82284f7ceadec2c1fab0372cc38b7d5a'),
    'demo/foot_model_10002.pt': (121778, '50704c50fec735bce9e22e27ed071bd3dd9187df'),
    'LICENSE': (1067, 'b20650b4ea7ce273fd1671cdf85a0cc6dbf1095c'),
}

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024**2), b''):
            h.update(block)
    return h.hexdigest()


def _pairs(rows):
    out = {}
    for key, value in rows:
        if key in out:
            raise ValueError('Duplicate JSON key')
        out[key] = value
    return out


def read_json(path: Path, limit: int = 1024**2):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('Missing, symlinked or oversized input')
    def invalid(value):
        raise ValueError('Nonfinite JSON constant')
    return json.loads(path.read_bytes(), object_pairs_hook=_pairs, parse_constant=invalid)


def write_json(path: Path, value):
    with Path(path).open('x', encoding='utf8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Nonfinite or out-of-range number')
    return float(value)


def vector(value, size=3, bound=100):
    if not isinstance(value, list) or len(value) != size:
        raise ValueError('Invalid vector shape')
    return [number(x, -bound, bound) for x in value]


def y_to_z(p):
    x, y, z = vector(list(p))
    return [x, -z, y]


def inside(point, bounds, margin=0):
    x, z = point
    return bounds[0] + margin <= x <= bounds[2] - margin and bounds[1] + margin <= z <= bounds[3] - margin


def validate(spec, cloud=None):
    if not isinstance(spec, dict) or spec.get('schema') != SCHEMA or spec.get('reviewed') is not True:
        raise ValueError('Explicit reviewed G1 trial specification required')
    if spec.get('source_kind') not in ('synthetic', 'captured'):
        raise ValueError('Declare synthetic or captured source')
    bindings = spec.get('source_sha256')
    if not isinstance(bindings, dict) or set(bindings) != {'scene.json', 'arena-cloud.json', 'scene.usda'}:
        raise ValueError('Bind all three original scene artifacts')
    if any(not isinstance(v, str) or len(v) != 64 or any(c not in '0123456789abcdef' for c in v) for v in bindings.values()):
        raise ValueError('Invalid source hash')
    prims = spec.get('collision_prims')
    if not isinstance(prims, list) or not 1 <= len(prims) <= 256 or len(set(prims)) != len(prims):
        raise ValueError('Explicit unique static collision prims required')
    if any(not isinstance(p, str) or not p.startswith('/World/') or '..' in p or len(p) > 256 for p in prims):
        raise ValueError('Invalid collision prim path')
    bounds = vector(spec.get('reviewed_bounds_xz_m'), 4)
    if bounds[2]-bounds[0] < 1 or bounds[3]-bounds[1] < 1:
        raise ValueError('Trial bounds are too small or inverted')
    for key in ('start_ground_y_up_m', 'goal_ground_y_up_m'):
        pos = vector(spec.get(key))
        if not inside((pos[0], pos[2]), bounds, .4):
            raise ValueError('Start or goal outside the reviewed interior')
    if math.dist(spec['start_ground_y_up_m'], spec['goal_ground_y_up_m']) < .3:
        raise ValueError('Goal must be distinct from spawn')
    yaw = number(spec.get('yaw_rad'), -math.pi, math.pi)
    a, b = spec['start_ground_y_up_m'], spec['goal_ground_y_up_m']
    if math.hypot(b[0]-a[0], b[2]-a[2]) < .3:
        raise ValueError('The first trial requires a horizontal traversal segment')
    heading = math.atan2(-(b[2]-a[2]), b[0]-a[0])
    if abs(math.atan2(math.sin(yaw-heading), math.cos(yaw-heading))) > .2:
        raise ValueError('Initial yaw must face the straight trial goal')
    number(spec.get('duration_s'), 1, 30)
    number(spec.get('speed_m_s'), .05, .5)
    number(spec.get('goal_tolerance_m'), .05, .3)
    friction = spec.get('friction')
    if not isinstance(friction, dict) or friction.get('basis') != 'simulation-assumption':
        raise ValueError('Declare friction as a simulation assumption')
    number(friction.get('static'), .1, 2)
    number(friction.get('dynamic'), .1, friction['static'])
    if cloud is None:
        return spec
    if cloud.get('units') != 'm' or cloud.get('coordinateFrame') != 'right-handed-y-up':
        raise ValueError('Metric Y-up source cloud required')
    synthetic = cloud.get('provenance', {}).get('synthetic') is True
    if (spec['source_kind'] == 'synthetic') != synthetic:
        raise ValueError('Synthetic/captured source label mismatch')
    if spec['source_kind'] == 'captured':
        rows = spec.get('measurements')
        if not isinstance(rows, list) or not 4 <= len(rows) <= 32:
            raise ValueError('One calibration and at least three withheld measurements required')
        if sum(r.get('role') == 'calibration' for r in rows) != 1:
            raise ValueError('Exactly one calibration span required')
        seen = set(); directions = set()
        points = cloud['points']
        for row in rows:
            if row.get('role') not in ('calibration', 'withheld') or row.get('independently_measured') is not True:
                raise ValueError('Explicit independent measurement provenance required')
            if not isinstance(row.get('method'), str) or not row['method'].strip() or len(row['method']) > 120:
                raise ValueError('Measurement method required')
            ids = row.get('point_indices')
            if not isinstance(ids, list) or len(ids) != 2 or any(type(i) is not int or not 0 <= i < len(points) for i in ids) or ids[0] == ids[1]:
                raise ValueError('Measurement must identify two original cloud points')
            pair = tuple(sorted(ids))
            if pair in seen:
                raise ValueError('Calibration cannot be reused as a withheld check')
            seen.add(pair)
            a, b = (vector(points[i][:3]) for i in ids)
            measured = number(row.get('distance_m'), .01, 100)
            tolerance = number(row.get('tolerance_m'), .001, .1)
            if abs(math.dist(a, b)-measured) > tolerance:
                raise ValueError('Independent dimensional check failed')
            if row['role'] == 'withheld':
                directions.add(max(range(3), key=lambda i: abs(a[i]-b[i])))
        if len(directions) < 2:
            raise ValueError('Withheld checks must span multiple directions')
    return spec


def verify_locked(path, key):
    path = Path(path); size, oid = LOCK[key]
    if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
        raise ValueError('Pinned upstream file size or path mismatch')
    data = path.read_bytes()
    if hashlib.sha1(f'blob {size}\0'.encode()+data).hexdigest() != oid:
        raise ValueError('Pinned upstream blob mismatch')
    return data


def outcome(position_y_up, tilt, body_contact, spec):
    p = vector(list(position_y_up))
    number(tilt, 0, math.pi)
    if tilt > .65 or body_contact or p[1] < min(spec['start_ground_y_up_m'][1],spec['goal_ground_y_up_m'][1])+.25:
        return 'fallen_or_body_contact'
    if not inside((p[0], p[2]), spec['reviewed_bounds_xz_m'], .2):
        return 'left_reviewed_bounds'
    goal = spec['goal_ground_y_up_m']
    if math.hypot(p[0]-goal[0], p[2]-goal[2]) <= spec['goal_tolerance_m']:
        return 'goal_reached'
    return None
