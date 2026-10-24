#!/usr/bin/env python3
"""Archive and optionally film an existing corrected Mip-NeRF 360 room job.

This does not reconstruct, compile, rename objects, or repair an old scene. Missing
original inputs or mismatched evidence stop before any output is created. See
REGENERATE.md for the independent worker and browser recording steps.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
FILM = ROOT / 'scripts/world-demo/film'
REQUIRED = ('scene.json', 'scene.glb', 'scene.usda', 'scene.ifc', 'scene.3dm',
            'scene-plan.dxf', 'quantities.csv', 'scene-usd.json', 'arena-cloud.json',
            'fit-check.json', 'fit-heatmap.ply', 'manifest.json')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def regular(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size > 0,
            f'Missing, empty or symlink input: {path}')
    return path


def read(path):
    return json.loads(regular(path).read_text())


def validate(args):
    require(not args.out.exists(), 'Output already exists; choose a fresh directory to avoid stale frames.')
    if getattr(args, 'original_route', None):
        regular(args.original_route)
    target = args.out.resolve()
    for source in (args.job, args.reconstruction, args.photos):
        base = source.resolve()
        require(not target.is_relative_to(base) and not base.is_relative_to(target),
                'Output overlaps an input tree; choose a separate fresh directory.')
    regular(args.capture)
    require(digest(args.capture) == args.capture_sha256.lower(), 'Original capture SHA-256 does not match.')
    rec = read(args.reconstruction / 'reconstruction.json')
    source_ply = getattr(args, 'source_ply', None) or args.reconstruction / 'sparse-preview.ply'
    regular(source_ply)
    require(any(s.get('sha256') == args.capture_sha256.lower() and s.get('kind') == 'video'
                for s in rec.get('sources', [])), 'Reconstruction receipt does not bind this original video.')
    for name in REQUIRED:
        regular(args.job / name)
    cloud, scene, evidence, fit = (read(args.job / n) for n in
                                 ('arena-cloud.json', 'scene.json', 'scene-usd.json', 'fit-check.json'))
    scale = cloud.get('scale') or {}
    require(cloud.get('units') == scene.get('units') == evidence.get('units') == fit.get('units') == 'm',
            'Centimetre captions require a metric scene and fit receipt.')
    require(cloud.get('provenance', {}).get('floorAligned') is True,
            'Hand-off was not gravity aligned; do not film the tilted scene.')
    require(cloud.get('provenance', {}).get('metricVerified') is False and scale.get('verified') is False,
            'This demo must retain its unverified scale status.')
    require(len(cloud.get('points', [])) == args.expected_points == fit.get('points')
            == (evidence.get('handoff') or {}).get('points'), 'Point counts do not identify the expected reference run.')
    require(math.isclose(float(scale.get('distance', 0)), args.entered_distance, rel_tol=0, abs_tol=1e-9),
            'Entered distance differs from the preserved reference scale.')
    require(scale == scene.get('scale') == (evidence.get('handoff') or {}).get('scale'),
            'Scene, cloud and worker receipt disagree on scale.')
    require(fit.get('basis') == 'model-to-points', 'Fit receipt is not model-to-points evidence.')
    require('fromSource' in cloud, 'Original reconstruction-to-scene transform is missing.')
    require(cloud['provenance'] == (evidence.get('handoff') or {}).get('provenance'),
            'Cloud and worker receipt disagree on hand-off provenance.')
    sys.path.insert(0, str(ROOT / 'robotics/world_worker'))
    import fit_check
    require(fit_check.check(scene, cloud['points']) == fit, 'Persisted fit does not match this scene and cloud.')
    summary_keys = ('within_5cm', 'modelled_median_cm', 'by_kind', 'misfits')
    summary = {'within_5cm': fit['within']['5cm'], 'modelled_median_cm': fit['modelled']['median_cm'],
               'by_kind': fit['by_kind'], 'misfits': fit['misfits']}
    require(scene.get('fit') == summary and all((evidence.get('fit') or {}).get(k) == summary[k] for k in summary_keys),
            'Scene and worker fit summaries do not match the recomputed fit.')
    binding = subprocess.run(['node', str(ROOT / 'scripts/world-demo/verify_reference.mjs'),
                              str(source_ply), str(args.job / 'arena-cloud.json')],
                             check=True, capture_output=True, text=True)
    binding = json.loads(binding.stdout)
    if scene.get('naming'):
        regular(args.job / 'object-names.json')
    images = sorted(p for p in args.photos.iterdir() if p.suffix.lower() in ('.jpg', '.jpeg', '.png'))
    require(bool(images), 'Original reconstruction frames are missing.')
    for image in images:
        regular(image)
    for camera in rec.get('cameras', []):
        name = camera.get('image', '')
        require(Path(name).name == name, 'Unexpected frame path in reconstruction receipt.')
        regular(args.photos / name)
    require(bool(rec.get('cameras')), 'Original camera poses are missing.')
    for tree in (args.job, args.reconstruction):
        require(not any(p.is_symlink() for p in tree.rglob('*')), 'Evidence trees must not contain symlinks.')
    point_source = {'filename': source_ply.name, 'sha256': digest(source_ply),
                    'caption': 'Dense CPU points checked across frames' if source_ply.name == 'dense-preview.ply' and rec.get('dense')
                    else 'Sparse COLMAP points' if source_ply.name == 'sparse-preview.ply'
                    else 'Selected reconstruction points; density method not established by filename',
                    'dense_evidence': rec.get('dense') if source_ply.name == 'dense-preview.ply' else None}
    return {'points': len(cloud['points']), 'scale': scale, 'floor': cloud['provenance'], 'source_binding': binding, 'point_source': point_source,
            'fit': fit, 'names': scene.get('naming'),
            'objects': [{k: o[k] for k in ('name', 'label', 'labelConfidence', 'base') if k in o}
                        for o in scene.get('objects', [])]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', type=Path, required=True, help='corrected scene job output directory')
    parser.add_argument('--reconstruction', type=Path, required=True, help='original reconstruction output directory')
    parser.add_argument('--source-ply', type=Path, help='original source PLY; defaults to reconstruction/sparse-preview.ply')
    parser.add_argument('--photos', type=Path, required=True, help='original COLMAP images directory')
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--capture-sha256', required=True, help='hash from original capture receipt')
    parser.add_argument('--expected-points', type=int, default=10925)
    parser.add_argument('--entered-distance', type=float, default=5.79)
    parser.add_argument('--out', type=Path, required=True, help='fresh private output directory')
    parser.add_argument('--render', action='store_true', help='render every shot and all three cuts with existing scripts')
    parser.add_argument('--original-route', type=Path, help='preserve an original route receipt alongside the recomputed route')
    args = parser.parse_args()
    for key in ('job', 'reconstruction', 'photos', 'capture', 'out'):
        setattr(args, key, getattr(args, key).resolve())
    args.source_ply = (args.source_ply or args.reconstruction / 'sparse-preview.ply').resolve()
    try:
        summary = validate(args)
    except (ValueError, OSError, KeyError, TypeError, ImportError, subprocess.CalledProcessError) as error:
        parser.exit(2, f'BLOCKED: {error}\nNo replacement media was generated.\n')
    args.out.mkdir(parents=True, mode=0o700)
    manifest = {'schema': 'brainsnn.demo-regeneration.v1', 'status': 'archived-not-rendered',
                'capture_credit': 'Mip-NeRF 360 room photographs, Barron et al.; video fixture, not a physical phone capture',
                'entered_distance_caveat': 'Typed for demonstration, not independently measured; not survey accuracy.',
                'route_caveat': 'Scripted planar planning preview; review flags set by the existing demo script, not human acceptance or physical robot evidence.',
                'validation_scope': 'Local consistency checks and hashes; not independent attestation that a worker executed this job.',
                'run': summary}
    receipt = args.out / 'regeneration.json'
    try:
        # Preserve all exports, names, source receipts and intermediate reconstruction evidence.
        shutil.copytree(args.job, args.out / 'job')
        shutil.copytree(args.reconstruction, args.out / 'reconstruction')
        shutil.copytree(args.photos, args.out / 'photos')
        shutil.copy2(args.capture, args.out / 'capture.mp4')
        shutil.copy2(args.source_ply, args.out / 'source-points.ply')
        if args.original_route:
            shutil.copy2(regular(args.original_route), args.out / 'original-route.json')
        route = args.out / 'route.json'
        subprocess.run(['node', str(FILM / 'plan_route.mjs'), str(args.out / 'job/scene.json'),
                        str(route), str(ROOT / 'brainsnn-r3f-app/public/world')], check=True)
        manifest['code_commit'] = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
        manifest['script_sha256'] = {str(p.relative_to(ROOT)): digest(p) for p in
                                    [Path(__file__), ROOT / 'scripts/world-demo/verify_reference.mjs',
                                     *FILM.glob('*.py'), FILM / 'plan_route.mjs']}
        if args.render:
            shots = args.out / 'renders'
            for shot in ('points', 'scene', 'route', 'bim', 'check'):
                subprocess.run([sys.executable, str(FILM / 'bl_shots.py'), '--',
                                *[str(args.out / 'job' / n) for n in ('scene.glb', 'arena-cloud.json', 'scene.json')],
                                str(route), shot, str(shots / f'shot_{shot}')], check=True)
            for cut in ('master', 'commercial', 'check'):
                subprocess.run([sys.executable, str(FILM / 'compose_film.py'), str(shots), str(args.out / 'photos'),
                                str(args.out / 'job'), str(route), str(args.out / f'world-builder-{cut}.mp4'),
                                '--cut', cut, '--reconstruction', str(args.out / 'reconstruction/reconstruction.json')], check=True)
                regular(args.out / f'world-builder-{cut}.mp4')
            manifest['status'] = 'rendered-awaiting-visual-review'
    except Exception as error:
        manifest['status'], manifest['error'] = 'failed-no-publishable-replacement', str(error)
        raise
    finally:
        manifest['sha256'] = {str(p.relative_to(args.out)): digest(p) for p in sorted(args.out.rglob('*'))
                              if p.is_file() and p != receipt}
        receipt.write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    print(f'{manifest["status"]}: {receipt}')


if __name__ == '__main__':
    main()
