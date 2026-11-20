"""Compare a static Nav2 plan with all scheduled, operator-reported route attempts offline."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import tempfile
from uuid import uuid4

from ..scene_compiler.nav2_export import _publish_directory
from .fleet_campaign import goal_only_astar
from .fleet_learning import Robot
from .fleet_nav2 import (MAX_CSV_BYTES, checked_map_samples, digest, json_strict,
                        load_nav2_map, number, read_bound, swept_disc_clear)

BASES = ('authored-synthetic', 'operator-reported-recording')
OUTCOMES = ('reached-unassisted', 'intervention', 'contact', 'timeout', 'localization-lost', 'stopped')


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + '\n').encode()


def publish(folder, files):
    """Expose all evidence for a single operation together. Concurrent writers cannot replace it."""
    folder = Path(folder)
    folder.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=folder.parent) as temporary:
        stage = Path(temporary) / 'bundle'
        stage.mkdir()
        for name, data in files.items():
            (stage / name).write_bytes(data)
        _publish_directory(stage, folder)


def map_identity(bundle):
    identity = {'revisionSha256': bundle.revision_sha256, 'pgmSha256': bundle.pgm_sha256,
            'sceneSha256': bundle.source_scene_sha256, 'cloudSha256': bundle.source_cloud_sha256,
            'scaleBasis': bundle.basis, 'frameId': bundle.frame_id}
    if bundle.comparison_evidence is not None:
        identity['comparisonEvidence'] = bundle.comparison_evidence
    return identity


def prepare(map_dir, out, *, start, goal, robot_id, radius, speed, tolerance, attempts, basis):
    bundle = load_nav2_map(map_dir)
    if type(attempts) is not int or not 1 <= attempts <= 100 or basis not in BASES:
        raise ValueError('Select a source basis and 1 to 100 planned attempts.')
    if not isinstance(robot_id, str) or not 1 <= len(robot_id.strip()) <= 80:
        raise ValueError('Supply a bounded robot identifier.')
    robot = Robot(robot_id, number(radius, 'footprint radius', .01, 5.), number(speed, 'max speed', .01, 15.))
    tolerance = number(tolerance, 'endpoint tolerance', .01, 2.)
    for col, row in (start, goal):
        if (type(col) is not int or type(row) is not int or not 0 <= col < bundle.scene.width
                or not 0 <= row < bundle.scene.height):
            raise ValueError('Start and goal must be cells inside the map.')
    if math.dist(bundle.centre(*start), bundle.centre(*goal)) <= 2 * tolerance:
        raise ValueError('Start and goal tolerance regions must be disjoint.')
    try:
        path = goal_only_astar(bundle.scene, robot, tuple(start), tuple(goal))
        prediction = {'status': 'planned', 'routeCellsSha256': digest(encoded(path)), 'cellCount': len(path),
                      'lengthMeters': (len(path) - 1) * bundle.scene.cell_size_m}
    except ValueError as error:
        prediction = {'status': 'unavailable', 'reason': str(error)}
    plan = {'schema': 'brainsnn.fleet-field-plan.v1', 'id': str(uuid4()), 'map': map_identity(bundle),
            'basis': basis, 'attempts': attempts, 'robot': {'id': robot.id, 'radiusM': radius, 'maxSpeedMps': speed},
            'startCell': list(start), 'goalCell': list(goal), 'endpointToleranceM': tolerance, 'staticPlan': prediction}
    publish(out, {'plan.json': encoded(plan)})
    return plan


def load_plan(trial):
    raw = read_bound(Path(trial) / 'plan.json', 32_000)
    plan = json_strict(raw)
    if (plan.get('schema') != 'brainsnn.fleet-field-plan.v1' or plan.get('basis') not in BASES
            or type(plan.get('attempts')) is not int or not 1 <= plan['attempts'] <= 100):
        raise ValueError('Invalid field trial plan.')
    return plan, digest(raw)


def record(trial, attempt, outcome, *, poses=None, reason='', recording_manifest=None):
    plan, plan_hash = load_plan(trial)
    if type(attempt) is not int or not 1 <= attempt <= plan['attempts'] or outcome not in OUTCOMES:
        raise ValueError('Unknown attempt number or outcome.')
    if not isinstance(reason, str) or len(reason) > 400 or (outcome != 'reached-unassisted' and not reason.strip()):
        raise ValueError('Record a short reason for each unsuccessful attempt (up to 400 characters).')
    raw = read_bound(Path(poses), MAX_CSV_BYTES) if poses is not None else None
    binding = read_bound(Path(recording_manifest), 32_000) if recording_manifest is not None else None
    if binding is not None and raw is None:
        raise ValueError('Supply the pose CSV with its recording manifest.')
    entry = {'schema': 'brainsnn.fleet-field-attempt.v1', 'attempt': attempt, 'planSha256': plan_hash,
             'outcome': outcome, 'reason': reason, 'poseSha256': digest(raw) if raw is not None else None,
             'recordingManifestSha256': digest(binding) if binding is not None else None}
    files = {'outcome.json': encoded(entry)}
    if raw is not None:
        files['poses.csv'] = raw
    if binding is not None:
        files['recording-manifest.json'] = binding
    publish(Path(trial) / f'attempt-{attempt:03d}', files)
    return entry


def read_attempt(folder, attempt, plan_hash):
    entry = json_strict(read_bound(folder / 'outcome.json', 16_000))
    if (entry.get('schema') != 'brainsnn.fleet-field-attempt.v1' or entry.get('attempt') != attempt
            or entry.get('planSha256') != plan_hash or entry.get('outcome') not in OUTCOMES):
        raise ValueError(f'Attempt {attempt} is inconsistent with the frozen plan.')
    return entry


def compare_trace(bundle, plan, robot, raw):
    samples = checked_map_samples(raw, robot)
    xy = [(s['x_m'], s['y_m']) for s in samples]
    start_error = math.dist(xy[0], bundle.centre(*plan['startCell']))
    goal_error = math.dist(xy[-1], bundle.centre(*plan['goalCell']))
    segments = list(zip(xy, xy[1:]))
    return {'status': 'checked', 'samples': len(samples), 'startErrorM': start_error, 'goalErrorM': goal_error,
            'endpointsMatch': max(start_error, goal_error) <= plan['endpointToleranceM'],
            'lengthMeters': sum(math.dist(a, b) for a, b in segments),
            'elapsedSeconds': (samples[-1]['timestamp_ns'] - samples[0]['timestamp_ns']) / 1e9,
            'staticMapConflict': any(not swept_disc_clear(bundle, a, b, robot.footprint_radius_m) for a, b in segments)}


def recording_binding(folder, plan, entry):
    sha = entry.get('recordingManifestSha256')
    if sha is None:
        return 'authored-fixture' if plan['basis'] == 'authored-synthetic' else 'missing'
    raw = read_bound(folder / 'recording-manifest.json', 32_000)
    if sha != digest(raw):
        raise ValueError('Recording manifest checksum changed.')
    try:
        manifest = json_strict(raw)
    except ValueError:
        return 'mismatch'
    profile = plan['robot']
    expected = {'schema': 'brainsnn.fleet-telemetry.v1', 'map_revision_sha256': plan['map']['revisionSha256'],
                'pgm_sha256': plan['map']['pgmSha256'], 'csv_sha256': entry['poseSha256'], 'pose_frame_id': 'map',
                'coordinate_convention': 'ROS-REP-103-ENU', 'source_type': plan['basis']}
    if not isinstance(manifest, dict) or any(manifest.get(k) != v for k, v in expected.items()):
        return 'mismatch'
    robot = manifest.get('robot')
    if (not isinstance(robot, dict) or robot.get('id') != profile['id']
            or type(robot.get('radius_m')) not in (int, float) or robot['radius_m'] != profile['radiusM']
            or type(robot.get('max_speed_m_s')) not in (int, float) or robot['max_speed_m_s'] != profile['maxSpeedMps']):
        return 'mismatch'
    return 'matched'


def report(trial, map_dir):
    trial = Path(trial)
    plan, plan_hash = load_plan(trial)
    bundle = load_nav2_map(map_dir)
    if map_identity(bundle) != plan['map']:
        raise ValueError('Map revision differs from the frozen trial plan.')
    profile = plan['robot']
    robot = Robot(profile['id'], number(profile['radiusM'], 'radius', .01, 5.),
                  number(profile['maxSpeedMps'], 'speed', .01, 15.))
    rows = []
    for i in range(1, plan['attempts'] + 1):
        folder = trial / f'attempt-{i:03d}'
        if not folder.exists():
            rows.append({'attempt': i, 'outcome': 'pending'})
            continue
        entry = read_attempt(folder, i, plan_hash)
        trace = {'status': 'missing'}
        if entry['poseSha256'] is not None:
            raw = read_bound(folder / 'poses.csv', MAX_CSV_BYTES)
            if digest(raw) != entry['poseSha256']:
                raise ValueError(f'Attempt {i} pose file checksum changed.')
            try:
                trace = compare_trace(bundle, plan, robot, raw)
            except (ValueError, OverflowError) as error:
                trace = {'status': 'unusable', 'reason': str(error)}
            trace['recordingBinding'] = recording_binding(folder, plan, entry)
        rows.append({**entry, 'trace': trace})
    digests = Counter(row.get('poseSha256') for row in rows if row.get('poseSha256'))
    for row in rows:
        trace = row.get('trace', {})
        row['duplicateTrace'] = digests[row.get('poseSha256')] > 1
        row['consistentReach'] = (row['outcome'] == 'reached-unassisted' and not row['duplicateTrace']
                                  and trace.get('recordingBinding') in ('matched', 'authored-fixture')
                                  and trace.get('endpointsMatch') is True and trace.get('staticMapConflict') is False)
    counts = Counter(row['outcome'] for row in rows)
    return {'schema': 'brainsnn.fleet-field-report.v1', 'planSha256': plan_hash, 'plan': plan, 'attempts': rows,
            'summary': {'scheduled': len(rows), 'reported': len(rows) - counts['pending'], 'pending': counts['pending'],
                        'reportedUnassistedReaches': counts['reached-unassisted'],
                        'consistentReaches': sum(row['consistentReach'] for row in rows),
                        'outcomes': {name: counts[name] for name in OUTCOMES}},
            'physicalRobotValidated': False, 'recordingAuthenticityVerified': False, 'surveyAccuracyValidated': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare')
    prep.add_argument('--map', type=Path, required=True)
    prep.add_argument('--out', type=Path, required=True)
    for key in ('start', 'goal'):
        prep.add_argument(f'--{key}-cell', type=int, nargs=2, required=True, metavar=('COL', 'ROW'))
    prep.add_argument('--robot-id', required=True)
    prep.add_argument('--radius-m', type=float, required=True)
    prep.add_argument('--max-speed-m-s', type=float, required=True)
    prep.add_argument('--tolerance-m', type=float, default=.25)
    prep.add_argument('--attempts', type=int, required=True)
    prep.add_argument('--basis', choices=BASES, required=True)
    rec = sub.add_parser('record')
    rec.add_argument('--trial', type=Path, required=True)
    rec.add_argument('--attempt', type=int, required=True)
    rec.add_argument('--outcome', choices=OUTCOMES, required=True)
    rec.add_argument('--reason', default='')
    rec.add_argument('--poses', type=Path)
    rec.add_argument('--recording-manifest', type=Path, help='Original telemetry manifest from the recording')
    score = sub.add_parser('report')
    score.add_argument('--trial', type=Path, required=True)
    score.add_argument('--map', type=Path, required=True)
    score.add_argument('--out', type=Path, required=True, help='Fresh report directory')
    args = parser.parse_args(argv)
    try:
        if args.command == 'prepare':
            result = prepare(args.map, args.out, start=args.start_cell, goal=args.goal_cell, robot_id=args.robot_id,
                             radius=args.radius_m, speed=args.max_speed_m_s, tolerance=args.tolerance_m,
                             attempts=args.attempts, basis=args.basis)['staticPlan']
        elif args.command == 'record':
            result = record(args.trial, args.attempt, args.outcome, poses=args.poses, reason=args.reason,
                            recording_manifest=args.recording_manifest)
        else:
            data = report(args.trial, args.map)
            publish(args.out, {'field-trial-report.json': encoded(data)})
            result = data['summary']
    except (ValueError, KeyError, OSError) as error:
        parser.exit(2, f'{error}\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
