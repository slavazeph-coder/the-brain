"""MANUAL deployed-worker qualification on small authored inputs, never startup.

Run only with --confirm-synthetic-deployment-test after checking the intended
deployment. Uses the real authenticated localhost API and installed CPU runtimes.
No physical scan, motion capture, ROS registration or robot control is claimed.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import struct
import sys
import tempfile
import time
import urllib.request
import uuid

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from robotics.world_worker.deploy.railway.tenants import CREDENTIAL, derived_credential

ENGINES = ('splat-repair', 'localization-map', 'motion-retarget')
ACTIVE = ('prepared', 'queued', 'running')
ID = re.compile(r'^[a-f0-9]{32}$')
SHA = re.compile(r'^[a-f0-9]{64}$')
NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$')
MIB = 1024**2


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def active_counts(root):
    """Read-only all-owner guard; never create, update, migrate or prune SQLite."""
    database = Path(root) / 'state.sqlite'
    require(database.is_file() and not database.is_symlink(), 'Existing regular worker database is required.')
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=5) as connection:
        connection.execute('PRAGMA query_only=ON')
        rows = connection.execute('SELECT status,COUNT(*) FROM jobs WHERE status IN (?,?,?) GROUP BY status', ACTIVE)
        counts = dict.fromkeys(ACTIVE, 0)
        counts.update(dict(rows))
    return counts


def require_idle(root):
    counts = active_counts(root)
    if any(counts.values()):
        raise RuntimeError('Worker has active jobs; manual qualification did not start another job.')
    return counts


def owner_credential(env):
    token = env.get('WORLD_WORKER_SITE_OWNER_TOKEN')
    if not token:
        passcode = env.get('WORLD_SITE_PASSCODE', '')
        require(len(passcode) >= 12, 'Owner credential is unavailable.')
        token = derived_credential(passcode, 'site-owner')
    require(bool(CREDENTIAL.fullmatch(token)), 'Owner credential is invalid.')
    return token


def deployment_identity(env, expected_commit=None, expected_deployment=None):
    commit = env.get('RAILWAY_GIT_COMMIT_SHA', '')
    deployment = env.get('RAILWAY_DEPLOYMENT_ID', '')
    require(bool(re.fullmatch(r'[a-f0-9]{40}', commit)), 'A deployed commit identity is required.')
    try:
        require(str(uuid.UUID(deployment)) == deployment.lower(), 'Invalid deployment identity.')
    except (ValueError, AttributeError) as error:
        raise ValueError('A deployed Railway identity is required.') from error
    require(expected_commit is None or commit == expected_commit, 'Deployed commit differs from the requested commit.')
    require(expected_deployment is None or deployment == expected_deployment, 'Deployment differs from the requested deployment.')
    return {'commit_sha': commit, 'deployment_id': deployment}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError('Qualification does not follow HTTP redirects.')


class LocalClient:
    def __init__(self, token, *, port=8080, duration=1200):
        require(type(port) is int and 1 <= port <= 65535, 'Invalid local worker port.')
        self.base = f'http://127.0.0.1:{port}'
        self.token = token
        self.deadline = time.monotonic() + duration
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.jobs = []
        self.active_job = None

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Deployment qualification deadline exceeded.')
        return remaining

    def call(self, path, *, body=None, raw=None, method=None, cleanup=False):
        require(path.startswith('/v1/') and not path.startswith('//') and '\\' not in path, 'Unexpected local API path.')
        headers = {'Cache-Control': 'no-store'}
        if not path.startswith('/v1/download/'):
            headers['Authorization'] = 'Bearer ' + self.token
        data = raw if raw is not None else encode(body) if body is not None else None
        if data is not None:
            headers['Content-Type'] = 'application/octet-stream' if raw is not None else 'application/json'
        request = urllib.request.Request(self.base + path, data=data, headers=headers,
                                         method=method or ('POST' if data is not None else 'GET'))
        return self.opener.open(request, timeout=10 if cleanup else min(60, self.remaining()))

    def json(self, path, **kwargs):
        with self.call(path, **kwargs) as response:
            raw = response.read(MIB + 1)
        require(len(raw) <= MIB, 'API JSON exceeded its limit.')
        return json.loads(raw)

    def upload(self, kind, name, raw):
        value = self.json('/v1/uploads', body={'name': name, 'kind': kind, 'size': len(raw)})
        uid = value.get('id')
        require(isinstance(uid, str) and bool(ID.fullmatch(uid)), 'Invalid returned upload identity.')
        for offset in range(0, len(raw), 4 * MIB):
            result = self.json(f'/v1/uploads/{uid}?offset={offset}', raw=raw[offset:offset + 4 * MIB], method='PUT')
            require(result.get('offset') == min(offset + 4 * MIB, len(raw)), 'Upload offset mismatch.')
        return uid

    def run(self, engine, inputs, run_id):
        ids = [self.upload(kind, f'authored-{run_id[:8]}-{name}', raw) for kind, name, raw in inputs]
        job = self.json('/v1/jobs', body={'engine': engine, 'upload_ids': ids, 'consent': True})
        jid = job.get('id')
        require(isinstance(jid, str) and bool(ID.fullmatch(jid)), 'Invalid returned job identity.')
        self.jobs.append({'engine': engine, 'id': jid})
        self.active_job = jid
        require(job.get('engine') == engine and job.get('status') == 'prepared', 'Unexpected prepared job.')
        self.json(f'/v1/jobs/{jid}/start', body={})
        deadline = min(self.deadline, time.monotonic() + (960 if engine == 'motion-retarget' else 240))
        while time.monotonic() < deadline:
            job = self.json(f'/v1/jobs/{jid}')
            require(job.get('id') == jid and job.get('engine') == engine, 'Job identity changed while polling.')
            if job.get('status') in ('complete', 'failed', 'cancelled'):
                self.active_job = None
                require(job['status'] == 'complete', 'A qualification adapter did not complete.')
                return job
            require(job.get('status') in ACTIVE, 'Unknown job state.')
            time.sleep(min(1, self.remaining()))
        raise TimeoutError('Qualification job exceeded its bounded deadline.')

    def cancel_own_active(self):
        jid = self.active_job
        if jid is None:
            return 'not-needed'
        require(any(row['id'] == jid for row in self.jobs), 'Refusing to cancel an unrelated job.')
        try:
            job = self.json(f'/v1/jobs/{jid}', cleanup=True)
            if job.get('status') in ACTIVE:
                result = self.json(f'/v1/jobs/{jid}', method='DELETE', cleanup=True)
                return 'requested' if result.get('status') == 'cancelled' else 'unconfirmed'
            return 'already-terminal'
        except Exception:
            return 'unconfirmed'

    def artifacts(self, job):
        rows = job.get('artifacts')
        require(isinstance(rows, list) and 1 <= len(rows) <= 40, 'Invalid artifact manifest.')
        records, payloads, total = [], {}, 0
        for index, row in enumerate(rows):
            name, size, digest = row.get('name'), row.get('size'), row.get('sha256')
            require(isinstance(name, str) and bool(NAME.fullmatch(name)) and name not in payloads,
                    'Invalid or duplicate artifact name.')
            require(type(size) is int and 0 < size <= 16 * MIB and isinstance(digest, str) and bool(SHA.fullmatch(digest)),
                    'Qualification artifact exceeds its bounded profile.')
            total += size
            require(total <= 64 * MIB, 'Qualification artifacts exceed their total byte limit.')
            ticket = self.json(f"/v1/jobs/{job['id']}/ticket", body={'artifact': index})['url']
            require(isinstance(ticket, str) and bool(re.fullmatch(r'/v1/download/[A-Za-z0-9_-]+\.[a-f0-9]{64}', ticket)),
                    'Unexpected signed download path.')
            with self.call(ticket) as response:
                raw = response.read(size + 1)
            require(len(raw) == size and sha(raw) == digest, 'Downloaded artifact hash/size mismatch.')
            payloads[name] = raw
            records.append({'name': name, 'bytes': size, 'sha256': digest})
        return records, payloads


def authored_inputs(runtime_dir):
    """Procedural Gaussian blemish, procedural scan and Apache neutral-rig sweep."""
    import numpy as np
    from robotics.splat_repair.ply import REQUIRED, TYPES
    from robotics.motion_retarget.authored_fixture import authored_sweep
    from robotics.localization import contracts as c
    rng = np.random.default_rng(41)
    count = 6400
    props = [('double' if name == 'x' else 'float', name) for name in REQUIRED]
    props += [('float', f'f_rest_{i}') for i in range(9)] + [('uint', 'authored_id')]
    rows = np.zeros(count, dtype=[(name, TYPES[ty]) for ty, name in props])
    x, y = np.meshgrid(np.linspace(-2.4, 2.4, 80), np.linspace(-2.4, 2.4, 80))
    rows['x'] = x.ravel() + rng.uniform(-.008, .008, count)
    rows['y'] = y.ravel() + rng.uniform(-.008, .008, count)
    rows['z'] = rng.normal(0, .001, count)
    selected = np.flatnonzero(rows['x']**2 + rows['y']**2 < .48**2).tolist()
    for i in range(3):
        rows[f'f_dc_{i}'] = (.4 + .08 * np.sin(rows['x'] * 2 + i) - .5) / .28209479177387814
        rows[f'scale_{i}'] = np.log([.04, .035, .004][i])
    rows['f_dc_0'][selected] = 1.5
    rows['rot_0'] = 1; rows['opacity'] = 2.5; rows['authored_id'] = np.arange(count)
    for i in range(9):
        rows[f'f_rest_{i}'] = rng.normal(0, .02, count)
    header = ['ply', 'format binary_little_endian 1.0', 'comment AUTHORED DEPLOYMENT TEST, NOT A MEASURED CAPTURE',
              f'element vertex {count}', *[f'property {ty} {name}' for ty, name in props], 'end_header', '']
    gaussian = '\n'.join(header).encode() + rows.tobytes()
    repair = {'schema': 'brainsnn.splat-repair-request.v1', 'sourceSha256': sha(gaussian), 'method': 'fast-fill',
              'selection': {'indices': selected}, 'parameters': {'mode': 'rim', 'seed': 17}, 'reviewed': True}
    points = [[i * .15, j * .16, .05 * ((i + 2 * j) % 5)] for i in range(16) for j in range(13)]
    scan = ('ply\nformat ascii 1.0\ncomment AUTHORED DEPLOYMENT TEST, NOT MEASURED LIDAR\nelement vertex ' + str(len(points)) +
            '\nproperty float x\nproperty float y\nproperty float z\nend_header\n' +
            ''.join(' '.join(map(str, point)) + '\n' for point in points)).encode()
    localization = {'schema': c.REQUEST_SCHEMA, 'action': 'prepare-map', 'sceneSha256': None, 'scanSha256': sha(scan),
                    'sourceFrame': 'right-handed-z-up', 'sourceToScene': [[1.,0.,0.,0.],[0.,0.,1.,0.],[0.,-1.,0.,0.],[0.,0.,0.,1.]],
                    'declaration': {'kind': 'registered-lidar', 'units': 'm', 'registered': True}, 'baseFrame': 'base_link', 'voxelMeters': .02}
    motion = authored_sweep(runtime_dir, frames=31, fps=30.)
    retarget = {'schema': 'brainsnn.motion-retarget-options.v1', 'target': 'unitree_g1', 'source_units': 'cm',
                'source_up_axis': 'Y', 'source_facing': 'Mujoco', 'fps': 30.}
    return {'splat-repair': [('splat', 'gaussian.ply', gaussian), ('repair', 'repair.json', encode(repair))],
            'localization-map': [('survey', 'scan.ply', scan), ('localization', 'localization.json', encode(localization))],
            'motion-retarget': [('motion', 'sweep.bvh', motion), ('retarget', 'retarget.json', encode(retarget))]}


def validate_repair(inputs, payloads):
    import numpy as np
    from robotics.splat_repair.ply import read_ply
    from robotics.splat_repair.runtime import REVISION
    original = inputs[0][2]
    require(payloads.get('original.ply') == original, 'Repair did not retain exact original bytes.')
    receipt = json.loads(payloads['repair-receipt.json']); mapping = json.loads(payloads['repair-mapping.json'])
    repaired = payloads['repaired.ply']
    require(receipt.get('schema') == 'brainsnn.splat-repair.v1' and receipt.get('runtime', {}).get('upstream', {}).get('revision') == REVISION,
            'Repair runtime receipt does not match the pinned core.')
    require(receipt.get('originalSha256') == mapping.get('originalSha256') == sha(original) and
            receipt.get('repairedSha256') == mapping.get('repairedSha256') == sha(repaired), 'Repair source/output binding mismatch.')
    require(receipt.get('appearanceOnly') is True and all(receipt.get(key) is False for key in
            ('measuredGeometry', 'metric_verified', 'physics_ready', 'robotReady', 'collisionGeometryProduced', 'occupancyMapProduced')),
            'Repair receipt overstates physical qualification.')
    with tempfile.TemporaryDirectory(prefix='layers-readback-') as directory:
        before = Path(directory) / 'before.ply'; after = Path(directory) / 'after.ply'
        before.write_bytes(original); after.write_bytes(repaired)
        source, result = read_ply(before), read_ply(after)
    kept = mapping['retainedOriginalIndices']; donors = mapping['generatedDonorOriginalIndices']; removed = mapping['removedOriginalIndices']
    n, start = len(source.records), len(kept)
    require(all(type(i) is int and 0 <= i < n for i in kept + donors + removed), 'Invalid repair index mapping.')
    require(len(kept) == len(set(kept)) and len(removed) == len(set(removed)) and set(kept).isdisjoint(removed)
            and set(kept) | set(removed) == set(range(n)), 'Repair retained/deleted mapping is incomplete.')
    require(result.properties == source.properties and result.records[:start].tobytes() == source.records[kept].tobytes(),
            'Retained Gaussian attributes changed.')
    require(len(result.records) - start == len(donors) == receipt['generatedVertices'] and len(donors) >= 30,
            'Repair did not create the expected generated fill.')
    require(np.array_equal(result.records['authored_id'][start:], source.records['authored_id'][donors]), 'Repair donor attributes changed.')
    face = ~np.asarray(mapping['generatedBacking'], dtype=bool)
    generated = result.records[start:][face]
    centre = generated[generated['x']**2 + generated['y']**2 < .35**2]
    require(len(centre) >= 25 and float(np.quantile(np.abs(centre['z']), .95)) < .03 and float(np.median(centre['f_dc_0'])) < .4,
            'Generated patch failed the authored plane/colour fixture check.')
    return {'original_sha256': sha(original), 'repaired_sha256': sha(repaired), 'generated_vertices': len(donors),
            'original_bytes_preserved': True, 'retained_attributes_preserved': True, 'actual_generated_fill': True}


def validate_map(inputs, payloads):
    from robotics.localization import contracts as c
    from robotics.localization.map_bundle import ply_points
    manifest = c.validate_map(c.decode(payloads['localization-map.json']))
    require(manifest['source']['scanSha256'] == sha(inputs[0][2]) and manifest['source']['mode'] == 'scan-local', 'Map input binding mismatch.')
    for name in ('localization-map.pcd', 'localization-map.ply'):
        require(manifest['artifacts'][name] == {'sha256': sha(payloads[name]), 'bytes': len(payloads[name])}, 'Map file binding mismatch.')
    pcd = payloads['localization-map.pcd']
    require(b'DATA binary\n' in pcd and manifest['units'] == 'm' and manifest['frames']['sourceToMap'] == c.IDENTITY,
            'Map units/frame mismatch.')
    points = list(ply_points(inputs[0][2])); packed = list(struct.iter_unpack('<ffff', pcd.split(b'DATA binary\n', 1)[1]))
    require(len(packed) == len(points) == manifest['sampling']['retainedPoints'], 'Map point count mismatch.')
    require(all(math.isclose(got[i], expected[i], abs_tol=1e-6) for got, expected in zip(packed, points) for i in range(3))
            and all(row[3] == 0 for row in packed), 'Map changed authored coordinates or invented intensity.')
    return {'source_sha256': sha(inputs[0][2]), 'pcd_sha256': sha(pcd), 'points': len(points), 'units': 'm',
            'map_frame': 'right-handed-z-up', 'physical_measurement': False}


def validate_motion(inputs, payloads, runtime_dir):
    from robotics.motion_retarget import UPSTREAM_COMMIT
    from robotics.motion_retarget.setup_runtime import G1
    source, options = inputs[0][2], inputs[1][2]
    require(payloads.get('original-motion.bvh') == source and payloads.get('retarget-options.json') == options,
            'Motion source or requested options were changed.')
    report = json.loads(payloads['motion-reference.json']); preview = json.loads(payloads['motion-preview.json'])
    runtime_raw = (runtime_dir / 'brainsnn-runtime.json').read_bytes(); runtime = json.loads(runtime_raw)
    require(report.get('schema') == 'brainsnn.motion-reference.v1' and preview.get('schema') == 'brainsnn.motion-preview.v1', 'Motion schema mismatch.')
    require(report['runtime']['commit'] == preview['runtime_commit'] == runtime['commit'] == UPSTREAM_COMMIT and
            report['runtime']['manifest_sha256'] == sha(runtime_raw) and report['runtime']['device'] == 'cpu', 'Motion runtime identity mismatch.')
    require(report['source_sha256'] == preview['source_sha256'] == sha(source) and report['options_sha256'] == sha(options), 'Motion source binding mismatch.')
    require(report['model_sha256'] == preview['model_sha256'] == runtime['files'][G1 + '/desc/mjcf/g1_29dof_rev_1_0.xml'], 'Motion robot model mismatch.')
    require(report['configuration_sha256'] == preview['configuration_sha256'] == runtime['files'][G1 + '/configs/soma_to_g1_retargeter_config.json'], 'Motion configuration mismatch.')
    for name, record in report['artifacts'].items():
        require(record == {'sha256': sha(payloads[name]), 'bytes': len(payloads[name])}, 'Motion artifact binding mismatch.')
    require(preview['csv_sha256'] == sha(payloads['robot-reference.csv']) and report['frame_count'] == preview['frame_count'] == 31
            and math.isclose(report['fps'], 30) and math.isclose(preview['fps'], 30), 'Motion timing/CSV binding mismatch.')
    require(all(report.get(key) is False for key in ('physics_executed', 'policy_trained', 'robot_control_enabled')) and
            preview.get('physics_executed') is False and preview.get('robot_control_enabled') is False, 'Motion overstates robot qualification.')
    require(report['diagnostics']['joint_limits']['violating_frames'] == 0, 'Motion violates declared joint limits.')
    angles = preview['joint_angles_rad']; names = preview['joint_order']
    require(len(names) == len(set(names)) == 29 and len(angles) == 31 and
            all(len(row) == 29 and all(math.isfinite(v) for v in row) for row in angles), 'Invalid motion joint output.')
    excursion = max(max(column) - min(column) for column in zip(*angles))
    require(excursion > .05, 'SOMA output did not respond to the authored articulation.')
    rows = list(csv.reader(io.StringIO(payloads['robot-reference.csv'].decode())))
    require(len(rows) == 32 and rows[0][7:] == names and all(len(row) == 36 for row in rows[1:]), 'Motion CSV shape/order mismatch.')
    require(all(math.isfinite(float(value)) for row in rows[1:] for value in row), 'Nonfinite CSV motion.')
    require(all(math.isclose(math.radians(float(value)), angles[i][j], abs_tol=1e-5)
                for i, row in enumerate(rows[1:]) for j, value in enumerate(row[7:])), 'Preview joints differ from actual exported CSV.')
    for track in ('human', 'robot'):
        data = preview[track]; count = len(data['joint_names'])
        require(len(data['parents']) == count and all(-1 <= parent < i for i, parent in enumerate(data['parents'])) and
                len(data['positions']) == 31 and all(len(frame) == count and all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in frame)
                                                    for frame in data['positions']), 'Invalid articulated motion preview.')
    return {'source_sha256': sha(source), 'csv_sha256': sha(payloads['robot-reference.csv']), 'preview_sha256': sha(payloads['motion-preview.json']),
            'runtime_commit': UPSTREAM_COMMIT, 'frames': 31, 'fps': 30, 'max_joint_excursion_rad': excursion, 'actual_cpu_ik': True}


def write_receipt(path, report):
    path = Path(path)
    require(path.is_absolute() and path.parent.is_dir() and not path.is_symlink(), 'Use an absolute private receipt path with an existing parent.')
    descriptor, temporary = tempfile.mkstemp(prefix='.layers-acceptance-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(encode(report) + b'\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def run_acceptance(*, confirmed=False, receipt_path=Path('/data/layers-acceptance.json'), env=None,
                   expected_commit=None, expected_deployment=None):
    require(confirmed is True, 'Explicit synthetic deployment-test confirmation is required.')
    env = os.environ if env is None else env
    identity = deployment_identity(env, expected_commit, expected_deployment)
    report = {'schema': 'brainsnn.hosted-layers-acceptance.v1', 'run_id': str(uuid.uuid4()), 'status': 'started',
              'started_at': datetime.now(timezone.utc).isoformat(), **identity,
              'script_sha256': sha(Path(__file__).read_bytes()), 'source_kind': 'authored synthetic deployment fixtures',
              'physical_accuracy_verified': False, 'real_lidar_or_motion_capture': False, 'robot_control_enabled': False,
              'ros_localizer_executed': False, 'jobs': [], 'results': {}}
    write_receipt(receipt_path, report)
    client = None
    try:
        root = Path(env.get('WORLD_WORKER_DIR', '/data/worker'))
        report['initial_all_owner_active_counts'] = require_idle(root)
        token = owner_credential(env)
        runtime_dir = Path(env.get('WORLD_SOMA_RUNTIME_DIR', '/opt/soma/upstream'))
        inputs = authored_inputs(runtime_dir)
        port = env.get('PORT', '8080')
        require(port.isdigit(), 'Invalid local worker port.')
        client = LocalClient(token, port=int(port))
        caps = client.json('/v1/capabilities')
        require(caps.get('owner_id') == 'site-owner', 'Qualification requires the hosted site-owner identity.')
        available = {row['id'] for row in caps.get('engines', []) if row.get('available') is True}
        require(set(ENGINES) <= available, 'All three real engines must be available to this owner.')
        validators = {'splat-repair': validate_repair, 'localization-map': validate_map,
                      'motion-retarget': lambda requested, payload: validate_motion(requested, payload, runtime_dir)}
        for engine in ENGINES:
            require_idle(root)
            job = client.run(engine, inputs[engine], report['run_id'])
            report['jobs'] = list(client.jobs)
            records, payloads = client.artifacts(job)
            report['results'][engine] = {**validators[engine](inputs[engine], payloads), 'artifacts': records}
            write_receipt(receipt_path, report)
        report.update(status='passed', all_download_hashes_verified=True)
    except Exception as error:
        report.update(status='failed', error_type=type(error).__name__)
        if client is not None:
            report['jobs'] = list(client.jobs)
            report['own_active_job_cancellation'] = client.cancel_own_active()
        raise
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        write_receipt(receipt_path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-synthetic-deployment-test', action='store_true')
    parser.add_argument('--receipt', type=Path, default=Path('/data/layers-acceptance.json'))
    parser.add_argument('--expected-commit')
    parser.add_argument('--expected-deployment')
    args = parser.parse_args()
    report = run_acceptance(confirmed=args.confirm_synthetic_deployment_test, receipt_path=args.receipt,
                            expected_commit=args.expected_commit, expected_deployment=args.expected_deployment)
    print('LAYERS_HOSTED_ACCEPTANCE ' + json.dumps({'status': report['status'], 'commit_sha': report['commit_sha'],
          'deployment_id': report['deployment_id'], 'jobs': report['jobs'], 'receipt_sha256': sha(args.receipt.read_bytes()),
          'output_digests': {engine: {row['name']: row['sha256'] for row in result['artifacts']}
                             for engine, result in report['results'].items()}}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # urllib errors can carry signed URLs. Never print exception details,
        # credentials, source contents or environment variables.
        print('LAYERS_HOSTED_ACCEPTANCE_FAILED ' + type(error).__name__, flush=True)
        sys.exit(1)
