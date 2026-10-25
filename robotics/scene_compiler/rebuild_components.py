"""Re-export a saved reconstruction after exact-source, revision-bound component edits.

No reconstruction or model inference runs. The original scene/cloud are retained
unchanged. A successful Blender process is required before publishing a fresh
bundle. Recomputed point checks still do not validate edited BIM dimensions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from .component_graph import apply_edits, ensure_component_ids
from . import nav2_export
from ..world_worker import cad_export, component_evidence, fit_check, measurement_check
from ..world_worker.geometry import load_arena_cloud

COMPILER = Path(__file__).with_name('scene_compiler.py')


def _read(path, maximum):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError('Inputs must be bounded regular JSON files.')
    raw = path.read_bytes()
    return nav2_export._parse(raw), raw


def _file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024**2), b''):
            digest.update(chunk)
    return digest.hexdigest()


def rebuild(scene_path, cloud_path, edits_path, out, *, blender, timeout=900, allow_unverified=False, source_job=None):
    scene, scene_raw = _read(scene_path, 16 * 1024**2)
    cloud, cloud_raw = _read(cloud_path, 16 * 1024**2)
    edits, edits_raw = _read(edits_path, 64 * 1024)
    # The worker's own bounded handoff validator, including multi-view and scale provenance.
    validated = load_arena_cloud(Path(cloud_path))
    if any(cloud.get(key) != validated.get(key) for key in ('points', 'scale', 'units', 'coordinateFrame', 'sourceFrame')):
        raise ValueError('Source cloud cannot change during validation or require scale normalization.')
    digest = measurement_check.points_sha256(validated)
    if scene.get('cloudPointsSha256') != digest or scene.get('scale') != cloud.get('scale'):
        raise ValueError('Scene and source cloud geometry/scale do not match.')
    expected = apply_edits(scene, edits)  # Refuse stale/invalid edits before starting Blender or writing output.
    target = Path(out).absolute()
    if target.exists() or target.is_symlink():
        raise FileExistsError('Edited output must be a fresh, absent directory.')
    executable = Path(blender)
    if not executable.is_absolute() or not executable.is_file():
        raise ValueError('Blender must be an existing absolute executable path.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'.{target.name}.rebuild-', dir=target.parent) as temporary:
        work = Path(temporary); result = work / 'bundle'
        # Use immutable snapshots of exactly the bytes admitted above, avoiding input races.
        for name, raw in [('source-scene.json', scene_raw), ('arena-cloud.json', cloud_raw), ('component-edits.json', edits_raw)]:
            (work / name).write_bytes(raw)
        command = [str(executable), '-b', '--python-exit-code', '1', '--python', str(COMPILER), '--',
                   '--cloud', str(work / 'arena-cloud.json'), '--scene', str(work / 'source-scene.json'),
                   '--edits', str(work / 'component-edits.json'), '--out', str(result)]
        if allow_unverified:
            command.append('--allow-unverified')
        subprocess.run(command, check=True, stdin=subprocess.DEVNULL, timeout=timeout)
        rebuilt, _ = _read(result / 'scene.json', 16 * 1024**2)
        rebuilt = ensure_component_ids(rebuilt)
        if rebuilt['componentGraph'] != expected['componentGraph']:
            raise RuntimeError('Compiler output does not match the admitted component edit revision.')
        for filename in ('scene.glb', 'scene.usda', 'scene.ifc', 'scene.blend'):
            path = result / filename
            if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError(f'Compiler did not write a complete {filename}.')
        cad = cad_export.export(rebuilt, result)
        fit = fit_check.export(rebuilt, cloud['points'], result)
        if fit.get('written'):
            rebuilt['fit'] = {k: fit[k] for k in ('within_5cm', 'modelled_median_cm', 'by_kind', 'misfits')}
        (result / 'scene.json').write_text(json.dumps(rebuilt, indent=1, allow_nan=False))
        (result / 'arena-cloud.json').write_bytes(cloud_raw)
        (result / 'source-scene.json').write_bytes(scene_raw)
        (result / 'component-edits.json').write_bytes(edits_raw)
        scene_digest = hashlib.sha256((result / 'scene.json').read_bytes()).hexdigest()
        source_files = {'scene': {'sha256': scene_digest}, 'cloud': {'sha256': hashlib.sha256(cloud_raw).hexdigest()}}
        report = measurement_check.build_report(rebuilt, cloud)
        report['sourceFiles'] = source_files
        (result / 'scene-measurements.json').write_text(json.dumps(report, indent=2, allow_nan=False))
        graph = {'schema': 'brainsnn.component-graph-export.v1', 'graph': rebuilt['componentGraph'],
                 'sourceFiles': source_files, 'metric_verified': False, 'physics_ready': False}
        (result / 'component-graph.json').write_text(json.dumps(graph, indent=2, allow_nan=False))
        support = component_evidence.write_component_evidence(result, rebuilt, cloud,
            scene_path=result / 'scene.json', cloud_path=result / 'arena-cloud.json', source_dir=source_job)
        nav = nav2_export.export(rebuilt, work / 'nav2', cloud=cloud,
                                 scene_bytes=(result / 'scene.json').read_bytes(), cloud_bytes=cloud_raw)
        for name in nav['files']:
            shutil.copyfile(work / 'nav2' / name, result / name)
        receipt = {'schema': 'brainsnn.component-rebuild.v1', 'revision': rebuilt['componentGraph']['revision'],
                   'sourceSceneSha256': hashlib.sha256(scene_raw).hexdigest(),
                   'editFileSha256': hashlib.sha256(edits_raw).hexdigest(), 'sourceFiles': source_files,
                   'blenderProcessSucceeded': True, 'cad': cad, 'fit': fit, 'navigation': nav,
                   'unverifiedGeometryExperiment': allow_unverified,
                   'componentEvidence': {'written': True, 'projection': support['projection'],
                                         'scope': 'Edited geometry remains unsupported by original point memberships.'},
                   'metric_verified': False, 'physics_ready': False, 'physicalRobotValidated': False,
                   'scope': 'Operator-authored geometric edits. Point-pair checks compare unchanged source points, not edited BIM elements.',
                   'artifacts': {p.name: {'sha256': _file_hash(p), 'bytes': p.stat().st_size}
                                 for p in sorted(result.iterdir()) if p.is_file()}}
        (result / 'component-rebuild.json').write_text(json.dumps(receipt, indent=2, allow_nan=False))
        nav2_export._publish_directory(result, target)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('scene', 'cloud', 'edits', 'out', 'blender'):
        parser.add_argument('--' + key, required=True, type=Path)
    parser.add_argument('--allow-unverified', action='store_true',
                        help='Explicit geometry experiment only; preserve default non-multiview refusal.')
    parser.add_argument('--source-job', type=Path, help='Retained reconstruction job for bound private-frame projections.')
    args = parser.parse_args()
    result = rebuild(args.scene, args.cloud, args.edits, args.out, blender=args.blender,
                     allow_unverified=args.allow_unverified, source_job=args.source_job)
    print(json.dumps({'written': True, 'revision': result['revision'], 'metric_verified': False}))


if __name__ == '__main__':
    main()
