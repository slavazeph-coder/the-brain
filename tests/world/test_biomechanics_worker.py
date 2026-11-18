"""Actual HTTP admission, tenant isolation and native OpenSim subprocess transport."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from fastapi.testclient import TestClient
import pytest

from robotics.world_worker.app import create_app
from robotics.world_worker.auth import REGISTRY_SCHEMA

ROOT = Path(__file__).resolve().parents[2]
A, B, VISITOR = 'a' * 43, 'b' * 43, 'v' * 43
KINDS = ['biomech-model', 'biomech-motion', 'biomech-options', 'biomech-loads']
FILES = ['authored-pendulum.osim', 'authored-motion.mot', 'kinematics-options.json', 'authored-loads.json']


def headers(token=A):
    return {'Authorization': 'Bearer ' + token}


@pytest.fixture
def native():
    interpreter = os.environ.get('WORLD_BIOMECHANICS_TEST_PYTHON')
    if not interpreter:
        pytest.skip('Set WORLD_BIOMECHANICS_TEST_PYTHON to the installed native runtime.')
    assert Path(interpreter).is_file(), 'Configured native runtime must exist; do not silently skip it.'
    return interpreter


@pytest.fixture
def example(tmp_path, native):
    target = tmp_path / 'example'
    subprocess.run([native, '-m', 'robotics.biomechanics.authored_fixture', '--out', str(target)],
                   cwd=ROOT, check=True, timeout=30, capture_output=True)
    return {kind: (filename, (target / filename).read_bytes()) for kind, filename in zip(KINDS, FILES)}


@pytest.fixture
def worker(tmp_path, native):
    config = tmp_path / 'adapters.json'
    config.write_text(json.dumps([{'id': 'biomechanics', 'enabled': True, 'license_reviewed': True,
        'input_kinds': KINDS, 'max_inputs': 4, 'timeout_seconds': 120,
        'command': [native, str(ROOT / 'robotics/world_worker/biomechanics.py'),
                    '--input-manifest', '{input_manifest}']}]))
    tenants = tmp_path / 'tenants.json'
    tenants.write_text(json.dumps({'schema': REGISTRY_SCHEMA, 'tenants': [
        {'id': owner, 'token_sha256': hashlib.sha256(token.encode()).hexdigest(),
         'engines': ['inspect'] + ([] if token == VISITOR else ['biomechanics']),
         'limits': {'active_jobs': 3}}
        for owner, token in [('alpha', A), ('beta', B), ('visitor', VISITOR)]]}))
    with TestClient(create_app(root=tmp_path / 'data', token='operator-' + 'o' * 43,
                              adapters=str(config), tenants=str(tenants), job_limit=128 * 1024**2)) as client:
        yield client


def upload(client, kind, item, token=A):
    filename, raw = item
    response = client.post('/v1/uploads', headers=headers(token),
                           json={'name': filename, 'kind': kind, 'size': len(raw)})
    assert response.status_code == 201, response.text
    uid = response.json()['id']
    response = client.put(f'/v1/uploads/{uid}?offset=0', headers=headers(token), content=raw)
    assert response.status_code == 200, response.text
    return uid


def prepare(client, ids, token=A):
    return client.post('/v1/jobs', headers=headers(token),
                       json={'engine': 'biomechanics', 'upload_ids': ids, 'consent': True})


def finish(client, response):
    assert response.status_code == 201, response.text
    jid = response.json()['id']
    started = client.post(f'/v1/jobs/{jid}/start', headers=headers(), json={})
    assert started.status_code == 200, started.text
    until = time.monotonic() + 120
    while time.monotonic() < until:
        value = client.get('/v1/jobs/' + jid, headers=headers()).json()
        if value['status'] in ('complete', 'failed', 'cancelled'):
            assert value['status'] == 'complete', value
            return value
        time.sleep(.05)
    raise AssertionError('Native OpenSim HTTP job exceeded deadline.')


def download(client, job, name):
    index = next(i for i, item in enumerate(job['artifacts']) if item['name'] == name)
    ticket = client.post(f"/v1/jobs/{job['id']}/ticket", headers=headers(), json={'artifact': index})
    assert ticket.status_code == 200, ticket.text
    response = client.get(ticket.json()['url'])
    assert response.status_code == 200, response.text
    assert hashlib.sha256(response.content).hexdigest() == job['artifacts'][index]['sha256']
    return response.content


def test_real_native_http_job_preserves_sources_and_is_owner_bound(worker, example):
    ids = [upload(worker, kind, example[kind]) for kind in KINDS[:3]]
    assert prepare(worker, ids, B).status_code == 404
    assert prepare(worker, ids[:2]).status_code == 422
    job = finish(worker, prepare(worker, ids))
    contents = {item['name']: download(worker, job, item['name']) for item in job['artifacts']}
    for kind in KINDS[:3]:
        assert example[kind][1] in contents.values(), f'{kind} original bytes must survive.'
    preview = next(json.loads(raw) for name, raw in contents.items()
                   if name.endswith('.json') and json.loads(raw).get('schema') == 'brainsnn.biomechanics-preview.v1')
    assert preview['time_s'][0] == 0 and len(preview['time_s']) == 31
    assert preview['coordinate_names'] == ['knee_angle_r']
    assert preview['coordinate_values'][-1][0] - preview['coordinate_values'][0][0] == pytest.approx(.3)
    assert len(preview['muscle_names']) == 1
    assert preview['medical_validated'] is False and preview['ground_reaction_forces_estimated'] is False
    assert all(item['metric_verified'] is False for item in job['artifacts'])
    assert worker.get('/v1/jobs/' + job['id'], headers=headers(B)).status_code == 404
    assert worker.post(f"/v1/jobs/{job['id']}/ticket", headers=headers(B), json={'artifact': 0}).status_code == 404


def test_force_and_coordinate_contracts_fail_before_reserving_job(worker, example):
    model = upload(worker, KINDS[0], example[KINDS[0]])
    motion = upload(worker, KINDS[1], example[KINDS[1]])
    options = json.loads(example[KINDS[2]][1])
    options['analysis'] = 'inverse-dynamics'
    missing_declaration = upload(worker, KINDS[2], ('options.json', json.dumps(options).encode()))
    assert prepare(worker, [model, motion, missing_declaration]).status_code == 422
    options['external_loads'] = 'supplied'
    supplied = upload(worker, KINDS[2], ('options.json', json.dumps(options).encode()))
    assert prepare(worker, [model, motion, supplied]).status_code == 422
    wrong_motion = example[KINDS[1]][1].replace(b'knee_angle_r', b'other_coordinate')
    wrong = upload(worker, KINDS[1], ('wrong.mot', wrong_motion))
    kin = upload(worker, KINDS[2], example[KINDS[2]])
    assert prepare(worker, [model, wrong, kin]).status_code == 422
    loads = json.loads(example[KINDS[3]][1]); loads['time_s'][1] += .001
    mismatch = upload(worker, KINDS[3], ('loads.json', json.dumps(loads).encode()))
    assert prepare(worker, [model, motion, supplied, mismatch]).status_code == 422
    assert worker.app.state.store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_biomechanics_visitors_and_xml_external_resources_are_rejected(worker, example):
    for kind, item in example.items():
        response = worker.post('/v1/uploads', headers=headers(VISITOR),
                               json={'name': item[0], 'kind': kind, 'size': len(item[1])})
        assert response.status_code == 403
    raw = b'<!DOCTYPE OpenSimDocument [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><OpenSimDocument Version="40000"><Model name="x">&xxe;</Model></OpenSimDocument>'
    uid = upload(worker, KINDS[0], ('unsafe.osim', raw))
    motion = upload(worker, KINDS[1], example[KINDS[1]])
    options = upload(worker, KINDS[2], example[KINDS[2]])
    assert prepare(worker, [uid, motion, options]).status_code == 422
    assert worker.app.state.store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
