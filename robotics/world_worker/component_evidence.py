"""Bound source-point memberships and private-frame projections of compiled components.

Membership is recomputed from the existing deterministic compiler. It is not an
independent geometry measurement, image segmentation or proof of physical
accuracy. This module reads no image bytes and invokes no naming/model service.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scene_compiler'))
import component_graph as cg
import scene_compiler as sc
try:
    from . import object_names as names
    from .measurement_check import points_sha256
except ImportError:
    import object_names as names
    from measurement_check import points_sha256

SCHEMA = 'brainsnn.component-evidence.v1'
MAX_EVALUATED = 50
MAX_SAMPLED_INDICES = 256
MAX_VIEWS = 60
MAX_RAW_BYTES = 32 * 1024 * 1024
FIT_ROUNDOFF = 1e-10  # Cross-runtime arithmetic only, never a physical acceptance tolerance.
_SHA = re.compile(r'^[a-f0-9]{64}$')
_IDENTIFIER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*$')


class _ViewEvidenceUnavailable(ValueError):
    """A bounded public explanation that contains no private source path."""


def _json(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_RAW_BYTES:
        raise ValueError('Component evidence needs bounded final JSON bytes.')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON keys cannot bind component evidence.')
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON.')))
        json.dumps(value, allow_nan=False)  # Also reject a finite-looking exponent that overflowed to infinity.
        return value
    except (UnicodeError, RecursionError) as error:
        raise ValueError('Component evidence needs finite JSON.') from error


def _raw_digest(raw, value, claimed, kind):
    decoded = _json(raw)
    try:
        # Python equality conflates True with 1 and False with 0. Compare finite
        # canonical JSON instead, retaining the original JSON value types.
        options = {'sort_keys': True, 'separators': (',', ':'), 'ensure_ascii': True, 'allow_nan': False}
        matches = json.dumps(decoded, **options) == json.dumps(value, **options)
    except (TypeError, ValueError, RecursionError, UnicodeError) as error:
        raise ValueError('Component evidence needs finite JSON source objects.') from error
    if not matches:
        raise ValueError(f'Final {kind} bytes do not match the supplied {kind}.')
    actual = hashlib.sha256(raw).hexdigest()
    if claimed is not None and (not isinstance(claimed, str) or not _SHA.fullmatch(claimed) or claimed != actual):
        raise ValueError(f'Final {kind} SHA-256 is stale or invalid.')
    return actual


def _box(fit):
    return {'centre': [fit['centre'][0], (fit['y0'] + fit['y1']) / 2, fit['centre'][1]],
            'size': [fit['length'], fit['y1'] - fit['y0'], fit['thickness']],
            'yaw_degrees': math.degrees(fit['yaw'])}


def _matches(item, expected):
    return all(math.isclose(a, b, rel_tol=0, abs_tol=FIT_ROUNDOFF)
               for key in ('centre', 'size') for a, b in zip(item[key], expected[key])) \
        and math.isclose(item.get('yaw_degrees', 0), expected['yaw_degrees'], rel_tol=0, abs_tol=FIT_ROUNDOFF)


def _floor_box(points, floor_y):
    ex = [sc.percentile([p[0] for p in points], q) for q in (.02, .98)]
    ez = [sc.percentile([p[2] for p in points], q) for q in (.02, .98)]
    lo, hi = [ex[0], floor_y - .02, ez[0]], [ex[1], floor_y, ez[1]]
    return {'centre': [(lo[i] + hi[i]) / 2 for i in range(3)],
            'size': [max(hi[i] - lo[i], .02) for i in range(3)], 'yaw_degrees': 0}


def _sample(members):
    members = sorted(set(int(index) for index in members))
    if len(members) <= MAX_SAMPLED_INDICES:
        return members
    return [members[index * (len(members) - 1) // (MAX_SAMPLED_INDICES - 1)] for index in range(MAX_SAMPLED_INDICES)]


def _inventory(scene):
    items = []
    for field, kind in (('walls', 'wall'), ('objects', 'object'), ('openings', 'opening')):
        for item in scene.get(field, []):
            items.append((item, 'floor' if item.get('name') == 'floor_observed' and kind == 'object' else kind))
            if kind == 'opening' and item.get('doorComponentId'):
                items.append((dict(item, componentId=item['doorComponentId']), 'door'))
    if scene.get('unknown'):
        items.append(({'componentId': cg.derive_id(scene['componentGraph']['sourceSha256'], 'unknown', 'space'),
                       'name': 'unknown_space'}, 'unknown'))
    return items


def _view_metadata(view):
    """Only ledger identity is exported. Local image paths and image bytes stay private."""
    if not isinstance(view, dict):
        raise _ViewEvidenceUnavailable('Camera views need ledger metadata.')
    identifier = view.get('frame_id')
    if not isinstance(identifier, str) or not 1 <= len(identifier) <= 160 or not _IDENTIFIER.fullmatch(identifier):
        raise _ViewEvidenceUnavailable('Camera views need a stable frame ID.')
    for key in ('image_sha256', 'ledger_sha256', 'source_cloud_sha256'):
        if not isinstance(view.get(key), str) or not _SHA.fullmatch(view[key]):
            raise _ViewEvidenceUnavailable('Camera views need image, ledger and source artifact hashes.')
    source_name = view.get('source_cloud_name')
    if not isinstance(source_name, str) or not 1 <= len(source_name) <= 240 or '\\' in source_name or ':' in source_name \
            or PurePosixPath(source_name).is_absolute() or '..' in PurePosixPath(source_name).parts \
            or str(PurePosixPath(source_name)) != source_name \
            or any(ord(c) < 32 for c in source_name):
        raise _ViewEvidenceUnavailable('Camera views need a safe job-relative source artifact name.')
    frame = view.get('source_cloud_coordinate_frame')
    if not isinstance(frame, str) or not 1 <= len(frame) <= 80 or not _IDENTIFIER.fullmatch(frame):
        raise _ViewEvidenceUnavailable('Camera views need the source artifact coordinate frame.')
    if any(type(view.get(key)) is not int or not 1 <= view[key] <= 16384 for key in ('width', 'height')):
        raise _ViewEvidenceUnavailable('Camera views need bounded image dimensions.')
    if view['width'] * view['height'] > 24_000_000:
        raise _ViewEvidenceUnavailable('Camera view raster dimensions exceed the projection budget.')
    if not callable(view.get('project')):
        raise _ViewEvidenceUnavailable('Camera views need their registered lens projection.')
    import numpy as np
    matrix = np.asarray(view.get('cam_from_world'), float)
    if matrix.shape != (3, 4) or not np.isfinite(matrix).all():
        raise _ViewEvidenceUnavailable('Camera views need finite registered poses.')
    rotation = matrix[:, :3]
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-6, rtol=1e-6) \
            or not math.isclose(float(np.linalg.det(rotation)), 1., abs_tol=1e-6):
        raise _ViewEvidenceUnavailable('Camera views need rigid registered poses.')
    result = {'frameId': identifier, 'imageSha256': view['image_sha256'], 'ledgerSha256': view['ledger_sha256'],
              'sourceArtifact': {'name': source_name, 'sha256': view['source_cloud_sha256'], 'coordinateFrame': frame},
              'sourceBinding': 'ordered-source-subset' if view.get('binding_status') == 'ordered-source-subset' else 'injected-local-metadata'}
    tolerance = view.get('binding_tolerance_source_units')
    if tolerance is not None:
        if type(tolerance) not in (int, float) or not math.isfinite(tolerance) or tolerance <= 0:
            raise _ViewEvidenceUnavailable('Source binding tolerance must be finite and positive.')
        result['bindingToleranceSourceUnits'] = tolerance
    return result


def build_component_evidence(scene, cloud, *, scene_bytes, cloud_bytes, scene_sha256=None, cloud_sha256=None,
                             source_dir=None, views=None, scene_name='scene.json', cloud_name='cloud.json'):
    """Build a sidecar bound to final raw files, exact ordered XYZRGB and graph revision.

Injected views are for trusted local callers/tests and must include ledger IDs
and hashes. Normal views come from reconstruction_views, which verifies the
source artifact/transform before loading the shared camera-frame ledger.
"""
    raw_scene = _raw_digest(scene_bytes, scene, scene_sha256, 'scene')
    raw_cloud = _raw_digest(cloud_bytes, cloud, cloud_sha256, 'cloud')
    point_hash = points_sha256(cloud)
    if not isinstance(scene, dict) or not isinstance(scene.get('componentGraph'), dict):
        raise ValueError('Source evidence requires a saved component graph.')
    scene = cg.ensure_component_ids(scene)
    graph = scene['componentGraph']
    if scene.get('cloudPointsSha256') != point_hash or graph['sourceSha256'] != point_hash:
        raise ValueError('Scene and component graph do not belong to this exact ordered cloud.')
    if scene.get('units') != 'm' or scene.get('scale') != cloud.get('scale'):
        raise ValueError('Scene and source cloud scale provenance do not match.')
    if any(not isinstance(name, str) or not name or Path(name).name != name or len(name) > 160 for name in (scene_name, cloud_name)):
        raise ValueError('Source JSON names must be bounded basenames.')
    points = cloud['points']; floor_y = sc.floor_plane(points, cloud.get('floorEstimate'))
    margin, walls, _rest, objects = sc.analyse(points, floor_y, True)
    wall_fits = {f'wall_{index + 1}': fit for index, fit in enumerate(walls)}
    object_fits = {f'object_{index + 1}': fit for index, fit in enumerate(objects)}
    floor_members = [index for index, point in enumerate(points) if abs(point[1] - floor_y) <= margin]
    floor_box = _floor_box(points, floor_y)
    entries, evaluated, supported, members_by_id = [], 0, [], {}
    for item, kind in _inventory(scene):
        name = item.get('name', item.get('id', 'unknown'))
        if kind == 'door':
            name = f'door_{item["id"]}'
        entry = {'componentId': item['componentId'], 'name': name, 'kind': kind, 'status': 'unsupported',
                 'supportCount': None, 'sampledPointIndices': [], 'frames': []}
        entries.append(entry)
        if item.get('provenance') == 'operator-authored-edit' or item.get('dimensionProvenance') == 'operator-authored-edit':
            entry['reason'] = 'Operator-authored geometry has no recomputed source-point support.'
            continue
        if kind in ('opening', 'door', 'unknown'):
            entry['reason'] = ('Reviewed openings and reference leaves are operator-authored, not detected source memberships.'
                               if kind != 'unknown' else 'Unknown space has no observed source membership.')
            continue
        if 'centre' not in item or 'size' not in item:
            entry['reason'] = 'Unplaced detection has no attributable 3D source membership.'
            continue
        if item.get('provenance') != 'observed' or kind == 'object' and item.get('kind') != 'separated':
            entry['reason'] = 'Detector placement or other geometry has no deterministic compiler-cluster attribution.'
            continue
        if evaluated >= MAX_EVALUATED:
            entry['reason'] = 'Source membership evaluation limit reached.'
            continue
        evaluated += 1
        fit = wall_fits.get(name) if kind == 'wall' else object_fits.get(name)
        expected = floor_box if kind == 'floor' else _box(fit) if fit is not None else None
        if scene.get('floor_y') != floor_y or expected is None or not _matches(item, expected):
            entry['reason'] = 'Geometry does not exactly match this source cloud and deterministic compiler fit.'
            continue
        members = floor_members if kind == 'floor' else fit['members']
        members = sorted(set(int(index) for index in members))
        if not members:
            entry['reason'] = 'No source points support this compiler component.'
            continue
        entry.update(status='source-membership', supportCount=len(members), sampledPointIndices=_sample(members),
                     membershipBasis='near-floor-source-points' if kind == 'floor' else 'original-compiler-wall-fit' if kind == 'wall' else 'original-separated-cluster')
        entry['geometryScope'] = ('Near-floor points do not validate slab thickness or the room boundary.' if kind == 'floor'
            else 'Original wall-fit membership; reviewed voids are not source-detected openings.' if kind == 'wall'
            else 'Original cluster membership; reconstruction dimensions and inferred bases are not independently validated.')
        supported.append(entry); members_by_id[entry['componentId']] = members
    projection = {'status': 'unavailable', 'reason': 'No source camera-frame ledger was available.', 'viewsConsidered': 0}
    injected_views = views is not None
    if supported:
        try:
            if views is None:
                if source_dir is None:
                    raise _ViewEvidenceUnavailable('No reconstruction job was supplied for camera evidence.')
                views = names.reconstruction_views(source_dir, cloud)
            if not isinstance(views, (list, tuple)) or not views:
                raise _ViewEvidenceUnavailable('No registered camera views were supplied.')
            metadata = [_view_metadata(view) for view in views[:MAX_VIEWS]]
            if len({item['frameId'] for item in metadata}) != len(metadata):
                raise _ViewEvidenceUnavailable('Camera frame IDs are duplicated.')
            if len({(item['ledgerSha256'], item['sourceArtifact']['sha256'], item['sourceArtifact']['name']) for item in metadata}) != 1:
                raise _ViewEvidenceUnavailable('Camera views do not share one source artifact and ledger.')
            try:
                source_points, metres_per_unit = names.source_points(points, cloud.get('fromSource'))
            except names.NamingSkipped as error:
                raise _ViewEvidenceUnavailable('The hand-off transform is missing, singular or does not preserve one uniform scale.') from error
            import numpy as np
            linear = np.asarray(cloud['fromSource'], float)[:, :3] / metres_per_unit
            if not np.allclose(linear.T @ linear, np.eye(3), atol=1e-6, rtol=1e-6):
                raise _ViewEvidenceUnavailable('The hand-off transform must preserve distances with one uniform scale.')
            objects_for_projection = [{'members': members_by_id[entry['componentId']]} for entry in supported]
            selected = names.choose_views(objects_for_projection, source_points, list(views[:MAX_VIEWS]), metres_per_unit)
            for entry, picks in zip(supported, selected):
                for pick in picks[:2]:
                    view = pick['view']; record = _view_metadata(view)
                    box = [float(value) for value in pick['box']]
                    if len(box) != 4 or not all(math.isfinite(value) for value in box) \
                            or not 0 <= box[0] < box[2] <= view['width'] or not 0 <= box[1] < box[3] <= view['height']:
                        raise _ViewEvidenceUnavailable('A projected component box is invalid.')
                    members = members_by_id[entry['componentId']]
                    uv, depth = names.project(view, source_points[members])
                    visible = np.isfinite(uv).all(1) & (depth > 0) & (uv[:, 0] >= 0) & (uv[:, 0] < view['width']) \
                        & (uv[:, 1] >= 0) & (uv[:, 1] < view['height'])
                    record.update(pixelBox=box, visibleFraction=float(visible.mean()), occludedFraction=float(pick['hidden']))
                    entry['frames'].append(record)
                entry['frameStatus'] = 'projected' if entry['frames'] else 'no-qualifying-view'
                if not entry['frames']:
                    entry['frameReason'] = 'No ledger frame saw enough member points at sufficient size and estimated visibility.'
            projection = {'status': 'available', 'viewsConsidered': len(metadata), 'viewsTruncated': len(views) > MAX_VIEWS,
                          'cameraViewSource': 'injected-local-metadata' if injected_views else 'validated-reconstruction-ledger',
                          'pixelBoxBasis': '2nd-to-98th percentile of projected full component membership',
                          'occlusionBasis': 'Other source points in an 8-pixel depth cell; heuristic, not image-ground-truth occlusion.'}
        except Exception as error:
            # A missing private camera environment must not erase valid point membership or leak paths in exceptions.
            reason = str(error) if isinstance(error, _ViewEvidenceUnavailable) else f'Camera evidence unavailable ({type(error).__name__}).'
            projection = {'status': 'unavailable', 'reason': reason, 'viewsConsidered': 0}
            for entry in supported:
                entry['frames'] = []; entry['frameStatus'] = 'unavailable'; entry['frameReason'] = projection['reason']
    return {'schema': SCHEMA, 'sourceFiles': {'scene': {'name': scene_name, 'sha256': raw_scene},
                                             'cloud': {'name': cloud_name, 'sha256': raw_cloud}},
            'sourcePointsSha256': point_hash, 'coordinateFrame': cloud['coordinateFrame'], 'units': 'm',
            'componentGraph': {key: graph[key] for key in ('schema', 'sourceSha256', 'revision', 'contentSha256')},
            'componentCount': len(entries), 'evaluatedComponents': evaluated,
            'limits': {'evaluatedComponents': MAX_EVALUATED, 'sampledIndicesPerComponent': MAX_SAMPLED_INDICES,
                       'cameraViews': MAX_VIEWS, 'framesPerComponent': 2},
            'membershipExclusive': False, 'membershipScope': 'Compiler memberships may share split-wall boundary points; no independent physical accuracy is established.',
            'membershipGeometryComparison': {'absoluteSceneUnits': FIT_ROUNDOFF, 'absoluteYawDegrees': FIT_ROUNDOFF,
                                            'basis': 'Cross-runtime arithmetic roundoff only; source hash stays exact, not physical accuracy.'},
            'projection': projection, 'components': entries, 'metricVerified': False,
            'independentAccuracyValidated': False, 'physicalRobotValidated': False, 'imagesPublished': False}


def write_component_evidence(out_dir, scene, cloud, *, scene_path, cloud_path, source_dir=None, views=None):
    """Write a sidecar after the final scene/cloud files are saved; never modify either input."""
    scene_path, cloud_path = Path(scene_path), Path(cloud_path)
    if any(path.stat().st_size > MAX_RAW_BYTES for path in (scene_path, cloud_path)):
        raise ValueError('Final component-evidence source JSON is oversized.')
    report = build_component_evidence(scene, cloud, scene_bytes=scene_path.read_bytes(), cloud_bytes=cloud_path.read_bytes(),
        source_dir=source_dir, views=views, scene_name=scene_path.name, cloud_name=cloud_path.name)
    if any(hashlib.sha256(path.read_bytes()).hexdigest() != report['sourceFiles'][kind]['sha256']
           for kind, path in (('scene', scene_path), ('cloud', cloud_path))):
        raise ValueError('Final source files changed while component evidence was computed.')
    path = Path(out_dir) / 'component-evidence.json'
    raw = json.dumps(report, indent=1, allow_nan=False).encode('utf-8') + b'\n'
    temporary = path.with_suffix('.json.tmp'); temporary.write_bytes(raw); temporary.replace(path)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', type=Path, required=True)
    parser.add_argument('--cloud', type=Path, required=True)
    parser.add_argument('--source-job', type=Path)
    parser.add_argument('--out', type=Path, required=True, help='Fresh directory for the evidence sidecar.')
    args = parser.parse_args()
    for path in (args.scene, args.cloud):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_RAW_BYTES:
            parser.error('Sources must be bounded regular scene/cloud JSON files.')
    scene, cloud = (_json(path.read_bytes()) for path in (args.scene, args.cloud))
    args.out.mkdir(parents=True, exist_ok=False)
    result = write_component_evidence(args.out, scene, cloud, scene_path=args.scene, cloud_path=args.cloud,
                                      source_dir=args.source_job)
    print(json.dumps({'written': True, 'components': result['componentCount'], 'projection': result['projection'],
                      'metricVerified': False}, allow_nan=False))


if __name__ == '__main__':
    main()
