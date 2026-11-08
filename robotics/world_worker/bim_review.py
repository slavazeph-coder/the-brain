"""Bounded, operator-reviewed BIM openings anchored to an exact cloud and host wall.

This creates IFC authoring instructions, not an automatic door detector or a
physical-clearance claim. The point cloud, scale and planning approvals are never
changed. Other visual/planning representations must explicitly apply the edits
before being described as matching the reviewed IFC.
"""
from __future__ import annotations

import copy
import json
import math
import re

try:
    from .measurement_check import points_sha256
except ImportError:
    from measurement_check import points_sha256

SCHEMA = 'brainsnn.bim-review.v1'
MAX_BYTES = 64 * 1024
MAX_OPENINGS = 32
_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
_SHA = re.compile(r'^[a-f0-9]{64}$')


def _exact(value, keys, name):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f'Invalid {name} fields.')


def _number(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name} must be finite and between {low} and {high}.')


def _shape(value):
    try:
        size = len(json.dumps(value, allow_nan=False, ensure_ascii=False).encode('utf-8'))
    except (ValueError, TypeError, RecursionError, UnicodeError) as error:
        raise ValueError('BIM review must be finite JSON.') from error
    if size > MAX_BYTES:
        raise ValueError('BIM review exceeds 64 KiB.')
    _exact(value, ['schema', 'cloudPointsSha256', 'openings'], 'BIM review')
    if value['schema'] != SCHEMA or not isinstance(value['cloudPointsSha256'], str) or not _SHA.fullmatch(value['cloudPointsSha256']):
        raise ValueError('Invalid BIM review schema or cloud hash.')
    if not isinstance(value['openings'], list) or not 1 <= len(value['openings']) <= MAX_OPENINGS:
        raise ValueError('Provide 1 to 32 reviewed openings, or omit BIM review.')
    ids = set()
    for opening in value['openings']:
        _exact(opening, ['id', 'hostWall', 'offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters',
                         'kind', 'reviewed', 'host'], 'opening')
        if not isinstance(opening['id'], str) or not _ID.fullmatch(opening['id']) or opening['id'] in ids:
            raise ValueError('Opening IDs must be unique bounded identifiers.')
        ids.add(opening['id'])
        if not isinstance(opening['hostWall'], str) or not 1 <= len(opening['hostWall']) <= 160:
            raise ValueError('Choose a host wall from the compiled scene.')
        if opening['kind'] not in ('opening', 'door') or opening['reviewed'] is not True:
            raise ValueError('Every opening or door needs an explicit operator review.')
        for field, low, high in [('offsetMeters', 0, 10_000), ('widthMeters', .05, 100),
                                 ('heightMeters', .05, 100), ('sillMeters', 0, 100)]:
            _number(opening[field], low, high, field)
        host = opening['host']
        _exact(host, ['centre', 'size', 'yaw_degrees'], 'opening host snapshot')
        for field, low, high in [('centre', -10_000_000, 10_000_000), ('size', .001, 100_000)]:
            if not isinstance(host[field], list) or len(host[field]) != 3:
                raise ValueError('Host centre and size need three coordinates.')
            for number in host[field]:
                _number(number, low, high, 'Host ' + field)
        _number(host['yaw_degrees'], -360, 360, 'Host yaw')
        length, height, _thickness = host['size']
        if opening['offsetMeters'] + opening['widthMeters'] > length + 1e-9 \
                or opening['sillMeters'] + opening['heightMeters'] > height + 1e-9:
            raise ValueError('The opening must fit inside its host wall.')
        if opening['kind'] == 'door' and opening['sillMeters'] != 0:
            raise ValueError('A reviewed door must start at the wall base; use an opening for an elevated void.')
    # Reject overlapping void rectangles in the same wall. Merely touching edges are allowed.
    for index, first in enumerate(value['openings']):
        for second in value['openings'][index + 1:]:
            if first['hostWall'] != second['hostWall']:
                continue
            if first['host'] != second['host']:
                raise ValueError('Openings on one wall must share the same host snapshot.')
            horizontal = min(first['offsetMeters'] + first['widthMeters'], second['offsetMeters'] + second['widthMeters']) \
                - max(first['offsetMeters'], second['offsetMeters'])
            vertical = min(first['sillMeters'] + first['heightMeters'], second['sillMeters'] + second['heightMeters']) \
                - max(first['sillMeters'], second['sillMeters'])
            if horizontal > 1e-9 and vertical > 1e-9:
                raise ValueError('Reviewed openings on one wall must not overlap.')


def validate_review(value, cloud):
    """Validate an optional cloud-embedded review before compilation; approval is self-reported."""
    if value is None:
        return None
    _shape(value)
    if value['cloudPointsSha256'] != points_sha256(cloud):
        raise ValueError('BIM review point SHA-256 does not match this cloud.')
    return copy.deepcopy(value)


def apply_review(scene, cloud):
    """Return a reviewed scene copy with hosted opening instructions; leave the inputs unchanged."""
    result = copy.deepcopy(scene)
    value = validate_review(cloud.get('bimReview'), cloud)
    if value is None:
        return result
    if scene.get('units') != 'm' or scene.get('scale') != cloud.get('scale'):
        raise ValueError('BIM review requires matching metric scene and cloud scale.')
    walls = scene.get('walls')
    if not isinstance(walls, list):
        raise ValueError('The compiled scene has no host walls.')
    by_name = {}
    for wall in walls:
        if not isinstance(wall, dict) or not isinstance(wall.get('name'), str) or wall['name'] in by_name:
            raise ValueError('Compiled host wall names must be unique.')
        by_name[wall['name']] = wall
    for opening in value['openings']:
        wall = by_name.get(opening['hostWall'])
        if wall is None:
            raise ValueError('The reviewed host wall is not in this compiled scene.')
        snapshot = {key: wall.get(key, 0 if key == 'yaw_degrees' else None) for key in ('centre', 'size', 'yaw_degrees')}
        if snapshot != opening['host']:
            raise ValueError('The reviewed host wall geometry has changed; review it again.')
    result['openings'] = value['openings']
    result['bimReview'] = {'schema': SCHEMA, 'cloudPointsSha256': value['cloudPointsSha256'],
                           'openingCount': len(value['openings']), 'authority': 'operator-declared-review',
                           'metricVerified': False, 'clearanceVerified': False,
                           'representationScope': 'IFC hosted openings; other representations require matching cuts'}
    return result
