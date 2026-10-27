"""Private tenant boundaries using real HTTP handlers/SQLite; no model/provider."""
import base64
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import io
import json
from pathlib import Path
import sqlite3
import sys
import time

import pytest
import httpx
from fastapi.testclient import TestClient
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker.app import create_app
from robotics.world_worker.auth import Identities, OPERATOR_OWNER, REGISTRY_SCHEMA

MIB = 1024 ** 2
OPERATOR = 'fixture-operator-' + 'o' * 48
A, B, ROTATED = 'a' * 43, 'b' * 43, 'r' * 43
TEST_TICKET_KEY = b'fixture-server-only-signing-key!!'


def row(owner, credential, **fields):
    return {'id': owner, 'token_sha256': hashlib.sha256(credential.encode()).hexdigest(), **fields}


def registry(path, entries):
    pending = path.with_suffix('.new')
    pending.write_text(json.dumps({'schema': REGISTRY_SCHEMA, 'tenants': entries}))
    pending.replace(path)
    return str(path)


def headers(credential):
    return {'Authorization': 'Bearer ' + credential}


@pytest.fixture
def configured(tmp_path):
    config = tmp_path / 'tenants.json'
    registry(config, [row('alpha', A), row('beta', B)])
    options = {'root': tmp_path / 'data', 'token': OPERATOR, 'tenants': str(config)}
    return options, config


def photo():
    output = io.BytesIO()
    Image.new('RGB', (12, 12), (1, 22, 33)).save(output, format='PNG')
    return output.getvalue()


def upload(client, credential):
    data = photo()
    response = client.post('/v1/uploads', headers=headers(credential), json={'name': 'room.png', 'kind': 'image', 'size': len(data)})
    assert response.status_code == 201, response.text
    uid = response.json()['id']
    response = client.put(f'/v1/uploads/{uid}?offset=0', content=data, headers=headers(credential))
    assert response.status_code == 200, response.text
    return uid


def prepare(client, credential, uid, engine='inspect'):
    return client.post('/v1/jobs', headers=headers(credential), json={'engine': engine, 'upload_ids': [uid], 'consent': True})


def finished(client, jid, credential):
    for _ in range(100):
        response = client.get('/v1/jobs/' + jid, headers=headers(credential))
        assert response.status_code == 200, response.text
        if response.json()['status'] in ['complete', 'failed', 'cancelled']:
            return response.json()
        time.sleep(.02)
    raise AssertionError('Job did not finish')


def complete(client, credential):
    uid = upload(client, credential)
    response = prepare(client, credential, uid)
    assert response.status_code == 201, response.text
    jid = response.json()['id']
    assert client.post(f'/v1/jobs/{jid}/start', headers=headers(credential), json={}).status_code == 200
    assert finished(client, jid, credential)['status'] == 'complete'
    ticket = client.post(f'/v1/jobs/{jid}/ticket', headers=headers(credential), json={'artifact': 0})
    assert ticket.status_code == 200, ticket.text
    return jid, uid, ticket.json()['url']


def test_two_credentials_cannot_access_or_mutate_foreign_resources(configured):
    options, _ = configured
    with TestClient(create_app(**options)) as client:
        ua, ub = upload(client, A), upload(client, B)
        ja = prepare(client, A, ua).json()['id']
        for credential in [B, OPERATOR]:
            for method, path, body in [
                ('GET', '/v1/uploads/' + ua, None),
                ('PUT', f'/v1/uploads/{ua}?offset=0', b'changed'),
                ('DELETE', '/v1/uploads/' + ua, None),
                ('GET', '/v1/jobs/' + ja, None),
                ('POST', f'/v1/jobs/{ja}/start', {}),
                ('DELETE', '/v1/jobs/' + ja, None),
                ('DELETE', f'/v1/jobs/{ja}/artifacts', None),
                ('POST', f'/v1/jobs/{ja}/ticket', {'artifact': 0}),
            ]:
                args = {'content': body} if isinstance(body, bytes) else {} if body is None else {'json': body}
                response = client.request(method, path, headers=headers(credential), **args)
                assert response.status_code == 404, (method, path, response.text)
            response = client.post('/v1/jobs', headers=headers(credential), json={'engine': 'inspect', 'upload_ids': [ub, ua] if credential == B else [ua], 'consent': True})
            assert response.status_code == 404
        jb = prepare(client, B, ub).json()['id']
        assert [j['id'] for j in client.get('/v1/jobs', headers=headers(A)).json()['jobs']] == [ja]
        assert [j['id'] for j in client.get('/v1/jobs', headers=headers(B)).json()['jobs']] == [jb]
        assert client.get('/v1/jobs', headers=headers(OPERATOR)).json() == {'jobs': []}
        assert client.get('/v1/jobs/' + ja, headers=headers(A)).json()['status'] == 'prepared'
        assert (options['root'] / 'uploads' / ua).read_bytes() == photo()
        assert client.delete('/v1/jobs/' + ja, headers=headers(A)).json()['status'] == 'cancelled'
        assert client.delete('/v1/uploads/' + ua, headers=headers(A)).status_code == 200
        assert client.delete(f'/v1/jobs/{ja}/artifacts', headers=headers(A)).status_code == 200


def test_owner_fields_and_unsigned_identity_headers_are_not_authority(configured):
    options, _ = configured
    with TestClient(create_app(**options)) as client:
        assert client.get('/v1/jobs', headers={'X-World-Owner': 'alpha'}).status_code == 401
        cap = client.get('/v1/capabilities', headers=headers(B) | {'X-World-Owner': 'alpha'}).json()
        assert cap['owner_id'] == 'beta' and cap['operator_only'] is True and cap['access_mode'] == 'tenant'
        assert 'token_sha256' not in json.dumps(cap)
        assert client.get('/healthz').json()['public_processing'] is False
        assert client.post('/v1/uploads', headers=headers(A), json={'name': 'x.png', 'kind': 'image', 'size': 1, 'owner_id': 'beta'}).status_code == 422
        ua = upload(client, A)
        assert client.post('/v1/jobs', headers=headers(A), json={'engine': 'inspect', 'upload_ids': [ua], 'consent': True, 'owner_id': 'beta'}).status_code == 422
        assert client.get('/v1/jobs', headers=[('Authorization', 'Bearer ' + A), ('Authorization', 'Bearer ' + OPERATOR)]).status_code == 401


def signed_ticket(body, secret=TEST_TICKET_KEY):
    payload = base64.urlsafe_b64encode(json.dumps(body, separators=(',', ':')).encode()).decode().rstrip('=')
    signature = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
    return '/v1/download/' + payload + '.' + signature


def test_tickets_bind_owner_credential_job_and_expiry(configured, monkeypatch):
    options, _ = configured
    with monkeypatch.context() as patch:
        patch.setattr('robotics.world_worker.app.secrets.token_bytes', lambda _: TEST_TICKET_KEY)
        app = create_app(**options)
    with TestClient(app) as client:
        jid, _, url = complete(client, A)  # Executes the real internal runner.
        assert client.post(f'/v1/jobs/{jid}/ticket', headers=headers(B), json={'artifact': 0}).status_code == 404
        payload = url.rsplit('/', 1)[1].split('.')[0]
        body = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        assert body['owner'] == 'alpha' and body['credential'] == hashlib.sha256(A.encode()).hexdigest()
        assert client.get(url).status_code == 200  # Deliberately transferable short-lived bearer capability.
        assert client.head(url).status_code == 200
        assert client.get(url, headers={'Range': 'bytes=0-15'}).status_code == 206
        for invalid in [
            signed_ticket(body, A.encode()),  # No browser credential is a signing key.
            signed_ticket(body, OPERATOR.encode()),
            signed_ticket(body | {'owner': 'beta', 'credential': hashlib.sha256(B.encode()).hexdigest()}),
            signed_ticket(body | {'artifact': True}),
            signed_ticket(body | {'expires': int(time.time()) - 1}),
            signed_ticket(body | {'expires': int(time.time()) + 3600}),
            signed_ticket(body | {'extra': 'ignored?'}),
            url[:-1] + ('0' if url[-1] != '0' else '1'),
        ]:
            assert client.get(invalid).status_code == 403
        monkeypatch.setattr('robotics.world_worker.app.time.time', lambda: body['expires'] + 1)
        assert client.get(url).status_code == 403


@pytest.mark.parametrize('change,expected', [('revoke', 401), ('lower_limit', 429)])
def test_admission_reauthenticates_after_slow_request_body(configured, change, expected):
    options, config = configured
    app = create_app(**options)
    body = json.dumps({'name': 'room.png', 'kind': 'image', 'size': 10}).encode()

    async def exercise():
        async def delayed_body():
            # Runs only after the middleware's initial authentication, during
            # request.stream(). Policy must be current when admission happens.
            registry(config, [] if change == 'revoke' else [row('alpha', A, limits={'upload_bytes': 1})])
            yield body
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture') as client:
            return await client.post('/v1/uploads', content=delayed_body(), headers=headers(A) | {'Content-Type': 'application/json', 'Content-Length': str(len(body))})
    try:
        response = asyncio.run(exercise())
        assert response.status_code == expected, response.text
        assert app.state.store.db.execute('SELECT COUNT(*) FROM uploads').fetchone()[0] == 0
    finally:
        app.state.store.db.close()


def test_registry_rotation_revocation_and_errors_fail_closed_without_restart(configured):
    options, config = configured
    with TestClient(create_app(**options)) as client:
        jid, _, old_ticket = complete(client, A)
        registry(config, [row('alpha', ROTATED), row('beta', B)])
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).status_code == 401
        assert client.get(old_ticket).status_code == 403
        assert client.get('/v1/jobs/' + jid, headers=headers(ROTATED)).status_code == 200
        new_ticket = client.post(f'/v1/jobs/{jid}/ticket', headers=headers(ROTATED), json={'artifact': 0}).json()['url']
        assert client.get(new_ticket).status_code == 200
        registry(config, [row('alpha', ROTATED, enabled=False), row('beta', B)])
        assert client.get('/v1/jobs', headers=headers(ROTATED)).status_code == 401
        assert client.get(new_ticket).status_code == 403
        registry(config, [row('beta', B)])
        assert client.get('/v1/jobs', headers=headers(ROTATED)).status_code == 401
        for corrupt in ['not JSON', None]:
            if corrupt is None:
                config.unlink()
            else:
                config.write_text(corrupt)
            assert client.get('/v1/jobs', headers=headers(B)).status_code == 503
            assert client.get(new_ticket).status_code == 403
            assert client.get('/v1/jobs', headers=headers(OPERATOR)).json() == {'jobs': []}


@pytest.mark.parametrize('change', [
    {'id': OPERATOR_OWNER}, {'token_sha256': 'plaintext-secret'}, {'token_sha256': hashlib.sha256(OPERATOR.encode()).hexdigest()},
    {'enabled': 'yes'}, {'engines': ['unknown']}, {'engines': ['inspect', 'inspect']},
    {'limits': {'active_jobs': True}}, {'limits': {'active_jobs': 0}}, {'limits': {'upload_count': 51}},
    {'limits': {'storage_bytes': 21 * 1024 ** 3}}, {'limits': {'unbounded': 1}}, {'secret': A},
])
def test_invalid_registry_rejected_at_startup(tmp_path, change):
    config = tmp_path / 'tenants.json'
    registry(config, [row('alpha', A) | change])
    with pytest.raises(ValueError):
        create_app(root=tmp_path / 'data', token=OPERATOR, tenants=str(config))


@pytest.mark.parametrize('contents', [
    '{"schema":"brainsnn.world.tenants.v1","tenants":[],"tenants":[]}',
    'x' * 65537,
    json.dumps({'schema': REGISTRY_SCHEMA, 'tenants': [row('alpha', A), row('alpha', B)]}),
    json.dumps({'schema': REGISTRY_SCHEMA, 'tenants': [row('alpha', A), row('beta', A)]}),
])
def test_registry_is_bounded_and_rejects_duplicate_keys_ids_or_hashes(tmp_path, contents):
    config = tmp_path / 'tenants.json'
    config.write_text(contents)
    with pytest.raises(ValueError):
        Identities(OPERATOR, str(config), {'inspect'}, 20 * 1024 ** 3)


def test_atomic_per_owner_upload_and_job_admission_keeps_global_budget(configured):
    options, config = configured
    options |= {'storage_limit': 16 * MIB, 'job_limit': 2 * MIB}
    registry(config, [row('alpha', A, limits={'upload_count': 2, 'upload_bytes': 3 * MIB, 'job_count': 2, 'active_jobs': 1}), row('beta', B)])
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(2) as threads:
        def reserve(_):
            return client.post('/v1/uploads', headers=headers(A), json={'name': 'room.png', 'kind': 'image', 'size': 2 * MIB})
        results = list(threads.map(reserve, range(2)))
        assert sorted(response.status_code for response in results) == [201, 429]
        foreign = client.post('/v1/uploads', headers=headers(B), json={'name': 'room.png', 'kind': 'image', 'size': 2 * MIB})
        assert foreign.status_code == 201
        ua = upload(client, A)
        results = list(threads.map(lambda _: prepare(client, A, ua), range(2)))
        assert sorted(response.status_code for response in results) == [201, 429]
        ub = upload(client, B)
        assert prepare(client, B, ub).status_code == 201
        assert client.app.state.store.storage_commitment(2 * MIB) <= 16 * MIB
    with TestClient(create_app(**options)) as client:
        assert prepare(client, A, ua).status_code == 429  # Reservation survives restart.
        assert client.get('/v1/uploads/' + ua, headers=headers(B)).status_code == 404


def test_owner_storage_reservation_releases_only_after_terminal_job(configured):
    options, config = configured
    options |= {'storage_limit': 12 * MIB, 'job_limit': 2 * MIB}
    registry(config, [row('alpha', A, limits={'storage_bytes': 4 * MIB}), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        ua = upload(client, A)
        jid = prepare(client, A, ua).json()['id']
        request = {'name': 'room.png', 'kind': 'image', 'size': 2 * MIB}
        assert client.post('/v1/uploads', headers=headers(A), json=request).status_code == 429
        assert client.post('/v1/uploads', headers=headers(B), json=request).status_code == 201
        store = client.app.state.store
        before = store.storage_commitment(2 * MIB, owner_id='alpha')
        store.state(jid, 'cancelled')
        assert store.storage_commitment(2 * MIB, [jid], 'alpha') >= before
        assert store.storage_commitment(2 * MIB, [], 'alpha') < before
        assert client.post('/v1/uploads', headers=headers(A), json=request).status_code == 201


def test_lowered_active_limit_blocks_start_and_global_capacity_still_wins(configured):
    options, config = configured
    options |= {'storage_limit': 8 * MIB, 'job_limit': 2 * MIB}
    registry(config, [row('alpha', A, limits={'active_jobs': 2}), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        ua, ub = upload(client, A), upload(client, B)
        first, second = prepare(client, A, ua).json()['id'], prepare(client, A, ua).json()['id']
        registry(config, [row('alpha', A), row('beta', B)])
        assert client.post(f'/v1/jobs/{first}/start', headers=headers(A), json={}).status_code == 429
        assert client.delete('/v1/jobs/' + second, headers=headers(A)).status_code == 200
        assert client.post(f'/v1/jobs/{first}/start', headers=headers(A), json={}).status_code == 200
        assert finished(client, first, A)['status'] == 'complete'
        # Both owners may fit their own budgets while combined reservations hit
        # the stricter global ceiling; adding tenant identities cannot bypass it.
        registry(config, [row('alpha', A, limits={'active_jobs': 3}), row('beta', B)])
        assert prepare(client, A, ua).status_code == 201
        assert prepare(client, A, ua).status_code == 201
        assert prepare(client, B, ub).status_code == 201
        assert prepare(client, A, ua).status_code == 429


def test_restart_invalidates_tickets_without_changing_ownership(configured):
    options, _ = configured
    with TestClient(create_app(**options)) as client:
        jid, _, url = complete(client, A)
    with TestClient(create_app(**options)) as client:
        assert client.get(url).status_code == 403
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).status_code == 200
        renewed = client.post(f'/v1/jobs/{jid}/ticket', headers=headers(A), json={'artifact': 0}).json()['url']
        assert client.get(renewed).status_code == 200


def test_owner_job_quota_counts_completed_rows_and_delete_frees_slot(configured):
    options, config = configured
    options |= {'storage_limit': 32 * MIB, 'job_limit': 2 * MIB}
    registry(config, [row('alpha', A, limits={'job_count': 2, 'active_jobs': 5}), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        uid = upload(client, A)
        j1 = prepare(client, A, uid).json()['id']
        j2 = prepare(client, A, uid).json()['id']
        assert client.post(f'/v1/jobs/{j1}/start', headers=headers(A), json={}).status_code == 200
        assert finished(client, j1, A)['status'] == 'complete'
        # A completed row still consumes quota; only a row-removing DELETE frees it.
        assert prepare(client, A, uid).status_code == 429
        assert client.delete(f'/v1/jobs/{j1}/artifacts', headers=headers(A)).json() == {'deleted': True}
        j3 = prepare(client, A, uid).json()['id']
        assert client.get('/v1/jobs', headers=headers(A)).json()['jobs'] and {j['id'] for j in client.get('/v1/jobs', headers=headers(A)).json()['jobs']} == {j2, j3}
        # Cancelling (row kept) does not free quota; a queued/active job keeps blocking.
        assert client.delete('/v1/jobs/' + j3, headers=headers(A)).json()['status'] == 'cancelled'
        assert prepare(client, A, uid).status_code == 429
        # Foreign owner is unaffected by this owner's quota and cannot free the row.
        assert upload(client, B) is not None
        assert client.delete(f'/v1/jobs/{j2}/artifacts', headers=headers(B)).status_code == 404


def test_legacy_operator_keeps_existing_prepared_job_admission(configured):
    options, _ = configured
    options |= {'storage_limit': 32 * MIB, 'job_limit': MIB}
    with TestClient(create_app(**options)) as client:
        uid = upload(client, OPERATOR)
        for _ in range(10):
            assert prepare(client, OPERATOR, uid).status_code == 201
        assert len(client.get('/v1/jobs', headers=headers(OPERATOR)).json()['jobs']) == 10
        assert client.get('/v1/jobs', headers=headers(A)).json() == {'jobs': []}


def test_legacy_migration_preserves_operator_owner_and_runner_access(configured):
    options, config = configured
    root = options['root']; root.mkdir(); (root / 'uploads').mkdir()
    uid, jid = '1' * 32, '2' * 32
    data = photo(); (root / 'uploads' / uid).write_bytes(data)
    with sqlite3.connect(root / 'state.sqlite') as db:
        db.executescript('CREATE TABLE uploads (id TEXT PRIMARY KEY,name TEXT,kind TEXT,size INTEGER,offset INTEGER,created REAL); CREATE TABLE jobs (id TEXT PRIMARY KEY,engine TEXT,status TEXT,uploads TEXT,created REAL,error TEXT,artifacts TEXT);')
        db.execute('INSERT INTO uploads VALUES (?,?,?,?,?,?)', (uid, 'old.png', 'image', len(data), len(data), time.time()))
        db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)', (jid, 'inspect', 'prepared', json.dumps([uid]), time.time(), None, '[]'))
    with TestClient(create_app(**options)) as client:
        assert client.get('/v1/uploads/' + uid, headers=headers(A)).status_code == 404
        assert client.get('/v1/jobs/' + jid, headers=headers(B)).status_code == 404
        assert client.get('/v1/jobs/' + jid, headers=headers(OPERATOR)).json()['owner_id'] == OPERATOR_OWNER
        assert client.post(f'/v1/jobs/{jid}/start', headers=headers(OPERATOR), json={}).status_code == 200
        assert finished(client, jid, OPERATOR)['status'] == 'complete'
        tenant_job, tenant_upload, _ = complete(client, A)
    registry(config, [row('beta', B), row('alpha', ROTATED)])
    with TestClient(create_app(**options)) as client:
        assert client.get('/v1/jobs/' + tenant_job, headers=headers(ROTATED)).json()['owner_id'] == 'alpha'
        assert client.get('/v1/uploads/' + tenant_upload, headers=headers(OPERATOR)).status_code == 404
        assert client.get('/v1/jobs/' + jid, headers=headers(ROTATED)).status_code == 404
        assert client.get('/v1/jobs/' + jid, headers=headers(OPERATOR)).status_code == 200


def test_engine_allowlist_and_revoked_queued_owner_checked_before_process(configured, tmp_path):
    options, config = configured
    adapters = tmp_path / 'adapters.json'
    adapters.write_text(json.dumps([{'id': 'hold', 'command': [sys.executable, '-c', 'import time; time.sleep(15)'], 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'timeout_seconds': 20}]))
    options['adapters'] = str(adapters)
    registry(config, [row('alpha', A, engines=['inspect', 'hold']), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        assert [e['id'] for e in client.get('/v1/capabilities', headers=headers(B)).json()['engines']] == ['inspect']
        ua, ub = upload(client, A), upload(client, B)
        assert prepare(client, B, ub, 'hold').status_code == 403
        hold = prepare(client, A, ua, 'hold').json()['id']
        assert client.post(f'/v1/jobs/{hold}/start', headers=headers(A), json={}).status_code == 200
        for _ in range(100):
            if client.get('/v1/jobs/' + hold, headers=headers(A)).json()['status'] == 'running': break
            time.sleep(.02)
        else: raise AssertionError('Holding adapter did not start')
        queued = prepare(client, B, ub).json()['id']
        assert client.post(f'/v1/jobs/{queued}/start', headers=headers(B), json={}).status_code == 200
        registry(config, [row('alpha', A, engines=['inspect', 'hold'])])
        client.delete('/v1/jobs/' + hold, headers=headers(A))
        for _ in range(100):
            job = client.app.state.store.job(queued)
            if job['status'] == 'failed': break
            time.sleep(.02)
        assert job['status'] == 'failed' and 'revoked' in job['error']
        assert not (options['root'] / 'jobs' / queued).exists()
        # Removing an engine also blocks starting an already-prepared job.
        next_job = prepare(client, A, ua, 'hold').json()['id']
        registry(config, [row('alpha', A)])
        assert client.post(f'/v1/jobs/{next_job}/start', headers=headers(A), json={}).status_code == 403
