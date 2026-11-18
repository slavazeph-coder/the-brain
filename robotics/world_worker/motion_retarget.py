"""World worker adapter: authorized SOMA BVH -> real G1 kinematic motion reference."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

# Worker processes run in a private job cwd and intentionally strip PYTHONPATH.
# Only this file's trusted repository root is added, never an uploaded path.
if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from robotics.motion_retarget.validation import (
    MAX_BVH_BYTES, MAX_OPTIONS_BYTES, options_from_bytes, parse_bvh, read_regular,
    sha256, strict_json, validate_source,
)


def validate_upload(path: Path, kind: str) -> dict:
    """Cheap native-library-free admission; exact pinned topology checked at execution."""
    path = Path(path)
    if kind == 'motion':
        motion = parse_bvh(read_regular(path, MAX_BVH_BYTES))
        return {'frame_count': len(motion.frames), 'fps': motion.fps, 'joints': len(motion.joints)}
    if kind == 'retarget':
        return options_from_bytes(read_regular(path, MAX_OPTIONS_BYTES))
    raise ValueError('Expected motion or retarget upload kind.')


def run_request(request: dict) -> dict:
    if not isinstance(request, dict) or request.get('schema') != 'brainsnn.adapter.v1':
        raise ValueError('Expected a brainsnn.adapter.v1 input manifest.')
    inputs = request.get('inputs')
    if not isinstance(inputs, list) or len(inputs) != 2 or any(not isinstance(i, dict) for i in inputs):
        raise ValueError('Retargeting requires exactly one motion and one options file.')
    if sorted(i.get('kind', '') for i in inputs) != ['motion', 'retarget']:
        raise ValueError('Retargeting requires one motion (.bvh) and one retarget (.json) input.')
    blobs = {}
    for item in inputs:
        kind = item['kind']
        path = Path(item['path'])
        validate_upload(path, kind)
        blob = read_regular(path, MAX_BVH_BYTES if kind == 'motion' else MAX_OPTIONS_BYTES)
        if item.get('sha256') and item['sha256'] != sha256(blob):
            raise ValueError('Input file no longer matches its upload SHA-256.')
        blobs[kind] = blob
    options = options_from_bytes(blobs['retarget'])
    validate_source(blobs['motion'], options)
    runtime = os.environ.get('WORLD_SOMA_RUNTIME_DIR')
    if not runtime:
        raise RuntimeError('Pinned SOMA runtime unavailable; set WORLD_SOMA_RUNTIME_DIR after installation and qualification.')
    output = Path(request['output_dir'])
    if output.is_symlink():
        raise ValueError('Output directory cannot be a symlink.')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Retargeting requires an empty output directory; prior results are never overwritten.')
    # Limit native numerical-library threads before importing any of them.
    for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ.setdefault(name, '2')
    from robotics.motion_retarget.runtime import retarget
    with tempfile.TemporaryDirectory(prefix='motion-stage-', dir=output.parent) as temporary:
        stage = Path(temporary)
        report = retarget(blobs['motion'], options, stage, runtime_dir=Path(runtime),
                          device=os.environ.get('WORLD_SOMA_DEVICE', 'cpu'))
        (stage / 'retarget-options.json').write_bytes(blobs['retarget'])
        report['options_sha256'] = sha256(blobs['retarget'])
        (stage / 'motion-reference.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
        kinds = {'original-motion.bvh': 'motion-source', 'normalized-soma.bvh': 'motion-source',
                 'retarget-options.json': 'motion-source', 'robot-reference.csv': 'motion-reference',
                 'motion-preview.json': 'motion-preview', 'motion-reference.json': 'motion-reference'}
        for name in kinds:
            os.replace(stage / name, output / name)
        # Worker only publishes files after successful process completion and manifest validation.
        manifest = {'artifacts': [{'name': name, 'kind': kind} for name, kind in kinds.items()]}
        (output / 'manifest.json').write_text(json.dumps(manifest) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', type=Path, required=True)
    args = parser.parse_args()
    report = run_request(strict_json(read_regular(args.input_manifest, 64 * 1024)))
    print(json.dumps({'status': 'complete', 'role': report['role'], 'target': report['target'],
                      'frames': report['frame_count'], 'fps': report['fps'],
                      'device': report['runtime']['device'], 'robot_control_enabled': False}))


if __name__ == '__main__':
    main()
