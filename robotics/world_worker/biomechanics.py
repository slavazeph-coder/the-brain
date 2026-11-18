"""Source-preserving OpenSim CPU analysis adapter, with no ENABLE dependency."""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sys
import tempfile

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from robotics.biomechanics.validation import (
    MAX_MODEL_BYTES, MAX_MOTION_BYTES, MAX_OPTIONS_BYTES, MAX_LOADS_BYTES,
    parse_model, parse_motion, parse_options, parse_loads, read_regular, sha256, strict_json,
)

LIMITS = {'biomech-model': MAX_MODEL_BYTES, 'biomech-motion': MAX_MOTION_BYTES,
          'biomech-options': MAX_OPTIONS_BYTES, 'biomech-loads': MAX_LOADS_BYTES}


def check_bytes(raw: bytes, kind: str):
    if kind == 'biomech-model':
        sanitized, info = parse_model(raw)
        return {**info, 'sanitized': sanitized}
    parsers = {'biomech-motion': parse_motion, 'biomech-options': parse_options, 'biomech-loads': parse_loads}
    if kind not in parsers:
        raise ValueError('Unknown biomechanics upload kind.')
    return parsers[kind](raw)


def validate_upload(path: Path, kind: str) -> dict:
    """No OpenSim/numerical import; worker UUID paths deliberately need no suffix."""
    if kind not in LIMITS:
        raise ValueError('Unknown biomechanics upload kind.')
    return check_bytes(read_regular(Path(path), LIMITS[kind]), kind)


def validate_inputs(checked: dict):
    required = {'biomech-model', 'biomech-motion', 'biomech-options'}
    if set(checked) not in (required, required | {'biomech-loads'}):
        raise ValueError('Provide exactly one model, one motion, options and optional explicit loads.')
    model, motion, options = (checked[key] for key in ('biomech-model', 'biomech-motion', 'biomech-options'))
    if set(model['coordinate_names']) != set(motion['coordinate_names']):
        raise ValueError('Motion must provide all model coordinates exactly once, without extra coordinates.')
    count = len(motion['time_s'])
    if model['body_count'] * count > 100000 or model['muscle_count'] * count * max(1, len(options.get('moment_arm_coordinates') or [0] * 4)) > 500000:
        raise ValueError('Model and motion exceed the analysis work budget; shorten the trial.')
    if any(name not in model['coordinate_names'] for name in options.get('moment_arm_coordinates', [])):
        raise ValueError('Requested moment-arm coordinate is absent from the model.')
    loads = checked.get('biomech-loads')
    supplied = options.get('external_loads') == 'supplied'
    if bool(loads is not None) != supplied:
        raise ValueError('Supplied-load analysis needs one loads file; other modes must not include it.')
    if options['analysis'] == 'inverse-dynamics' and count < 5:
        raise ValueError('Inverse dynamics needs at least five motion frames.')
    if loads is not None:
        if len(loads['time_s']) != count or any(not math.isclose(a, b, rel_tol=0, abs_tol=1e-9) for a, b in zip(loads['time_s'], motion['time_s'])):
            raise ValueError('External load timestamps must match the original motion, without implicit resampling.')
        if any(load['body'] not in model['body_names'] for load in loads['loads']):
            raise ValueError('External load targets a body absent from the model.')
    return {'frame_count': count, 'analysis': options['analysis']}


def run_request(request: dict) -> dict:
    if not isinstance(request, dict) or request.get('schema') != 'brainsnn.adapter.v1' or not isinstance(request.get('inputs'), list) or not 3 <= len(request['inputs']) <= 4:
        raise ValueError('Expected a biomechanics brainsnn.adapter.v1 manifest with 3–4 inputs.')
    blobs, checked = {}, {}
    for item in request['inputs']:
        if not isinstance(item, dict) or item.get('kind') not in LIMITS or item['kind'] in blobs:
            raise ValueError('Invalid, duplicate or unsupported biomechanics input.')
        kind = item['kind']
        raw = read_regular(Path(item['path']), LIMITS[kind])
        if item.get('sha256') and item['sha256'] != sha256(raw):
            raise ValueError('Input bytes no longer match the recorded upload hash.')
        blobs[kind], checked[kind] = raw, check_bytes(raw, kind)
    validate_inputs(checked)
    bindings = {'model_sha256': sha256(blobs['biomech-model']), 'motion_sha256': sha256(blobs['biomech-motion']),
                'options_sha256': sha256(blobs['biomech-options']),
                'loads_sha256': sha256(blobs['biomech-loads']) if 'biomech-loads' in blobs else None}
    output = Path(request['output_dir'])
    if output.is_symlink():
        raise ValueError('Output directory must not be a symlink.')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Analysis needs an empty output directory; previous results are retained.')
    for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ.setdefault(key, '2')
    from robotics.biomechanics.runtime import analyze
    with tempfile.TemporaryDirectory(prefix='biomechanics-stage-', dir=output.parent) as temporary:
        stage = Path(temporary)
        report = analyze(checked, stage, bindings)
        originals = {'biomech-model': 'original-model.osim', 'biomech-motion': 'original-motion.mot',
                     'biomech-options': 'biomechanics-options.json', 'biomech-loads': 'external-loads.json'}
        for kind, raw in blobs.items():
            (stage / originals[kind]).write_bytes(raw)
        artifacts = []
        for path in sorted(stage.iterdir()):
            if path.is_symlink() or not path.is_file():
                raise ValueError('Unexpected native output.')
            kind = ('biomechanics-preview' if path.name == 'biomechanics-preview.json' else
                    'biomechanics-source' if path.name in originals.values() or path.name == 'analysis-model.osim' else 'biomechanics-report')
            artifacts.append({'name': path.name, 'kind': kind})
            os.replace(path, output / path.name)
        (output / 'manifest.json').write_text(json.dumps({'artifacts': artifacts}) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', type=Path, required=True)
    args = parser.parse_args()
    report = run_request(strict_json(read_regular(args.input_manifest, 64 * 1024)))
    print(json.dumps({'status': 'complete', 'analysis': report['analysis'], 'frames': report['frame_count'],
                      'native_build': report['runtime']['native_build'], 'medical_validated': False}))


if __name__ == '__main__':
    main()
