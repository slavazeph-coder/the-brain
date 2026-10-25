"""Operator review admission and scene-binding tests, using authored synthetic geometry."""
import copy
import math

import pytest

from robotics.world_worker import bim_review as br
from robotics.world_worker.measurement_check import points_sha256


def cloud():
    return {'units': 'm', 'coordinateFrame': 'right-handed-y-up',
            'scale': {'source': 'user-measured', 'metresPerUnit': 1, 'selfReported': True, 'verified': False},
            'points': [[0, 0, 0, 10, 20, 30], [4, 0, 0, 10, 20, 30], [0, 3, 0, 10, 20, 30]]}


def wall():
    return {'name': 'wall_1', 'centre': [0, 1.5, 0], 'size': [4, 3, .2], 'yaw_degrees': 30}


def opening(**changes):
    value = {'id': 'entry', 'hostWall': 'wall_1', 'offsetMeters': 1, 'widthMeters': 1,
             'heightMeters': 2, 'sillMeters': 0, 'kind': 'opening', 'reviewed': True,
             'host': {key: copy.deepcopy(wall()[key]) for key in ('centre', 'size', 'yaw_degrees')}}
    value.update(changes)
    return value


def review(c, openings=None):
    return {'schema': br.SCHEMA, 'cloudPointsSha256': points_sha256(c),
            'openings': openings if openings is not None else [opening()]}


def scene(c):
    return {'schema': 'brainsnn.scene.v1', 'units': 'm', 'scale': copy.deepcopy(c['scale']),
            'walls': [wall()], 'objects': [], 'metricVerified': False}


def test_valid_review_is_a_defensive_copy_and_preserves_source_geometry_and_scale():
    c = cloud(); c['bimReview'] = review(c)
    s = scene(c); original = copy.deepcopy((s, c))
    result = br.apply_review(s, c)
    assert (s, c) == original
    assert result['walls'] == s['walls'] and result['scale'] == s['scale']
    assert result['openings'] == c['bimReview']['openings']
    assert result['bimReview']['authority'] == 'operator-declared-review'
    assert result['bimReview']['metricVerified'] is False and result['bimReview']['clearanceVerified'] is False
    result['openings'][0]['host']['centre'][0] = 100
    assert (s, c) == original


def test_omitted_review_leaves_arbitrary_or_metric_scene_unchanged():
    c = cloud(); s = scene(c)
    assert br.validate_review(None, c) is None
    assert br.apply_review(s, c) == s


def test_point_colour_order_and_scale_changes_invalidate_the_review_binding():
    c = cloud(); value = review(c)
    for modify in (lambda d: d['points'].reverse(), lambda d: d['points'][0].__setitem__(3, 99),
                   lambda d: d['points'][1].__setitem__(0, 8)):
        changed = copy.deepcopy(c); modify(changed)
        with pytest.raises(ValueError, match='SHA-256'):
            br.validate_review(value, changed)
    with pytest.raises(ValueError, match='metres'):
        br.validate_review(value, {**c, 'units': 'arbitrary'})


@pytest.mark.parametrize('changes', [
    {'reviewed': False}, {'reviewed': 1}, {'kind': 'window'}, {'widthMeters': True},
    {'widthMeters': 0}, {'heightMeters': -1}, {'offsetMeters': -1}, {'sillMeters': math.nan},
    {'widthMeters': math.inf}, {'widthMeters': 5}, {'heightMeters': 4},
    {'kind': 'door', 'sillMeters': .1}, {'hostWall': ''}, {'id': '../unbounded'}, {'extra': 'guess'},
])
def test_unreviewed_invalid_or_out_of_host_openings_are_refused(changes):
    c = cloud()
    with pytest.raises(ValueError):
        br.validate_review(review(c, [opening(**changes)]), c)


def test_unique_ids_nonoverlapping_rectangles_and_matching_host_snapshots_are_required():
    c = cloud()
    with pytest.raises(ValueError, match='unique'):
        br.validate_review(review(c, [opening(), opening()]), c)
    with pytest.raises(ValueError, match='overlap'):
        br.validate_review(review(c, [opening(), opening(id='second', offsetMeters=1.5)]), c)
    # Abutting void edges are allowed; a separate elevated opening is also allowed.
    assert len(br.validate_review(review(c, [opening(), opening(id='second', offsetMeters=2)]), c)['openings']) == 2
    assert len(br.validate_review(review(c, [opening(heightMeters=1), opening(id='upper', sillMeters=1, heightMeters=1)]), c)['openings']) == 2
    bad_host = copy.deepcopy(opening()['host']); bad_host['centre'][0] += .1
    with pytest.raises(ValueError, match='snapshot'):
        br.validate_review(review(c, [opening(), opening(id='second', offsetMeters=2, host=bad_host)]), c)


def test_changed_or_missing_host_and_mismatched_scale_are_refused_during_scene_application():
    c = cloud(); c['bimReview'] = review(c); s = scene(c)
    for key, changed in [('walls', []), ('walls', [{**wall(), 'centre': [1, 1.5, 0]}]),
                         ('scale', {**s['scale'], 'metresPerUnit': 2}), ('units', 'arbitrary')]:
        with pytest.raises(ValueError):
            br.apply_review({**s, key: changed}, c)


def test_limits_and_unknown_top_level_or_host_fields_are_refused():
    c = cloud()
    for value in ({**review(c), 'extra': 1}, review(c, []),
                  review(c, [opening(id=f'entry-{i}') for i in range(br.MAX_OPENINGS + 1)]),
                  review(c, [opening(host={**opening()['host'], 'guess': 1})])):
        with pytest.raises(ValueError):
            br.validate_review(value, c)
