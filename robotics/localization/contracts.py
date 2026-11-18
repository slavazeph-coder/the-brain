"""Bounded interchange for a measured-map localizer, not physical qualification.

All transforms use column vectors, metres and proper rigid 4x4 matrices. Map
coordinates are ROS right-handed Z-up; scene coordinates are right-handed Y-up.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re

UPSTREAM_COMMIT = '6e21b7ed9e2e5c5ba1452eb63db5c9402862625b'
NDT_COMMIT = '17ce1e19831447a1f5bc5a68a4522fa8087f8933'
REQUEST_SCHEMA = 'brainsnn.localization-request.v1'
MAP_SCHEMA = 'brainsnn.localization-map.v1'
RECORDING_SCHEMA = 'brainsnn.localization-recording.v1'
MAX_RECORD_BYTES = 16 * 1024 * 1024
MAX_SAMPLES = 20_000
HEX = re.compile(r'^[0-9a-f]{64}$')
FRAME = re.compile(r'^[A-Za-z][A-Za-z0-9_/-]{0,79}$')
SCENE_TO_MAP = [[1., 0., 0., 0.], [0., 0., -1., 0.], [0., 1., 0., 0.], [0., 0., 0., 1.]]
IDENTITY = [[float(i == j) for j in range(4)] for i in range(4)]


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def encode(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


def decode(raw: bytes):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('Duplicate JSON property: ' + key)
            value[key] = item
        return value
    def bad(value):
        raise ValueError('Non-finite JSON value: ' + value)
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=bad)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError('Invalid localization JSON') from exc


def read_file(path, limit=MAX_RECORD_BYTES):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('Expected a bounded regular localization file')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Localization file exceeded its bound')
    return raw


def number(value, name, low=-1e6, high=1e6):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(name + ' must be finite and in range')
    return float(value)


def digest(value, name):
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise ValueError('Invalid ' + name)
    return value


def frame(value):
    if not isinstance(value, str) or not FRAME.fullmatch(value) or '..' in value or '//' in value:
        raise ValueError('Invalid ROS frame')
    return value


def vector(value, size, name, low=-1e6, high=1e6):
    if not isinstance(value, list) or len(value) != size:
        raise ValueError('Invalid ' + name)
    return [number(x, name, low, high) for x in value]


def rigid(value):
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError('Expected a 4x4 rigid transform')
    rows = [vector(row, 4, 'transform') for row in value]
    if rows[3] != [0., 0., 0., 1.]:
        raise ValueError('Invalid homogeneous transform row')
    for i in range(3):
        for j in range(3):
            if abs(sum(rows[k][i] * rows[k][j] for k in range(3)) - (i == j)) > 1e-6:
                raise ValueError('Transform must preserve measured metres; no scale or shear')
    a, b, c = rows[:3]
    det = a[0] * (b[1]*c[2]-b[2]*c[1]) - a[1] * (b[0]*c[2]-b[2]*c[0]) + a[2] * (b[0]*c[1]-b[1]*c[0])
    if abs(det - 1) > 1e-6:
        raise ValueError('Transform must be a proper rotation, not a reflection')
    return rows


def compose(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def transform(matrix, point):
    return [sum(matrix[i][j] * point[j] for j in range(3)) + matrix[i][3] for i in range(3)]


def validate_request(value):
    keys = {'schema', 'action', 'sceneSha256', 'scanSha256', 'sourceFrame', 'sourceToScene', 'declaration', 'baseFrame', 'voxelMeters'}
    if not isinstance(value, dict) or set(value) != keys or value.get('schema') != REQUEST_SCHEMA or value.get('action') != 'prepare-map':
        raise ValueError('Expected a localization prepare-map request')
    if value['sceneSha256'] is not None:
        digest(value['sceneSha256'], 'scene SHA')
    digest(value['scanSha256'], 'scan SHA')
    if value['sourceFrame'] not in ('right-handed-z-up', 'right-handed-y-up'):
        raise ValueError('Declare the measured scan coordinate frame')
    rigid(value['sourceToScene']); frame(value['baseFrame'])
    if value['sceneSha256'] is None:
        expected = IDENTITY if value['sourceFrame'] == 'right-handed-y-up' else [[1.,0.,0.,0.],[0.,0.,1.,0.],[0.,-1.,0.,0.],[0.,0.,0.,1.]]
        if value['sourceToScene'] != expected:
            raise ValueError('Scan-local mode requires only the declared axis conversion')
    number(value['voxelMeters'], 'voxel metres', .01, .5)
    if value['declaration'] != {'kind': 'registered-lidar', 'units': 'm', 'registered': True}:
        raise ValueError('Only declared registered LiDAR in metres is supported; generated appearance is excluded')
    return value


def manifest_revision(manifest):
    return sha(encode({k: v for k, v in manifest.items() if k != 'revisionSha256'}))


def validate_map(manifest):
    if not isinstance(manifest, dict) or manifest.get('schema') != MAP_SCHEMA:
        raise ValueError('Expected a localization map bundle')
    source = manifest.get('source', {})
    if not isinstance(source, dict):
        raise ValueError('Invalid map source binding')
    digest(source.get('scanSha256'), 'scan SHA')
    if source.get('mode') == 'scan-local':
        if any(source.get(k) is not None for k in ('sceneSha256', 'cloudPointsSha256', 'componentRevision')):
            raise ValueError('Scan-local maps do not invent a scene binding')
    elif source.get('mode') == 'scene-bound':
        for key in ('sceneSha256', 'cloudPointsSha256'):
            digest(source.get(key), key)
        if type(source.get('componentRevision')) is not int or not 0 <= source['componentRevision'] <= 1_000_000:
            raise ValueError('Invalid component revision')
    else:
        raise ValueError('Unknown localization source mode')
    frames = manifest.get('frames', {})
    if not isinstance(frames, dict):
        raise ValueError('Invalid map frame contract')
    if frames.get('sceneFrame') != 'right-handed-y-up' or frames.get('mapFrame') != 'map' or frames.get('sceneToMap') != SCENE_TO_MAP:
        raise ValueError('Unsupported scene-to-ROS coordinate transform')
    if frames.get('sourceFrame') not in ('right-handed-z-up', 'right-handed-y-up'):
        raise ValueError('Unsupported measured scan frame')
    frame(frames.get('baseFrame')); rigid(frames.get('sourceToScene'))
    if source['mode'] == 'scan-local':
        axis_only = IDENTITY if frames['sourceFrame'] == 'right-handed-y-up' else [[1.,0.,0.,0.],[0.,0.,1.,0.],[0.,-1.,0.,0.],[0.,0.,0.,1.]]
        if frames['sourceToScene'] != axis_only:
            raise ValueError('Scan-local source transform must be the explicit axis conversion')
    expected = compose(SCENE_TO_MAP, frames['sourceToScene'])
    actual = rigid(frames.get('sourceToMap'))
    if any(abs(expected[i][j]-actual[i][j]) > 1e-8 for i in range(4) for j in range(4)):
        raise ValueError('Composed transform does not match the source-to-scene chain')
    if manifest.get('validation') != {'metricVerified': False, 'physicalRobotValidated': False, 'localizationValidated': False}:
        raise ValueError('Map packaging does not confer physical validation')
    artifacts = manifest.get('artifacts')
    if not isinstance(artifacts, dict):
        raise ValueError('Missing map artifacts')
    for name in ('localization-map.pcd', 'localization-map.ply'):
        entry = artifacts.get(name, {})
        if not isinstance(entry, dict):
            raise ValueError('Invalid map artifact')
        digest(entry.get('sha256'), 'map file hash')
        if type(entry.get('bytes')) is not int or not 0 < entry['bytes'] <= 32*1024*1024:
            raise ValueError('Invalid map artifact size')
    if manifest.get('mapSha256') != manifest['artifacts']['localization-map.pcd']['sha256'] or manifest.get('revisionSha256') != manifest_revision(manifest):
        raise ValueError('Map revision/hash mismatch')
    return manifest


def load_bundle(folder):
    folder = Path(folder)
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('Expected a regular map bundle directory')
    raw = read_file(folder / 'localization-map.json', 100_000)
    manifest = validate_map(decode(raw))
    for name in ('localization-map.pcd', 'localization-map.ply'):
        data = read_file(folder / name, 32*1024*1024)
        if manifest['artifacts'][name] != {'sha256': sha(data), 'bytes': len(data)}:
            raise ValueError('Map artifact no longer matches its manifest')
    return manifest, raw


def binding(manifest, raw):
    validate_map(manifest)
    return {'bundleSha256': sha(raw), 'mapSha256': manifest['mapSha256'],
            'sourceMode': manifest['source']['mode'],
            **{k: manifest['source'][k] for k in ('scanSha256', 'sceneSha256', 'cloudPointsSha256', 'componentRevision')},
            'mapFrame': manifest['frames']['mapFrame'], 'baseFrame': manifest['frames']['baseFrame']}


def validate_binding(value):
    if not isinstance(value, dict) or set(value) != {'bundleSha256', 'mapSha256', 'scanSha256', 'sourceMode', 'sceneSha256', 'cloudPointsSha256', 'componentRevision', 'mapFrame', 'baseFrame'}:
        raise ValueError('Missing localization source binding')
    for key in ('bundleSha256', 'mapSha256', 'scanSha256'):
        digest(value[key], key)
    if value['sourceMode'] == 'scan-local':
        if any(value[k] is not None for k in ('sceneSha256', 'cloudPointsSha256', 'componentRevision')):
            raise ValueError('Scan-local recording cannot borrow a scene')
    elif value['sourceMode'] == 'scene-bound':
        digest(value['sceneSha256'], 'scene SHA'); digest(value['cloudPointsSha256'], 'cloud SHA')
        if type(value['componentRevision']) is not int or not 0 <= value['componentRevision'] <= 1_000_000:
            raise ValueError('Invalid component revision')
    else:
        raise ValueError('Unknown recording source mode')
    if value['mapFrame'] != 'map':
        raise ValueError('Invalid localization revision/frame')
    frame(value['baseFrame'])


def stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', value):
        raise ValueError('Use positive decimal-string nanosecond timestamps')
    return int(value)


def validate_recording(value, expected_binding=None):
    if not isinstance(value, dict) or value.get('schema') != RECORDING_SCHEMA:
        raise ValueError('Expected a ROS localization recording')
    validate_binding(value.get('binding'))
    if expected_binding is not None and value['binding'] != expected_binding:
        raise ValueError('Recording belongs to another source, map or revision')
    runtime = value.get('runtime', {})
    if not isinstance(runtime, dict):
        raise ValueError('Invalid localization runtime')
    if runtime.get('upstreamCommit') != UPSTREAM_COMMIT or runtime.get('engine') != 'lidar_localization_ros2' or runtime.get('origin') not in ('recorded-ros2', 'authored-ros2-test'):
        raise ValueError('Unknown localization producer')
    if value.get('validation') != {'physicalRobotValidated': False, 'accuracyVerified': False, 'producerAttested': False}:
        raise ValueError('A recording is not an independent accuracy or producer attestation')
    samples = value.get('samples')
    if not isinstance(samples, list) or not 1 <= len(samples) <= MAX_SAMPLES:
        raise ValueError('Recording sample count is out of bounds')
    if not isinstance(samples[0], dict):
        raise ValueError('Invalid localization sample')
    first = stamp(samples[0].get('timestampNs')); previous = 0
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError('Invalid localization sample')
        current = stamp(sample.get('timestampNs'))
        if current <= previous:
            raise ValueError('Recording timestamps must increase strictly')
        previous = current
        t = number(sample.get('t'), 'relative time', 0, 86_400)
        if abs(t - (current-first)/1e9) > 1e-5:
            raise ValueError('Relative time disagrees with the ROS stamp')
        vector(sample.get('position'), 3, 'map pose', -100_000, 100_000)
        q = vector(sample.get('quaternion'), 4, 'quaternion', -1.001, 1.001)
        if abs(sum(x*x for x in q)-1) > 1e-3:
            raise ValueError('Quaternion must be normalized')
        cov = vector(sample.get('covariance'), 36, 'covariance', -1e6, 1e6)
        if any(cov[i] < 0 for i in (0, 7, 14, 21, 28, 35)):
            raise ValueError('Negative pose variance')
        if sample.get('state') not in ('tracking', 'weak', 'odometry-only', 'lost'):
            raise ValueError('Unknown localization health state')
        diag = sample.get('diagnostics', {})
        if not isinstance(diag, dict) or set(diag) != {'level', 'failureCategory', 'reinitializationRequested', 'statusTimestampNs', 'poseSource'}:
            raise ValueError('Missing bounded localization diagnostics')
        if type(diag['level']) is not int or diag['level'] not in (0, 1, 2, 3) or type(diag['reinitializationRequested']) is not bool:
            raise ValueError('Invalid localization diagnostics')
        if not isinstance(diag['failureCategory'], str) or len(diag['failureCategory']) > 80:
            raise ValueError('Invalid failure category')
        if abs(stamp(diag['statusTimestampNs']) - current) > 500_000_000:
            raise ValueError('Pose diagnostic is stale or from another time')
        if diag['poseSource'] not in ('pcl_pose', 'odom_bridge_pose'):
            raise ValueError('Unknown pose source')
        if sample['state'] == 'tracking' and (diag['level'] != 0 or diag['reinitializationRequested'] or diag['poseSource'] != 'pcl_pose' or diag['failureCategory'] not in ('', 'healthy', 'none')):
            raise ValueError('Tracking claim disagrees with diagnostics')
        if diag['poseSource'] == 'odom_bridge_pose' and sample['state'] != 'odometry-only':
            raise ValueError('Odometry bridge must remain visibly separate')
    if len(encode(value)) > MAX_RECORD_BYTES:
        raise ValueError('Recording exceeded byte limit')
    return value
