"""Source-preserving, appearance-only CPU Gaussian repair adapter."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import sys
import tempfile

# The worker executes absolute adapter files from a private job directory and
# deliberately strips PYTHONPATH. Trust this file's repository, never the cwd.
if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from robotics.splat_repair.ply import read_ply, regular_bytes, encode_repaired
from robotics.splat_repair.runtime import fast_fill

SCHEMA = 'brainsnn.splat-repair-request.v1'
MAX_REQUEST = 256 * 1024
MAX_SELECTION = 20_000
HASH = re.compile(r'^[a-f0-9]{64}$')
DEFAULTS = {'mode': 'auto', 'density': 1.0, 'roughness': 1.0, 'colorSmooth': 0.5, 'seed': 0}


def canonical(value):
    return json.dumps(value, sort_keys=True, allow_nan=False, separators=(',', ':')).encode('utf-8')


def read_json(path, maximum=MAX_REQUEST):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Duplicate JSON keys are not accepted.')
            result[key] = value
        return result
    try:
        value = json.loads(regular_bytes(path, maximum), object_pairs_hook=pairs)
        canonical(value)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Use a bounded UTF-8 JSON object.') from error
    return value


def validate_options(value, vertex_count=None):
    keys = {'schema', 'sourceSha256', 'method', 'selection', 'parameters', 'reviewed'}
    if not isinstance(value, dict) or set(value) != keys or value.get('schema') != SCHEMA \
            or value.get('reviewed') is not True:
        raise ValueError('A reviewed splat repair request with the exact schema is required.')
    if not isinstance(value['sourceSha256'], str) or not HASH.fullmatch(value['sourceSha256']):
        raise ValueError('Bind the exact original PLY SHA-256.')
    if value['method'] != 'fast-fill':
        raise ValueError('Only the real CPU fast-fill runtime is installed; Deep Fill is unavailable.')
    selection = value['selection']
    if not isinstance(selection, dict) or set(selection) != {'indices'}:
        raise ValueError('Selection must contain original vertex indices only.')
    indices = selection['indices']
    if not isinstance(indices, list) or not 30 <= len(indices) <= MAX_SELECTION \
            or any(type(i) is not int or not 0 <= i < 200_000 for i in indices) \
            or len(set(indices)) != len(indices):
        raise ValueError('Select 30 to 20,000 unique original Gaussian vertex indices.')
    if vertex_count is not None and (max(indices) >= vertex_count or len(indices) > vertex_count // 4):
        raise ValueError('Selection must belong to this source and cover at most one quarter of its splats.')
    knobs = value['parameters']
    if not isinstance(knobs, dict) or set(knobs) - set(DEFAULTS):
        raise ValueError('Unknown repair parameter; paths, volumes and external models are not accepted.')
    knobs = {**DEFAULTS, **knobs}
    if knobs['mode'] not in ('auto', 'rim', 'patch'):
        raise ValueError('Repair mode must be auto, rim or patch.')
    for name, lo, hi in [('density', .25, 2), ('roughness', 0, 2), ('colorSmooth', 0, 1)]:
        value_n = knobs[name]
        if type(value_n) not in (int, float) or not math.isfinite(value_n) or not lo <= value_n <= hi:
            raise ValueError('Repair numeric parameters are outside their finite bounded range.')
    if type(knobs['seed']) is not int or not 0 <= knobs['seed'] <= 2**32 - 1:
        raise ValueError('Repair seed must be an unsigned 32-bit integer.')
    result = {**value, 'selection': {'indices': sorted(indices)}, 'parameters': knobs}
    if len(canonical(result)) > MAX_REQUEST:
        raise ValueError('Repair request exceeds 256 KiB.')
    return result


def validate_upload(path, kind):
    if kind == 'splat':
        source = read_ply(path)
        return {'vertices': len(source.records), 'sha256': source.sha256, 'format': source.format,
                'sphericalHarmonicRestProperties': source.rest_count}
    if kind == 'repair':
        return validate_options(read_json(path))
    raise ValueError('Splat repair accepts only splat and repair inputs.')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def run(request):
    inputs = request.get('inputs', []) if isinstance(request, dict) else []
    if not isinstance(request, dict) or request.get('schema') != 'brainsnn.adapter.v1' \
            or not isinstance(inputs, list) or len(inputs) != 2 \
            or any(not isinstance(row, dict) or not isinstance(row.get('kind'), str) for row in inputs) \
            or sorted(row['kind'] for row in inputs) != ['repair', 'splat']:
        raise ValueError('Splat repair needs exactly one original splat PLY and one reviewed repair request.')
    by_kind = {row['kind']: row for row in inputs}
    paths = {}
    for kind, row in by_kind.items():
        if not isinstance(row.get('path'), str) or not Path(row['path']).is_absolute():
            raise ValueError('Adapter input paths must be absolute regular files.')
        paths[kind] = Path(row['path'])
    if paths['splat'].resolve() == paths['repair'].resolve():
        raise ValueError('Original PLY and repair request must be distinct files.')
    source = read_ply(paths['splat'])
    options = validate_options(read_json(paths['repair']), len(source.records))
    if source.sha256 != options['sourceSha256']:
        raise ValueError('Original PLY changed; reopen it and review the selected indices.')
    out_value = request.get('output_dir')
    if not isinstance(out_value, str) or not Path(out_value).is_absolute():
        raise ValueError('Adapter output must be an absolute private directory.')
    out = Path(out_value)
    if out.is_symlink() or out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError('Repair output must be an empty regular directory; existing data is never overwritten.')
    if not out.parent.is_dir():
        raise ValueError('Adapter output parent must already exist.')
    result, kept, donors, backing, engine = fast_fill(source, options)
    repaired = encode_repaired(source, kept, result.added, donors)
    generated_start = len(kept)
    mapping = {'schema': 'brainsnn.splat-repair-mapping.v1', 'originalSha256': source.sha256,
               'repairedSha256': digest(repaired), 'selectedOriginalIndices': options['selection']['indices'],
               'removedOriginalIndices': sorted(int(i) for i in result.removed),
               'retainedOriginalIndices': kept.tolist(),
               'generatedOutputIndices': list(range(generated_start, generated_start + result.added.n)),
               'generatedDonorOriginalIndices': donors.tolist(), 'generatedBacking': backing.tolist(),
               'ordering': 'retained original rows in source order, followed by generated rows',
               'generatedOriginalIndex': None, 'generatedPositionsMeasured': False,
               'extraProperties': 'copied from the mapped donor; not recomputed physical attributes'}
    payloads = {'original.ply': source.raw, 'repaired.ply': repaired,
                'repair-request.json': canonical(options), 'repair-mapping.json': canonical(mapping)}
    outputs = [{'name': name, 'bytes': len(raw), 'sha256': digest(raw)} for name, raw in payloads.items()]
    receipt = {'schema': 'brainsnn.splat-repair.v1', 'method': 'fast-fill', 'status': 'generated-appearance',
               'originalSha256': source.sha256, 'repairedSha256': digest(repaired),
               'inputVertices': len(source.records), 'retainedVertices': len(kept),
               'selectedVertices': len(options['selection']['indices']), 'removedVertices': len(result.removed),
               'generatedVertices': result.added.n, 'outputVertices': len(kept) + result.added.n,
               'inputFormat': source.format, 'outputFormat': 'binary_little_endian',
               'properties': [{'name': name, 'type': ty} for ty, name in source.properties],
               'originalBytesPreserved': True, 'retainedVertexAttributesPreserved': True,
               'appearanceOnly': True, 'generatedGeometry': True, 'measuredGeometry': False,
               'metric_verified': False, 'physics_ready': False, 'robotReady': False,
               'collisionGeometryProduced': False, 'occupancyMapProduced': False,
               'deepFillUsed': False, 'originalCoordinateSystem': 'unchanged; units unverified',
               'limits': ['Generated fill is inferred appearance, not recovered measured surfaces.',
                          'Review the result; no physical accuracy, watertightness or robot safety is established.',
                          'This profile repairs selected existing splats; painting empty scan volumes is not supported.'],
               'runtime': {'python': platform.python_version(), 'numpy': importlib.metadata.version('numpy'),
                           'scipy': importlib.metadata.version('scipy'), **engine},
               'outputs': outputs}
    payloads['repair-receipt.json'] = canonical(receipt)
    manifest = {'artifacts': [{'name': name, 'kind': 'gaussian-appearance' if name.endswith('.ply') else 'evidence'}
                              for name in payloads]}
    payloads['manifest.json'] = canonical(manifest)
    # Publish one complete directory. Cancellation during computation/staging
    # cannot expose a success manifest or overwrite the source or an old result.
    with tempfile.TemporaryDirectory(prefix='.splat-repair-', dir=out.parent) as temporary:
        stage = Path(temporary)
        for name, raw in payloads.items():
            (stage / name).write_bytes(raw)
        if regular_bytes(paths['splat']) != source.raw:
            raise ValueError('Original PLY changed during repair; no result was published.')
        os.replace(stage, out)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-manifest', type=Path, required=True)
    args = parser.parse_args()
    result = run(read_json(args.input_manifest))
    print(json.dumps({'status': result['status'], 'generatedVertices': result['generatedVertices'],
                      'originalSha256': result['originalSha256'], 'repairedSha256': result['repairedSha256'],
                      'metric_verified': False, 'physics_ready': False}))


if __name__ == '__main__':
    main()
