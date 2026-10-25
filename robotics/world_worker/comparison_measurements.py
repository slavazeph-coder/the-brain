"""Source-bound, withheld landmark measurements for reconstruction comparisons.

Pixels are annotated once on the shared prepared images. Each engine's cameras
triangulate those same observations. Exactly one span sets scale; withheld
readings never fit cameras, points or scale. This tests camera-derived landmark
geometry, not dense surfaces, BIM dimensions, free space or physical robots.
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import itertools
import json
import math
import re

import numpy as np

ANNOTATION_SCHEMA = 'brainsnn.comparison-annotations.v1'
CAMERA_SCHEMA = 'brainsnn.comparison-cameras.v1'
REPORT_SCHEMA = 'brainsnn.comparison-measurements.v1'
MIN_PARALLAX_DEGREES = 1.0
MAX_REPROJECTION_ERROR_PIXELS = 4.0
MAX_LANDMARKS = 128
MAX_SPANS = 64
_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
_IMAGE = re.compile(r'^frame_\d{4}\.jpg$')
_SHA = re.compile(r'^[a-f0-9]{64}$')


def _json_bytes(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (ValueError, TypeError, RecursionError, UnicodeError) as error:
        raise ValueError('Comparison inputs must be finite JSON.') from error


def _sha(value):
    return hashlib.sha256(_json_bytes(value)).hexdigest()


def _number(value, minimum, maximum, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f'{label} must be a finite number from {minimum} to {maximum}.')
    return float(value)


def _matrix(value, rows, columns, limit, label):
    if not isinstance(value, list) or len(value) != rows or any(not isinstance(row, list) or len(row) != columns for row in value):
        raise ValueError(f'{label} must be a {rows} by {columns} numeric matrix.')
    for row in value:
        for item in row:
            _number(item, -limit, limit, label)
    return np.asarray(value, dtype=float)


def _identifier(value, label):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f'{label} must be a bounded identifier.')
    return value


def _text(value, maximum, label):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f'Invalid {label}.')
    return value


def _exact(value, required, optional, label):
    if not isinstance(value, dict) or not set(required) <= value.keys() or set(value) - set(required) - set(optional):
        raise ValueError(f'Invalid {label} fields.')


def _frames(frames_receipt):
    if not isinstance(frames_receipt, dict) or frames_receipt.get('schema') != 'brainsnn.comparison-frames.v1':
        raise ValueError('Expected a comparison frame receipt.')
    digest = frames_receipt.get('captureSha256')
    if not isinstance(digest, str) or not _SHA.fullmatch(digest) or _sha({k: v for k, v in frames_receipt.items() if k != 'captureSha256'}) != digest:
        raise ValueError('Frame receipt capture SHA-256 does not match its canonical contents.')
    rows = frames_receipt.get('frames')
    if not isinstance(rows, list) or not 3 <= len(rows) <= 60:
        raise ValueError('Use 3 to 60 shared prepared frames.')
    result = {}
    for frame in rows:
        if not isinstance(frame, dict) or not isinstance(frame.get('image'), str) or not _IMAGE.fullmatch(frame['image']) or frame['image'] in result:
            raise ValueError('Prepared frame names must be unique frame_NNNN.jpg names.')
        for key in ('width', 'height'):
            if type(frame.get(key)) is not int or not 1 <= frame[key] <= 10000:
                raise ValueError('Prepared frame dimensions must be bounded positive integers.')
        if not isinstance(frame.get('sha256'), str) or not _SHA.fullmatch(frame['sha256']):
            raise ValueError('Every shared frame must have a SHA-256 binding.')
        if type(frame.get('bytes')) is not int or not 1 <= frame['bytes'] <= 64 * 1024 * 1024:
            raise ValueError('Every shared frame must have a bounded byte count.')
        result[frame['image']] = frame
    return result


def validate_annotations(value, frames_receipt):
    """Check a frozen annotation manifest against the validated shared frame receipt.

    The caller is responsible for checking the actual retained frame bytes. The
    receipt canonical hash and all annotation image coordinates are checked here.
    Physical readings and their provenance remain self-reported.
    """
    frames = _frames(frames_receipt)
    if len(_json_bytes(value)) > 256 * 1024:
        raise ValueError('Annotations exceed 256 KiB.')
    _exact(value, ('schema', 'captureSha256', 'referenceBasis', 'landmarks', 'spans'), ('floorLandmarks',), 'annotations')
    if value['schema'] != ANNOTATION_SCHEMA or value['captureSha256'] != frames_receipt['captureSha256']:
        raise ValueError('Annotations do not match this shared capture.')
    if value['referenceBasis'] not in ('physical-readings', 'synthetic-fixture'):
        raise ValueError('References must be labelled physical-readings or synthetic-fixture.')
    landmarks = value['landmarks']
    if not isinstance(landmarks, list) or not 2 <= len(landmarks) <= MAX_LANDMARKS:
        raise ValueError(f'Use 2 to {MAX_LANDMARKS} landmarks.')
    ids = set()
    for landmark in landmarks:
        _exact(landmark, ('id', 'observations'), (), 'landmark')
        name = _identifier(landmark['id'], 'Landmark ID')
        if name in ids:
            raise ValueError('Landmark IDs must be unique.')
        ids.add(name)
        observations = landmark['observations']
        if not isinstance(observations, list) or not 2 <= len(observations) <= 12:
            raise ValueError('Every landmark needs 2 to 12 observations on distinct shared frames.')
        seen = set()
        for observation in observations:
            _exact(observation, ('image', 'xy'), (), 'landmark observation')
            image, xy = observation['image'], observation['xy']
            if not isinstance(image, str) or image not in frames or image in seen:
                raise ValueError('Landmark observations need distinct known shared frames.')
            seen.add(image)
            if not isinstance(xy, list) or len(xy) != 2:
                raise ValueError('An observation needs two integer-centred pixel coordinates.')
            _number(xy[0], 0, frames[image]['width'] - 1, 'Horizontal observation pixel')
            _number(xy[1], 0, frames[image]['height'] - 1, 'Vertical observation pixel')
    spans = value['spans']
    if not isinstance(spans, list) or not 1 <= len(spans) <= MAX_SPANS:
        raise ValueError(f'Use 1 to {MAX_SPANS} reference spans.')
    seen_ids, pairs, calibration_count = set(), set(), 0
    for span in spans:
        _exact(span, ('id', 'label', 'role', 'landmarks', 'distanceMeters', 'uncertaintyMeters', 'method', 'instrument', 'measuredOn'), (), 'reference span')
        name = _identifier(span['id'], 'Span ID')
        if name in seen_ids:
            raise ValueError('Span IDs must be unique.')
        seen_ids.add(name)
        _text(span['label'], 160, 'span label')
        if span['role'] not in ('calibration', 'held-out'):
            raise ValueError('Span role must be calibration or held-out.')
        calibration_count += span['role'] == 'calibration'
        endpoints = span['landmarks']
        if not isinstance(endpoints, list) or len(endpoints) != 2 or any(not isinstance(i, str) or i not in ids for i in endpoints) or endpoints[0] == endpoints[1]:
            raise ValueError('A span needs two distinct known landmark IDs.')
        pair = tuple(sorted(endpoints))
        if pair in pairs:
            raise ValueError('Endpoint pairs cannot be reused, including calibration as held-out.')
        pairs.add(pair)
        _number(span['distanceMeters'], .001, 200, 'Reference distance')
        _number(span['uncertaintyMeters'], 0, 10, 'Reference uncertainty')
        valid_methods = ('tape', 'laser') if value['referenceBasis'] == 'physical-readings' else ('synthetic',)
        if span['method'] not in valid_methods:
            raise ValueError('Reference method must match the declared physical or synthetic basis.')
        _text(span['instrument'], 160, 'reference instrument')
        stamp = span['measuredOn']
        try:
            if not isinstance(stamp, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', stamp) or datetime.date.fromisoformat(stamp).isoformat() != stamp:
                raise ValueError('Invalid date.')
        except (ValueError, TypeError) as error:
            raise ValueError('Enter the actual reading date as YYYY-MM-DD.') from error
    if calibration_count != 1:
        raise ValueError('Exactly one calibration span is required; withheld readings cannot set scale.')
    if 'floorLandmarks' in value:
        floor = value['floorLandmarks']
        if not isinstance(floor, list) or (floor and not 3 <= len(floor) <= MAX_LANDMARKS) or any(not isinstance(i, str) or i not in ids for i in floor) or len(set(floor)) != len(floor):
            raise ValueError('Floor annotation needs at least three distinct known landmarks.')
    return copy.deepcopy(value)


def _cameras(value, frames):
    if len(_json_bytes(value)) > 2 * 1024 * 1024 or not isinstance(value, dict) or value.get('schema') != CAMERA_SCHEMA or value.get('metricVerified') is not False:
        raise ValueError('Expected finite, unverified comparison cameras within 2 MiB.')
    _text(value.get('coordinateFrame'), 160, 'camera coordinate frame')
    rows = value.get('frames')
    if not isinstance(rows, list) or not 1 <= len(rows) <= len(frames):
        raise ValueError('Provide at least one registered camera, bounded by the shared frames.')
    result = {}
    for row in rows:
        _exact(row, ('image', 'width', 'height', 'camera', 'cam_from_world'), ('preparedToCameraPixelCenter', 'imageSha256', 'preparedWidth', 'preparedHeight'), 'camera frame')
        image = row['image']
        if not isinstance(image, str) or image not in frames or image in result:
            raise ValueError('Camera frames must reference distinct shared images.')
        for key in ('width', 'height'):
            if type(row[key]) is not int or not 1 <= row[key] <= 10000:
                raise ValueError('Camera raster dimensions must be bounded positive integers.')
        if 'imageSha256' in row and row['imageSha256'] != frames[image]['sha256']:
            raise ValueError('Camera image SHA-256 differs from the shared prepared frame.')
        for prepared_key, receipt_key in [('preparedWidth', 'width'), ('preparedHeight', 'height')]:
            if prepared_key in row and (type(row[prepared_key]) is not int or row[prepared_key] != frames[image][receipt_key]):
                raise ValueError('Camera prepared dimensions differ from the shared prepared frame.')
        camera = row['camera']
        _exact(camera, ('model', 'params', 'pixelConvention'), (), 'camera calibration')
        if camera['model'] not in ('PINHOLE', 'SIMPLE_RADIAL') or camera['pixelConvention'] not in ('integer-centres', 'colmap-half-pixel'):
            raise ValueError('Unsupported comparison camera model or pixel convention.')
        params = camera['params']
        if not isinstance(params, list) or len(params) != 4:
            raise ValueError('Pinhole and simple-radial cameras require four parameters.')
        for p in params:
            _number(p, -10_000_000, 10_000_000, 'Camera parameter')
        if params[0] <= 0 or (camera['model'] == 'PINHOLE' and params[1] <= 0):
            raise ValueError('Camera focal lengths must be positive.')
        pose = _matrix(row['cam_from_world'], 3, 4, 1e10, 'Camera pose')
        if pose.shape != (3, 4) or not np.isfinite(pose).all() or np.max(np.abs(pose)) > 1e10:
            raise ValueError('Camera pose must be a bounded finite 3 by 4 matrix.')
        rotation = pose[:, :3]
        if not np.allclose(rotation @ rotation.T, np.eye(3), rtol=0, atol=1e-5) or not np.isclose(np.linalg.det(rotation), 1, rtol=0, atol=1e-5):
            raise ValueError('Camera pose rotation must be proper and rigid.')
        transform = _matrix(row.get('preparedToCameraPixelCenter', np.eye(3).tolist()), 3, 3, 1e7, 'Prepared-to-camera affine')
        if transform.shape != (3, 3) or not np.isfinite(transform).all() or np.max(np.abs(transform)) > 1e7 or not np.allclose(transform[2], [0, 0, 1], rtol=0, atol=1e-12) or abs(np.linalg.det(transform[:2, :2])) < 1e-12:
            raise ValueError('Prepared-to-camera pixel transform must be an invertible affine matrix.')
        if 'preparedToCameraPixelCenter' not in row and (row['width'] != frames[image]['width'] or row['height'] != frames[image]['height']):
            raise ValueError('Changed camera raster dimensions require an explicit pixel transform.')
        result[image] = {'calibration': camera, 'pose': pose, 'transform': transform, 'inverseTransform': np.linalg.inv(transform), 'width': row['width'], 'height': row['height']}
    return result


def _undistort(pixel, calibration):
    """Native calibration pixels -> normalized camera ray, preserving radial distortion."""
    p = np.asarray(pixel, dtype=float)
    if calibration['pixelConvention'] == 'colmap-half-pixel':
        p = p + .5
    params = calibration['params']
    if calibration['model'] == 'PINHOLE':
        return np.array([(p[0] - params[2]) / params[0], (p[1] - params[3]) / params[1], 1.])
    focal, cx, cy, k = params
    distorted = (p - [cx, cy]) / focal
    radius = float(np.linalg.norm(distorted))
    if radius == 0:
        return np.array([0., 0., 1.])
    if k == 0:
        return np.r_[distorted, 1.]
    low, high = 0., radius if k > 0 else math.sqrt(-1 / (3 * k))
    if k < 0 and radius >= high * (1 + k * high * high):
        raise ValueError('Radial observation lies beyond the invertible lens branch.')
    for _ in range(70):
        middle = (low + high) / 2
        if middle * (1 + k * middle * middle) < radius:
            low = middle
        else:
            high = middle
    undistorted_radius = (low + high) / 2
    if not math.isfinite(undistorted_radius) or abs(undistorted_radius * (1 + k * undistorted_radius ** 2) - radius) > 1e-9 * max(1, radius):
        raise ValueError('Radial inverse did not converge.')
    return np.r_[distorted * (undistorted_radius / radius), 1.]


def _project(point, view):
    calibration = view['calibration']
    xyz = view['pose'][:, :3] @ point + view['pose'][:, 3]
    if xyz[2] <= 0:
        raise ValueError('Triangulated landmark is behind a supporting camera.')
    xy = xyz[:2] / xyz[2]
    params = calibration['params']
    if calibration['model'] == 'PINHOLE':
        native = xy * params[:2] + params[2:]
    else:
        f, cx, cy, k = params
        native = xy * (f * (1 + k * float(xy @ xy))) + [cx, cy]
    integer_pixels = native - (.5 if calibration['pixelConvention'] == 'colmap-half-pixel' else 0.)
    prepared = view['inverseTransform'] @ np.r_[integer_pixels, 1.]
    return prepared[:2]


def _triangulate(landmark, views):
    observations, missing = [], []
    for observation in landmark['observations']:
        image = observation['image']
        if image not in views:
            missing.append(image)
            continue
        view = views[image]
        mapped = view['transform'] @ np.r_[observation['xy'], 1.]
        if not (-.5 <= mapped[0] <= view['width'] - .5 and -.5 <= mapped[1] <= view['height'] - .5):
            raise ValueError(f'Observation on {image} is outside this engine camera raster after preprocessing.')
        direction = _undistort(mapped[:2], view['calibration'])
        rotation, translation = view['pose'][:, :3], view['pose'][:, 3]
        direction = rotation.T @ direction
        direction /= np.linalg.norm(direction)
        observations.append((observation, view, -rotation.T @ translation, direction))
    if len(observations) < 2:
        raise ValueError('Fewer than two annotated views were registered by this engine.')
    parallax = max(math.degrees(math.acos(float(np.clip(a[3] @ b[3], -1, 1)))) for a, b in itertools.combinations(observations, 2))
    if parallax < MIN_PARALLAX_DEGREES:
        raise ValueError(f'Insufficient ray parallax: {parallax:.6g} degrees, minimum {MIN_PARALLAX_DEGREES:g}.')
    matrices = [np.eye(3) - row[3][:, None] @ row[3][None, :] for row in observations]
    lhs, rhs = sum(matrices), sum(matrix @ row[2] for matrix, row in zip(matrices, observations))
    if np.linalg.cond(lhs) > 1e12:
        raise ValueError('Degenerate multi-view triangulation.')
    point = np.linalg.solve(lhs, rhs)
    errors = [{'image': observation['image'], 'errorPreparedPixels': float(np.linalg.norm(_project(point, view) - observation['xy']))} for observation, view, _, _ in observations]
    worst = max(row['errorPreparedPixels'] for row in errors)
    if not np.isfinite(point).all() or not math.isfinite(worst) or worst > MAX_REPROJECTION_ERROR_PIXELS:
        raise ValueError(f'Landmark reprojection error exceeds {MAX_REPROJECTION_ERROR_PIXELS:g} shared prepared-image pixels.')
    return point, {'observationsRequested': len(landmark['observations']), 'observationsUsed': len(observations), 'unregisteredImages': missing,
                   'maxParallaxDegrees': parallax, 'maxReprojectionErrorPreparedPixels': worst, 'reprojectionErrors': errors}


def score(cameras, annotations, frames_receipt):
    """Triangulate fixed observations, calibrate one span and score every withheld span.

    Missing/invalid geometry remains in the denominator with an unavailable reason.
    Summary error metrics cover the explicitly counted valid spans only. A complete
    physical-reference result is eligibility for a comparison, not certification or
    permission to promote an engine.
    """
    annotations = validate_annotations(annotations, frames_receipt)
    if isinstance(cameras, dict) and 'captureSha256' in cameras and cameras['captureSha256'] != frames_receipt['captureSha256']:
        raise ValueError('Camera capture SHA-256 differs from the shared frames.')
    views = _cameras(cameras, _frames(frames_receipt))
    positions, landmarks = {}, []
    for landmark in annotations['landmarks']:
        try:
            point, diagnostics = _triangulate(landmark, views)
            positions[landmark['id']] = point
            landmarks.append({'id': landmark['id'], 'status': 'available', 'positionReconstructionUnits': point.tolist(), **diagnostics})
        except (ValueError, np.linalg.LinAlgError, FloatingPointError) as error:
            landmarks.append({'id': landmark['id'], 'status': 'unavailable', 'reason': str(error), 'positionReconstructionUnits': None})
    calibration = next(row for row in annotations['spans'] if row['role'] == 'calibration')
    a, b = calibration['landmarks']
    calibration_units = float(np.linalg.norm(positions[a] - positions[b])) if a in positions and b in positions else None
    scale = calibration['distanceMeters'] / calibration_units if calibration_units is not None and calibration_units > 1e-12 else None
    if scale is not None and (not math.isfinite(scale) or not 1e-9 <= scale <= 1e9):
        scale = None
    rows = []
    for span in annotations['spans']:
        row = copy.deepcopy(span)
        a, b = span['landmarks']
        if a not in positions or b not in positions:
            row.update(status='unavailable', reason='One or both annotated landmarks could not be triangulated.')
        elif scale is None:
            row.update(status='unavailable', reason='The sole calibration span could not establish a positive finite scale.')
        else:
            distance = float(np.linalg.norm(positions[a] - positions[b])) * scale
            absolute = abs(distance - span['distanceMeters'])
            row.update(status='available', triangulatedDistanceMeters=distance, signedErrorMeters=distance - span['distanceMeters'],
                       absoluteErrorMeters=absolute, relativeError=absolute / span['distanceMeters'])
        rows.append(row)
    held_out = [row for row in rows if row['role'] == 'held-out']
    valid = [row for row in held_out if row['status'] == 'available']
    floor = {'status': 'not-annotated', 'gravityTiltDegrees': None, 'independentGravityValidated': False}
    if annotations.get('floorLandmarks'):
        floor_ids = annotations['floorLandmarks']
        if scale is None or any(name not in positions for name in floor_ids):
            floor.update(status='unavailable', reason='Calibration or an annotated floor landmark is unavailable.')
        else:
            points = np.array([positions[name] for name in floor_ids])
            centred = points - points.mean(0)
            _, singular, vt = np.linalg.svd(centred, full_matrices=False)
            if singular[1] <= max(1e-12, singular[0] * 1e-8):
                floor.update(status='unavailable', reason='Annotated floor landmarks are collinear.')
            else:
                normal = vt[-1]
                if normal[np.argmax(np.abs(normal))] < 0:
                    normal = -normal
                floor.update(status='available', normalInReconstructionFrame=normal.tolist(),
                             planeRmsMeters=float(np.sqrt(np.mean((centred @ normal) ** 2))) * scale,
                             basis='Plane fitted to annotated floor landmarks; no independent gravity direction or dense-floor validation.')
    complete = bool(held_out) and len(valid) == len(held_out) and scale is not None
    eligible = complete and len(held_out) >= 7 and annotations['referenceBasis'] == 'physical-readings'
    return {'schema': REPORT_SCHEMA, 'scope': 'camera-derived-triangulated-landmark-distances',
            'referenceBasis': annotations['referenceBasis'], 'physicalReadingsSelfReported': annotations['referenceBasis'] == 'physical-readings',
            'metricVerified': False, 'independentAccuracyValidated': False, 'physicalRobotValidated': False,
            'bimGeometryValidated': False, 'surfaceCompletenessValidated': False,
            'sources': {'captureSha256': frames_receipt['captureSha256'], 'annotationsCanonicalSha256': _sha(annotations), 'camerasCanonicalSha256': _sha(cameras)},
            'triangulation': {'minimumParallaxDegrees': MIN_PARALLAX_DEGREES, 'maximumReprojectionErrorPreparedPixels': MAX_REPROJECTION_ERROR_PIXELS,
                              'usesAllAvailableAnnotatedViews': True, 'heldOutDistancesUsedForFitting': False},
            'scale': {'metresPerReconstructionUnit': scale, 'calibrationSpan': calibration['id'], 'calibrationDistanceMeters': calibration['distanceMeters'],
                      'calibrationDistanceReconstructionUnits': calibration_units, 'basis': 'single-self-reported-measured-span' if annotations['referenceBasis'] == 'physical-readings' else 'synthetic-fixture-span',
                      'independentlyMeasuredScale': False},
            'registeredFrames': len(views), 'sharedFrames': len(frames_receipt['frames']), 'landmarks': landmarks, 'spans': rows, 'floor': floor,
            'summary': {'calibrationCount': 1, 'requestedHeldOutCount': len(held_out), 'validHeldOutCount': len(valid), 'unavailableHeldOutCount': len(held_out) - len(valid),
                        'heldOutMedianAbsoluteErrorMeters': float(np.median([r['absoluteErrorMeters'] for r in valid])) if valid else None,
                        'heldOutMaxAbsoluteErrorMeters': max((r['absoluteErrorMeters'] for r in valid), default=None),
                        'heldOutMedianRelativeError': float(np.median([r['relativeError'] for r in valid])) if valid else None,
                        'allRequestedHeldOutAvailable': complete, 'eligibleForPhysicalDimensionComparison': eligible},
            'caveats': ['Distances assess triangulated pixel landmarks, not reconstructed dense surfaces or compiled BIM elements.',
                        'Calibration is fitted and excluded from held-out summary metrics; withheld readings never fit geometry or scale.',
                        'Physical readings, instrument, date and uncertainty are self-reported and not independently attested.',
                        'Reading uncertainty is retained separately and does not widen any acceptance tolerance.',
                        'Reprojection residual and floor-plane fit are internal consistency metrics, not physical or survey accuracy.',
                        'Missing spans are retained as unavailable; reported error aggregates describe valid spans only.',
                        'This report does not validate openings, free space, collisions, material properties or robot execution.']}
