"""Source-scoped component identities and atomic, bounded scene edits.

IDs describe continuity within one captured reconstruction, not object recognition
across captures. Legacy callers without a source hash get an explicitly labelled
geometry-scoped namespace. Edits author geometry; they never verify measurements.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import unicodedata
import uuid

SCHEMA = 'brainsnn.component-graph.v1'
EDIT_SCHEMA = 'brainsnn.component-edits.v1'
MAX_COMPONENTS = 1024
MAX_EDITS = 32
MAX_HISTORY = 64
MAX_EDIT_BYTES = 64 * 1024
MAX_SCENE_BYTES = 16 * 1024 * 1024
_SHA = re.compile(r'^[a-f0-9]{64}$')
_OPENING_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
_KINDS = ('wall', 'object', 'opening')
_INVALIDATED = ['fit', 'measurements', 'routes', 'navigation', 'exports']
_ACCURACY_FLAGS = ('metric_verified', 'metricVerified', 'certified', 'clearanceVerified', 'physicalRobotValidated')
_CONTENT_KEYS = ('schema', 'source', 'cloudPointsSha256', 'units', 'scale', 'floor_y',
                 'walls', 'objects', 'openings', 'unknown')


def _fail(message):
    raise ValueError(message)


def _json(value, limit=MAX_SCENE_BYTES):
    # JSON's implicit conversion of non-string dict keys would make hashes ambiguous.
    def keys(item, depth=0):
        if depth > 64:
            _fail('Scene JSON is too deeply nested.')
        if isinstance(item, dict):
            if any(not isinstance(key, str) for key in item):
                _fail('Scene JSON object keys must be strings.')
            for child in item.values():
                keys(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                keys(child, depth + 1)
        elif item is not None and type(item) not in (str, int, float, bool):
            _fail('Scene values must be plain JSON.')
    try:
        keys(value)
        raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                         allow_nan=False).encode('ascii')
    except (TypeError, ValueError, RecursionError, UnicodeError) as error:
        raise ValueError('Scene evidence must be bounded finite JSON.') from error
    if len(raw) > limit:
        _fail('Scene evidence exceeds its byte limit.')
    return raw


def scene_sha256(scene):
    """Digest the complete canonical finite JSON scene, including revision/history."""
    if not isinstance(scene, dict):
        _fail('Use a scene JSON object.')
    return hashlib.sha256(_json(scene)).hexdigest()


def _hash(value, name):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        _fail(f'{name} must be a lowercase SHA-256 digest.')
    return value


def _text(value, name, limit=160):
    if not isinstance(value, str) or not value.strip() or len(value) > limit \
            or any(unicodedata.category(char).startswith('C') for char in value):
        _fail(f'{name} needs 1 to {limit} plain characters.')
    return value


def _number(value, low, high, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        _fail(f'{name} must be finite and between {low} and {high}.')
    return value


def _vector(value, low, high, name):
    if not isinstance(value, list) or len(value) != 3:
        _fail(f'{name} needs exactly three coordinates.')
    return [_number(number, low, high, name) for number in value]


def derive_id(source_hash, kind, key):
    """Deterministic UUID5; exporters can derive hierarchy and representation IDs."""
    _hash(source_hash, 'Source hash')
    _text(kind, 'Component kind', 64)
    _text(key, 'Component key', 240)
    namespace = uuid.uuid5(uuid.NAMESPACE_URL, 'brainsnn.component-source.v1:' + source_hash)
    return str(uuid.uuid5(namespace, kind + ':' + key))


def _content(scene):
    # Export receipts and recomputed fit reports may be added without changing identity.
    return {key: scene[key] for key in _CONTENT_KEYS if key in scene}


def _content_hash(scene):
    return hashlib.sha256(_json(_content(scene))).hexdigest()


def source_sha256(scene):
    """Use the saved source hash, or a labelled legacy geometry fingerprint.

    The fallback excludes labels, names and export receipts. It is not asserted
    to identify an original camera capture and must not be presented as one.
    """
    if not isinstance(scene, dict):
        _fail('Use a scene JSON object.')
    _json(scene)
    if 'componentGraph' in scene:
        graph = scene['componentGraph']
        if not isinstance(graph, dict):
            _fail('Invalid component graph.')
        return _hash(graph.get('sourceSha256'), 'Component source hash')
    if 'cloudPointsSha256' in scene:
        return _hash(scene['cloudPointsSha256'], 'Cloud point hash')
    body = {key: scene[key] for key in ('schema', 'source', 'units', 'scale', 'floor_y', 'unknown') if key in scene}
    walls = scene.get('walls', [])
    host_indices = {wall.get('name'): index for index, wall in enumerate(walls) if isinstance(wall, dict)}
    for field in ('walls', 'objects'):
        body[field] = [{key: item[key] for key in ('centre', 'size', 'yaw_degrees', 'min', 'max', 'base') if key in item}
                       for item in scene.get(field, []) if isinstance(item, dict)]
    body['openings'] = [{**{key: item[key] for key in ('offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters', 'kind') if key in item},
                         'hostIndex': host_indices.get(item.get('hostWall'))}
                        for item in scene.get('openings', []) if isinstance(item, dict)]
    return hashlib.sha256(b'brainsnn.legacy-component-geometry.v1\0' + _json(body)).hexdigest()


def _snapshot(wall):
    return {key: copy.deepcopy(wall.get(key, 0 if key == 'yaw_degrees' else None))
            for key in ('centre', 'size', 'yaw_degrees')}


def _check_host(host, wall):
    if not isinstance(host, dict) or set(host) != {'centre', 'size', 'yaw_degrees'}:
        _fail('Opening host needs an exact geometry snapshot.')
    _vector(host['centre'], -10_000_000, 10_000_000, 'Host centre')
    _vector(host['size'], .001, 100_000, 'Host size')
    _number(host['yaw_degrees'], -360, 360, 'Host yaw')
    # JSON encoders may write the same numeric coordinate as 1 or 1.0. Booleans
    # have already been excluded, so numeric equality retains the existing API.
    if host != _snapshot(wall):
        _fail('Opening host geometry is stale.')


def _authored_geometry(item, edit, default_provenance):
    if item.get('parameterProvenance') is not None and not isinstance(item['parameterProvenance'], dict):
        _fail('Parameter provenance must be a JSON object.')
    item.setdefault('sourceProvenance', copy.deepcopy(item.get('provenance', default_provenance)))
    item['provenance'] = 'operator-authored-edit'
    item['dimensionProvenance'] = 'operator-authored-edit'
    item['parameterProvenance'] = {**(item.get('parameterProvenance') or {}),
        **{key: 'operator-authored-edit' for key in edit if key not in ('op', 'componentId')}}
    if 'support_points' in item:
        item['supportPointsScope'] = 'original-source-not-edited-geometry'


def _components(scene):
    entries, names, walls = [], set(), {}
    for kind, field in zip(_KINDS, ('walls', 'objects', 'openings')):
        items = scene.get(field, [])
        if not isinstance(items, list) or len(items) > MAX_COMPONENTS:
            _fail('Scene component lists must be bounded arrays.')
        if kind == 'opening' and len(items) > 32:
            _fail('Use at most 32 hosted openings.')
        local_ids = set()
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                _fail('Each component must be a JSON object.')
            if kind != 'opening':
                name = _text(item.get('name'), 'Component name')
                if name in names:
                    _fail('Internal wall and object names must be unique.')
                names.add(name)
                if kind == 'wall':
                    walls[name] = item
                if kind == 'wall' or 'centre' in item or 'size' in item:
                    _vector(item.get('centre'), -10_000_000, 10_000_000, 'Component centre')
                    _vector(item.get('size'), .001, 100_000, 'Component size')
                    _number(item.get('yaw_degrees', 0), -360, 360, 'Component yaw')
            else:
                name = _text(item.get('id'), 'Opening identifier', 64)
                if not _OPENING_ID.fullmatch(name) or name in local_ids:
                    _fail('Opening identifiers must be unique bounded alphanumeric IDs.')
                local_ids.add(name)
                if not isinstance(item.get('hostWall'), str) or item['hostWall'] not in walls:
                    _fail('Every opening needs an existing host wall.')
                if item.get('kind') not in ('opening', 'door') or item.get('reviewed') is not True:
                    _fail('Openings require explicit operator-authored geometric intent.')
                for key, low, high in (('offsetMeters', 0, 100_000), ('widthMeters', .05, 100),
                                       ('heightMeters', .05, 100), ('sillMeters', 0, 100)):
                    _number(item.get(key), low, high, key)
                wall = walls[item['hostWall']]
                if item['offsetMeters'] + item['widthMeters'] > wall['size'][0] + 1e-9 \
                        or item['sillMeters'] + item['heightMeters'] > wall['size'][1] + 1e-9:
                    _fail('The opening must fit inside its host wall.')
                if item['kind'] == 'door' and item['sillMeters'] != 0:
                    _fail('A door must start at the host wall base.')
                if 'host' in item:
                    _check_host(item['host'], wall)
            if 'label' in item:
                _text(item['label'], 'Component label')
            entries.append((kind, index, name, item))
    if len(entries) > MAX_COMPONENTS:
        _fail('Scene has too many components.')
    holes = scene.get('openings', [])
    for index, first in enumerate(holes):
        for second in holes[index + 1:]:
            if first['hostWall'] == second['hostWall'] and \
                    min(first['offsetMeters'] + first['widthMeters'], second['offsetMeters'] + second['widthMeters']) - max(first['offsetMeters'], second['offsetMeters']) > 1e-9 and \
                    min(first['sillMeters'] + first['heightMeters'], second['sillMeters'] + second['heightMeters']) - max(first['sillMeters'], second['sillMeters']) > 1e-9:
                _fail('Hosted openings must not overlap.')
    return entries


def _inventory(scene, source_hash, *, attach=False):
    entries = _components(scene)
    walls = {item['name']: item for kind, _index, _name, item in entries if kind == 'wall'}
    result = []
    for kind, index, name, item in entries:
        identifier = derive_id(source_hash, kind, str(index))
        if attach:
            item['componentId'] = identifier
        elif item.get('componentId') != identifier:
            _fail('Component identity is missing, changed or outside its source namespace.')
        entry = {'componentId': identifier, 'kind': kind, 'index': index, 'sourceName': name}
        if kind == 'opening':
            host_id = walls[item['hostWall']]['componentId']
            if attach:
                item['hostComponentId'] = host_id
                item['host'] = _snapshot(walls[item['hostWall']])
            elif item.get('hostComponentId') != host_id:
                _fail('Opening component host is stale.')
            entry['hostComponentId'] = host_id
            if item['kind'] == 'door':
                door_id = derive_id(source_hash, 'door', str(index))
                if attach:
                    item['doorComponentId'] = door_id
                elif item.get('doorComponentId') != door_id:
                    _fail('Door identity is missing or outside its source namespace.')
                entry['doorComponentId'] = door_id
            elif 'doorComponentId' in item:
                _fail('An unfilled opening cannot carry a door identity.')
        result.append(entry)
    return result


def attach_component_ids(scene, source_sha256=None):
    """Return an identified scene copy; existing graphs are checked, never re-keyed."""
    scene_sha256(scene)
    result = copy.deepcopy(scene)
    if 'componentGraph' in result:
        _validate_graph(result)
        if source_sha256 is not None and _hash(source_sha256, 'Source hash') != result['componentGraph']['sourceSha256']:
            _fail('An identified scene cannot change source namespace.')
        return result
    entries = _components(result)
    if any(any(key in item for key in ('componentId', 'hostComponentId', 'doorComponentId')) for *_rest, item in entries):
        _fail('Partial component identities need their original component graph.')
    supplied = source_sha256 is not None or 'cloudPointsSha256' in result
    source_hash = _hash(source_sha256, 'Source hash') if source_sha256 is not None else globals()['source_sha256'](result)
    if 'cloudPointsSha256' in result and _hash(result['cloudPointsSha256'], 'Cloud hash') != source_hash:
        _fail('Cloud and component source hashes disagree.')
    original_digest = scene_sha256(result)
    components = _inventory(result, source_hash, attach=True)
    for key in _ACCURACY_FLAGS:
        result[key] = False
    result['componentGraph'] = {'schema': SCHEMA, 'sourceSha256': source_hash,
        'namespaceBasis': 'supplied-source-sha256' if supplied else 'legacy-scene-geometry-sha256',
        'sourceSceneSha256': original_digest, 'contentSha256': _content_hash(result),
        'revision': 0, 'components': components, 'editHistory': [], 'evidenceStatus': 'source-scene',
        'invalidatedEvidence': [], 'metricVerified': False, 'certified': False}
    _json(result)
    return result


def ensure_component_ids(scene):
    return attach_component_ids(scene)


def _validate_graph(scene):
    graph = scene.get('componentGraph')
    expected = {'schema', 'sourceSha256', 'namespaceBasis', 'sourceSceneSha256', 'contentSha256',
                'revision', 'components', 'editHistory', 'evidenceStatus', 'invalidatedEvidence', 'metricVerified', 'certified'}
    if not isinstance(graph, dict) or set(graph) != expected or graph['schema'] != SCHEMA:
        _fail('Invalid component graph fields or schema.')
    source_hash = _hash(graph['sourceSha256'], 'Source hash')
    _hash(graph['sourceSceneSha256'], 'Original scene hash')
    if graph['namespaceBasis'] not in ('supplied-source-sha256', 'legacy-scene-geometry-sha256') \
            or type(graph['revision']) is not int or not 0 <= graph['revision'] <= MAX_HISTORY \
            or graph['metricVerified'] is not False or graph['certified'] is not False:
        _fail('Invalid component revision, scope or accuracy claims.')
    if 'cloudPointsSha256' in scene and scene['cloudPointsSha256'] != source_hash:
        _fail('Cloud and component source hashes disagree.')
    if any(key in scene and scene[key] is not False for key in _ACCURACY_FLAGS):
        _fail('Component scenes cannot assert verified physical accuracy.')
    if _json(graph['components']) != _json(_inventory(scene, source_hash)) \
            or graph['contentSha256'] != _content_hash(scene):
        _fail('Scene components changed outside the controlled edit history.')
    history = graph['editHistory']
    if not isinstance(history, list) or len(history) != graph['revision']:
        _fail('Component revision and edit history disagree.')
    for revision, row in enumerate(history, 1):
        if not isinstance(row, dict) or set(row) != {'revision', 'parentSceneSha256', 'contractSha256', 'edits'} \
                or type(row['revision']) is not int or row['revision'] != revision:
            _fail('Invalid component edit history.')
        _hash(row['parentSceneSha256'], 'Parent scene hash')
        contract = {'schema': EDIT_SCHEMA, 'sourceSha256': source_hash, 'sceneSha256': row['parentSceneSha256'],
                    'revision': revision - 1, 'edits': row['edits']}
        if row['contractSha256'] != hashlib.sha256(_json(contract, MAX_EDIT_BYTES)).hexdigest():
            _fail('Edit history contract hash is inconsistent.')
    if graph['evidenceStatus'] != ('invalidated-by-edit' if history else 'source-scene') \
            or graph['invalidatedEvidence'] != (_INVALIDATED if history else []):
        _fail('Component evidence status disagrees with its revision.')
    return graph


def apply_edits(scene, contract):
    """Apply an exact-source/revision contract atomically to a deep scene copy.

    Wall translation uses world XYZ metres; dimensions replace [length,height,
    thickness] around its centre; yaw is absolute Y-up degrees. Openings remain
    relative to the host's marked start/base. Internal names are never editable.
    """
    scene_sha256(scene)
    graph = _validate_graph(scene)
    _json(contract, MAX_EDIT_BYTES)
    if not isinstance(contract, dict) or set(contract) != {'schema', 'sourceSha256', 'sceneSha256', 'revision', 'edits'}:
        _fail('Invalid component edit contract fields.')
    if contract['schema'] != EDIT_SCHEMA or contract['sourceSha256'] != graph['sourceSha256'] \
            or contract['sceneSha256'] != scene_sha256(scene) or type(contract['revision']) is not int \
            or contract['revision'] != graph['revision']:
        _fail('Edit contract does not match this exact source scene and revision.')
    if graph['revision'] >= MAX_HISTORY:
        _fail('Edit history limit reached; preserve this revision before starting a new authoring session.')
    edits = contract['edits']
    if not isinstance(edits, list) or not 1 <= len(edits) <= MAX_EDITS:
        _fail('Provide 1 to 32 controlled edits.')
    if scene.get('units') != 'm':
        _fail('Controlled geometry edits require metres.')
    result = copy.deepcopy(scene)
    lookup = {item['componentId']: (kind, item) for kind, _index, _name, item in _components(result)}
    seen, changed, label_changed = set(), False, False
    for edit in edits:
        if not isinstance(edit, dict) or not {'op', 'componentId'} <= set(edit):
            _fail('Each edit needs an operation and component ID.')
        operation, identifier = edit['op'], edit['componentId']
        if not isinstance(identifier, str) or identifier not in lookup:
            _fail('Edit target is not a component in this scene.')
        if not isinstance(operation, str) or (operation, identifier) in seen:
            _fail('Duplicate component operations are not allowed.')
        seen.add((operation, identifier))
        kind, item = lookup[identifier]
        before = copy.deepcopy(item)
        if operation == 'wall':
            allowed = {'op', 'componentId', 'translationMeters', 'sizeMeters', 'yawDegrees'}
            if kind != 'wall' or not set(edit) <= allowed or len(edit) < 3:
                _fail('Wall edits support translationMeters, sizeMeters and yawDegrees only.')
            if 'translationMeters' in edit:
                delta = _vector(edit['translationMeters'], -100, 100, 'Wall translation')
                item['centre'] = [value + step for value, step in zip(item['centre'], delta)]
            if 'sizeMeters' in edit:
                item['size'] = _vector(edit['sizeMeters'], .05, 100, 'Wall dimensions')
            if 'yawDegrees' in edit:
                item['yaw_degrees'] = _number(edit['yawDegrees'], -360, 360, 'Wall yaw')
            item.pop('min', None)
            item.pop('max', None)
            # Where the compiler put the box against the face it saw; no longer true of the edited box.
            item.pop('faceCentre', None)
            item.pop('thicknessBasis', None)
            if item != before:
                _authored_geometry(item, edit, 'observed')
        elif operation == 'opening':
            allowed = {'op', 'componentId', 'offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters'}
            if kind != 'opening' or not set(edit) <= allowed or len(edit) < 3:
                _fail('Opening edits support offset, width, height and sill metres only.')
            for key in set(edit) - {'op', 'componentId'}:
                item[key] = _number(edit[key], .05 if key in ('widthMeters', 'heightMeters') else 0, 100, key)
            if item != before:
                _authored_geometry(item, edit, 'operator-reviewed')
        elif operation == 'label':
            if set(edit) != {'op', 'componentId', 'label'}:
                _fail('Label edits change only the display label.')
            item['label'] = _text(edit['label'], 'Component label')
            if item != before:
                item['labelProvenance'] = 'operator-authored-edit'
                item.pop('labelConfidence', None)
                item['labelAuthority'] = 'operator-declared'
                label_changed = True
        else:
            _fail('Unsupported component edit operation.')
        changed |= item != before
    if not changed:
        _fail('The edit contract makes no change.')
    by_name = {wall['name']: wall for wall in result.get('walls', [])}
    for opening in result.get('openings', []):
        host = by_name[opening['hostWall']]
        if host.get('dimensionProvenance') == 'operator-authored-edit' and opening.get('host') != _snapshot(host):
            _authored_geometry(opening, {'op': 'opening', 'componentId': opening['componentId'],
                                        'hostPlacement': True}, 'operator-reviewed')
        opening['host'] = _snapshot(host)
        # reviewed means operator-authored intent, not a physical acceptance result.
        opening['physicalReviewRequired'] = True
    _components(result)  # Final-state fit/overlap checks allow coordinated wall+opening changes.
    for key in ('fit', 'measurements', 'route', 'routes', 'navigation', 'nav2', 'cad', 'ifc', 'usd'):
        result.pop(key, None)
    if label_changed:
        result.pop('naming', None)  # The original input still retains the model's naming receipt.
    for key in ('metric_verified', 'metricVerified', 'certified', 'clearanceVerified',
                'physicalRobotValidated', 'scaleReviewed', 'mapReviewed'):
        result[key] = False
    result['physicalReviewRequired'] = True
    if isinstance(result.get('bimReview'), dict):
        result['bimReview'].update(metricVerified=False, clearanceVerified=False,
                                   physicalReviewRequired=True, authority='operator-authored-edit')
    new_graph = result['componentGraph']
    new_graph['revision'] += 1
    new_graph['editHistory'].append({'revision': new_graph['revision'],
        'parentSceneSha256': contract['sceneSha256'],
        'contractSha256': hashlib.sha256(_json(contract, MAX_EDIT_BYTES)).hexdigest(), 'edits': copy.deepcopy(edits)})
    new_graph.update(contentSha256=_content_hash(result), evidenceStatus='invalidated-by-edit',
                     invalidatedEvidence=copy.deepcopy(_INVALIDATED))
    _json(result)
    _validate_graph(result)
    return result
