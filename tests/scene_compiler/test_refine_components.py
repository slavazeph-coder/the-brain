"""Selection/admission tests; authored proposals are an explicit solver stand-in.

These exercise review integrity and controlled-edit behavior. They are not
physical room measurements or a native Blender execution qualification.
"""
import copy
import hashlib
import json
import random
from pathlib import Path
from unittest.mock import patch

import pytest

from robotics.scene_compiler import component_graph as cg, refine_components as rc
from robotics.world_worker.measurement_check import points_sha256


def encoded(value):
    return json.dumps(value, indent=1, allow_nan=False).encode()


@pytest.fixture
def fixture():
    scale = {'source': 'user-measured', 'metresPerUnit': 1., 'selfReported': True, 'verified': False}
    cloud = {'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'scale': scale,
             'points': [[0, 0, 0, 1, 2, 3], [1, 0, 0, 1, 2, 3], [0, 2, -2, 1, 2, 3]],
             'floorEstimate': {'y': 0.}}
    scene = {'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': copy.deepcopy(scale), 'floor_y': 0.,
             'cloudPointsSha256': points_sha256(cloud),
             'walls': [{'name': 'wall_1', 'centre': [0, 1.25, -2.05], 'size': [4., 2.5, .1],
                        'yaw_degrees': 0., 'provenance': 'observed', 'faceCentre': [0, -2.],
                        'thicknessBasis': 'assumed 0.1 m: one face seen'}],
             'objects': [], 'openings': [{'id': 'entry', 'kind': 'opening', 'reviewed': True,
                        'hostWall': 'wall_1', 'offsetMeters': 1., 'widthMeters': 1.,
                        'heightMeters': 2., 'sillMeters': 0.}],
             'unknown': [], 'fit': {'old': True}, 'routes': ['stale'], 'navigation': {'stale': True}}
    scene = cg.attach_component_ids(scene, points_sha256(cloud))
    identifier = scene['walls'][0]['componentId']
    candidate = {'kind': 'wall-plane-refinement', 'status': 'review-required',
                 'geometry': {'centre': [0, 1.25, -2.04], 'size': [4., 2.5, .1], 'yaw_degrees': .1},
                 'suggestedEdit': {'op': 'wall', 'componentId': identifier,
                                   'translationMeters': [0, 0, .01], 'yawDegrees': .1},
                 'before': {'medianMeters': .01, 'p95Meters': .02},
                 'after': {'medianMeters': .005, 'p95Meters': .015},
                 'thicknessPreserved': True, 'reviewRequired': True}
    report = {'schema': 'brainsnn.component-fit.v1',
              'components': [{'componentId': identifier, 'name': 'wall_1', 'kind': 'wall', 'candidate': candidate}]}
    return scene, cloud, report, identifier


def call(fixture, *, fresh=None, ids=None, **overrides):
    scene, cloud, report, identifier = fixture
    kwargs = dict(scene_bytes=encoded(scene), cloud_bytes=encoded(cloud), report_bytes=encoded(report))
    kwargs.update(overrides)
    with patch.object(rc.cf, 'build_component_fit', return_value=report if fresh is None else fresh):
        return rc.build_refinement(scene, cloud, report, [identifier] if ids is None else ids, **kwargs)


def test_selected_wall_becomes_authored_and_host_follows_without_source_mutation(fixture):
    scene, cloud, report, identifier = fixture
    originals = copy.deepcopy((scene, cloud, report))
    result = call(fixture)
    edited = result['scene']; receipt = result['receipt']
    assert (scene, cloud, report) == originals
    assert result['contract']['sceneSha256'] == cg.scene_sha256(scene)
    assert result['contract']['revision'] == 0
    assert receipt['sourceFiles']['scene']['sha256'] == hashlib.sha256(encoded(scene)).hexdigest()
    assert receipt['sourceFiles']['componentFit']['sha256'] == hashlib.sha256(encoded(report)).hexdigest()
    assert edited['componentGraph']['revision'] == 1
    assert edited['walls'][0]['componentId'] == identifier
    assert edited['walls'][0]['size'] == scene['walls'][0]['size']
    assert edited['walls'][0]['provenance'] == 'operator-authored-edit'
    assert 'faceCentre' not in edited['walls'][0] and 'thicknessBasis' not in edited['walls'][0]
    assert edited['openings'][0]['host']['centre'] == edited['walls'][0]['centre']
    assert edited['openings'][0]['provenance'] == 'operator-authored-edit'
    assert not any(key in edited for key in ('fit', 'routes', 'navigation'))
    assert edited['metric_verified'] is False and edited['physicalRobotValidated'] is False
    assert receipt['metricVerified'] is receipt['independentAccuracyValidated'] is receipt['blenderRebuilt'] is False


@pytest.mark.parametrize('ids', [[], ['no-such-component'], [None], [True], ['same'] * 2, ['x'] * 33])
def test_selection_must_be_explicit_bounded_unique_and_in_scene(fixture, ids):
    with pytest.raises(ValueError):
        call(fixture, ids=ids)


def test_nonwall_opening_cannot_be_selected(fixture):
    with pytest.raises(ValueError, match='wall component'):
        call(fixture, ids=[fixture[0]['openings'][0]['componentId']])


@pytest.mark.parametrize('field', ['scene_bytes', 'cloud_bytes', 'report_bytes'])
def test_parsed_values_must_match_retained_bytes(fixture, field):
    with pytest.raises(ValueError, match='bytes do not match'):
        call(fixture, **{field: b'{}'})


def test_report_recomputation_rejects_stale_or_tampered_numbers(fixture):
    fresh = copy.deepcopy(fixture[2]); fresh['components'][0]['candidate']['after']['medianMeters'] = .006
    with pytest.raises(ValueError, match='stale, altered'):
        call(fixture, fresh=fresh)


def test_old_report_cannot_be_applied_to_another_revision(fixture):
    scene, cloud, report, identifier = fixture
    advanced = cg.apply_edits(scene, {'schema': cg.EDIT_SCHEMA, 'sourceSha256': points_sha256(cloud),
        'sceneSha256': cg.scene_sha256(scene), 'revision': 0,
        'edits': [{'op': 'label', 'componentId': identifier, 'label': 'North wall'}]})
    fresh = copy.deepcopy(report); fresh['revision'] = 1
    with pytest.raises(ValueError, match='stale, altered'):
        call((advanced, cloud, report, identifier), fresh=fresh)


@pytest.mark.parametrize('mutation', ['not-reviewable', 'no-thickness-promise', 'resize', 'too-far',
                                    'vertical', 'too-much-yaw', 'no-op', 'worse-tail', 'no-improvement',
                                    'nonfinite', 'bad-shape', 'wrong-id', 'disagree-centre', 'authored'])
def test_unsafe_or_unsupported_proposals_cannot_be_converted(fixture, mutation):
    scene, cloud, report, identifier = fixture
    candidate = report['components'][0]['candidate']
    if mutation == 'not-reviewable': candidate['status'] = 'unavailable'
    elif mutation == 'no-thickness-promise': candidate['thicknessPreserved'] = False
    elif mutation == 'resize': candidate['geometry']['size'][2] = .2
    elif mutation == 'too-far':
        candidate['suggestedEdit']['translationMeters'][2] = .3; candidate['geometry']['centre'][2] = -1.75
    elif mutation == 'vertical':
        candidate['suggestedEdit']['translationMeters'][1] = .01; candidate['geometry']['centre'][1] = 1.26
    elif mutation == 'too-much-yaw':
        candidate['suggestedEdit']['yawDegrees'] = candidate['geometry']['yaw_degrees'] = 6.
    elif mutation == 'no-op':
        candidate['suggestedEdit']['translationMeters'] = [0, 0, 0]
        candidate['suggestedEdit']['yawDegrees'] = candidate['geometry']['yaw_degrees'] = 0.
        candidate['geometry']['centre'] = scene['walls'][0]['centre'].copy()
    elif mutation == 'worse-tail': candidate['after']['p95Meters'] = .03
    elif mutation == 'no-improvement': candidate['after']['medianMeters'] = .01
    elif mutation == 'nonfinite': candidate['suggestedEdit']['yawDegrees'] = float('nan')
    elif mutation == 'bad-shape': candidate['geometry']['centre'] = [0]
    elif mutation == 'wrong-id': candidate['suggestedEdit']['componentId'] = 'changed'
    elif mutation == 'disagree-centre': candidate['geometry']['centre'][0] = 1.
    elif mutation == 'authored':
        scene = cg.apply_edits(scene, {'schema': cg.EDIT_SCHEMA, 'sourceSha256': points_sha256(cloud),
            'sceneSha256': cg.scene_sha256(scene), 'revision': 0,
            'edits': [{'op': 'wall', 'componentId': identifier, 'translationMeters': [.01, 0, 0]}]})
    with pytest.raises(ValueError):
        call((scene, cloud, report, identifier))


def write_inputs(tmp_path, fixture):
    scene, cloud, report, _ = fixture
    paths = [tmp_path / name for name in ('scene.json', 'arena-cloud.json', 'component-fit.json')]
    for path, value in zip(paths, (scene, cloud, report)):
        path.write_bytes(encoded(value))
    return paths


def test_fresh_atomic_review_output_preserves_raw_sources(fixture, tmp_path):
    paths = write_inputs(tmp_path, fixture); originals = [path.read_bytes() for path in paths]
    with patch.object(rc.cf, 'build_component_fit', return_value=fixture[2]):
        receipt = rc.write_refinement(*paths, tmp_path / 'review', component_ids=[fixture[3]])
    out = tmp_path / 'review'
    assert [path.read_bytes() for path in paths] == originals
    for name, raw in zip(('source-scene.json', 'arena-cloud.json', 'source-component-fit.json'), originals):
        assert (out / name).read_bytes() == raw
    assert json.loads((out / 'component-edits.json').read_text())['edits'][0]['componentId'] == fixture[3]
    assert receipt['blenderRebuilt'] is False and not (out / 'model').exists()
    for name, artifact in receipt['artifacts'].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == artifact['sha256']
    with pytest.raises(FileExistsError):
        rc.write_refinement(*paths, out, component_ids=[fixture[3]])


def test_failed_optional_rebuild_publishes_nothing(fixture, tmp_path):
    paths = write_inputs(tmp_path, fixture)
    with patch.object(rc.cf, 'build_component_fit', return_value=fixture[2]), \
            patch.object(rc.rebuild_components, 'rebuild', side_effect=RuntimeError('Blender failed')), \
            pytest.raises(RuntimeError, match='Blender failed'):
        rc.write_refinement(*paths, tmp_path / 'review', component_ids=[fixture[3]], blender='/authored/blender')
    assert not (tmp_path / 'review').exists()
    assert not list(tmp_path.glob('.review.refinement-*'))


def test_supplied_evidence_is_forwarded_for_exact_recomputation(fixture):
    support = {'explicit': 'authored camera evidence stand-in'}; raw = encoded(support)
    with patch.object(rc.cf, 'build_component_fit', return_value=fixture[2]) as build:
        result = rc.build_refinement(*fixture[:3], [fixture[3]], scene_bytes=encoded(fixture[0]),
            cloud_bytes=encoded(fixture[1]), report_bytes=encoded(fixture[2]),
            component_evidence=support, evidence_bytes=raw, source_job=Path('/retained/source'))
    assert build.call_args.kwargs['component_evidence'] == support
    assert build.call_args.kwargs['evidence_bytes'] == raw
    assert build.call_args.kwargs['source_dir'] == Path('/retained/source')
    assert result['receipt']['sourceFiles']['componentEvidence']['sha256'] == hashlib.sha256(raw).hexdigest()


def solver_fixture():
    """Authored reconstructed surface with a depth bias in the lower half.

The existing compiler fits its initial plane using upper wall points. The
reviewable solver can reduce the all-member residuals without resizing a wall.
These are synthetic points, not independent physical measurement evidence.
"""
    from robotics.world_worker import component_evidence as ce
    rng = random.Random(15)
    points = [[rng.uniform(-2.5, 2.5), rng.gauss(0, .001), rng.uniform(-2.5, 2.5), 90, 80, 70]
              for _ in range(1000)]
    for _ in range(4000):
        y = rng.uniform(.06, 2.5)
        z = (-1.97 if y < 1.3 else -2.) + rng.gauss(0, .001)
        points.append([rng.uniform(-2, 2), y, z, 180, 180, 180])
    cloud = {'version': 1, 'kind': 'colmap-sparse-point-cloud', 'sourceFrame': 'right-handed-y-up',
             'source': 'AUTHORED depth-biased wall fixture; no physical capture or accuracy result',
             'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'points': points,
             'floorEstimate': {'y': 0., 'units': 'm'}, 'provenance': {'metricVerified': False},
             'scale': {'source': 'user-measured', 'metresPerUnit': 1., 'distance': 1., 'spanUnits': 1.,
                       'selfReported': True, 'verified': False}}
    _margin, walls, _rest, _objects = ce.sc.analyse(points, 0., True)
    assert len(walls) == 1
    scene = {'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': copy.deepcopy(cloud['scale']), 'floor_y': 0.,
             'cloudPointsSha256': points_sha256(cloud), 'unknown': [],
             'walls': [dict(ce._box(fit), name=f'wall_{index + 1}', provenance='observed')
                       for index, fit in enumerate(walls)],
             'objects': [dict(ce._floor_box(points, 0.), name='floor_observed', label='floor', provenance='observed')]}
    scene = cg.attach_component_ids(scene, points_sha256(cloud))
    report = rc.cf.build_component_fit(scene, cloud, scene_bytes=encoded(scene), cloud_bytes=encoded(cloud),
                                      scene_name='scene.json', cloud_name='arena-cloud.json')
    return scene, cloud, report, scene['walls'][0]['componentId']


def test_actual_solver_proposal_recomputes_into_a_bound_review_contract(tmp_path):
    fixture = solver_fixture()
    scene, cloud, report, identifier = fixture
    candidate = next(row for row in report['components'] if row['componentId'] == identifier)['candidate']
    assert candidate['status'] == 'review-required'
    assert candidate['after']['medianMeters'] < candidate['before']['medianMeters']
    assert candidate['after']['p95Meters'] < candidate['before']['p95Meters']
    paths = write_inputs(tmp_path, fixture)
    receipt = rc.write_refinement(*paths, tmp_path / 'review', component_ids=[identifier])
    proposed = json.loads((tmp_path / 'review' / 'proposed-scene.json').read_text())
    assert proposed['walls'][0]['centre'] == candidate['geometry']['centre']
    assert proposed['walls'][0]['size'] == scene['walls'][0]['size']
    assert proposed['scale'] == cloud['scale']
    assert proposed['walls'][0]['provenance'] == 'operator-authored-edit'
    assert receipt['comparisons'][0]['before']['allPointsIncluded'] is True
    assert receipt['comparisons'][0]['after']['allPointsIncluded'] is True
    assert receipt['independentAccuracyValidated'] is False


def test_actual_solver_rejects_an_edited_retained_candidate(tmp_path):
    fixture = solver_fixture()
    candidate = next(row for row in fixture[2]['components'] if row['componentId'] == fixture[3])['candidate']
    candidate['geometry']['centre'][0] += .001
    paths = write_inputs(tmp_path, fixture)
    with pytest.raises(ValueError, match='stale, altered'):
        rc.write_refinement(*paths, tmp_path / 'review', component_ids=[fixture[3]])
    assert not (tmp_path / 'review').exists()
