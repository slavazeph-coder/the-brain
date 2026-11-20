"""An authored map and pose logs exercise offline evidence accounting."""
import csv
from io import StringIO
import json

import pytest

from robotics.world_worker import fleet_field_trial as field
from robotics.world_worker.fleet_campaign import _write_nav2_fixture
from robotics.world_worker.fleet_learning import GridScene
from robotics.world_worker.fleet_nav2 import CSV_COLUMNS, load_nav2_map


@pytest.fixture
def inputs(tmp_path):
    map_dir, trial = tmp_path / 'map', tmp_path / 'trial'
    rows = ('#########', '#.......#', '#...?...#', '#.......#', '#########')
    _write_nav2_fixture(map_dir, GridScene(rows, .4), 'field-test')
    args = dict(start=(1, 2), goal=(7, 2), robot_id='fixture', radius=.10, speed=.8, tolerance=.12,
                attempts=5, basis='authored-synthetic')
    field.prepare(map_dir, trial, **args)
    return map_dir, trial, args


def trace(map_dir, path, cells, *, step_ns=1_000_000_000, frame='map'):
    bundle = load_nav2_map(map_dir)
    stream = StringIO()
    w = csv.writer(stream)
    w.writerow(CSV_COLUMNS)
    for i, cell in enumerate(cells):
        w.writerow([i * step_ns, *bundle.centre(*cell), 0, .4, 0, .02, frame])
    path.write_text(stream.getvalue())
    return path


SAFE = [(1, 2), (2, 2), (3, 1), (4, 1), (5, 1), (6, 2), (7, 2)]


def test_keeps_negative_missing_and_pending_attempts_in_denominator(inputs, tmp_path):
    map_dir, trial, _ = inputs
    path = trace(map_dir, tmp_path / 'good.csv', SAFE)
    field.record(trial, 1, 'reached-unassisted', poses=path)
    field.record(trial, 2, 'contact', reason='Operator recorded wheel contact.')
    bad = trace(map_dir, tmp_path / 'bad.csv', SAFE, frame='odom')
    field.record(trial, 3, 'localization-lost', poses=bad, reason='Map transform dropped.')
    field.record(trial, 4, 'reached-unassisted')
    data = field.report(trial, map_dir)
    s = data['summary']
    assert s['scheduled'] == 5 and s['reported'] == 4 and s['pending'] == 1
    assert s['reportedUnassistedReaches'] == 2 and s['consistentReaches'] == 1
    assert s['outcomes']['contact'] == s['outcomes']['localization-lost'] == 1
    assert data['attempts'][0]['trace']['elapsedSeconds'] == 6
    assert data['attempts'][0]['trace']['startErrorM'] == data['attempts'][0]['trace']['goalErrorM'] == 0
    assert data['attempts'][2]['trace']['status'] == 'unusable' and data['attempts'][3]['trace']['status'] == 'missing'
    assert data['plan']['staticPlan']['status'] == 'planned'
    assert data['plan']['basis'] == 'authored-synthetic' and data['plan']['map']['scaleBasis'] == 'authored-synthetic-meters'
    assert not data['recordingAuthenticityVerified'] and not data['physicalRobotValidated'] and not data['surveyAccuracyValidated']


def test_reused_logs_do_not_support_either_attempt_and_pending_remains_visible(inputs, tmp_path):
    map_dir, trial, _ = inputs
    path = trace(map_dir, tmp_path / 'duplicate.csv', SAFE)
    for i in (1, 2):
        field.record(trial, i, 'reached-unassisted', poses=path)
    result = field.report(trial, map_dir)
    assert all(r['duplicateTrace'] for r in result['attempts'][:2])
    assert result['summary']['consistentReaches'] == 0 and result['summary']['pending'] == 3
    with pytest.raises(FileExistsError):
        field.record(trial, 1, 'timeout', reason='Replacement')
    with pytest.raises(ValueError, match='attempt'):
        field.record(trial, 6, 'timeout', reason='Outside plan')


@pytest.mark.parametrize('mode', ['unknown', 'wrong-goal', 'gap', 'jump'])
def test_bad_pose_evidence_preserves_operator_outcome(inputs, tmp_path, mode):
    map_dir, trial, _ = inputs
    cells = [(x, 2) for x in range(1, 8)] if mode == 'unknown' else SAFE
    path = trace(map_dir, tmp_path / 'trace.csv', cells[:-2] if mode == 'wrong-goal' else cells,
                 step_ns={'gap': 3_000_000_000, 'jump': 10_000_000}.get(mode, 1_000_000_000))
    field.record(trial, 1, 'reached-unassisted', poses=path)
    row = field.report(trial, map_dir)['attempts'][0]
    assert row['outcome'] == 'reached-unassisted' and row['consistentReach'] is False
    if mode == 'unknown':
        assert row['trace']['endpointsMatch'] and row['trace']['staticMapConflict']
    elif mode == 'wrong-goal':
        assert row['trace']['endpointsMatch'] is False
    else:
        assert row['trace']['status'] == 'unusable'


def test_map_revision_plan_binding_and_csv_integrity(inputs, tmp_path):
    map_dir, trial, _ = inputs
    path = trace(map_dir, tmp_path / 'trace.csv', SAFE)
    field.record(trial, 1, 'reached-unassisted', poses=path)
    plan = trial / 'plan.json'
    before = plan.read_bytes()
    plan.write_bytes(before + b'\n')
    with pytest.raises(ValueError, match='frozen plan'):
        field.report(trial, map_dir)
    plan.write_bytes(before)
    (trial / 'attempt-001/poses.csv').write_bytes(b'changed')
    with pytest.raises(ValueError, match='checksum'):
        field.report(trial, map_dir)
    manifest = map_dir / 'nav2-map.json'
    manifest.write_bytes(manifest.read_bytes() + b'\n')
    with pytest.raises(ValueError, match='Map revision'):
        field.report(trial, map_dir)


@pytest.mark.parametrize('variant', ['matched', 'missing', 'wrong-map', 'wrong-csv', 'wrong-robot', 'malformed', 'wrong-basis'])
def test_operator_recording_requires_original_map_robot_and_log_binding(inputs, tmp_path, variant):
    map_dir, _, args = inputs
    trial = tmp_path / 'operator'
    plan = field.prepare(map_dir, trial, **{**args, 'basis': 'operator-reported-recording'})
    path = trace(map_dir, tmp_path / 'recording.csv', SAFE)
    metadata = {'schema': 'brainsnn.fleet-telemetry.v1', 'map_revision_sha256': plan['map']['revisionSha256'],
                'pgm_sha256': plan['map']['pgmSha256'], 'csv_sha256': field.digest(path.read_bytes()),
                'source_type': 'operator-reported-recording', 'pose_frame_id': 'map', 'coordinate_convention': 'ROS-REP-103-ENU',
                'robot': {'id': args['robot_id'], 'radius_m': args['radius'], 'max_speed_m_s': args['speed']}}
    if variant == 'wrong-map':
        metadata['map_revision_sha256'] = '0' * 64
    if variant == 'wrong-csv':
        metadata['csv_sha256'] = '1' * 64
    if variant == 'wrong-robot':
        metadata['robot']['id'] = 'other'
    if variant == 'wrong-basis':
        metadata['source_type'] = 'authored-synthetic'
    manifest = tmp_path / 'recording.json'
    manifest.write_text(json.dumps(metadata) if variant != 'malformed' else '{')
    field.record(trial, 1, 'reached-unassisted', poses=path, recording_manifest=None if variant == 'missing' else manifest)
    result = field.report(trial, map_dir)
    row = result['attempts'][0]
    assert row['outcome'] == 'reached-unassisted' and row['trace']['endpointsMatch']
    assert row['consistentReach'] == (variant == 'matched')
    assert row['trace']['recordingBinding'] == (variant if variant in ('matched', 'missing') else 'mismatch')
    assert not result['physicalRobotValidated']
    if variant == 'matched':
        (trial / 'attempt-001/recording-manifest.json').write_text('changed')
        with pytest.raises(ValueError, match='manifest checksum'):
            field.report(trial, map_dir)


def test_no_static_route_and_local_record_cli(inputs, tmp_path):
    map_dir, _, args = inputs
    trial, output = tmp_path / 'closed', tmp_path / 'report'
    plan = field.prepare(map_dir, trial, **{**args, 'goal': (4, 2)})
    assert plan['staticPlan']['status'] == 'unavailable'
    field.main(['record', '--trial', str(trial), '--attempt', '2', '--outcome', 'stopped', '--reason', 'Operator stop.'])
    field.main(['report', '--trial', str(trial), '--map', str(map_dir), '--out', str(output)])
    assert json.loads((output / 'field-trial-report.json').read_text())['summary']['pending'] == 4
    with pytest.raises(ValueError, match='disjoint'):
        field.prepare(map_dir, tmp_path / 'invalid', **{**args, 'goal': args['start']})
    with pytest.raises(ValueError, match='reason'):
        field.record(trial, 4, 'intervention')
