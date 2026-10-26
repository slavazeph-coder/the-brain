"""Turn explicitly selected, recomputed wall-fit proposals into controlled edits.

This is a local review step, not automatic acceptance of a fitted model. It never
changes reconstruction points, scale, wall dimensions or physical-accuracy flags.
An optional Blender rebuild uses the existing atomic component export pipeline.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import tempfile

from . import component_graph as cg, nav2_export, rebuild_components
from ..world_worker import component_evidence as ce, component_fit as cf

SCHEMA = 'brainsnn.component-refinement.v1'
MAX_REPORT_BYTES = 8 * 1024 * 1024
MAX_TRANSLATION_METERS = cf.MAX_TRANSLATION_METERS
MAX_YAW_CHANGE_DEGREES = cf.MAX_YAW_CHANGE_DEGREES
MIN_IMPROVEMENT_METERS = cf.MIN_IMPROVEMENT_METERS


def _raw(value, raw, limit, name):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= limit:
        raise ValueError(f'{name} needs bounded original JSON bytes.')
    parsed = ce._json(raw)
    if cg._json(parsed, limit) != cg._json(value, limit):
        raise ValueError(f'{name} bytes do not match the supplied object.')
    return hashlib.sha256(raw).hexdigest()


def _selected(component_ids):
    if not isinstance(component_ids, (list, tuple)) or not 1 <= len(component_ids) <= cg.MAX_EDITS \
            or any(not isinstance(identifier, str) for identifier in component_ids) \
            or len(set(component_ids)) != len(component_ids):
        raise ValueError('Explicitly select 1 to 32 distinct wall component IDs.')
    return list(component_ids)


def _number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('The wall proposal has invalid or unsafe numeric parameters.')
    return value


def _edit(wall, row):
    candidate = row.get('candidate') or {}
    if row.get('kind') != 'wall' or candidate.get('kind') != 'wall-plane-refinement' \
            or candidate.get('status') != 'review-required' \
            or candidate.get('thicknessPreserved') is not True or candidate.get('reviewRequired') is not True \
            or wall.get('provenance') != 'observed' or wall.get('dimensionProvenance') == 'operator-authored-edit':
        raise ValueError('The selected component has no supported reviewable wall proposal.')
    geometry, edit = candidate.get('geometry'), candidate.get('suggestedEdit')
    if not isinstance(geometry, dict) or set(geometry) != {'centre', 'size', 'yaw_degrees'} \
            or not isinstance(edit, dict) \
            or set(edit) != {'op', 'componentId', 'translationMeters', 'yawDegrees'} \
            or edit['op'] != 'wall' or edit['componentId'] != wall['componentId']:
        raise ValueError('A wall proposal must preserve dimensions and use a controlled placement edit.')
    if geometry['size'] != wall['size']:
        raise ValueError('Reviewed plane refinement cannot resize a wall or infer thickness.')
    centre, delta = geometry.get('centre'), edit.get('translationMeters')
    if not isinstance(centre, list) or len(centre) != 3 or not isinstance(delta, list) or len(delta) != 3:
        raise ValueError('The wall proposal needs three centre and translation coordinates.')
    for i in range(3):
        _number(centre[i], -10_000_000, 10_000_000)
        _number(delta[i], -MAX_TRANSLATION_METERS, MAX_TRANSLATION_METERS)
        if not math.isclose(centre[i], wall['centre'][i] + delta[i], abs_tol=cf.FIT_ROUNDOFF, rel_tol=0):
            raise ValueError('The wall proposal and controlled translation disagree.')
    if delta[1] != 0 or math.dist(delta, [0, 0, 0]) > MAX_TRANSLATION_METERS:
        raise ValueError('The wall proposal exceeds the bounded horizontal translation.')
    yaw = _number(edit['yawDegrees'], -360, 360)
    if geometry['yaw_degrees'] != yaw:
        raise ValueError('The wall proposal and controlled yaw disagree.')
    turn = (yaw - wall.get('yaw_degrees', 0) + 180) % 360 - 180
    if abs(turn) > MAX_YAW_CHANGE_DEGREES:
        raise ValueError('The wall proposal exceeds the bounded yaw correction.')
    if max(abs(value) for value in delta) <= 1e-8 and abs(turn) <= 1e-8:
        raise ValueError('The selected wall proposal makes no geometric change.')
    before, after = candidate.get('before'), candidate.get('after')
    if not isinstance(before, dict) or not isinstance(after, dict):
        raise ValueError('The wall proposal needs before and after residuals.')
    for stats in (before, after):
        for key in ('medianMeters', 'p95Meters'):
            _number(stats.get(key), 0, 10_000_000)
    if after['medianMeters'] > before['medianMeters'] - MIN_IMPROVEMENT_METERS \
            or after['p95Meters'] > before['p95Meters'] + cf.FIT_ROUNDOFF:
        raise ValueError('The selected wall proposal does not improve the retained fit residuals.')
    return copy.deepcopy(edit), {'componentId': wall['componentId'], 'name': wall['name'],
                                'before': copy.deepcopy(before), 'after': copy.deepcopy(after)}


def build_refinement(scene, cloud, report, component_ids, *, scene_bytes, cloud_bytes, report_bytes,
                     component_evidence=None, evidence_bytes=None, source_job=None,
                     scene_name='scene.json', cloud_name='arena-cloud.json'):
    """Recompute every proposal before generating an exact-source edit contract.

The full supplied report must match recomputation; a report's hashes alone do
not authenticate its candidate numbers. Supporting camera evidence, if supplied,
must be recomputable from the same retained reconstruction job.
"""
    selected = _selected(component_ids)
    scene_hash = _raw(scene, scene_bytes, ce.MAX_RAW_BYTES, 'Source scene')
    cloud_hash = _raw(cloud, cloud_bytes, ce.MAX_RAW_BYTES, 'Source cloud')
    report_hash = _raw(report, report_bytes, MAX_REPORT_BYTES, 'Component fit report')
    fresh = cf.build_component_fit(scene, cloud, scene_bytes=scene_bytes, cloud_bytes=cloud_bytes,
        component_evidence=component_evidence, evidence_bytes=evidence_bytes, source_dir=source_job,
        scene_name=scene_name, cloud_name=cloud_name)
    if cg._json(fresh, MAX_REPORT_BYTES) != cg._json(report, MAX_REPORT_BYTES):
        raise ValueError('The component fit report is stale, altered or not reproducible from these inputs.')
    graph = cg.ensure_component_ids(scene)['componentGraph']
    walls = {wall['componentId']: wall for wall in scene.get('walls', [])}
    rows = {row['componentId']: row for row in fresh['components']}
    edits, checked = [], []
    for identifier in selected:
        if identifier not in walls or identifier not in rows:
            raise ValueError('Select a wall component from this exact saved scene.')
        edit, comparison = _edit(walls[identifier], rows[identifier])
        edits.append(edit); checked.append(comparison)
    contract = {'schema': cg.EDIT_SCHEMA, 'sourceSha256': graph['sourceSha256'],
                'sceneSha256': cg.scene_sha256(scene), 'revision': graph['revision'], 'edits': edits}
    preview = cg.apply_edits(scene, contract)
    receipt = {'schema': SCHEMA, 'sourceFiles': {'scene': {'name': scene_name, 'sha256': scene_hash},
                'cloud': {'name': cloud_name, 'sha256': cloud_hash},
                'componentFit': {'sha256': report_hash}},
        'sourcePointsSha256': graph['sourceSha256'], 'sourceRevision': graph['revision'],
        'proposedRevision': preview['componentGraph']['revision'], 'selectedComponentIds': selected,
        'selectionAuthority': 'explicit-local-operator-selection',
        'contractCanonicalSha256': hashlib.sha256(cg._json(contract, cg.MAX_EDIT_BYTES)).hexdigest(),
        'comparisons': checked,
        'limits': {'maximumHorizontalTranslationMeters': MAX_TRANSLATION_METERS,
                   'maximumYawChangeDegrees': MAX_YAW_CHANGE_DEGREES,
                   'minimumMedianImprovementMeters': MIN_IMPROVEMENT_METERS},
        'wallDimensionsPreserved': True, 'scaleChanged': False, 'geometryAppliedToSources': False,
        'blenderRebuilt': False, 'metricVerified': False, 'independentAccuracyValidated': False,
        'physicalRobotValidated': False,
        'scope': 'Operator-selected placement suggestions fitted to the same reconstruction; not independent physical validation.'}
    if evidence_bytes is not None:
        receipt['sourceFiles']['componentEvidence'] = {'sha256': hashlib.sha256(evidence_bytes).hexdigest()}
    return {'contract': contract, 'receipt': receipt, 'scene': preview}


def _read(path, limit):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('Refinement inputs must be bounded regular JSON files.')
    raw = path.read_bytes()
    return ce._json(raw), raw


def _write(path, value):
    raw = json.dumps(value, indent=1, allow_nan=False).encode('utf-8') + b'\n'
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def write_refinement(scene_path, cloud_path, report_path, out, *, component_ids, evidence_path=None,
                     source_job=None, blender=None, timeout=900, allow_unverified=False):
    """Atomically publish review files, optionally with a complete native rebuild.

No existing destination is replaced. Admitted source bytes are preserved in the
output. No report or source file is edited, and a failing Blender publishes no
partial review or model bundle.
"""
    target = Path(out).absolute()
    if target.exists() or target.is_symlink():
        raise FileExistsError('Refinement output must be a fresh, absent directory.')
    scene_path, cloud_path, report_path = map(Path, (scene_path, cloud_path, report_path))
    scene, scene_raw = _read(scene_path, ce.MAX_RAW_BYTES)
    cloud, cloud_raw = _read(cloud_path, ce.MAX_RAW_BYTES)
    report, report_raw = _read(report_path, MAX_REPORT_BYTES)
    support, evidence_raw = _read(evidence_path, ce.MAX_RAW_BYTES) if evidence_path is not None else (None, None)
    result = build_refinement(scene, cloud, report, component_ids, scene_bytes=scene_raw, cloud_bytes=cloud_raw,
        report_bytes=report_raw, component_evidence=support, evidence_bytes=evidence_raw, source_job=source_job,
        scene_name=scene_path.name, cloud_name=cloud_path.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'.{target.name}.refinement-', dir=target.parent) as temporary:
        work = Path(temporary); bundle = work / 'review'; bundle.mkdir()
        for name, raw in [('source-scene.json', scene_raw), ('arena-cloud.json', cloud_raw),
                          ('source-component-fit.json', report_raw)]:
            (bundle / name).write_bytes(raw)
        if evidence_raw is not None:
            (bundle / 'source-component-evidence.json').write_bytes(evidence_raw)
        receipt = result['receipt']
        receipt['editFileSha256'] = _write(bundle / 'component-edits.json', result['contract'])
        _write(bundle / 'proposed-scene.json', result['scene'])
        if blender is not None:
            rebuild = rebuild_components.rebuild(bundle / 'source-scene.json', bundle / 'arena-cloud.json',
                bundle / 'component-edits.json', bundle / 'model', blender=blender, timeout=timeout,
                allow_unverified=allow_unverified, source_job=source_job)
            receipt['blenderRebuilt'] = True
            receipt['rebuiltRevision'] = rebuild['revision']
            receipt['rebuiltBundle'] = 'model'
        receipt['artifacts'] = {path.name: {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                          'bytes': path.stat().st_size}
                                for path in sorted(bundle.iterdir()) if path.is_file()}
        _write(bundle / 'refinement-review.json', receipt)
        nav2_export._publish_directory(bundle, target)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('scene', 'cloud', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--fit', '--report', dest='report', type=Path, required=True)
    parser.add_argument('--component-id', action='append', required=True,
                        help='Explicitly selected wall ID; repeat for multiple walls. There is no select-all option.')
    parser.add_argument('--evidence', type=Path)
    parser.add_argument('--source-job', type=Path)
    parser.add_argument('--blender', type=Path, help='Optional absolute Blender executable for complete edited exports.')
    parser.add_argument('--allow-unverified', action='store_true', help='Explicit authored geometry experiment only.')
    args = parser.parse_args()
    receipt = write_refinement(args.scene, args.cloud, args.report, args.out, component_ids=args.component_id,
        evidence_path=args.evidence, source_job=args.source_job, blender=args.blender,
        allow_unverified=args.allow_unverified)
    print(json.dumps({'written': True, 'selected': len(receipt['selectedComponentIds']),
                      'blenderRebuilt': receipt['blenderRebuilt'], 'metricVerified': False}))


if __name__ == '__main__':
    main()
