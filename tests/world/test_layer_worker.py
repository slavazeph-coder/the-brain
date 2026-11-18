"""HTTP admission, tenant boundaries and real CPU layer subprocess transport."""
import hashlib
import io
import json
from pathlib import Path
import sys
import time

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from robotics.world_worker.app import create_app, LAYER_UPLOADS
from robotics.world_worker.auth import REGISTRY_SCHEMA
from robotics.localization import contracts as localization
from robotics.localization.recording import Collector
from tests.world.test_splat_repair import fixture_ply
from tests.world.test_localization import scan, options as scan_options
from tests.world.test_motion_retarget import small_bvh, OPTIONS as MOTION_OPTIONS

ROOT = Path(__file__).resolve().parents[2]
OPERATOR = 'http-layer-operator-' + 'o' * 43
A, B, VISITOR = 'a' * 43, 'b' * 43, 'v' * 43
ENGINES = ['splat-repair', 'localization-map', 'motion-retarget', 'biomechanics']
KINDS = {'splat-repair': ['splat', 'repair'], 'localization-map': ['survey', 'localization'],
         'motion-retarget': ['motion', 'retarget'],
         'biomechanics': ['biomech-model', 'biomech-motion', 'biomech-options', 'biomech-loads']}
FILENAMES = {'splat': 'source.ply', 'repair': 'repair.json', 'survey': 'scan.ply',
             'localization': 'localization.json', 'motion': 'source.bvh', 'retarget': 'retarget.json',
             'biomech-model': 'body.osim', 'biomech-motion': 'movement.mot',
             'biomech-options': 'options.json', 'biomech-loads': 'forces.json'}


def headers(credential=A):
    return {'Authorization': 'Bearer ' + credential}


def configure(tmp_path, *, command_overrides=None, disabled=()):
    modules = {'splat-repair': 'splat_repair.py', 'localization-map': 'localization_job.py',
               'motion-retarget': 'motion_retarget.py', 'biomechanics': 'biomechanics.py'}
    entries = [{'id': engine, 'label': 'HTTP contract fixture ' + engine,
                'enabled': engine not in disabled, 'license_reviewed': True,
                'input_kinds': KINDS[engine], 'max_inputs': len(KINDS[engine]), 'timeout_seconds': 60,
                'source_job': engine == 'localization-map',
                'command': (command_overrides or {}).get(engine, [sys.executable,
                    str(ROOT / 'robotics/world_worker' / module), '--input-manifest', '{input_manifest}'])}
               for engine, module in modules.items()]
    config = tmp_path / 'adapters.json'; config.write_text(json.dumps(entries))
    registry = tmp_path / 'tenants.json'
    registry.write_text(json.dumps({'schema': REGISTRY_SCHEMA, 'tenants': [
        {'id': owner, 'token_sha256': hashlib.sha256(credential.encode()).hexdigest(),
         'engines': ['inspect'] + (ENGINES if credential != VISITOR else []),
         'limits': {'active_jobs': 3}}
        for owner, credential in [('alpha', A), ('beta', B), ('visitor', VISITOR)]]}))
    return {'root': tmp_path / 'data', 'token': OPERATOR, 'adapters': str(config),
            'tenants': str(registry), 'job_limit': 128 * 1024**2}, registry


@pytest.fixture
def worker(tmp_path):
    arguments, registry = configure(tmp_path)
    with TestClient(create_app(**arguments)) as client:
        yield client, registry


def upload(client, kind, raw, credential=A):
    response = client.post('/v1/uploads', headers=headers(credential),
                           json={'name': FILENAMES[kind], 'kind': kind, 'size': len(raw)})
    assert response.status_code == 201, response.text
    uid = response.json()['id']
    for offset in range(0, len(raw), 4 * 1024**2):
        put = client.put(f'/v1/uploads/{uid}?offset={offset}', content=raw[offset:offset + 4 * 1024**2], headers=headers(credential))
        assert put.status_code == 200, put.text
    return uid


def prepare(client, engine, ids, credential=A, source=None):
    body = {'engine': engine, 'upload_ids': ids, 'consent': True}
    if source is not None:
        body['source_job'] = source
    return client.post('/v1/jobs', json=body, headers=headers(credential))


def complete(client, prepared):
    assert prepared.status_code == 201, prepared.text
    jid = prepared.json()['id']
    assert client.post(f'/v1/jobs/{jid}/start', headers=headers(), json={}).status_code == 200
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        job = client.get('/v1/jobs/' + jid, headers=headers()).json()
        if job['status'] in ('complete', 'failed', 'cancelled'):
            assert job['status'] == 'complete', job
            return job
        time.sleep(.03)
    raise AssertionError('CPU layer job did not finish')


def artifact(client, job, name):
    index = next(i for i, item in enumerate(job['artifacts']) if item['name'] == name)
    response = client.post(f"/v1/jobs/{job['id']}/ticket", headers=headers(), json={'artifact': index})
    assert response.status_code == 200, response.text
    downloaded = client.get(response.json()['url'])
    assert downloaded.status_code == 200, downloaded.text
    assert hashlib.sha256(downloaded.content).hexdigest() == job['artifacts'][index]['sha256']
    return downloaded.content


def splat_inputs(tmp_path):
    path = tmp_path / 'authored.ply'; selected = fixture_ply(path, degree=1)
    raw = path.read_bytes()
    options = {'schema': 'brainsnn.splat-repair-request.v1', 'sourceSha256': hashlib.sha256(raw).hexdigest(),
               'method': 'fast-fill', 'selection': {'indices': selected},
               'parameters': {'mode': 'rim', 'seed': 11}, 'reviewed': True}
    return raw, options


def test_layers_stay_private_and_require_available_engine(worker):
    client, _ = worker
    assert client.get('/v1/capabilities').status_code == 401
    visible = client.get('/v1/capabilities', headers=headers(VISITOR)).json()
    assert [e['id'] for e in visible['engines']] == ['inspect']
    assert visible['limits']['upload_kind_bytes'] == {}
    for kind, (engine, _) in LAYER_UPLOADS.items():
        assert client.post('/v1/uploads', headers=headers(VISITOR),
                           json={'name': FILENAMES[kind], 'kind': kind, 'size': 1}).status_code == 403
        assert prepare(client, engine, ['a' * 32], VISITOR).status_code == 403
    limits = client.get('/v1/capabilities', headers=headers()).json()['limits']['upload_kind_bytes']
    assert limits == {kind: limit for kind, (_, limit) in LAYER_UPLOADS.items()}


def test_disabled_layers_cannot_admit_uploads(tmp_path):
    args, _ = configure(tmp_path, disabled=ENGINES)
    with TestClient(create_app(**args)) as client:
        for kind in LAYER_UPLOADS:
            assert client.post('/v1/uploads', headers=headers(),
                               json={'name': FILENAMES[kind], 'kind': kind, 'size': 1}).status_code == 403


@pytest.mark.parametrize('kind', list(LAYER_UPLOADS))
def test_each_upload_kind_enforces_own_budget_and_extension(worker, kind):
    client, _ = worker
    maximum = LAYER_UPLOADS[kind][1]
    assert client.post('/v1/uploads', headers=headers(),
                       json={'name': FILENAMES[kind], 'kind': kind, 'size': maximum + 1}).status_code == 422
    assert client.post('/v1/uploads', headers=headers(),
                       json={'name': 'wrong.exe', 'kind': kind, 'size': 1}).status_code == 422
    assert client.post('/v1/uploads', headers=headers(),
                       json={'name': FILENAMES[kind], 'kind': kind, 'size': maximum}).status_code == 201


@pytest.mark.parametrize('kind', list(LAYER_UPLOADS))
def test_malformed_layer_content_fails_before_preparing_job(worker, kind):
    client, _ = worker
    uid = upload(client, kind, b'not the declared format')
    response = prepare(client, LAYER_UPLOADS[kind][0], [uid])
    assert response.status_code == 422, response.text
    assert client.app.state.store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_real_splat_cpu_job_owner_binding_and_exact_artifact_download(worker, tmp_path):
    client, _ = worker
    raw, options = splat_inputs(tmp_path)
    ids = [upload(client, 'splat', raw), upload(client, 'repair', json.dumps(options).encode())]
    assert prepare(client, 'splat-repair', ids, B).status_code == 404
    assert prepare(client, 'splat-repair', ids[:1]).status_code == 422
    job = complete(client, prepare(client, 'splat-repair', ids))
    assert artifact(client, job, 'original.ply') == raw
    receipt = json.loads(artifact(client, job, 'repair-receipt.json'))
    assert receipt['generatedVertices'] > 0 and receipt['originalSha256'] == options['sourceSha256']
    assert receipt['appearanceOnly'] is True and receipt['metric_verified'] is False
    assert all(item['metric_verified'] is False for item in job['artifacts'])
    assert client.post(f"/v1/jobs/{job['id']}/ticket", headers=headers(B), json={'artifact': 0}).status_code == 404


def test_repair_hash_and_original_indices_must_match_at_admission(worker, tmp_path):
    client, _ = worker
    raw, options = splat_inputs(tmp_path)
    source = upload(client, 'splat', raw)
    options['sourceSha256'] = '0' * 64
    request = upload(client, 'repair', json.dumps(options).encode())
    assert prepare(client, 'splat-repair', [source, request]).status_code == 422
    assert client.app.state.store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_real_localization_pcd_download_and_source_bound_recording(worker):
    client, _ = worker
    raw, _ = scan(); options = scan_options(raw)
    ids = [upload(client, 'survey', raw), upload(client, 'localization', json.dumps(options).encode())]
    assert prepare(client, 'localization-map', ids[:1]).status_code == 422
    map_job = complete(client, prepare(client, 'localization-map', ids))
    pcd = artifact(client, map_job, 'localization-map.pcd')
    assert b'DATA binary\n' in pcd
    map_raw = artifact(client, map_job, 'localization-map.json'); manifest = json.loads(map_raw)
    assert manifest['mapSha256'] == hashlib.sha256(pcd).hexdigest()
    collector = Collector(localization.binding(manifest, map_raw), origin='authored-ros2-test')
    stamp = 1_000_000_000
    collector.pose(stamp, 'map', [0, 0, 0], [0, 0, 0, 1], [0.] * 36, now_ns=stamp)
    collector.status(stamp, 0, 'healthy', now_ns=stamp); collector.flush(now_ns=stamp, force=True)
    recording = upload(client, 'localization', json.dumps(collector.document()).encode())
    assert prepare(client, 'localization-map', [recording]).status_code == 422
    # Both the upload and completed source must belong to the authenticated owner.
    foreign_recording = upload(client, 'localization', json.dumps(collector.document()).encode(), B)
    assert prepare(client, 'localization-map', [foreign_recording], B, map_job['id']).status_code == 404
    assert prepare(client, 'localization-map', ids, source=map_job['id']).status_code == 422
    verified = complete(client, prepare(client, 'localization-map', [recording], source=map_job['id']))
    report = json.loads(artifact(client, verified, 'localization-verification.json'))
    assert report['status'] == 'contract-verified' and report['accuracyVerified'] is False
    assert report['physicalRobotValidated'] is False


def test_gaussian_appearance_is_not_a_survey(worker, tmp_path):
    client, _ = worker
    raw, _ = splat_inputs(tmp_path)
    uid = upload(client, 'survey', raw)
    assert prepare(client, 'localization-map', [uid]).status_code == 422


def test_localization_map_requires_exact_scan_hash_and_scene_source(worker):
    client, _ = worker
    raw, _ = scan(); options = scan_options(raw)
    survey = upload(client, 'survey', raw)
    options['scanSha256'] = '0' * 64
    wrong = upload(client, 'localization', json.dumps(options).encode())
    assert prepare(client, 'localization-map', [survey, wrong]).status_code == 422
    options['scanSha256'] = hashlib.sha256(raw).hexdigest(); options['sceneSha256'] = '1' * 64
    bound = upload(client, 'localization', json.dumps(options).encode())
    assert prepare(client, 'localization-map', [survey, bound]).status_code == 422
    assert client.app.state.store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_motion_content_is_accepted_from_uuid_storage_and_timing_checked(worker):
    client, _ = worker
    motion = upload(client, 'motion', small_bvh())
    options = upload(client, 'retarget', json.dumps(MOTION_OPTIONS).encode())
    response = prepare(client, 'motion-retarget', [motion, options])
    assert response.status_code == 201, response.text
    assert client.app.state.store.upload_path(motion).suffix == ''
    assert client.delete('/v1/jobs/' + response.json()['id'], headers=headers()).status_code == 200
    bad = upload(client, 'retarget', json.dumps({**MOTION_OPTIONS, 'fps': 120}).encode())
    assert prepare(client, 'motion-retarget', [motion, bad]).status_code == 422


def test_engine_revocation_prevents_starting_an_already_prepared_layer(worker):
    client, registry = worker
    motion = upload(client, 'motion', small_bvh())
    options = upload(client, 'retarget', json.dumps(MOTION_OPTIONS).encode())
    prepared = prepare(client, 'motion-retarget', [motion, options]); assert prepared.status_code == 201
    value = json.loads(registry.read_text()); value['tenants'][0]['engines'] = ['inspect']
    registry.write_text(json.dumps(value))
    assert client.post('/v1/jobs/' + prepared.json()['id'] + '/start', headers=headers(), json={}).status_code == 403
    assert client.post('/v1/uploads', headers=headers(), json={'kind': 'motion', 'name': 'x.bvh', 'size': 1}).status_code == 403


def test_soma_environment_is_scoped_and_bvh_artifacts_are_downloadable(tmp_path, monkeypatch):
    # A process fixture tests transport/environment only, never SOMA solver quality.
    script = tmp_path / 'environment_fixture.py'
    script.write_text("import json,os,pathlib,sys\n"
                      "request=json.loads(pathlib.Path(sys.argv[1]).read_text()); out=pathlib.Path(request['output_dir'])\n"
                      "keys=['WORLD_SOMA_RUNTIME_DIR','WORLD_SOMA_DEVICE','WARP_CACHE_PATH','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','WORLD_WORKER_TOKEN','WORLD_TENANTS_FILE','UNRELATED_PRIVATE_TOKEN','PYTHONPATH']\n"
                      "seen={key:os.environ.get(key) for key in keys}\n"
                      "(out/'environment.json').write_text(json.dumps(seen)); artifacts=[{'name':'environment.json','kind':'test-fixture'}]\n"
                      "motion=next((i for i in request['inputs'] if i['kind']=='motion'),None)\n"
                      "if motion:\n (out/'original-motion.bvh').write_bytes(pathlib.Path(motion['path']).read_bytes()); artifacts.append({'name':'original-motion.bvh','kind':'motion-source'})\n"
                      "(out/'manifest.json').write_text(json.dumps({'artifacts':artifacts}))\n")
    command = [sys.executable, str(script), '{input_manifest}']
    args, _ = configure(tmp_path, command_overrides={'motion-retarget': command})
    config = Path(args['adapters']); entries = json.loads(config.read_text())
    entries.append({'id': 'plain-fixture', 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'],
                    'max_inputs': 1, 'command': command})
    config.write_text(json.dumps(entries))
    registry = Path(args['tenants']); tenants = json.loads(registry.read_text())
    tenants['tenants'][0]['engines'].append('plain-fixture'); registry.write_text(json.dumps(tenants))
    wanted = {'WORLD_SOMA_RUNTIME_DIR': '/private/operator-soma', 'WORLD_SOMA_DEVICE': 'cpu',
              'WARP_CACHE_PATH': '/private/operator-cache', 'OMP_NUM_THREADS': '2',
              'OPENBLAS_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2'}
    for name, value in {**wanted, 'WORLD_WORKER_TOKEN': 'private-worker-fixture',
                        'WORLD_TENANTS_FILE': str(registry), 'UNRELATED_PRIVATE_TOKEN': 'private-unrelated-fixture',
                        'PYTHONPATH': '/untrusted/request-path'}.items():
        monkeypatch.setenv(name, value)
    with TestClient(create_app(**args)) as client:
        motion = upload(client, 'motion', small_bvh())
        options = upload(client, 'retarget', json.dumps(MOTION_OPTIONS).encode())
        job = complete(client, prepare(client, 'motion-retarget', [motion, options]))
        assert artifact(client, job, 'original-motion.bvh') == small_bvh()
        seen = json.loads(artifact(client, job, 'environment.json'))
        assert all(seen[name] == value for name, value in wanted.items())
        assert all(seen[name] is None for name in ('WORLD_WORKER_TOKEN', 'WORLD_TENANTS_FILE', 'UNRELATED_PRIVATE_TOKEN', 'PYTHONPATH'))
        picture = io.BytesIO(); Image.new('RGB', (4, 4)).save(picture, format='PNG')
        response = client.post('/v1/uploads', headers=headers(), json={'name': 'image.png', 'kind': 'image', 'size': len(picture.getvalue())})
        uid = response.json()['id']; client.put(f'/v1/uploads/{uid}?offset=0', headers=headers(), content=picture.getvalue())
        plain = complete(client, prepare(client, 'plain-fixture', [uid]))
        assert all(value is None for value in json.loads(artifact(client, plain, 'environment.json')).values())
