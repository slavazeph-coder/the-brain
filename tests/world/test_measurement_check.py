"""Backend dimension comparisons on explicit synthetic geometry, never product/demo accuracy evidence."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics/world_worker'))
import measurement_check as mc  # noqa: E402


def cloud():
    return {'version': 1, 'kind': 'colmap-sparse-point-cloud', 'units': 'm',
            'coordinateFrame': 'right-handed-y-up', 'sourceFrame': 'colmap',
            'points': [[0, 0, 0, 10, 20, 30], [3, 0, 0, 40, 50, 60],
                       [3, 4, 0, 70, 80, 90], [0, 0, 2, 10, 20, 30]],
            'scale': {'source': 'user-measured', 'metresPerUnit': .5, 'distance': 3, 'spanUnits': 6,
                      'selfReported': True, 'verified': False},
            'floorEstimate': None, 'provenance': {'metricVerified': False},
            'fromSource': [[.5, 0, 0, 0], [0, -.5, 0, 0], [0, 0, -.5, 0]]}


def scene(c):
    return {'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': copy.deepcopy(c['scale']),
            'objects': [{'name': 'floor_observed', 'label': 'floor', 'centre': [2, -.01, 1.5], 'size': [4, .02, 3]},
                        {'name': 'object_1', 'label': 'sofa', 'centre': [2, .5, 1.5], 'size': [2, 1, 1], 'base': 'inferred'}],
            'walls': [{'name': 'wall_1', 'label': 'wall', 'centre': [2, 1.2, 0], 'size': [4, 2.4, .1]}]}


def check(id='reference-1', role='held-out', pair=(1, 2), distance=4):
    return {'id': id, 'label': 'Synthetic independent vertical span', 'role': role, 'pointIndices': list(pair),
            'distanceMeters': distance, 'uncertaintyMeters': .01, 'method': 'laser',
            'instrument': 'Test-only declared instrument', 'measuredOn': '2026-10-24', 'note': 'Synthetic fixture'}


def contract(c, rows=None):
    return {'schema': mc.INPUT_SCHEMA, 'cloudPointsSha256': mc.points_sha256(c),
            'coordinateFrame': 'right-handed-y-up', 'units': 'm',
            'tolerance': {'absoluteMeters': .05, 'relative': .02}, 'checks': rows or [check()]}


def test_hash_has_explicit_units_frame_order_and_float64_wire_format():
    c = cloud()
    encoded = b'brainsnn.dimension-points.v1\0right-handed-y-up\0m\0' + b''.join(struct.pack('<6d', *p) for p in c['points'])
    assert mc.points_sha256(c) == hashlib.sha256(encoded).hexdigest()
    for mutate in [lambda v: v['points'].reverse(), lambda v: v['points'][0].__setitem__(3, 11)]:
        other = copy.deepcopy(c)
        mutate(other)
        assert mc.points_sha256(other) != mc.points_sha256(c)


def test_held_out_distances_recomputed_without_mutating_geometry_or_scale():
    c = cloud()
    c['measurementChecks'] = contract(c, [check('cal', 'calibration', (0, 1), 4), check()])
    s = scene(c)
    original = copy.deepcopy((s, c))
    report = mc.build_report(s, c)
    assert report['status'] == 'within-requested-tolerance'
    assert report['metric_verified'] is False and report['certified'] is False
    assert report['statusScope'] == 'held-out-point-pairs-only'
    assert report['summary'] == {'calibrationCount': 1, 'calibrationWithinTolerance': 0, 'heldOutCount': 1, 'heldOutWithinTolerance': 1,
                                 'heldOutMaxAbsoluteErrorMeters': 0, 'heldOutMaxRelativeError': 0}
    assert report['checks'][0]['cloudDistanceMeters'] == 3
    assert report['checks'][0]['withinRequestedTolerance'] is False, 'a failing calibration record is excluded from held-out metrics'
    assert report['checks'][1]['cloudDistanceMeters'] == 4
    assert report['checks'][1]['requestedToleranceMeters'] == .08
    assert (s, c) == original
    sofa = next(item for item in report['dimensions'] if item['name'] == 'object_1')
    assert sofa['dimensionsMeters'] == {'length': 2, 'height': 1, 'width': 1}
    assert sofa['independentlyChecked'] is False and any('inferred' in note for note in sofa['notes'])
    assert all(item['basis'] == 'compiled-geometry' for item in report['dimensions'])


def test_bad_holdout_is_not_hidden_by_large_reading_uncertainty():
    c = cloud()
    reading = check(pair=(0, 2), distance=4.5)
    reading['uncertaintyMeters'] = 1
    c['measurementChecks'] = contract(c, [reading])
    report = mc.build_report(scene(c), c)
    assert report['status'] == 'outside-requested-tolerance'
    row = report['checks'][0]
    assert row['cloudDistanceMeters'] == 5 and row['absoluteErrorMeters'] == .5
    assert row['requestedToleranceMeters'] == pytest.approx(.09)
    assert row['uncertaintyMeters'] == 1 and row['withinRequestedTolerance'] is False


def test_absent_or_calibration_only_checks_never_imply_heldout_success():
    c = cloud()
    report = mc.build_report(scene(c), c)
    assert report['status'] == 'no-held-out' and report['tolerance'] is None and report['checks'] == []
    c['measurementChecks'] = contract(c, [check(role='calibration')])
    report = mc.build_report(scene(c), c)
    assert report['status'] == 'no-held-out' and report['summary']['heldOutCount'] == 0
    assert report['summary']['heldOutMaxAbsoluteErrorMeters'] is None


def test_changed_cloud_cannot_reuse_old_readings():
    c = cloud()
    refs = contract(c)
    c['points'][0][0] = .1
    with pytest.raises(ValueError, match='SHA-256'):
        mc.validate_checks(refs, c)


@pytest.mark.parametrize('mutate', [
    lambda refs: refs.update(extra=True),
    lambda refs: refs['tolerance'].update(extra=True),
    lambda refs: refs['tolerance'].update(absoluteMeters=float('nan')),
    lambda refs: refs['tolerance'].update(relative=True),
    lambda refs: refs['checks'][0].update(distanceMeters=True),
    lambda refs: refs['checks'][0].update(uncertaintyMeters=float('inf')),
    lambda refs: refs['checks'][0].update(pointIndices=[True, 2]),
    lambda refs: refs['checks'][0].update(pointIndices=[1.0, 2]),
    lambda refs: refs['checks'][0].update(pointIndices=[1, 999]),
    lambda refs: refs['checks'][0].update(pointIndices=[1, 1]),
    lambda refs: refs['checks'][0].update(method='vlm-estimate'),
    lambda refs: refs['checks'][0].update(measuredOn='2026-02-30'),
    lambda refs: refs['checks'][0].update(role='verified'),
    lambda refs: refs['checks'][0].update(extra=True),
    lambda refs: refs['checks'].append(check()),
    lambda refs: refs['checks'].append(check('other', 'calibration', (2, 1))),
])
def test_invalid_inputs_fail_closed(mutate):
    c = cloud()
    refs = contract(c)
    mutate(refs)
    with pytest.raises(ValueError):
        mc.validate_checks(refs, c)


def test_contract_and_cloud_have_resource_and_metric_bounds():
    c = cloud()
    refs = contract(c)
    refs['extra'] = 'x' * mc.MAX_CHECK_BYTES
    with pytest.raises(ValueError, match='64 KiB'):
        mc.validate_checks(refs, c)
    c['points'][0][3] = True
    with pytest.raises(ValueError):
        mc.points_sha256(c)
    c = cloud()
    c['points'][0][0] = float('nan')
    with pytest.raises(ValueError):
        mc.points_sha256(c)
    for field, value in [('units', 'arbitrary'), ('coordinateFrame', 'colmap')]:
        c = cloud()
        c[field] = value
        with pytest.raises(ValueError):
            mc.points_sha256(c)


def test_scene_scale_or_units_mismatch_is_rejected():
    c = cloud()
    s = scene(c)
    s['scale']['metresPerUnit'] = 2
    with pytest.raises(ValueError, match='scale provenance'):
        mc.build_report(s, c)
    s = scene(c)
    s['units'] = 'arbitrary'
    with pytest.raises(ValueError, match='metric scene'):
        mc.build_report(s, c)


def cli(*args):
    return subprocess.run([sys.executable, '-m', 'robotics.world_worker.measurement_check', *map(str, args)],
                          cwd=ROOT, text=True, capture_output=True)


def test_cli_fingerprints_binds_exact_inputs_and_refuses_overwrite_or_unscaled(tmp_path):
    c = cloud()
    cloud_path, scene_path, refs_path, out = (tmp_path / name for name in ['cloud.json', 'scene.json', 'checks.json', 'report.json'])
    cloud_path.write_text(json.dumps(c))
    scene_path.write_text(json.dumps(scene(c)))
    refs_path.write_text(json.dumps(contract(c)))
    result = cli('--fingerprint', cloud_path)
    assert result.returncode == 0 and result.stdout.strip() == mc.points_sha256(c), result.stderr
    result = cli('--cloud', cloud_path, '--scene', scene_path, '--checks', refs_path, '--out', out)
    assert result.returncode == 0, result.stderr
    report = json.loads(out.read_text())
    assert report['status'] == 'within-requested-tolerance'
    assert report['sourceFiles']['cloud']['sha256'] == hashlib.sha256(cloud_path.read_bytes()).hexdigest()
    assert cli('--cloud', cloud_path, '--scene', scene_path, '--out', out).returncode != 0
    c['units'], c['scale'] = 'arbitrary', None
    cloud_path.write_text(json.dumps(c))
    assert cli('--fingerprint', cloud_path).returncode != 0
    assert cli('--cloud', cloud_path, '--scene', scene_path, '--out', tmp_path / 'unscaled.json').returncode != 0
    assert not (tmp_path / 'unscaled.json').exists()


def test_cli_rejects_changed_fingerprint_before_writing_report(tmp_path):
    c = cloud()
    refs = contract(c)
    c['points'][0][0] = .1
    cloud_path, scene_path, refs_path = (tmp_path / name for name in ['cloud.json', 'scene.json', 'checks.json'])
    for path, value in [(cloud_path, c), (scene_path, scene(c)), (refs_path, refs)]:
        path.write_text(json.dumps(value))
    out = tmp_path / 'report.json'
    result = cli('--cloud', cloud_path, '--scene', scene_path, '--checks', refs_path, '--out', out)
    assert result.returncode != 0 and 'SHA-256' in result.stderr and not out.exists()
