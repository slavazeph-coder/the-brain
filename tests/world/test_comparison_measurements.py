"""Authored camera/landmark fixtures test the scorer, not reconstruction accuracy."""
import copy
import hashlib
import json
import math

import numpy as np
import pytest

from robotics.world_worker import comparison_measurements as cm


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def receipt():
    value = {'schema': 'brainsnn.comparison-frames.v1', 'sources': [{'name': 'authored-fixture', 'kind': 'synthetic', 'sha256': 'f' * 64, 'bytes': 1}],
             'frames': [{'image': f'frame_{i:04d}.jpg', 'width': 800, 'height': 600, 'sha256': str(i + 1) * 64, 'bytes': 100} for i in range(3)]}
    value['captureSha256'] = _digest(value)
    return value


def scene(model='PINHOLE', *, half_pixel=False, transformed=False, basis='physical-readings'):
    points = np.array([[-.7, -.3, 4.], [.65, -.3, 4.], [-.5, .4, 4.4], [.5, .4, 4.6], [0, -.55, 3.7],
                       [-.6, .55, 5.], [.6, .55, 5.], [.1, .2, 3.3], [-.1, -.2, 5.2]], float)
    manifest = receipt()
    frames, observations = [], [[] for _ in points]
    for index, cx in enumerate([-.7, .0, .8]):
        pose = np.c_[np.eye(3), [-cx, 0, 0]].tolist()
        camera = {'model': model, 'params': [500., 510., 400., 300.] if model == 'PINHOLE' else [500., 400., 300., .1],
                  'pixelConvention': 'colmap-half-pixel' if half_pixel else 'integer-centres'}
        if half_pixel:
            camera['params'][2 if model == 'PINHOLE' else 1] += .5
            camera['params'][3 if model == 'PINHOLE' else 2] += .5
        frame = {'image': f'frame_{index:04d}.jpg', 'width': 800, 'height': 600, 'camera': camera, 'cam_from_world': pose}
        if transformed:
            # Model camera uses a crop/half-sized raster. The input annotations remain on800x600 JPEGs.
            transform = np.array([[.5, 0, -20.25], [0, .5, -10.25], [0, 0, 1.]])
            frame.update(width=380, height=280, preparedToCameraPixelCenter=transform.tolist())
            p = camera['params']
            if model == 'PINHOLE':
                p[0] *= .5; p[1] *= .5
                p[2] = .5 * (p[2] - (.5 if half_pixel else 0)) - 20.25 + (.5 if half_pixel else 0)
                p[3] = .5 * (p[3] - (.5 if half_pixel else 0)) - 10.25 + (.5 if half_pixel else 0)
            else:
                p[0] *= .5
                p[1] = .5 * (p[1] - (.5 if half_pixel else 0)) - 20.25 + (.5 if half_pixel else 0)
                p[2] = .5 * (p[2] - (.5 if half_pixel else 0)) - 10.25 + (.5 if half_pixel else 0)
        frames.append(frame)
        # Generate shared prepared pixels directly from known authored pinhole/radial truth.
        for j, point in enumerate(points):
            xy = (point[:2] - [cx, 0]) / point[2]
            if model == 'PINHOLE':
                uv = xy * [500, 510] + [400, 300]
            else:
                uv = xy * (500 * (1 + .1 * float(xy @ xy))) + [400, 300]
            observations[j].append({'image': frame['image'], 'xy': uv.tolist()})
    cameras = {'schema': cm.CAMERA_SCHEMA, 'coordinateFrame': 'authored-arbitrary', 'metricVerified': False, 'frames': frames}
    spans = []
    for i in range(1, len(points)):
        spans.append({'id': f'span_{i}', 'label': f'Authored span {i}', 'role': 'calibration' if i == 1 else 'held-out',
                      'landmarks': ['p0', f'p{i}'], 'distanceMeters': float(np.linalg.norm(points[0] - points[i])) * 2.5,
                      'uncertaintyMeters': .002, 'method': 'laser' if basis == 'physical-readings' else 'synthetic',
                      'instrument': 'Authored test instrument metadata, not an actual reading', 'measuredOn': '2026-10-25'})
    annotations = {'schema': cm.ANNOTATION_SCHEMA, 'captureSha256': manifest['captureSha256'], 'referenceBasis': basis,
                   'landmarks': [{'id': f'p{i}', 'observations': obs} for i, obs in enumerate(observations)], 'spans': spans}
    return cameras, annotations, manifest, points


@pytest.mark.parametrize('model', ['PINHOLE', 'SIMPLE_RADIAL'])
@pytest.mark.parametrize('half_pixel', [False, True])
@pytest.mark.parametrize('transformed', [False, True])
def test_same_shared_pixels_recover_authored_span_scale_and_distances(model, half_pixel, transformed):
    cameras, annotations, manifest, points = scene(model, half_pixel=half_pixel, transformed=transformed)
    before = copy.deepcopy((cameras, annotations, manifest))
    result = cm.score(cameras, annotations, manifest)
    assert (cameras, annotations, manifest) == before
    assert result['scale']['metresPerReconstructionUnit'] == pytest.approx(2.5, abs=1e-10)
    assert result['summary']['requestedHeldOutCount'] == 7
    assert result['summary']['validHeldOutCount'] == 7
    assert result['summary']['heldOutMaxAbsoluteErrorMeters'] < 1e-10
    assert result['summary']['eligibleForPhysicalDimensionComparison']
    assert not result['metricVerified'] and not result['independentAccuracyValidated']
    assert not result['bimGeometryValidated'] and not result['surfaceCompletenessValidated'] and not result['physicalRobotValidated']
    assert result['triangulation']['heldOutDistancesUsedForFitting'] is False
    np.testing.assert_allclose([r['positionReconstructionUnits'] for r in result['landmarks']], points, atol=1e-10)


def test_withheld_values_never_change_landmarks_or_scale():
    cameras, annotations, manifest, _ = scene()
    original = cm.score(cameras, annotations, manifest)
    annotations['spans'][3]['distanceMeters'] *= 1.3
    changed = cm.score(cameras, annotations, manifest)
    assert changed['landmarks'] == original['landmarks']
    assert changed['scale'] == original['scale']
    assert changed['spans'][3]['triangulatedDistanceMeters'] == original['spans'][3]['triangulatedDistanceMeters']
    assert changed['spans'][3]['absoluteErrorMeters'] > .1
    assert changed['sources']['annotationsCanonicalSha256'] != original['sources']['annotationsCanonicalSha256']


def test_scale_uses_only_calibration_and_reports_its_fitted_zero_error_separately():
    cameras, annotations, manifest, _ = scene()
    annotations['spans'][0]['distanceMeters'] *= 2
    result = cm.score(cameras, annotations, manifest)
    assert result['scale']['metresPerReconstructionUnit'] == pytest.approx(5)
    assert result['spans'][0]['absoluteErrorMeters'] < 1e-10
    assert result['summary']['heldOutMedianAbsoluteErrorMeters'] > 1


def test_synthetic_fixture_cannot_become_physical_qualification():
    cameras, annotations, manifest, _ = scene(basis='synthetic-fixture')
    result = cm.score(cameras, annotations, manifest)
    assert result['summary']['validHeldOutCount'] == 7
    assert not result['summary']['eligibleForPhysicalDimensionComparison']
    assert not result['physicalReadingsSelfReported']
    annotations['spans'][0]['method'] = 'laser'
    with pytest.raises(ValueError, match='method'):
        cm.score(cameras, annotations, manifest)


def test_missing_camera_keeps_recoverable_two_view_results_and_discloses_missing():
    cameras, annotations, manifest, _ = scene()
    cameras['frames'].pop()
    result = cm.score(cameras, annotations, manifest)
    assert result['registeredFrames'] == 2 and result['sharedFrames'] == 3
    assert result['summary']['validHeldOutCount'] == 7
    assert result['landmarks'][0]['observationsUsed'] == 2
    assert result['landmarks'][0]['unregisteredImages'] == ['frame_0002.jpg']


def test_unavailable_landmark_keeps_withheld_span_in_denominator():
    cameras, annotations, manifest, _ = scene()
    # For this landmark only, two available cameras have the same centre and ray.
    annotations['landmarks'][4]['observations'] = annotations['landmarks'][4]['observations'][:2]
    cameras['frames'].pop(1)
    result = cm.score(cameras, annotations, manifest)
    assert len(result['spans']) == 8
    assert result['summary']['requestedHeldOutCount'] == 7
    assert result['summary']['validHeldOutCount'] == 6
    assert result['summary']['unavailableHeldOutCount'] == 1
    assert result['spans'][3]['status'] == 'unavailable'
    assert not result['summary']['eligibleForPhysicalDimensionComparison']
    assert not result['summary']['allRequestedHeldOutAvailable']


def test_no_calibration_geometry_means_no_metric_error_aggregates():
    cameras, annotations, manifest, _ = scene()
    cameras['frames'] = cameras['frames'][:1]
    result = cm.score(cameras, annotations, manifest)
    assert result['scale']['metresPerReconstructionUnit'] is None
    assert result['summary']['validHeldOutCount'] == 0
    assert result['summary']['heldOutMedianAbsoluteErrorMeters'] is None
    assert all(row['status'] == 'unavailable' for row in result['spans'])


def test_low_parallax_and_inconsistent_observation_are_rejected_without_dropping_spans():
    cameras, annotations, manifest, _ = scene()
    for frame in cameras['frames']:
        frame['cam_from_world'][0][3] *= .001
    # Ray parallax uses the annotated viewing rays, so collapse all corresponding pixels too.
    for landmark in annotations['landmarks']:
        first = landmark['observations'][0]['xy']
        for obs in landmark['observations'][1:]:
            obs['xy'] = first.copy()
    result = cm.score(cameras, annotations, manifest)
    assert 'parallax' in result['landmarks'][0]['reason']
    assert result['summary']['validHeldOutCount'] == 0
    cameras, annotations, manifest, _ = scene()
    annotations['landmarks'][3]['observations'][1]['xy'][1] += 30
    result = cm.score(cameras, annotations, manifest)
    assert result['landmarks'][3]['status'] == 'unavailable'
    assert 'reprojection' in result['landmarks'][3]['reason']
    assert result['summary']['validHeldOutCount'] == 6


def test_points_behind_all_cameras_are_not_accepted_as_physical_landmarks():
    cameras, annotations, manifest, _ = scene()
    for frame in cameras['frames']:
        # Invert camera baseline while preserving rotations: resulting pixel intersections lie behind cameras.
        frame['cam_from_world'][0][3] *= -1
    result = cm.score(cameras, annotations, manifest)
    assert result['summary']['validHeldOutCount'] == 0
    assert 'behind' in result['landmarks'][0]['reason']


def test_crop_that_excludes_annotation_makes_landmark_unavailable():
    cameras, annotations, manifest, _ = scene(transformed=True)
    cameras['frames'][0]['preparedToCameraPixelCenter'][0][2] = -1000
    result = cm.score(cameras, annotations, manifest)
    assert result['landmarks'][0]['status'] == 'unavailable'
    assert 'outside' in result['landmarks'][0]['reason']


def test_floor_plane_is_internal_fit_without_invented_gravity():
    cameras, annotations, manifest, _ = scene()
    annotations['floorLandmarks'] = ['p0', 'p1', 'p2']
    result = cm.score(cameras, annotations, manifest)
    assert result['floor']['status'] == 'available'
    assert result['floor']['planeRmsMeters'] < 1e-10
    assert result['floor']['gravityTiltDegrees'] is None
    assert not result['floor']['independentGravityValidated']


@pytest.mark.parametrize('change,match', [
    (lambda a, c, r: a.update(captureSha256='a' * 64), 'capture'),
    (lambda a, c, r: r['frames'][0].update(width=900), 'SHA'),
    (lambda a, c, r: a['spans'][1].update(role='calibration'), 'Exactly one'),
    (lambda a, c, r: a['spans'][1].update(landmarks=['p1', 'p0']), 'pairs'),
    (lambda a, c, r: a['spans'][1].update(distanceMeters=True), 'finite'),
    (lambda a, c, r: a['spans'][1].update(uncertaintyMeters=float('nan')), 'finite JSON'),
    (lambda a, c, r: a['landmarks'][0]['observations'][0].update(xy=[800, 1]), 'pixel'),
    (lambda a, c, r: a['landmarks'][0]['observations'].append(copy.deepcopy(a['landmarks'][0]['observations'][0])), 'distinct'),
    (lambda a, c, r: a['spans'][0].update(measuredOn='2026-02-30'), 'date'),
    (lambda a, c, r: c.update(metricVerified=True), 'unverified'),
    (lambda a, c, r: c['frames'][0]['cam_from_world'][0].__setitem__(0, 2), 'rigid'),
    (lambda a, c, r: c['frames'][0].update(width=400), 'transform'),
    (lambda a, c, r: c['frames'][0].update(preparedToCameraPixelCenter=[[0, 0, 0], [0, 0, 0], [0, 0, 1]]), 'affine'),
    (lambda a, c, r: c['frames'].append(copy.deepcopy(c['frames'][0])), 'registered camera'),
])
def test_malformed_or_stale_bindings_rejected(change, match):
    cameras, annotations, manifest, _ = scene()
    change(annotations, cameras, manifest)
    with pytest.raises(ValueError, match=match):
        cm.score(cameras, annotations, manifest)


def test_radial_inverse_checks_physical_branch():
    calibration = {'model': 'SIMPLE_RADIAL', 'params': [500., 400., 300., -.2], 'pixelConvention': 'integer-centres'}
    for x, y in [(0, 0), (.2, -.3), (.8, .5)]:
        radius2 = x * x + y * y
        pixel = np.array([x, y]) * (500 * (1 - .2 * radius2)) + [400, 300]
        np.testing.assert_allclose(cm._undistort(pixel, calibration), [x, y, 1], atol=1e-10)
    with pytest.raises(ValueError, match='invertible'):
        cm._undistort([2000, 300], calibration)


def test_empty_floor_list_is_explicitly_not_annotated():
    cameras, annotations, manifest, _ = scene()
    annotations['floorLandmarks'] = []
    result = cm.score(cameras, annotations, manifest)
    assert result['floor']['status'] == 'not-annotated'
    for floor in [['p0'], ['p0', 'p1']]:
        annotations['floorLandmarks'] = floor
        with pytest.raises(ValueError, match='Floor annotation'):
            cm.score(cameras, annotations, manifest)


def test_optional_engine_frame_provenance_matches_shared_raster_not_model_size():
    cameras, annotations, manifest, _ = scene(transformed=True)
    for frame, shared in zip(cameras['frames'], manifest['frames']):
        frame.update(imageSha256=shared['sha256'], preparedWidth=shared['width'], preparedHeight=shared['height'])
    result = cm.score(cameras, annotations, manifest)
    assert result['summary']['validHeldOutCount'] == 7
    for key, value, match in [('imageSha256', 'f' * 64, 'SHA'), ('preparedWidth', 380, 'prepared dimensions'),
                              ('preparedHeight', 280, 'prepared dimensions'), ('preparedWidth', True, 'prepared dimensions')]:
        changed = copy.deepcopy(cameras)
        changed['frames'][0][key] = value
        with pytest.raises(ValueError, match=match):
            cm.score(changed, annotations, manifest)
    cameras['frames'][0]['unreviewedExtra'] = 'unknown'
    with pytest.raises(ValueError, match='camera frame fields'):
        cm.score(cameras, annotations, manifest)


@pytest.mark.parametrize('field,indices', [('cam_from_world', (0, 0)), ('preparedToCameraPixelCenter', (0, 0))])
@pytest.mark.parametrize('value', [True, False, '1', '0.5'])
def test_boolean_or_string_pose_and_affine_numbers_cannot_be_coerced(field, indices, value):
    cameras, annotations, manifest, _ = scene(transformed=True)
    i, j = indices
    cameras['frames'][0][field][i][j] = value
    with pytest.raises(ValueError, match='finite number'):
        cm.score(cameras, annotations, manifest)
