"""Lost-response recovery uses real HTTP handlers and persistent SQLite state."""
import hashlib
import io
import json
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.world_worker.app import create_app

OPERATOR = 'test-operator-' + 'o' * 48
TENANT_A = 'a' * 43
TENANT_B = 'b' * 43


@pytest.fixture
def options(tmp_path):
    registry = tmp_path / 'tenants.json'
    registry.write_text(json.dumps({'schema': 'brainsnn.world.tenants.v1', 'tenants': [
        {'id': owner, 'token_sha256': hashlib.sha256(token.encode()).hexdigest()}
        for owner, token in [('alpha', TENANT_A), ('beta', TENANT_B)]
    ]}))
    return {'root': tmp_path / 'data', 'token': OPERATOR, 'tenants': str(registry)}


def headers(key=None, token=TENANT_A):
    return {'Authorization': 'Bearer ' + token, **({'Idempotency-Key': key} if key else {})}


def image_bytes():
    buffer = io.BytesIO()
    Image.new('RGB', (12, 12), (40, 70, 90)).save(buffer, format='PNG')
    return buffer.getvalue()


def make_upload(client, key='upload-request-00001', token=TENANT_A):
    data = image_bytes()
    request = {'name': 'test.png', 'size': len(data), 'kind': 'image'}
    result = client.post('/v1/uploads', json=request, headers=headers(key, token))
    assert result.status_code == 201, result.text
    return result.json(), request, data


def test_upload_replay_survives_restart_and_reports_current_offset(options):
    with TestClient(create_app(**options)) as client:
        original, request, data = make_upload(client)
        assert client.put(f"/v1/uploads/{original['id']}?offset=0", content=data, headers=headers()).status_code == 200
    with TestClient(create_app(**options)) as client:
        replay = client.post('/v1/uploads', json=request, headers=headers('upload-request-00001'))
        assert replay.status_code == 201
        assert replay.headers['Idempotency-Replayed'] == 'true'
        assert replay.json()['id'] == original['id']
        assert replay.json()['offset'] == len(data)
        assert len(list(options['root'].joinpath('uploads').iterdir())) == 1
        conflict = client.post('/v1/uploads', json=request | {'name': 'different.png'}, headers=headers('upload-request-00001'))
        assert conflict.status_code == 409
        other, _, _ = make_upload(client, token=TENANT_B)
        assert other['id'] != original['id']
        assert client.get('/v1/uploads/' + original['id'], headers=headers(token=TENANT_B)).status_code == 404


def test_job_create_and_start_retry_never_duplicate_or_restart_cancelled_job(options):
    with TestClient(create_app(**options)) as client:
        item, _, data = make_upload(client)
        client.put(f"/v1/uploads/{item['id']}?offset=0", content=data, headers=headers())
        body = {'engine': 'inspect', 'upload_ids': [item['id']], 'consent': True}
        first = client.post('/v1/jobs', json=body, headers=headers('job-request-000001'))
        assert first.status_code == 201, first.text
        jid = first.json()['id']
        replay = client.post('/v1/jobs', json=body, headers=headers('job-request-000001'))
        assert replay.status_code == 201 and replay.json()['id'] == jid
        assert len(client.get('/v1/jobs', headers=headers()).json()['jobs']) == 1
        first_start = client.post(f'/v1/jobs/{jid}/start', json={}, headers=headers('start-request-00001'))
        assert first_start.status_code == 200
        repeated = client.post(f'/v1/jobs/{jid}/start', json={}, headers=headers('start-request-00001'))
        assert repeated.status_code == 200 and repeated.headers['Idempotency-Replayed'] == 'true'
        # Cancellation after admission remains terminal even if the request is retried.
        client.delete('/v1/jobs/' + jid, headers=headers())
        state = client.get('/v1/jobs/' + jid, headers=headers()).json()['status']
    with TestClient(create_app(**options)) as client:
        retried = client.post(f'/v1/jobs/{jid}/start', json={}, headers=headers('start-request-00001'))
        assert retried.status_code == 200
        assert retried.json()['status'] == state
        assert retried.json()['status'] in ('complete', 'cancelled', 'failed')
        assert client.post(f'/v1/jobs/{jid}/start', json={}, headers=headers('brand-new-start-0001')).status_code == 409


def test_deleted_resource_tombstone_and_cross_route_conflict(options):
    with TestClient(create_app(**options)) as client:
        item, request, data = make_upload(client)
        client.put(f"/v1/uploads/{item['id']}?offset=0", content=data, headers=headers())
        body = {'engine': 'inspect', 'upload_ids': [item['id']], 'consent': True}
        assert client.post('/v1/jobs', json=body, headers=headers('upload-request-00001')).status_code == 409
        assert client.delete('/v1/uploads/' + item['id'], headers=headers()).status_code == 200
        assert client.post('/v1/uploads', json=request, headers=headers('upload-request-00001')).status_code == 410
        assert not list(options['root'].joinpath('uploads').iterdir())


def test_idempotency_remains_authenticated_validated_and_bounded(options):
    with TestClient(create_app(**options)) as client:
        _, request, _ = make_upload(client)
        assert client.post('/v1/uploads', json=request, headers={'Idempotency-Key': 'upload-request-00001'}).status_code == 401
        assert client.post('/v1/uploads', json=request, headers=headers('short')).status_code == 422
        assert client.post('/v1/uploads', json=request, headers=headers('x' * 129)).status_code == 422
        assert client.post('/v1/uploads', json=request | {'owner_id': 'beta'}, headers=headers('upload-request-00001')).status_code == 422
        cap = client.get('/v1/capabilities', headers=headers()).json()
        assert cap['idempotency']['retention_seconds'] == 7 * 86400
        # No raw caller credentials are retained with the mutation ledger.
        database = options['root'].joinpath('state.sqlite').read_bytes()
        assert TENANT_A.encode() not in database and TENANT_B.encode() not in database


def test_receipt_failure_rolls_back_admission_and_never_queues_a_partial_job(options, monkeypatch):
    app = create_app(**options)
    store = app.state.store
    remember = store.remember
    def fail_receipt(*args):
        raise OSError('Injected receipt storage failure')
    with TestClient(app, raise_server_exceptions=False) as client:
        payload = {'name': 'test.png', 'size': len(image_bytes()), 'kind': 'image'}
        monkeypatch.setattr(store, 'remember', fail_receipt)
        assert client.post('/v1/uploads', json=payload, headers=headers('atomic-upload-00001')).status_code == 500
        assert store.db.execute('SELECT count(*) FROM uploads').fetchone()[0] == 0
        assert not list(options['root'].joinpath('uploads').iterdir())
        monkeypatch.setattr(store, 'remember', remember)
        item, _, data = make_upload(client, key='atomic-upload-00001')
        client.put(f"/v1/uploads/{item['id']}?offset=0", content=data, headers=headers())
        job = {'engine': 'inspect', 'upload_ids': [item['id']], 'consent': True}
        monkeypatch.setattr(store, 'remember', fail_receipt)
        assert client.post('/v1/jobs', json=job, headers=headers('atomic-job-0000001')).status_code == 500
        assert store.db.execute('SELECT count(*) FROM jobs').fetchone()[0] == 0
        monkeypatch.setattr(store, 'remember', remember)
        prepared = client.post('/v1/jobs', json=job, headers=headers('atomic-job-0000001'))
        assert prepared.status_code == 201
        jid = prepared.json()['id']
        monkeypatch.setattr(store, 'remember', fail_receipt)
        assert client.post(f'/v1/jobs/{jid}/start', json={}, headers=headers('atomic-start-00001')).status_code == 500
        assert client.get('/v1/jobs/' + jid, headers=headers()).json()['status'] == 'prepared'
        monkeypatch.setattr(store, 'remember', remember)
        assert client.post(f'/v1/jobs/{jid}/start', json={}, headers=headers('atomic-start-00001')).status_code == 200
