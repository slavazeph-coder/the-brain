"""Authored geometry regressions; these are not physical capture accuracy tests."""
import copy
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import sys

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import component_fit as cf


def encoded(value):
    return json.dumps(value, indent=1, allow_nan=False).encode()


@pytest.fixture(scope='module')
def capture():
    rng = random.Random(32)
    theta = math.radians(23)
    points = [[rng.uniform(-3, 3), rng.gauss(0, .002), rng.uniform(-3, 3), 100, 100, 100]
              for _ in range(900)]
    for _ in range(1600):
        along, noise = rng.uniform(-2.5, 2.5), rng.gauss(0, .012)
        points.append([along * math.cos(theta) - noise * math.sin(theta), rng.uniform(.06, 2.7),
                       -2 + along * math.sin(theta) + noise * math.cos(theta), 180, 180, 180])
    cloud = {'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'points': points,
             'floorEstimate': {'y': 0.}, 'scale': {'source': 'user-measured', 'metresPerUnit': 1., 'verified': False},
             'multiView': True, 'fromSource': [[1., 0, 0, 0], [0, 1., 0, 0], [0, 0, 1., 0]]}
    margin, walls, _rest, _objects = cf.ce.sc.analyse(points, 0., True)
    assert len(walls) == 1
    wall = {'name': 'wall_1', 'label': 'wall', 'provenance': 'observed', **cf.ce._box(walls[0]),
            'support_points': walls[0]['support'], 'faceCentre': copy.deepcopy(walls[0]['face']),
            'thicknessBasis': 'assumed 0.1 m: one face seen'}
    floor = {'name': 'floor_observed', 'label': 'floor', 'provenance': 'observed', **cf.ce._floor_box(points, 0.)}
    scene = {'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': copy.deepcopy(cloud['scale']),
             'floor_y': 0., 'walls': [wall], 'objects': [floor], 'openings': [], 'unknown': [[2, 2, .5]],
             'cloudPointsSha256': cf.ce.points_sha256(cloud)}
    return cf.ce.cg.attach_component_ids(scene, cf.ce.points_sha256(cloud)), cloud, walls[0]


def build(scene, cloud, **kwargs):
    return cf.build_component_fit(scene, cloud, scene_bytes=encoded(scene), cloud_bytes=encoded(cloud), views=[], **kwargs)


def row(report, kind):
    return next(item for item in report['components'] if item['kind'] == kind)


def test_report_binds_exact_sources_revision_and_never_changes_inputs(capture):
    scene, cloud, _fit = capture
    original_scene, original_cloud = copy.deepcopy(scene), copy.deepcopy(cloud)
    result = build(scene, cloud)
    assert result['schema'] == 'brainsnn.component-fit.v1'
    assert result['sourceFiles']['scene']['sha256'] == hashlib.sha256(encoded(scene)).hexdigest()
    assert result['sourceFiles']['cloud']['sha256'] == hashlib.sha256(encoded(cloud)).hexdigest()
    assert result['sourcePointsSha256'] == cf.ce.points_sha256(cloud)
    assert result['componentGraph']['revision'] == 0
    assert result['geometryChanged'] is result['scaleChanged'] is result['metricVerified'] is False
    assert result['independentAccuracyValidated'] is result['physicalRobotValidated'] is False
    assert scene == original_scene and cloud == original_cloud
    assert json.loads(json.dumps(result, allow_nan=False)) == result


def test_full_source_memberships_are_used_instead_of_the_256_index_sample(capture):
    scene, cloud, fit = capture
    result = build(scene, cloud)
    wall = row(result, 'wall')
    assert wall['supportCount'] == fit['support'] > 256
    assert wall['residuals']['pointCount'] == fit['support']
    assert wall['residuals']['allPointsIncluded'] is True
    assert wall['residuals']['medianMeters'] < .02
    assert wall['residuals']['p95Meters'] < .05
    assert wall['supportBasis'] == 'original-compiler-wall-fit'


def test_no_points_are_filtered_out_of_reported_residuals():
    result = cf._stats([.001] * 95 + [.3, .4, .5, .6, .7])
    assert result['pointCount'] == 100 and result['maxMeters'] == .7
    assert result['rmsMeters'] > .1
    assert result['outsideReviewBandFraction'] == .05


def test_plane_consensus_resists_outliers_but_reports_them():
    rng = np.random.default_rng(4)
    points = np.stack([rng.uniform(-3, 3, 1000), rng.uniform(0, 3, 1000), rng.normal(-2, .004, 1000)], axis=1)
    points = np.concatenate([points, rng.uniform(-8, 8, (250, 3))])
    result = cf._robust_plane(points, vertical=True)
    assert result is not None
    assert abs(float(result['normal'][2])) > .999
    assert abs(abs(result['offset']) - 2) < .002
    assert result['residuals']['pointCount'] == 1250
    assert result['residuals']['maxMeters'] > 2
    assert .79 <= result['inlierFraction'] <= .82
    again = cf._robust_plane(points, vertical=True)
    assert result['offset'] == again['offset'] and np.array_equal(result['normal'], again['normal'])


def test_tilted_floor_is_diagnostic_and_degenerate_plane_is_not_invented():
    points = np.array([[x, .04 * x + .03 * z + .2, z] for x in np.linspace(-2, 2, 20) for z in np.linspace(-2, 2, 20)])
    plane = cf._robust_plane(points)
    assert plane is not None
    assert plane['residuals']['maxMeters'] < 1e-12
    assert math.degrees(math.acos(abs(float(plane['normal'][1])))) == pytest.approx(math.degrees(math.atan(.05)), abs=1e-6)
    assert cf._robust_plane(np.array([[float(x), 0, 0] for x in range(100)])) is None
    assert cf._robust_plane(np.zeros((100, 3))) is None
    assert cf._robust_plane(points[:10]) is None


def test_floor_footprint_is_not_misrepresented_as_complete_or_measured_thickness(capture):
    scene, cloud, _fit = capture
    floor = row(build(scene, cloud), 'floor')
    assert floor['sampledCellOccupancy']['visibilityValidated'] is False
    assert 'full slab footprint' in floor['scope'] and 'thickness' in floor['scope']
    item = {'centre': [0., -.01, 0.], 'size': [10., .02, 10.]}
    points = np.array([[x, 0., z] for x in [-5., 5.] for z in [-5., 5.]])
    occupancy = cf._cell_occupancy(item, 'floor', points)
    assert occupancy['cellsWithMemberPoints'] == 4
    assert occupancy['sampledCellFraction'] == 4 / 1600


def test_zero_distance_floor_line_cannot_claim_planar_support():
    points = [[x / 10, 0., 0., 100, 100, 100] for x in range(100)]
    cloud = {'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'points': points,
             'floorEstimate': {'y': 0.}, 'scale': {'source': 'user-measured', 'verified': False}}
    floor = {'name': 'floor_observed', 'label': 'floor', 'provenance': 'observed', **cf.ce._floor_box(points, 0.)}
    scene = cf.ce.cg.attach_component_ids({'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': cloud['scale'],
        'floor_y': 0., 'walls': [], 'objects': [floor], 'openings': [], 'unknown': [],
        'cloudPointsSha256': cf.ce.points_sha256(cloud)}, cf.ce.points_sha256(cloud))
    result = build(scene, cloud)
    floor_row = row(result, 'floor')
    assert floor_row['residuals']['medianMeters'] < .01
    assert floor_row['planeStatus'] == 'unavailable' and floor_row['status'] == 'needs-review'
    assert any(request['code'] == 'floor-plane-insufficient-support' for request in result['recaptureRequests'])


def test_missing_camera_ledger_requests_retained_views_without_erasing_source_support(capture):
    scene, cloud, _fit = capture
    result = build(scene, cloud)
    assert row(result, 'wall')['supportCount'] > 256 and row(result, 'wall')['frames'] == []
    assert any(request['code'] == 'missing-supporting-frames' for request in result['recaptureRequests'])
    assert any(request['code'] == 'unknown-space' for request in result['recaptureRequests'])
    assert all(request['cameraPoseSuggested'] is False for request in result['recaptureRequests'])


def test_bound_evidence_must_match_recomputed_memberships_and_exact_bytes(capture):
    scene, cloud, _fit = capture
    evidence = cf.ce.build_component_evidence(scene, cloud, scene_bytes=encoded(scene), cloud_bytes=encoded(cloud), views=[])
    result = build(scene, cloud, component_evidence=evidence, evidence_bytes=encoded(evidence))
    assert result['componentEvidenceSha256'] == hashlib.sha256(encoded(evidence)).hexdigest()
    altered = copy.deepcopy(evidence)
    row(altered, 'wall')['sampledPointIndices'][0] = 0
    with pytest.raises(ValueError, match='stale|recomputed'):
        build(scene, cloud, component_evidence=altered, evidence_bytes=encoded(altered))
    with pytest.raises(ValueError, match='bytes do not match'):
        build(scene, cloud, component_evidence=altered, evidence_bytes=encoded(evidence))
    with pytest.raises(ValueError, match='both parsed'):
        build(scene, cloud, component_evidence=evidence)


def test_stale_cloud_scene_graph_or_raw_json_are_rejected(capture):
    scene, cloud, _fit = capture
    altered = copy.deepcopy(cloud)
    altered['points'][0][0] += .001
    with pytest.raises(ValueError, match='exact ordered cloud'):
        build(scene, altered)
    altered = copy.deepcopy(scene)
    altered['walls'][0]['centre'][0] += .01
    with pytest.raises(ValueError, match='controlled edit'):
        build(altered, cloud)
    with pytest.raises(ValueError, match='bytes do not match'):
        cf.build_component_fit(scene, cloud, scene_bytes=encoded({**scene, 'floor_y': False}), cloud_bytes=encoded(cloud), views=[])
    with pytest.raises(ValueError, match='Duplicate JSON'):
        cf.build_component_fit(scene, cloud, scene_bytes=b'{"units":"m","units":"m"}', cloud_bytes=encoded(cloud), views=[])


def test_operator_authored_wall_is_compared_but_cannot_inherit_observation_claim_or_candidate(capture):
    scene, cloud, _fit = capture
    theta = math.radians(scene['walls'][0]['yaw_degrees'])
    edit = {'op': 'wall', 'componentId': scene['walls'][0]['componentId'],
            'translationMeters': [-.3 * math.sin(theta), 0., .3 * math.cos(theta)]}
    changed = cf.ce.cg.apply_edits(scene, {'schema': cf.ce.cg.EDIT_SCHEMA,
        'sourceSha256': scene['componentGraph']['sourceSha256'], 'sceneSha256': cf.ce.cg.scene_sha256(scene),
        'revision': 0, 'edits': [edit]})
    report = build(changed, cloud)
    wall = row(report, 'wall')
    assert report['componentGraph']['revision'] == 1
    assert wall['status'] == 'evaluated-authored' and wall['sourceObservationClaim'] is False
    assert wall['residuals']['medianMeters'] > .15
    assert wall['candidate'] is None
    assert wall['supportBasis'] == 'original-compiler-membership-evaluated-against-authored-geometry'


def test_reviewed_openings_remain_unobserved_and_request_jamb_lintel_threshold_capture(capture):
    scene, cloud, _fit = capture
    legacy = {key: copy.deepcopy(value) for key, value in scene.items() if key != 'componentGraph'}
    for field in ('walls', 'objects'):
        for item in legacy[field]:
            item.pop('componentId', None)
    legacy['openings'] = [{'id': 'entry', 'hostWall': 'wall_1', 'offsetMeters': 1., 'widthMeters': 1.,
        'heightMeters': 2.1, 'sillMeters': 0., 'kind': 'door', 'reviewed': True}]
    identified = cf.ce.cg.attach_component_ids(legacy, cf.ce.points_sha256(cloud))
    report = build(identified, cloud)
    for kind in ('opening', 'door'):
        entry = row(report, kind)
        assert entry['status'] == 'unsupported' and entry['residuals'] is None and entry['candidate'] is None
    assert sum(request['code'] == 'opening-needs-observation' for request in report['recaptureRequests']) == 2


@pytest.mark.parametrize('yaw', [0, 23, -67, 120])
def test_reviewable_wall_correction_preserves_dimensions_and_places_box_behind_seen_face(yaw):
    rng = np.random.default_rng(12)
    angle = math.radians(yaw)
    tangent = np.array([math.cos(angle), 0., math.sin(angle)])
    normal = np.array([-math.sin(angle), 0., math.cos(angle)])
    face = np.array([1., 1.4, -2.])
    points = face + rng.uniform(-2.4, 2.4, (1500, 1)) * tangent + rng.normal(0, .003, (1500, 1)) * normal
    points[:, 1] = rng.uniform(.1, 2.7, 1500)
    # The fixture's box is 6 cm off its observed face, with 0.1 m assumed thickness behind that face.
    item = {'name': 'wall_1', 'label': 'wall', 'provenance': 'observed',
            'centre': (face - .05 * normal + .06 * normal).tolist(), 'size': [5., 2.8, .1], 'yaw_degrees': yaw}
    scene = cf.ce.cg.attach_component_ids({'schema': 'brainsnn.scene.v1', 'units': 'm', 'walls': [item],
        'objects': [], 'openings': [], 'unknown': [], 'floor_y': 0.}, 'c' * 64)
    item = scene['walls'][0]
    # The original observation face corresponding to this box's placement convention.
    fit = {'face': (np.asarray(item['centre']) + .05 * normal)[[0, 2]].tolist()}
    before = cf._stats(cf._surface_distances(scene, item, 'wall', points))
    result = cf._wall_candidate(scene, item, fit, points, before)
    assert result['status'] == 'review-required'
    assert result['geometry']['size'] == item['size']
    assert result['after']['medianMeters'] < .003 and result['after']['p95Meters'] < before['p95Meters']
    proposed = np.asarray(result['geometry']['centre'])
    assert float((proposed - face) @ normal) == pytest.approx(-.05, abs=.001)
    assert result['suggestedEdit']['translationMeters'][1] == 0
    assert 'sizeMeters' not in result['suggestedEdit']
    assert item['centre'] != result['geometry']['centre']


def test_multi_face_thickness_proxy_does_not_get_single_face_refinement(capture):
    scene, _cloud, fit = capture
    result = cf._wall_candidate(scene, scene['walls'][0], {**fit, 'face': None}, np.zeros((20, 3)), {})
    assert result['status'] == 'unavailable'
    assert 'suggestedEdit' not in result


@pytest.mark.parametrize('offset,yaw', [(.4, 0.), (0., 12.)])
def test_large_registration_corrections_are_diagnostic_without_an_acceptable_edit(offset, yaw):
    rng = np.random.default_rng(12)
    points = np.stack([rng.uniform(-2, 2, 800), rng.uniform(.1, 2.7, 800), rng.normal(0, .002, 800)], axis=1)
    theta = math.radians(yaw)
    normal = np.array([-math.sin(theta), 0., math.cos(theta)])
    centre = np.array([0., 1.4, offset]) - .05 * normal
    item = {'name': 'wall_1', 'label': 'wall', 'provenance': 'observed', 'centre': centre.tolist(),
            'size': [5., 2.8, .1], 'yaw_degrees': yaw}
    scene = cf.ce.cg.attach_component_ids({'schema': 'brainsnn.scene.v1', 'units': 'm', 'walls': [item],
        'objects': [], 'openings': [], 'unknown': [], 'floor_y': 0.}, 'e' * 64)
    item = scene['walls'][0]
    fit = {'face': (centre + .05 * normal)[[0, 2]].tolist()}
    before = cf._stats(cf._surface_distances(scene, item, 'wall', points))
    result = cf._wall_candidate(scene, item, fit, points, before)
    assert result['status'] == 'unavailable' and 'suggestedEdit' not in result
    assert 'review limit' in result['reason']


def test_wall_residuals_ignore_other_hosts_and_never_use_an_authored_door_leaf():
    wall = {'name': 'wall_1', 'label': 'wall', 'centre': [0., 1.5, 0.], 'size': [4., 3., .1], 'yaw_degrees': 0}
    other = {**wall, 'name': 'wall_2', 'centre': [0., 1.5, 5.]}
    door = {'id': 'entry', 'hostWall': 'wall_2', 'offsetMeters': 1., 'widthMeters': 2.,
            'heightMeters': 2., 'sillMeters': 0., 'kind': 'door'}
    scene = {'walls': [wall, other], 'objects': [], 'openings': [door]}
    assert cf._surface_distances(scene, wall, 'wall', [[0., 1., .05]])[0] == pytest.approx(0)
    # This point would be explained by the authored 5 cm reference leaf, but
    # it is one metre from the nearest exposed wall jamb/lintel.
    door['hostWall'] = 'wall_1'
    assert cf._surface_distances(scene, wall, 'wall', [[0., 1., .025]])[0] == pytest.approx(1.)


def test_writer_and_cli_bind_actual_names_and_preserve_sources(capture, tmp_path):
    scene, cloud, _fit = capture
    scene_path, cloud_path = tmp_path / 'retained-scene.json', tmp_path / 'arena-cloud.json'
    scene_path.write_bytes(encoded(scene)); cloud_path.write_bytes(encoded(cloud))
    evidence = cf.ce.write_component_evidence(tmp_path, scene, cloud, scene_path=scene_path, cloud_path=cloud_path, views=[])
    result = cf.write_component_fit(tmp_path, scene, cloud, scene_path=scene_path, cloud_path=cloud_path,
                                    evidence_path=tmp_path / 'component-evidence.json', views=[])
    assert result['sourceFiles']['scene']['name'] == scene_path.name
    assert result['sourceFiles']['cloud']['name'] == cloud_path.name
    assert result['componentEvidenceSha256'] == hashlib.sha256((tmp_path / 'component-evidence.json').read_bytes()).hexdigest()
    assert scene_path.read_bytes() == encoded(scene) and cloud_path.read_bytes() == encoded(cloud)
    target = tmp_path / 'cli'
    process = subprocess.run([sys.executable, str(ROOT / 'robotics/world_worker/component_fit.py'), '--scene', str(scene_path),
        '--cloud', str(cloud_path), '--out', str(target)], capture_output=True, text=True)
    assert process.returncode == 0, process.stderr
    assert json.loads(process.stdout)['metricVerified'] is False
    assert (target / 'component-fit.json').is_file()


def test_nonmetric_inputs_are_refused(capture):
    scene, cloud, _fit = capture
    with pytest.raises(ValueError, match='metres|metric'):
        build({**scene, 'units': 'arbitrary'}, {**cloud, 'units': 'arbitrary'})
