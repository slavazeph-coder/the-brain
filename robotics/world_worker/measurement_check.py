"""Compare self-reported physical readings with bound 3D cloud-point distances.

This does not estimate scale, ask a model for dimensions, certify accuracy or
change geometry/review flags. Compiled box dimensions are an unchecked inventory;
point-pair comparisons do not independently validate every scene element.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import struct

INPUT_SCHEMA = 'brainsnn.dimension-checks.v1'
REPORT_SCHEMA = 'brainsnn.scene-measurements.v1'
MAX_CHECK_BYTES = 64 * 1024
MAX_CHECKS = 64
MAX_POINTS = 50_000
MAX_SCENE_BYTES = 4 * 1024 * 1024
_SHA = re.compile(r'^[a-f0-9]{64}$')
_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
_HASH_PREFIX = b'brainsnn.dimension-points.v1\0right-handed-y-up\0m\0'


def _fail(message):
    raise ValueError(message)


def _number(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        _fail(f'{name} must be finite and between {low} and {high}.')
    return value


def _exact(value, keys, name):
    if not isinstance(value, dict) or set(value) != set(keys):
        _fail(f'Invalid {name} fields.')


def _text(value, limit, name, *, empty=False):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        _fail(f'Invalid {name}.')
    return value


def _json_bytes(value):
    try:
        return json.dumps(value, allow_nan=False, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    except (TypeError, ValueError, RecursionError, UnicodeError) as error:
        raise ValueError('Evidence must be finite JSON.') from error


def points_sha256(cloud):
    """Ordered XYZ/RGB values as little-endian Float64 after an explicit frame/unit prefix."""
    if not isinstance(cloud, dict) or cloud.get('units') != 'm' or cloud.get('coordinateFrame') != 'right-handed-y-up':
        _fail('Dimension checks need a right-handed-y-up cloud in metres.')
    points = cloud.get('points')
    if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
        _fail('Dimension checks need 1 to 50,000 ordered points.')
    digest = hashlib.sha256(_HASH_PREFIX)
    for row in points:
        if not isinstance(row, list) or len(row) != 6:
            _fail('Every dimension-check point must contain XYZ and RGB.')
        for value in row[:3]:
            _number(value, -10_000_000, 10_000_000, 'Point coordinate')
        for value in row[3:]:
            _number(value, 0, 255, 'Point colour')
        digest.update(struct.pack('<6d', *row))
    return digest.hexdigest()


def validate_checks(value, cloud):
    """Validate the optional cloud-embedded contract; the claimed physical readings remain self-reported."""
    if value is None:
        return None
    if len(_json_bytes(value)) > MAX_CHECK_BYTES:
        _fail('Dimension checks exceed 64 KiB.')
    _exact(value, ['schema', 'cloudPointsSha256', 'coordinateFrame', 'units', 'tolerance', 'checks'], 'dimension checks')
    if value['schema'] != INPUT_SCHEMA or value['coordinateFrame'] != 'right-handed-y-up' or value['units'] != 'm':
        _fail('Unknown dimension-check schema, frame or units.')
    if not isinstance(value['cloudPointsSha256'], str) or not _SHA.fullmatch(value['cloudPointsSha256']) \
            or value['cloudPointsSha256'] != points_sha256(cloud):
        _fail('Dimension-check point SHA-256 does not match this cloud.')
    _exact(value['tolerance'], ['absoluteMeters', 'relative'], 'requested tolerance')
    _number(value['tolerance']['absoluteMeters'], 0, 10, 'Absolute tolerance')
    _number(value['tolerance']['relative'], 0, 1, 'Relative tolerance')
    if not isinstance(value['checks'], list) or not 1 <= len(value['checks']) <= MAX_CHECKS:
        _fail('Provide 1 to 64 dimension checks, or omit the optional contract.')
    ids, pairs = set(), set()
    for check in value['checks']:
        _exact(check, ['id', 'label', 'role', 'pointIndices', 'distanceMeters', 'uncertaintyMeters',
                       'method', 'instrument', 'measuredOn', 'note'], 'dimension check')
        if not isinstance(check['id'], str) or not _ID.fullmatch(check['id']) or check['id'] in ids:
            _fail('Dimension-check IDs must be unique bounded identifiers.')
        ids.add(check['id'])
        _text(check['label'], 120, 'dimension-check label')
        if check['role'] not in ('calibration', 'held-out'):
            _fail('Check role must be calibration or held-out.')
        indices = check['pointIndices']
        if not isinstance(indices, list) or len(indices) != 2 or any(
                isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(cloud['points']) for i in indices) \
                or indices[0] == indices[1]:
            _fail('Use two different point indices from this cloud.')
        pair = tuple(sorted(indices))
        if pair in pairs:
            _fail('Endpoint pairs cannot be repeated, including across calibration and held-out roles.')
        pairs.add(pair)
        if math.dist(cloud['points'][indices[0]][:3], cloud['points'][indices[1]][:3]) <= 1e-6:
            _fail('Dimension-check endpoints must have distinct 3D positions.')
        _number(check['distanceMeters'], .001, 200, 'Reference distance')
        _number(check['uncertaintyMeters'], 0, 10, 'Reading uncertainty')
        if check['method'] not in ('tape', 'laser', 'manual-reference'):
            _fail('Reference method must be tape, laser or manual-reference; model estimates are not readings.')
        _text(check['instrument'], 120, 'instrument or dimensioned reference')
        stamp = check['measuredOn']
        try:
            if not isinstance(stamp, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', stamp) \
                    or datetime.date.fromisoformat(stamp).isoformat() != stamp:
                _fail('Enter a valid measurement date.')
        except (ValueError, TypeError) as error:
            raise ValueError('Enter a valid measurement date.') from error
        _text(check['note'], 600, 'measurement note', empty=True)
    return copy.deepcopy(value)


def _inventory(scene):
    inventory = []
    for kind, elements in [('wall', scene.get('walls', [])), ('object', scene.get('objects', []))]:
        if not isinstance(elements, list) or len(elements) > 512:
            _fail('Invalid or oversized scene dimension inventory.')
        for element in elements:
            if not isinstance(element, dict):
                _fail('Invalid scene element.')
            if 'centre' not in element or 'size' not in element:
                continue  # unplaced detections have no compiled dimensions
            size = element['size']
            if not isinstance(size, list) or len(size) != 3:
                _fail('Scene dimensions must have three components.')
            for component in size:
                _number(component, .000001, 10_000_000, 'Compiled dimension')
            name = _text(element.get('name'), 160, 'scene element name')
            floor = element.get('label') == 'floor' or name == 'floor_observed'
            notes = ['Compiled geometry; independently unchecked element dimensions.']
            if kind == 'wall':
                notes.append('Wall thickness is estimated from point spread with a 0.10 m compiler minimum; it is not measured construction thickness.')
            if floor:
                notes.append('Floor footprint is a bounding extent; slab thickness is a 0.02 m modelling choice, not a measured floor assembly.')
            if element.get('base') == 'inferred':
                notes.append('Object base is inferred; the resulting height is not wholly observed.')
            inventory.append({'name': name, 'label': element.get('label'), 'kind': 'floor' if floor else kind,
                              'dimensionsMeters': {'length': size[0], 'height': size[1], 'width': size[2]},
                              'basis': 'compiled-geometry', 'independentlyChecked': False,
                              'provenance': element.get('provenance', 'unknown'), 'base': element.get('base', 'unknown'),
                              'notes': notes})
    return inventory


def build_report(scene, cloud):
    """Build an auditable local comparison, without changing scale, scene geometry or approval flags."""
    point_hash = points_sha256(cloud)
    if not isinstance(scene, dict) or scene.get('units') != 'm':
        _fail('Scene dimension reports require a metric scene; arbitrary units cannot produce metre claims.')
    if scene.get('scale') != cloud.get('scale'):
        _fail('Scene and cloud scale provenance do not match.')
    checks = validate_checks(cloud.get('measurementChecks'), cloud)
    rows = []
    if checks:
        tolerance = checks['tolerance']
        for check in checks['checks']:
            a, b = (cloud['points'][i][:3] for i in check['pointIndices'])
            actual, reference = math.dist(a, b), check['distanceMeters']
            absolute_error = abs(actual - reference)
            limit = max(tolerance['absoluteMeters'], tolerance['relative'] * reference)
            within = absolute_error <= limit or math.isclose(absolute_error, limit, rel_tol=1e-12, abs_tol=1e-12)
            rows.append({**copy.deepcopy(check), 'cloudDistanceMeters': actual, 'signedErrorMeters': actual - reference,
                         'absoluteErrorMeters': absolute_error, 'relativeError': absolute_error / reference,
                         'requestedToleranceMeters': limit, 'withinRequestedTolerance': within})
    held_out = [row for row in rows if row['role'] == 'held-out']
    status = ('no-held-out' if not held_out else 'within-requested-tolerance'
              if all(row['withinRequestedTolerance'] for row in held_out) else 'outside-requested-tolerance')
    return {'schema': REPORT_SCHEMA, 'basis': 'self-reported-reference-to-cloud-point-distances',
            'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'metric_verified': False, 'certified': False,
            'status': status, 'statusScope': 'held-out-point-pairs-only', 'source': {'cloudPointsSha256': point_hash,
                                       'sceneCanonicalSha256': hashlib.sha256(_json_bytes(scene)).hexdigest()},
            'scale': copy.deepcopy(cloud.get('scale')), 'tolerance': copy.deepcopy(checks['tolerance']) if checks else None,
            'checks': rows, 'summary': {'calibrationCount': sum(row['role'] == 'calibration' for row in rows),
                                      'calibrationWithinTolerance': sum(row['role'] == 'calibration' and row['withinRequestedTolerance'] for row in rows),
                                      'heldOutCount': len(held_out),
                                      'heldOutWithinTolerance': sum(row['withinRequestedTolerance'] for row in held_out),
                                      'heldOutMaxAbsoluteErrorMeters': max((row['absoluteErrorMeters'] for row in held_out), default=None),
                                      'heldOutMaxRelativeError': max((row['relativeError'] for row in held_out), default=None)},
            'dimensions': _inventory(scene),
            'caveats': ['Readings, instrument and calibration/held-out roles are self-reported, not independently attested.',
                        'A within-tolerance comparison is not certification, a confidence interval, or a survey-accuracy claim.',
                        'Reading uncertainty is retained separately and does not widen the requested acceptance tolerance.',
                        'Cloud-point checks do not independently validate every compiled wall, object, opening or clearance.',
                        'The report never changes geometry, scale or planning review decisions.']}


def _read_json(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        _fail(f'Input must be a regular file within its byte limit: {path}')
    def reject(_constant):
        _fail('Input JSON contains a non-finite value.')
    try:
        return json.loads(path.read_text(encoding='utf-8'), parse_constant=reject)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError(f'Invalid JSON input: {path}') from error


def _file_sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fingerprint', type=Path, metavar='CLOUD', help='print the ordered metric point hash; writes no report')
    parser.add_argument('--cloud', type=Path)
    parser.add_argument('--scene', type=Path)
    parser.add_argument('--checks', type=Path, help='optional exact dimension-check contract bound to the cloud point hash')
    parser.add_argument('--out', type=Path, help='fresh output JSON path')
    args = parser.parse_args(argv)
    try:
        if args.fingerprint and any((args.cloud, args.scene, args.checks, args.out)):
            _fail('Use --fingerprint on its own.')
        if not args.fingerprint and not all((args.cloud, args.scene, args.out)):
            _fail('Use --cloud, --scene and --out, or --fingerprint CLOUD.')
        # Lazy import avoids a geometry <-> optional-contract validation import cycle.
        try:
            from .geometry import load_arena_cloud
        except ImportError:
            from geometry import load_arena_cloud
        cloud_path = args.fingerprint or args.cloud
        _read_json(cloud_path, 16 * 1024 * 1024)
        cloud = load_arena_cloud(cloud_path)
        if args.fingerprint:
            print(points_sha256(cloud))
            return
        if args.out.exists() or args.out.is_symlink():
            _fail('Choose a fresh report path; an existing file will not be overwritten.')
        if args.out.resolve() in {p.resolve() for p in (args.cloud, args.scene, args.checks) if p is not None}:
            _fail('Report output cannot replace an input.')
        scene = _read_json(args.scene, MAX_SCENE_BYTES)
        if args.checks:
            cloud['measurementChecks'] = validate_checks(_read_json(args.checks, MAX_CHECK_BYTES), cloud)
        report = build_report(scene, cloud)
        report['sourceFiles'] = {name: {'sha256': _file_sha256(path)}
                                 for name, path in [('cloud', args.cloud), ('scene', args.scene), ('checks', args.checks)]
                                 if path is not None}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write('\n')
        print(f'{report["status"]}: {args.out}')
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(2, f'REFUSED: {error}\n')


if __name__ == '__main__':
    main()
