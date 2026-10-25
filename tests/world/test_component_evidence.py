"""Synthetic source memberships and ledger projections, without images or model calls."""
import copy
import hashlib
import json
import math
from pathlib import Path
import random
import sys

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import component_evidence as ce


def encoded(value):
    return json.dumps(value, indent=1, allow_nan=False).encode()


def report(scene, cloud, **overrides):
    return ce.build_component_evidence(scene, cloud, scene_bytes=encoded(scene), cloud_bytes=encoded(cloud), **overrides)


@pytest.fixture(scope='module')
def capture():
    rng = random.Random(11); points = []
    for _ in range(1000):
        points.append([rng.uniform(-2.5, 2.5), rng.gauss(0, .003), rng.uniform(-2.5, 2.5), 90, 80, 70])
    for _ in range(1400):
        points.append([rng.uniform(-2, 2), rng.uniform(.06, 2.5), -2 + rng.gauss(0, .005), 180, 180, 180])
    for _ in range(1000):
        x, y, z = rng.uniform(-.4, .4), rng.uniform(0, 1), rng.uniform(-.3, .3)
        face = rng.randrange(3)
        if face == 0: x = rng.choice((-.4, .4))
        elif face == 1: z = rng.choice((-.3, .3))
        else: y = 1
        points.append([.5 + x, y, .5 + z, 120, 60, 30])
    cloud = {'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'points': points, 'floorEstimate': {'y': 0.0},
             'scale': {'source': 'user-measured', 'metresPerUnit': 1., 'selfReported': True, 'verified': False},
             'fromSource': [[1., 0, 0, 0], [0, 1., 0, 0], [0, 0, 1., 0]], 'multiView': True}
    floor = ce.sc.floor_plane(points, cloud['floorEstimate'])
    margin, walls, _rest, objects = ce.sc.analyse(points, floor, True)
    assert len(walls) == 1 and len(objects) == 1
    def component(fit, name, kind=None):
        item = {'name': name, 'label': 'wall' if name.startswith('wall') else 'object', 'provenance': 'observed',
                'centre': [fit['centre'][0], (fit['y0'] + fit['y1']) / 2, fit['centre'][1]],
                'size': [fit['length'], fit['y1'] - fit['y0'], fit['thickness']],
                'yaw_degrees': math.degrees(fit['yaw']), 'support_points': fit['support']}
        if kind: item['kind'] = kind
        return item
    x0, x1 = (ce.sc.percentile([p[0] for p in points], q) for q in (.02, .98))
    z0, z1 = (ce.sc.percentile([p[2] for p in points], q) for q in (.02, .98))
    floor_item = {'name': 'floor_observed', 'label': 'floor', 'provenance': 'observed',
                  'centre': [(x0 + x1) / 2, -.01, (z0 + z1) / 2], 'size': [x1 - x0, .02, z1 - z0],
                  'min': [x0, -.02, z0], 'max': [x1, 0., z1]}
    scene = {'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': copy.deepcopy(cloud['scale']), 'floor_y': floor,
             'walls': [component(walls[0], 'wall_1')], 'objects': [floor_item, component(objects[0], 'object_1', 'separated')],
             'unknown': [[2, 2, .5]], 'cloudPointsSha256': ce.points_sha256(cloud)}
    return cloud, scene, margin, walls, objects


def identified(capture):
    cloud, scene, *_ = capture
    return copy.deepcopy(cloud), ce.cg.attach_component_ids(scene, ce.points_sha256(cloud))


def camera(identifier, at, target):
    at, target = np.asarray(at, float), np.asarray(target, float)
    forward = (target - at) / np.linalg.norm(target - at)
    right = np.cross(forward, [0, 1, 0]); right /= np.linalg.norm(right)
    down = np.cross(forward, right); rotation = np.stack([right, down, forward])
    return {'name': identifier, 'path': '/private/never-publish/capture.png', 'width': 640, 'height': 480,
            'cam_from_world': np.hstack([rotation, (-rotation @ at)[:, None]]),
            'project': lambda p: np.stack([500 * p[:, 0] / p[:, 2] + 320, 500 * p[:, 1] / p[:, 2] + 240], 1),
            'frame_id': identifier, 'image_sha256': 'c' * 64, 'ledger_sha256': 'd' * 64,
            'source_cloud_sha256': 'e' * 64, 'source_cloud_name': 'output/points.ply',
            'source_cloud_coordinate_frame': 'reconstruction-world'}


@pytest.fixture
def views():
    return [camera('frame-1', [.5, 1.5, 4], [.5, .5, .5]), camera('frame-2', [3, 1.5, 3], [.5, .5, .5])]


def test_exact_compiler_geometry_recomputes_full_membership_and_only_samples_output(capture):
    cloud, scene = identified(capture); before_cloud, before_scene = copy.deepcopy(cloud), copy.deepcopy(scene)
    result = report(scene, cloud, views=[])
    by_name = {item['name']: item for item in result['components']}
    wall, obj, floor = by_name['wall_1'], by_name['object_1'], by_name['floor_observed']
    assert wall['supportCount'] == len(capture[3][0]['members'])
    assert obj['supportCount'] == len(capture[4][0]['members'])
    assert set(wall['sampledPointIndices']) <= set(capture[3][0]['members'])
    assert set(obj['sampledPointIndices']) <= set(capture[4][0]['members'])
    assert floor['supportCount'] == sum(abs(point[1]) <= capture[2] for point in cloud['points'])
    assert all(abs(cloud['points'][index][1]) <= capture[2] for index in floor['sampledPointIndices'])
    assert wall['supportCount'] > 256 and len(wall['sampledPointIndices']) == 256
    assert wall['sampledPointIndices'] == sorted(set(wall['sampledPointIndices']))
    assert result['sourcePointsSha256'] == ce.points_sha256(cloud)
    assert result['sourceFiles']['scene']['sha256'] == hashlib.sha256(encoded(scene)).hexdigest()
    assert result['metricVerified'] is result['independentAccuracyValidated'] is False
    assert scene == before_scene and cloud == before_cloud


def test_only_cross_runtime_roundoff_is_allowed_in_compiler_fit_matching(capture):
    cloud, original, *_ = capture
    scene = copy.deepcopy(original)
    scene['walls'][0]['centre'][0] += 4.44e-16
    scene['walls'][0]['yaw_degrees'] += 2.84e-14
    scene = ce.cg.attach_component_ids(scene, ce.points_sha256(cloud))
    result = report(scene, cloud, views=[])
    assert next(item for item in result['components'] if item['name'] == 'wall_1')['status'] == 'source-membership'
    assert result['membershipGeometryComparison']['absoluteSceneUnits'] == 1e-10
    moved = copy.deepcopy(original); moved['walls'][0]['centre'][0] += 1e-7
    moved = ce.cg.attach_component_ids(moved, ce.points_sha256(cloud))
    rejected = report(moved, cloud, views=[])
    assert next(item for item in rejected['components'] if item['name'] == 'wall_1')['status'] == 'unsupported'


def test_injected_ledger_views_return_only_ids_hashes_and_projected_boxes(capture, views, monkeypatch):
    cloud, scene = identified(capture)
    monkeypatch.setattr(ce.names, 'crop', lambda *_: pytest.fail('No images may be cropped or read.'))
    monkeypatch.setattr(ce.names, 'ask', lambda *_: pytest.fail('No model service may be called.'))
    result = report(scene, cloud, views=views)
    assert result['projection']['status'] == 'available'
    obj = next(item for item in result['components'] if item['name'] == 'object_1')
    assert obj['frames'] and len(obj['frames']) <= 2
    for frame in obj['frames']:
        assert frame['frameId'] in {'frame-1', 'frame-2'}
        assert frame['imageSha256'] == 'c' * 64 and frame['ledgerSha256'] == 'd' * 64
        assert frame['sourceArtifact'] == {'name': 'output/points.ply', 'sha256': 'e' * 64, 'coordinateFrame': 'reconstruction-world'}
        x0, y0, x1, y1 = frame['pixelBox']; assert 0 <= x0 < x1 < 640 and 0 <= y0 < y1 < 480
        assert .85 <= frame['visibleFraction'] <= 1 and 0 <= frame['occludedFraction'] <= .5
    text = json.dumps(result)
    assert '/private/' not in text and 'capture.png' not in text and 'base64' not in text
    assert result['imagesPublished'] is False


def test_a_long_walk_considers_views_spread_over_all_of_it(capture, monkeypatch):
    # 150 views, and only the last ten see the object: the first 60 alone would miss it.
    cloud, scene = identified(capture)
    monkeypatch.setattr(ce.names, 'crop', lambda *_: pytest.fail('No images may be cropped or read.'))
    walk = [camera(f'away-{i}', [.5, 1.5, 4], [.5, 1.5, 10]) for i in range(140)] + \
           [camera(f'late-{i}', [.5, 1.5, 4], [.5, .5, .5]) for i in range(10)]
    result = report(scene, cloud, views=walk)
    assert result['projection']['viewsConsidered'] == 60 and result['projection']['viewSelection'] == '60 evenly spread over 150'
    obj = next(item for item in result['components'] if item['name'] == 'object_1')
    assert obj['frames'] and all(frame['frameId'].startswith('late-') for frame in obj['frames'])


def test_raw_hashes_parsed_source_and_exact_ordered_cloud_must_all_match(capture):
    cloud, scene = identified(capture)
    for key in ('scene_sha256', 'cloud_sha256'):
        with pytest.raises(ValueError, match='SHA-256'):
            report(scene, cloud, views=[], **{key: 'f' * 64})
    changed = copy.deepcopy(cloud); changed['points'][0][3] += 1
    with pytest.raises(ValueError, match='exact ordered cloud'):
        report(scene, changed, views=[])
    changed['points'] = list(reversed(cloud['points']))
    with pytest.raises(ValueError, match='exact ordered cloud'):
        report(scene, changed, views=[])
    altered = copy.deepcopy(scene); altered['walls'][0]['label'] = 'different raw scene'
    with pytest.raises(ValueError, match='bytes do not match'):
        ce.build_component_evidence(altered, cloud, scene_bytes=encoded(scene), cloud_bytes=encoded(cloud), views=[])
    with pytest.raises(ValueError, match='Duplicate JSON'):
        ce.build_component_evidence(scene, cloud, scene_bytes=b'{"x":1,"x":2}', cloud_bytes=encoded(cloud), views=[])


def test_raw_binding_preserves_boolean_and_number_types(capture):
    cloud, scene = identified(capture)
    raw_cloud = copy.deepcopy(cloud); raw_cloud['multiView'] = 1
    assert raw_cloud == cloud, 'This is the Python equality ambiguity the JSON binding must reject.'
    with pytest.raises(ValueError, match='cloud bytes do not match'):
        ce.build_component_evidence(scene, cloud, scene_bytes=encoded(scene), cloud_bytes=encoded(raw_cloud), views=[])
    provided = copy.deepcopy(cloud); provided['points'][0][0] = 1
    raw_cloud = copy.deepcopy(provided); raw_cloud['points'][0][0] = True
    assert provided == raw_cloud
    with pytest.raises(ValueError, match='cloud bytes do not match'):
        ce.build_component_evidence(scene, provided, scene_bytes=encoded(scene), cloud_bytes=encoded(raw_cloud), views=[])
    raw_scene = copy.deepcopy(scene); raw_scene['metric_verified'] = 0
    assert raw_scene == scene
    with pytest.raises(ValueError, match='scene bytes do not match'):
        ce.build_component_evidence(scene, cloud, scene_bytes=encoded(raw_scene), cloud_bytes=encoded(cloud), views=[])


def test_changed_geometry_is_not_attributed_just_because_the_name_and_support_count_match(capture):
    cloud, source, *_ = capture; changed = copy.deepcopy(source)
    changed['walls'][0]['centre'][0] += .000001
    changed = ce.cg.attach_component_ids(changed, ce.points_sha256(cloud))
    wall = next(item for item in report(changed, cloud, views=[])['components'] if item['name'] == 'wall_1')
    assert wall['status'] == 'unsupported' and wall['supportCount'] is None and not wall['sampledPointIndices']
    assert 'exactly match' in wall['reason']


def test_edited_geometry_is_unsupported_but_label_only_revision_keeps_source_membership(capture):
    cloud, scene = identified(capture)
    def edit(operation):
        return ce.cg.apply_edits(scene, {'schema': ce.cg.EDIT_SCHEMA, 'sourceSha256': ce.points_sha256(cloud),
            'sceneSha256': ce.cg.scene_sha256(scene), 'revision': 0, 'edits': [operation]})
    wall_id = scene['walls'][0]['componentId']
    edited = edit({'op': 'wall', 'componentId': wall_id, 'translationMeters': [.1, 0, 0]})
    authored = next(item for item in report(edited, cloud, views=[])['components'] if item['componentId'] == wall_id)
    assert edited['walls'][0]['support_points'] > 0
    assert authored['supportCount'] is None and authored['status'] == 'unsupported' and 'Operator-authored' in authored['reason']
    renamed = edit({'op': 'label', 'componentId': wall_id, 'label': 'North wall'})
    result = report(renamed, cloud, views=[])
    assert result['componentGraph']['revision'] == 1 and result['componentGraph']['sourceSha256'] == ce.points_sha256(cloud)
    assert next(item for item in result['components'] if item['componentId'] == wall_id)['status'] == 'source-membership'
    assert result['sourceFiles']['scene']['sha256'] != report(scene, cloud, views=[])['sourceFiles']['scene']['sha256']


def test_detector_placements_unplaced_openings_fills_and_unknown_space_are_explicitly_unsupported(capture):
    cloud, source, *_ = capture; scene = copy.deepcopy(source)
    scene['objects'] += [{'name': 'detected_chair', 'label': 'chair', 'provenance': 'detected', 'centre': [0, .5, 0], 'size': [.5, 1, .5]},
                         {'name': 'unplaced', 'label': 'chair', 'provenance': 'detected-unplaced'}]
    wall = scene['walls'][0]
    scene['openings'] = [{'id': 'entry', 'hostWall': wall['name'], 'offsetMeters': .5, 'widthMeters': .6, 'heightMeters': 1.9,
                          'sillMeters': 0, 'kind': 'door', 'reviewed': True,
                          'host': {key: copy.deepcopy(wall[key]) for key in ('centre', 'size', 'yaw_degrees')}}]
    scene = ce.cg.attach_component_ids(scene, ce.points_sha256(cloud)); result = report(scene, cloud, views=[])
    by_name = {item['name']: item for item in result['components']}
    for name in ('detected_chair', 'unplaced', 'entry', 'door_entry', 'unknown_space'):
        assert by_name[name]['status'] == 'unsupported' and by_name[name]['supportCount'] is None
        assert by_name[name]['reason'] and by_name[name]['frames'] == []
    assert by_name['wall_1']['membershipBasis'] == 'original-compiler-wall-fit'
    assert 'voids are not source-detected' in by_name['wall_1']['geometryScope']


def test_outputs_are_bounded_and_remaining_inventory_stays_visible(capture, views):
    cloud, source, *_ = capture; scene = copy.deepcopy(source)
    scene['objects'] += [{'name': f'fake_{index}', 'label': 'object', 'kind': 'separated', 'provenance': 'observed',
                          'centre': [index, .5, 0], 'size': [.5, 1, .5]} for index in range(60)]
    scene = ce.cg.attach_component_ids(scene, ce.points_sha256(cloud))
    many_views = [dict(views[0], frame_id=f'frame-{index}') for index in range(65)]
    result = report(scene, cloud, views=many_views)
    assert result['evaluatedComponents'] == 50 and len(result['components']) == 64
    assert result['projection']['viewsConsidered'] == 60 and result['projection']['viewsTruncated'] is True
    assert all(len(item['sampledPointIndices']) <= 256 and len(item['frames']) <= 2 for item in result['components'])
    assert any(item.get('reason') == 'Source membership evaluation limit reached.' for item in result['components'])


def test_legacy_or_mixed_ledger_views_never_get_invented_frame_identity(capture, views):
    cloud, scene = identified(capture)
    legacy = dict(views[0]); legacy.pop('frame_id')
    mixed = [views[0], dict(views[1], ledger_sha256='f' * 64)]
    for invalid in ([legacy], mixed, [dict(views[0], frame_id='/private/capture.png')],
                    [dict(views[0], width=16384, height=16384)]):
        result = report(scene, cloud, views=invalid)
        assert result['projection']['status'] == 'unavailable'
        assert all(not item['frames'] for item in result['components'])
        assert all(item.get('frameStatus') == 'unavailable' for item in result['components'] if item['status'] == 'source-membership')
    assert 'stable frame ID' in report(scene, cloud, views=[legacy])['projection']['reason']


def test_normal_views_use_the_shared_source_bound_loader_and_disclose_binding(capture, views, monkeypatch):
    cloud, scene = identified(capture); calls = []
    def load(source_dir, supplied_cloud):
        calls.append((source_dir, supplied_cloud))
        return [dict(view, binding_status='ordered-source-subset', binding_tolerance_source_units=1e-6) for view in views]
    monkeypatch.setattr(ce.names, 'reconstruction_views', load)
    result = report(scene, cloud, source_dir='/private/source-job')
    assert calls == [('/private/source-job', cloud)]
    assert result['projection']['cameraViewSource'] == 'validated-reconstruction-ledger'
    frames = next(item for item in result['components'] if item['name'] == 'object_1')['frames']
    assert frames and all(frame['sourceBinding'] == 'ordered-source-subset' and frame['bindingToleranceSourceUnits'] == 1e-6 for frame in frames)
    assert '/private/' not in json.dumps(result)


def test_graph_revision_tampering_and_nonfinite_raw_values_are_rejected(capture):
    cloud, scene = identified(capture); altered = copy.deepcopy(scene)
    altered['componentGraph']['revision'] = 1
    with pytest.raises(ValueError, match='revision|history'):
        report(altered, cloud, views=[])
    with pytest.raises(ValueError):
        ce.build_component_evidence(scene, cloud, scene_bytes=b'{"overflow":1e999}', cloud_bytes=encoded(cloud), views=[])


def test_projection_does_not_use_a_sheared_handoff_or_nonrigid_camera(capture, views):
    cloud, scene = identified(capture); cloud['fromSource'][0][0] = 2
    result = report(scene, cloud, views=views)
    assert result['projection']['status'] == 'unavailable' and 'uniform scale' in result['projection']['reason']
    assert any(item['status'] == 'source-membership' for item in result['components'])
    cloud, scene = identified(capture); view = dict(views[0]); view['cam_from_world'] = view['cam_from_world'].copy()
    view['cam_from_world'][0, 0] *= 2
    result = report(scene, cloud, views=[view])
    assert result['projection']['status'] == 'unavailable' and 'rigid' in result['projection']['reason']
    assert not any(item['frames'] for item in result['components'])


def test_writer_binds_exact_final_raw_files_and_refuses_a_stale_scene(capture, tmp_path):
    cloud, scene = identified(capture)
    scene_path, cloud_path = tmp_path / 'scene.json', tmp_path / 'cloud.json'
    scene_path.write_bytes(encoded(scene)); cloud_path.write_bytes(encoded(cloud))
    result = ce.write_component_evidence(tmp_path, scene, cloud, scene_path=scene_path, cloud_path=cloud_path, views=[])
    assert json.loads((tmp_path / 'component-evidence.json').read_text()) == result
    assert result['sourceFiles']['cloud']['sha256'] == hashlib.sha256(cloud_path.read_bytes()).hexdigest()
    scene_path.write_text('{}')
    with pytest.raises(ValueError, match='bytes do not match'):
        ce.write_component_evidence(tmp_path, scene, cloud, scene_path=scene_path, cloud_path=cloud_path, views=[])
