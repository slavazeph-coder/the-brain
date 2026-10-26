"""Evidence screening fixtures are synthetic; no physical accuracy claim."""
import copy
import importlib.util
import json
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[2] / 'scripts/world-demo/video_qualification.py'
SPEC = importlib.util.spec_from_file_location('world_video_qualification', MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
assess_quality = MODULE.assess_quality


def evidence(images=10, indices=None, models=1):
    indices = list(range(images)) if indices is None else list(indices)
    registered = len(indices)
    receipt = {'reconstructed_points': 1000, 'mean_reprojection_error_pixels': 0.5,
               'capture': {'images': images, 'registered_images': registered,
                           'registration_fraction': registered / images, 'models_found': models,
                           'consistency': {'status': 'consistent', 'thresholdDegrees': 15,
                                           'pairsChecked': registered - 1, 'pairsSkipped': 0,
                                           'pairsDisagreeing': 0, 'worstDisagreementDegrees': 2}}}
    ledger = {'frames': [{'image': {'name': f'colmap-work/images/image_{index:04d}.jpg'},
                          'timestamp': None} for index in indices]}
    scene = {'compiler': {'counts': {'walls': 2}, 'walls': [{'support_points': 40}, {'support_points': 30}]},
             'handoff': {'provenance': {'floorAligned': True, 'floorInlierFraction': 0.5}}}
    return receipt, ledger, scene


def failed_ids(report):
    return {check['id'] for check in report['checks'] if not check['passed']}


def test_complete_synthetic_evidence_passes_screening_without_physical_claims_or_mutation():
    rec, ledger, scene = evidence()
    before = copy.deepcopy((rec, ledger, scene))
    result = assess_quality(rec, ledger, scene)
    assert result['screeningPassed'] is True and result['status'] == 'passes-screening'
    assert result['physicalAccuracyValidated'] is False
    assert result['layoutUsableClaim'] is False and result['bimValidated'] is False and result['robotValidated'] is False
    assert result['thresholds']['kind'] == 'heuristic, not physical accuracy tolerances'
    assert 'not original PTS' in result['metrics']['extractedSequence']['basis']
    assert (rec, ledger, scene) == before
    json.dumps(result, allow_nan=False)


def test_partial_52_of_140_with_three_models_cannot_be_reported_as_screening_success():
    # Count/fragment shape reproduces a known failure class without private media or identity.
    rec, ledger, scene = evidence(140, range(52), models=3)
    result = assess_quality(rec, ledger, scene)
    assert result['status'] == 'review-required' and result['screeningPassed'] is False
    assert {'registration-fraction', 'single-model', 'extracted-sequence-coverage'} <= failed_ids(result)
    assert result['metrics']['registrationFraction'] == 52 / 140
    assert result['metrics']['extractedSequence']['trailingMissingFrames'] == 88
    assert result['physicalAccuracyValidated'] is False


@pytest.mark.parametrize('receipt,ledger', [(None, None), ({}, {}), ([], []),
                                          ({'capture': {}}, {'frames': []})])
def test_absent_or_malformed_evidence_requires_review(receipt, ledger):
    result = assess_quality(receipt, ledger)
    assert result['screeningPassed'] is False
    assert {'reconstruction-counts', 'registered-ledger', 'extracted-sequence-coverage'} <= failed_ids(result)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize('field,value', [('images', 0), ('images', True), ('registered_images', 11),
                                       ('registered_images', 0), ('models_found', 0),
                                       ('images', 10**400),
                                       ('registration_fraction', float('nan')),
                                       ('registration_fraction', float('inf')),
                                       ('registration_fraction', 0.8), ('registration_fraction', True)])
def test_invalid_counts_or_disagreeing_registration_fraction_fail_closed(field, value):
    rec, ledger, _ = evidence()
    rec['capture'][field] = value
    result = assess_quality(rec, ledger)
    assert not result['screeningPassed']
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize('field,value', [('reconstructed_points', 0), ('reconstructed_points', True),
                                       ('mean_reprojection_error_pixels', float('nan')),
                                       ('mean_reprojection_error_pixels', 10**400),
                                       ('mean_reprojection_error_pixels', -0.01)])
def test_no_point_or_error_evidence_passes_by_accident(field, value):
    rec, ledger, _ = evidence()
    rec[field] = value
    assert 'point-and-error-evidence' in failed_ids(assess_quality(rec, ledger))


@pytest.mark.parametrize('change', [{'status': 'folded'}, {'status': 'not-checked'}, {'pairsChecked': 0},
                                   {'pairsDisagreeing': 1}, {'pairsSkipped': 1},
                                   {'worstDisagreementDegrees': float('nan')},
                                   {'worstDisagreementDegrees': 16}, {'thresholdDegrees': 0}])
def test_missing_or_self_contradicting_turn_checks_require_review(change):
    rec, ledger, _ = evidence()
    rec['capture']['consistency'].update(change)
    assert 'consecutive-frame-consistency' in failed_ids(assess_quality(rec, ledger))


@pytest.mark.parametrize('change', ['missing', 'unknown-name', 'duplicate', 'out-of-range', 'wrong-ledger-count'])
def test_ledger_sequence_requires_actual_unique_in_range_index_evidence(change):
    rec, ledger, _ = evidence()
    if change == 'missing':
        ledger['frames'][0] = {}
    elif change == 'unknown-name':
        ledger['frames'][0]['image']['name'] = 'colmap-work/images/phone-photo.jpg'
    elif change == 'duplicate':
        ledger['frames'][1] = copy.deepcopy(ledger['frames'][0])
    elif change == 'out-of-range':
        ledger['frames'][0]['image']['name'] = 'colmap-work/images/image_0010.jpg'
    else:
        ledger['frames'].pop()
    result = assess_quality(rec, ledger)
    assert 'extracted-sequence-coverage' in failed_ids(result)
    if change == 'wrong-ledger-count':
        assert 'registered-ledger' in failed_ids(result)


def test_sequence_metrics_retain_leading_interior_and_trailing_gaps_without_inventing_time():
    rec, ledger, _ = evidence(10, [1, 2, 3, 5, 6, 7, 8])
    result = assess_quality(rec, ledger)
    sequence = result['metrics']['extractedSequence']
    assert sequence['leadingMissingFrames'] == sequence['trailingMissingFrames'] == 1
    assert sequence['largestInteriorMissingRun'] == 1
    assert sequence['spanFraction'] == 0.8
    assert result['screeningPassed'] is False
    assert not any('seconds' in name.lower() for name in sequence)


@pytest.mark.parametrize('wall_change', ['empty', 'weak', 'missing', 'bool', 'wrong-count'])
def test_empty_or_weak_wall_evidence_never_passes_a_vacuous_all_gate(wall_change):
    rec, ledger, scene = evidence()
    if wall_change == 'empty':
        scene['compiler']['walls'] = []
        scene['compiler']['counts']['walls'] = 0
    elif wall_change == 'wrong-count':
        scene['compiler']['counts']['walls'] = 3
    else:
        scene['compiler']['walls'][0] = {'support_points': {'weak': 1, 'missing': None, 'bool': True}[wall_change]}
    assert 'wall-support' in failed_ids(assess_quality(rec, ledger, scene))


@pytest.mark.parametrize('change', [{'floorAligned': False}, {'floorAligned': 1},
                                   {'floorInlierFraction': 0.149}, {'floorInlierFraction': None},
                                   {'floorInlierFraction': float('nan')}, {'floorInlierFraction': 1.1}])
def test_unaligned_or_weak_floor_requires_review(change):
    rec, ledger, scene = evidence()
    scene['handoff']['provenance'].update(change)
    result = assess_quality(rec, ledger, scene)
    assert 'floor-evidence' in failed_ids(result)
    json.dumps(result, allow_nan=False)


def test_scene_is_optional_but_supplied_malformed_scene_fails_closed():
    rec, ledger, _ = evidence()
    assert assess_quality(rec, ledger)['screeningPassed'] is True
    assert assess_quality(rec, ledger)['metrics']['sceneAssessed'] is False
    assert {'wall-support', 'floor-evidence'} <= failed_ids(assess_quality(rec, ledger, {}))


def test_explicit_threshold_overrides_are_recorded_and_do_not_create_accuracy_claims():
    rec, ledger, scene = evidence(10, range(8))
    scene['compiler']['walls'][0]['support_points'] = 5
    assert not assess_quality(rec, ledger, scene)['screeningPassed']
    result = assess_quality(rec, ledger, scene, min_registration_fraction=0.8, min_wall_support=5)
    assert result['screeningPassed'] is True
    assert result['thresholds']['minRegistrationFraction'] == 0.8
    assert result['thresholds']['minWallSupportPoints'] == 5
    assert result['physicalAccuracyValidated'] is False


@pytest.mark.parametrize('kwargs', [{'min_registration_fraction': 0}, {'min_registration_fraction': 1.1},
                                   {'min_registration_fraction': float('nan')}, {'min_registration_fraction': True},
                                   {'min_registration_fraction': '0.9'}, {'min_wall_support': 0},
                                   {'min_wall_support': 1.5}, {'min_wall_support': True}])
def test_invalid_thresholds_are_the_only_caller_configuration_errors(kwargs):
    rec, ledger, scene = evidence()
    with pytest.raises(ValueError):
        assess_quality(rec, ledger, scene, **kwargs)
