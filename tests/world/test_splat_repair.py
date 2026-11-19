"""Real upstream CPU repair on an authored Gaussian surface, without weights."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import pytest

from robotics.splat_repair import ply, runtime
from robotics.world_worker import splat_repair as adapter


ROOT = Path(__file__).resolve().parents[2]


def fixture_ply(path, *, ascii=False, degree=3):
    """Authored plane with a coloured blemish; all values are test-generated."""
    rng = np.random.default_rng(41)
    n = 6400
    rest = 3 * ((degree + 1)**2 - 1)
    properties = [('double' if name == 'x' else 'float', name) for name in ply.REQUIRED]
    properties += [('float', f'f_rest_{i}') for i in range(rest)]
    properties += [('uint', 'authored_id'), ('double', 'confidence'), ('short', 'category')]
    data = np.zeros(n, dtype=[(name, ply.TYPES[ty]) for ty, name in properties])
    x, y = np.meshgrid(np.linspace(-2.4, 2.4, 80), np.linspace(-2.4, 2.4, 80))
    data['x'] = x.ravel() + rng.uniform(-.008, .008, n)
    data['y'] = y.ravel() + rng.uniform(-.008, .008, n)
    data['z'] = rng.normal(0, .001, n)
    selection = np.flatnonzero(data['x']**2 + data['y']**2 < .48**2).tolist()
    for i in range(3):
        data[f'f_dc_{i}'] = (.4 + .08 * np.sin(data['x'] * 2 + i) - .5) / .28209479177387814
        data[f'scale_{i}'] = np.log([.04, .035, .004][i])
    data['f_dc_0'][selection] = 1.5
    data['rot_0'] = 1
    data['opacity'] = 2.5
    for i in range(rest):
        data[f'f_rest_{i}'] = rng.normal(0, .02, n)
    data['authored_id'] = np.arange(n) + 100
    data['confidence'] = np.linspace(.1234567890123, .9876543210987, n)
    data['category'] = np.arange(n) % 7
    header = ['ply', 'format ' + ('ascii' if ascii else 'binary_little_endian') + ' 1.0',
              'comment authored non-restricted Gaussian test fixture', f'element vertex {n}',
              *[f'property {ty} {name}' for ty, name in properties], 'end_header', '']
    if ascii:
        body = '\n'.join(' '.join(str(data[name][i]) for _, name in properties) for i in range(n)).encode() + b'\n'
    else:
        body = data.tobytes()
    path.write_bytes('\n'.join(header).encode() + body)
    return selection


def make_request(tmp_path, *, ascii=False, degree=3, mode='rim'):
    source = tmp_path / 'source.ply'
    selected = fixture_ply(source, ascii=ascii, degree=degree)
    options = {'schema': adapter.SCHEMA, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
               'method': 'fast-fill', 'selection': {'indices': selected},
               'parameters': {'mode': mode, 'seed': 17}, 'reviewed': True}
    repair = tmp_path / 'request.json'; repair.write_text(json.dumps(options))
    out = tmp_path / 'output'; out.mkdir()
    request = {'schema': 'brainsnn.adapter.v1',
               'inputs': [{'kind': 'splat', 'path': str(source)}, {'kind': 'repair', 'path': str(repair)}],
               'output_dir': str(out)}
    return request, options


def test_real_fast_fill_preserves_source_properties_and_records_provenance(tmp_path):
    request, options = make_request(tmp_path)
    source = ply.read_ply(request['inputs'][0]['path'])
    receipt = adapter.run(request)
    out = Path(request['output_dir'])
    repaired = ply.read_ply(out / 'repaired.ply')
    mapping = json.loads((out / 'repair-mapping.json').read_bytes())
    kept = mapping['retainedOriginalIndices']; start = len(kept)
    donors = mapping['generatedDonorOriginalIndices']
    assert (out / 'original.ply').read_bytes() == source.raw == Path(request['inputs'][0]['path']).read_bytes()
    assert repaired.properties == source.properties
    assert repaired.records[:start].tobytes() == source.records[kept].tobytes()
    for name in ('authored_id', 'confidence', 'category'):
        assert np.array_equal(repaired.records[name][start:], source.records[name][donors])
    assert set(options['selection']['indices']).issubset(mapping['removedOriginalIndices'])
    assert mapping['generatedOutputIndices'] == list(range(start, len(repaired.records)))
    assert len(donors) == receipt['generatedVertices'] > 30
    face = ~np.asarray(mapping['generatedBacking'])
    generated = repaired.records[start:][face]
    center = generated[generated['x']**2 + generated['y']**2 < .35**2]
    assert len(center) > 25, 'Upstream must actually fill the erased surface, not only delete the selection.'
    assert np.quantile(np.abs(center['z']), .95) < .03
    assert np.median(center['f_dc_0']) < .4, 'Actual copied fill must replace the authored red blemish.'
    assert receipt['runtime']['upstream']['revision'] == runtime.REVISION
    assert receipt['runtime']['effectiveParameters']['seed'] == 17
    assert receipt['appearanceOnly'] and receipt['originalBytesPreserved']
    for key in ('measuredGeometry', 'metric_verified', 'physics_ready', 'robotReady', 'collisionGeometryProduced', 'occupancyMapProduced', 'deepFillUsed'):
        assert receipt[key] is False
    assert mapping['generatedPositionsMeasured'] is False
    assert mapping['originalSha256'] == receipt['originalSha256'] == source.sha256
    assert mapping['repairedSha256'] == receipt['repairedSha256'] == repaired.sha256
    for row in receipt['outputs']:
        raw = (out / row['name']).read_bytes()
        assert row['sha256'] == hashlib.sha256(raw).hexdigest() and row['bytes'] == len(raw)
    assert {p.name for p in out.iterdir()} == {'original.ply', 'repaired.ply', 'repair-request.json',
                                              'repair-mapping.json', 'repair-receipt.json', 'manifest.json'}


def test_default_auto_core_and_deterministic_parameters(tmp_path):
    request, options = make_request(tmp_path, degree=0, mode='auto')
    options['parameters'] = {}
    Path(request['inputs'][1]['path']).write_text(json.dumps(options))
    first = adapter.run(request)
    request['output_dir'] = str(tmp_path / 'again')
    second = adapter.run(request)
    assert first['repairedSha256'] == second['repairedSha256']
    assert (tmp_path / 'output/repair-mapping.json').read_bytes() == (tmp_path / 'again/repair-mapping.json').read_bytes()
    assert first['runtime']['effectiveParameters']['mode'] == 'auto'


def test_direct_cli_works_from_private_cwd_without_pythonpath(tmp_path):
    request, _ = make_request(tmp_path, ascii=True, degree=1)
    manifest = tmp_path / 'manifest.json'; manifest.write_text(json.dumps(request))
    private = tmp_path / 'private-job'; private.mkdir()
    env = dict(os.environ); env.pop('PYTHONPATH', None)
    result = subprocess.run([sys.executable, str(ROOT / 'robotics/world_worker/splat_repair.py'),
                             '--input-manifest', str(manifest)], cwd=private, env=env,
                            text=True, capture_output=True, timeout=120, check=True)
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    assert summary['status'] == 'generated-appearance' and summary['generatedVertices'] > 0
    assert (tmp_path / 'source.ply').read_bytes() == (tmp_path / 'output/original.ply').read_bytes()
    assert ply.read_ply(tmp_path / 'output/repaired.ply').rest_count == 9


@pytest.mark.parametrize('change', [
    {'reviewed': False}, {'method': 'deep-fill'}, {'sourceSha256': '../outside'},
    {'parameters': {'weights': '/tmp/weights'}}, {'parameters': {'density': float('nan')}},
    {'parameters': {'roughness': True}}, {'parameters': {'seed': -1}}, {'parameters': {'seed': True}},
    {'parameters': {'colorSmooth': 1.1}}, {'parameters': {'mode': 'fake'}},
    {'selection': {'indices': [0] * 30}}, {'selection': {'indices': list(range(29))}},
    {'selection': {'indices': list(range(20_001))}}, {'selection': {'indices': [True] + list(range(1, 30))}},
    {'selection': {'indices': list(range(29)) + [200_000]}}, {'selection': {'path': '/tmp/region'}},
])
def test_invalid_request_is_rejected_before_runtime(change):
    base = {'schema': adapter.SCHEMA, 'sourceSha256': '1' * 64, 'method': 'fast-fill',
            'selection': {'indices': list(range(30))}, 'parameters': {}, 'reviewed': True}
    with pytest.raises(ValueError):
        adapter.validate_options({**base, **change})


def test_indices_bound_to_exact_source_and_small_region(tmp_path):
    request, options = make_request(tmp_path)
    for selected in [list(range(1700)), list(range(29)) + [6400]]:
        with pytest.raises(ValueError, match='this source'):
            adapter.validate_options({**options, 'selection': {'indices': selected}}, 6400)
    options['sourceSha256'] = '0' * 64
    Path(request['inputs'][1]['path']).write_text(json.dumps(options))
    with pytest.raises(ValueError, match='changed'):
        adapter.run(request)
    assert not any(Path(request['output_dir']).iterdir())


@pytest.mark.parametrize('mutation', ['nan', 'quaternion', 'truncated', 'partial-sh', 'duplicate', 'list', 'vertices'])
def test_malformed_gaussians_rejected(tmp_path, mutation):
    source = tmp_path / 'source.ply'; fixture_ply(source)
    data = ply.read_ply(source)
    raw = data.raw
    if mutation in ('nan', 'quaternion'):
        rows = data.records.copy()
        rows['x' if mutation == 'nan' else 'rot_0'][0] = float('nan') if mutation == 'nan' else 0
        raw = raw[:raw.index(b'end_header\n') + 11] + rows.tobytes()
    elif mutation == 'truncated': raw = raw[:-1]
    elif mutation == 'partial-sh': raw = raw.replace(b'f_rest_44', b'f_rest_99')
    elif mutation == 'duplicate': raw = raw.replace(b'property double confidence', b'property double x')
    elif mutation == 'list': raw = raw.replace(b'property short category', b'property list uchar int category')
    elif mutation == 'vertices': raw = raw.replace(b'element vertex 6400', b'element vertex 200001')
    source.write_bytes(raw)
    with pytest.raises(ValueError): ply.read_ply(source)


def test_resource_guard_rejects_dispersed_dense_selection(tmp_path):
    request, options = make_request(tmp_path)
    source = ply.read_ply(request['inputs'][0]['path'])
    # Keep the original local density, but move selected points far apart.
    # Do not invoke the expensive upstream surface-grid allocation.
    source.records['x'][options['selection']['indices'][0]] = 1000
    with pytest.raises(ValueError, match='surface grid'):
        runtime.fast_fill(source, adapter.validate_options(options, len(source.records)))


def test_path_and_output_guards_do_not_overwrite_sources(tmp_path):
    request, _ = make_request(tmp_path)
    original = Path(request['inputs'][0]['path']).read_bytes()
    alias = tmp_path / 'alias.ply'; alias.symlink_to(request['inputs'][0]['path'])
    with pytest.raises(ValueError, match='regular'):
        adapter.validate_upload(alias, 'splat')
    (Path(request['output_dir']) / 'preserve.txt').write_text('existing data')
    with pytest.raises(ValueError, match='never overwritten'):
        adapter.run(request)
    assert Path(request['inputs'][0]['path']).read_bytes() == original
    assert (Path(request['output_dir']) / 'preserve.txt').read_text() == 'existing data'
    target = tmp_path / 'target'; target.mkdir()
    out_alias = tmp_path / 'out-alias'; out_alias.symlink_to(target)
    request['output_dir'] = str(out_alias)
    with pytest.raises(ValueError, match='never overwritten'):
        adapter.run(request)


def test_json_duplicates_and_unbounded_files_are_rejected(tmp_path):
    path = tmp_path / 'request.json'; path.write_text('{"reviewed":true,"reviewed":false}')
    with pytest.raises(ValueError, match='Duplicate'):
        adapter.read_json(path)
    path.write_bytes(b' ' * (adapter.MAX_REQUEST + 1))
    with pytest.raises(ValueError, match='bounded'):
        adapter.read_json(path)


def test_changed_source_during_actual_repair_is_not_published(tmp_path, monkeypatch):
    request, _ = make_request(tmp_path, degree=0)
    real_fill = adapter.fast_fill
    def change_after_fill(source, options):
        result = real_fill(source, options)
        Path(request['inputs'][0]['path']).write_bytes(source.raw + b'changed')
        return result
    monkeypatch.setattr(adapter, 'fast_fill', change_after_fill)
    with pytest.raises(ValueError, match='during repair'):
        adapter.run(request)
    assert not any(Path(request['output_dir']).iterdir())
    assert not list(tmp_path.glob('.splat-repair-*'))


@pytest.mark.parametrize('inputs', [[], [{}], [{}, {}], [{'kind': None}, {'kind': 'splat'}],
                                  [{'kind': 'splat'}, {'kind': 'splat'}]])
def test_malformed_adapter_inputs_are_rejected(inputs):
    with pytest.raises(ValueError, match='exactly one'):
        adapter.run({'schema': 'brainsnn.adapter.v1', 'inputs': inputs})


def test_vendored_source_is_exact_and_licensed():
    lock = runtime.verify_vendor()
    assert lock['repository'] == 'https://github.com/NicolasDrum/splat-repair'
    assert lock['license'] == 'Apache-2.0' and len(lock['files']) == 9
