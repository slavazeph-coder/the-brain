"""Heuristic screening of retained video reconstruction evidence.

This pure evaluator runs no reconstruction and reads no files. Its checks are
quality triage, not measured accuracy, BIM acceptance or robot qualification.
The caller must separately verify the receipt/ledger/artifact hash bindings.
"""
from __future__ import annotations

import math
import re


_IMAGE_INDEX = re.compile(r"(?:^|/)image_([0-9]+)\.(?:jpg|jpeg|png)$", re.IGNORECASE)
_FLOOR_INLIER_FRACTION = 0.20


def _mapping(value):
    return value if isinstance(value, dict) else {}


def _positive_int(value):
    return type(value) is int and 0 < value <= 2**53 - 1


def _nonnegative_int(value):
    return type(value) is int and 0 <= value <= 2**53 - 1


def _finite(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _number(value):
    return value if _finite(value) else None


def assess_quality(reconstruction, ledger, scene_receipt=None, *,
                   min_registration_fraction=0.90, min_wall_support=20):
    """Return JSON-safe screening results; malformed evidence requires review.

    ``min_registration_fraction`` also bounds missing extracted-frame runs and
    leading/trailing gaps. Image indices describe the prepared extraction
    sequence, never original video timestamps or elapsed-time coverage.
    A supplied scene additionally needs nonempty supported wall primitives and
    an aligned floor with at least 20% fitted-plane inliers. All thresholds are
    operator-adjustable or documented heuristics, not physical tolerances.
    """
    if not (_finite(min_registration_fraction) and 0 < min_registration_fraction <= 1):
        raise ValueError('min_registration_fraction must be finite and greater than 0 through 1.')
    if not _positive_int(min_wall_support):
        raise ValueError('min_wall_support must be a positive integer.')

    reconstruction = _mapping(reconstruction)
    ledger = _mapping(ledger)
    capture = _mapping(reconstruction.get('capture'))
    consistency = _mapping(capture.get('consistency'))
    images, registered = capture.get('images'), capture.get('registered_images')
    fraction, models = capture.get('registration_fraction'), capture.get('models_found')
    frames = ledger.get('frames')
    frames_valid = isinstance(frames, list) and bool(frames)
    counts_valid = (_positive_int(images) and _positive_int(registered)
                    and registered <= images and _positive_int(models))
    fraction_agrees = (counts_valid and _finite(fraction) and 0 < fraction <= 1
                       and math.isclose(fraction, registered / images, rel_tol=0, abs_tol=1e-9))
    checks = []

    def check(identifier, passed, reason):
        checks.append({'id': identifier, 'passed': bool(passed), 'reason': reason})

    check('reconstruction-counts', counts_valid,
          'Extracted, registered and discovered-model counts must be positive integers; registered cannot exceed extracted.')
    check('registration-fraction', fraction_agrees and fraction >= min_registration_fraction,
          'The reported fraction must agree with the selected registered/extracted counts and meet the heuristic minimum.')
    check('single-model', _positive_int(models) and models == 1,
          'Multiple discovered models require review for disconnected or omitted geometry.')
    check('registered-ledger', frames_valid and _positive_int(registered) and len(frames) == registered,
          'A nonempty camera ledger must contain exactly the selected registered-frame count.')

    points, error = reconstruction.get('reconstructed_points'), reconstruction.get('mean_reprojection_error_pixels')
    check('point-and-error-evidence', _positive_int(points) and _finite(error) and error >= 0,
          'A positive point count and finite nonnegative reprojection error are required; pixel error does not establish physical accuracy.')

    checked, skipped = consistency.get('pairsChecked'), consistency.get('pairsSkipped')
    disagreeing, worst = consistency.get('pairsDisagreeing'), consistency.get('worstDisagreementDegrees')
    turn_threshold = consistency.get('thresholdDegrees')
    turns_valid = (consistency.get('status') == 'consistent'
                   and _positive_int(checked) and _nonnegative_int(skipped)
                   and _nonnegative_int(disagreeing) and disagreeing == 0
                   and _positive_int(registered) and checked + skipped == registered - 1
                   and _finite(worst) and _finite(turn_threshold)
                   and 0 < turn_threshold <= 180 and 0 <= worst <= turn_threshold)
    check('consecutive-frame-consistency', turns_valid,
          'A consistent fold check must actually check pairs, account for the selected sequence and report no threshold disagreements.')

    indices = []
    index_evidence_valid = frames_valid
    if frames_valid:
        for frame in frames:
            name = _mapping(_mapping(frame).get('image')).get('name')
            match = _IMAGE_INDEX.search(name) if isinstance(name, str) else None
            if match is None:
                index_evidence_valid = False
                break
            try:
                indices.append(int(match.group(1)))
            except ValueError:
                index_evidence_valid = False
                break
    index_evidence_valid = (index_evidence_valid and counts_valid
                            and len(indices) == registered and len(set(indices)) == len(indices)
                            and all(0 <= index < images for index in indices))
    sequence = {'basis': 'prepared extracted-frame image indices; not original PTS or elapsed-time coverage',
                'evidenceAvailable': bool(index_evidence_valid), 'firstRegisteredIndex': None,
                'lastRegisteredIndex': None, 'spanFraction': None,
                'leadingMissingFrames': None, 'trailingMissingFrames': None,
                'largestInteriorMissingRun': None, 'largestMissingRun': None,
                'allowedMissingRun': None}
    sequence_ok = False
    if index_evidence_valid:
        indices.sort()
        leading, trailing = indices[0], images - 1 - indices[-1]
        interior = max((second - first - 1 for first, second in zip(indices, indices[1:])), default=0)
        allowed = math.floor(images * (1 - min_registration_fraction) + 1e-9)
        span = (indices[-1] - indices[0] + 1) / images
        sequence.update(firstRegisteredIndex=indices[0], lastRegisteredIndex=indices[-1], spanFraction=span,
                        leadingMissingFrames=leading, trailingMissingFrames=trailing,
                        largestInteriorMissingRun=interior, largestMissingRun=max(leading, trailing, interior),
                        allowedMissingRun=allowed)
        sequence_ok = span + 1e-9 >= min_registration_fraction and max(leading, trailing, interior) <= allowed
    check('extracted-sequence-coverage', sequence_ok,
          'Unique in-range extracted-frame indices must establish sequence coverage and bounded missing runs; missing evidence cannot pass.')

    metrics = {'extractedFrames': images if _positive_int(images) else None,
               'registeredFrames': registered if _positive_int(registered) else None,
               'registrationFraction': _number(fraction),
               'computedRegistrationFraction': registered / images if counts_valid else None,
               'modelsFound': models if _positive_int(models) else None,
               'ledgerFrames': len(frames) if isinstance(frames, list) else None,
               'reconstructedPoints': points if _positive_int(points) else None,
               'meanReprojectionErrorPixels': _number(error), 'extractedSequence': sequence,
               'consistencyStatus': consistency.get('status') if isinstance(consistency.get('status'), str) else None,
               'sceneAssessed': scene_receipt is not None}

    if scene_receipt is not None:
        scene = _mapping(scene_receipt)
        compiler = _mapping(scene.get('compiler'))
        walls = compiler.get('walls')
        counts = _mapping(compiler.get('counts'))
        walls_valid = isinstance(walls, list) and bool(walls)
        supports = [_mapping(wall).get('support_points') for wall in walls] if walls_valid else []
        support_evidence = walls_valid and all(_positive_int(value) for value in supports)
        wall_count = counts.get('walls')
        wall_count_agrees = _positive_int(wall_count) and walls_valid and wall_count == len(walls)
        weak = sum(not _positive_int(value) or value < min_wall_support for value in supports) if walls_valid else None
        check('wall-support', support_evidence and wall_count_agrees and weak == 0,
              'A supplied scene needs nonempty wall primitives, agreeing counts and sufficient point support for every primitive; these are not verified physical walls.')
        provenance = _mapping(_mapping(scene.get('handoff')).get('provenance'))
        floor_fraction = provenance.get('floorInlierFraction')
        floor_ok = (provenance.get('floorAligned') is True and _finite(floor_fraction)
                    and _FLOOR_INLIER_FRACTION <= floor_fraction <= 1)
        check('floor-evidence', floor_ok,
              'The estimated floor must be aligned with at least 20% plane inliers, a review heuristic rather than a measured floor validation.')
        metrics.update(wallPrimitives=len(walls) if isinstance(walls, list) else None,
                       weakWallPrimitives=weak,
                       minimumWallSupport=min(supports) if support_evidence else None,
                       floorAligned=provenance.get('floorAligned') is True,
                       floorInlierFraction=_number(floor_fraction))

    passed = all(item['passed'] for item in checks)
    return {'schema': 'brainsnn.video-quality-screening.v1',
            'status': 'passes-screening' if passed else 'review-required', 'screeningPassed': passed,
            'physicalAccuracyValidated': False, 'layoutUsableClaim': False,
            'bimValidated': False, 'robotValidated': False,
            'surfaceCompletenessValidated': False, 'geographicAlignmentValidated': False,
            'assessmentScope': 'reconstruction-and-scene' if scene_receipt is not None else 'reconstruction-only',
            'scope': 'Heuristic review of reported geometry evidence. File integrity, source binding and physical accuracy require separate checks.',
            'thresholds': {'kind': 'heuristic, not physical accuracy tolerances',
                           'minRegistrationFraction': min_registration_fraction,
                           'minWallSupportPoints': min_wall_support,
                           'minFloorInlierFraction': _FLOOR_INLIER_FRACTION},
            'checks': checks, 'metrics': metrics}
