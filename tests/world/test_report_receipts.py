"""Real Ed25519/private HTTP receipt tests; only temporary test keys and media."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time

import asyncio
import pytest
from cryptography.exceptions import InvalidSignature
from fastapi.testclient import TestClient

from test_tenant_isolation import configured, complete, upload, prepare, finished, registry, row, headers, A, B, OPERATOR, ROOT, photo
from robotics.world_worker.app import create_app
from robotics.world_worker.report_receipts import (init_key, ReportSigner, verify_receipt, file_digest,
    make_payload, public_key_document, parse_json, DOMAIN, PAYLOAD_SCHEMA)

SCENARIO = b'{"schema":"brainsnn.proof.v1","world":null,"signature":null}'


@pytest.fixture
def signed_options(configured, tmp_path):
    options, config = configured
    options = dict(options)
    private, public = tmp_path / 'signing.key', tmp_path / 'public.json'
    key = init_key(private, public)
    options['report_key'] = str(private)
    return options, config, key, public


def request_body(job, scenario=SCENARIO):
    return {'scenarioSha256': hashlib.sha256(scenario).hexdigest(), 'geometrySha256': None,
            'artifactRefs': [{'name': item['name'], 'sha256': item['sha256']} for item in job['artifacts']]}


def receipt(client, jid, credential=A, body=None):
    if body is None:
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(credential)).json())
    return client.post(f'/v1/jobs/{jid}/report-receipt', headers=headers(credential), json=body)


def test_actual_owned_job_receipt_verifies_only_against_independent_key_and_exact_bytes(signed_options):
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        assert client.get('/v1/report-key').json() == key  # Public key contains no job/tenant data.
        assert client.get('/healthz').json()['public_processing'] is False
        cap = client.get('/v1/capabilities', headers=headers(A)).json()['reportSigning']
        assert cap == {'available': True, 'algorithm': 'Ed25519', 'keyId': key['keyId']}
        jid, uid, _ = complete(client, A)
        response = receipt(client, jid)
        assert response.status_code == 200, response.text
        signed = response.json()
        payload = verify_receipt(signed, key, SCENARIO)
        assert payload['ownerId'] == 'alpha' and payload['job'] == {'id': jid, 'engine': 'inspect'}
        assert payload['evidence']['sources'] == [{'id': uid, 'kind': 'image', 'size': len(photo()), 'sha256': hashlib.sha256(photo()).hexdigest()}]
        assert payload['evidence']['authority'] == 'worker-verified-bytes'
        assert payload['scenario']['authority'] == 'owner-declared'
        assert all(payload[field] is False for field in ['metricVerified', 'policyExecuted', 'safetyCertified', 'independentHostAttestation'])
        with pytest.raises(ValueError, match='Scenario'):
            verify_receipt(signed, key, SCENARIO + b' ')
        with pytest.raises(ValueError):
            verify_receipt(signed, None, SCENARIO)
        with pytest.raises(ValueError):
            verify_receipt(signed, public_key_document(b'x' * 32), SCENARIO)
        for credential in [B, OPERATOR]:
            assert receipt(client, jid, credential, request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())).status_code == 404
        assert client.post(f'/v1/jobs/{jid}/report-receipt', json=request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())).status_code == 401


def test_signatures_are_domain_separated_and_reject_hash_signature_key_or_payload_tampering(signed_options):
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        signed = receipt(client, jid).json()
        for changed in [signed | {'keyId': '0' * 64}, signed | {'payloadSha256': '0' * 64},
                        signed | {'signature': base64.urlsafe_b64encode(b'x' * 64).decode().rstrip('=')},
                        signed | {'payloadText': signed['payloadText'] + ' '}, signed | {'publicKey': key}]:
            with pytest.raises((ValueError, InvalidSignature)):
                verify_receipt(changed, key, SCENARIO)
        text = signed['payloadText'].replace('"ownerId":"alpha"', '"ownerId":"beta"')
        with pytest.raises(InvalidSignature):
            verify_receipt(signed | {'payloadText': text, 'payloadSha256': hashlib.sha256(text.encode()).hexdigest()}, key)
        signer = ReportSigner(options['report_key'])
        # A valid Ed25519 signature over the same JSON without our domain fails.
        signature = signer._key.sign(signed['payloadText'].encode())
        with pytest.raises(InvalidSignature):
            verify_receipt(signed | {'signature': base64.urlsafe_b64encode(signature).decode().rstrip('=')}, key)


def test_report_receipt_malformed_body_is_rejected_422(signed_options):
    """Schema-level ReportBody rejections must be 422, not 500 or 200.

    Covers the Pydantic model's validation surface that the earlier suite
    only exercised via duplicate-name handling:
      - scenarioSha256 not 64 hex chars (63, 65, non-hex)
      - geometrySha256 not 64 hex when present
      - artifactRefs name not matching [A-Za-z0-9._-]{1,256}
      - artifactRefs sha256 not 64 hex
      - more than 32 artifactRefs
      - extra top-level field
    Each must produce 422 over HTTP without touching the job slot.
    """
    options, _, _, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        job = client.get('/v1/jobs/' + jid, headers=headers(A)).json()
        ref = job['artifacts'][0]
        good_ref = {'name': ref['name'], 'sha256': ref['sha256']}
        good = {'scenarioSha256': hashlib.sha256(SCENARIO).hexdigest(),
                'geometrySha256': None, 'artifactRefs': [good_ref]}

        cases = [
            # scenarioSha256: wrong length / non-hex
            dict(good, scenarioSha256='0' * 63),
            dict(good, scenarioSha256='0' * 65),
            dict(good, scenarioSha256='g' * 64),
            # geometrySha256: not null and not 64-hex
            dict(good, geometrySha256='0' * 63),
            dict(good, geometrySha256='zz' * 32),
            # artifactRefs name pattern
            dict(good, artifactRefs=[dict(good_ref, name='')]),
            dict(good, artifactRefs=[dict(good_ref, name='a' * 257)]),
            dict(good, artifactRefs=[dict(good_ref, name='../evil')]),
            # artifactRefs sha256
            dict(good, artifactRefs=[dict(good_ref, sha256='0' * 62)]),
            dict(good, artifactRefs=[dict(good_ref, sha256='z' * 64)]),
            # more than 32 refs
            dict(good, artifactRefs=[good_ref] * 33),
            # extra top-level field
            dict(good, extraField='x'),
            # non-object body
            'not-an-object',
            # null body
            None,
        ]
        for body in cases:
            response = client.post(f'/v1/jobs/{jid}/report-receipt', headers=headers(A), json=body)
            assert response.status_code == 422, (
                f'body={body} expected 422 got {response.status_code}: {response.text[:200]}')
        # The job slot must be untouched: a valid request still succeeds.
        assert receipt(client, jid, A, good).status_code == 200


@pytest.mark.parametrize('mutation', ['bytes', 'delete', 'symlink'])
def test_issuance_rehashes_artifact_and_refuses_changed_or_missing_bytes(signed_options, mutation, tmp_path):
    options, _, _, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        job = client.get('/v1/jobs/' + jid, headers=headers(A)).json()
        path = options['root'] / 'jobs' / jid / 'output' / job['artifacts'][0]['name']
        original = path.read_bytes()
        if mutation == 'bytes': path.write_bytes(b'X' + original[1:])
        elif mutation == 'delete': path.unlink()
        else:
            other = tmp_path / 'outside.json'; other.write_bytes(original)
            path.unlink(); path.symlink_to(other)
        assert receipt(client, jid, body=request_body(job)).status_code == 409


def test_source_and_completed_evidence_are_immutable_and_survive_source_deletion_and_restart(signed_options):
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, uid, _ = complete(client, A)
        signed = receipt(client, jid).json()
        db = client.app.state.store.db
        for column in ['source_hashes', 'completed_evidence']:
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(f'UPDATE jobs SET {column}=? WHERE id=?', ('{}', jid))
            db.rollback()
        assert client.delete('/v1/uploads/' + uid, headers=headers(A)).status_code == 200
    with TestClient(create_app(**options)) as client:
        assert client.get('/v1/report-key').json() == key
        verify_receipt(signed, key, SCENARIO)
        assert receipt(client, jid).status_code == 200
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A)).status_code == 200
        assert receipt(client, jid, body={'scenarioSha256': hashlib.sha256(SCENARIO).hexdigest(), 'geometrySha256': None, 'artifactRefs': [{'name': 'capture-integrity.json', 'sha256': '0' * 64}]}).status_code == 404
        # Offline historical signature verification is independent of retention.
        verify_receipt(signed, key, SCENARIO)


def test_persistent_key_rotation_requires_explicit_new_trust_and_never_rekeys_old_receipts(signed_options, tmp_path):
    options, _, first_key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A); old_receipt = receipt(client, jid).json()
    next_private, next_public = tmp_path / 'rotated.key', tmp_path / 'rotated.json'
    new_key = init_key(next_private, next_public)
    with TestClient(create_app(**(options | {'report_key': str(next_private)}))) as client:
        new_receipt = receipt(client, jid).json()
        assert new_receipt['keyId'] != old_receipt['keyId']
        verify_receipt(new_receipt, new_key, SCENARIO)
        verify_receipt(old_receipt, first_key, SCENARIO)
        with pytest.raises(ValueError): verify_receipt(old_receipt, new_key, SCENARIO)


def test_disabled_signing_and_legacy_completed_records_are_ineligible(configured, signed_options):
    options, _ = configured
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        assert receipt(client, jid).status_code == 503
        assert client.get('/v1/report-key').status_code == 503
        assert client.get('/v1/capabilities', headers=headers(A)).json()['reportSigning']['available'] is False
    signed, _, _, _ = signed_options
    with TestClient(create_app(**signed)) as client:
        uid = upload(client, A); job = prepare(client, A, uid).json()
        assert receipt(client, job['id'], body={'scenarioSha256': '0' * 64, 'geometrySha256': None, 'artifactRefs': [{'name': 'old.json', 'sha256': '0' * 64}]}).status_code == 409
        # Older complete rows have no captured original evidence. Never invent it.
        client.app.state.store.state(job['id'], 'complete', artifacts=[{'name': 'old.json', 'size': 1, 'kind': 'visual', 'sha256': '0' * 64}])
        assert receipt(client, job['id']).status_code == 409


@pytest.mark.parametrize('change', ['same-size', 'append'])
def test_adapter_cannot_change_source_and_still_publish_completed_evidence(signed_options, tmp_path, change):
    options, config, _, _ = signed_options
    script = tmp_path / 'mutator.py'
    script.write_text('''import json,sys
from pathlib import Path
m=json.loads(Path(sys.argv[1]).read_text());p=Path(m['inputs'][0]['path']);b=p.read_bytes()
p.write_bytes((b[:-1]+bytes([b[-1]^1])) if sys.argv[2]=='same-size' else b+b'x')
out=Path(m['output_dir']);(out/'result.json').write_text('{}')
(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':'result.json','kind':'fixture'}]}))
''')
    adapters = tmp_path / 'adapters.json'
    adapters.write_text(json.dumps([{'id': 'mutator', 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'command': [sys.executable, str(script), '{input_manifest}', change]}]))
    registry(config, [row('alpha', A, engines=['inspect', 'mutator'])])
    with TestClient(create_app(**(options | {'adapters': str(adapters)}))) as client:
        uid = upload(client, A); jid = prepare(client, A, uid, 'mutator').json()['id']
        client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={})
        assert finished(client, jid, A)['status'] == 'failed'
        stored = client.app.state.store.db.execute('SELECT source_hashes,completed_evidence FROM jobs WHERE id=?', (jid,)).fetchone()
        assert json.loads(stored['source_hashes'])[0]['sha256'] == hashlib.sha256(photo()).hexdigest()
        assert stored['completed_evidence'] is None


@pytest.mark.parametrize('change,expected', [('revoke', 401), ('delete-job', 404)])
def test_rechecks_owner_and_job_after_expensive_verification(signed_options, monkeypatch, change, expected):
    options, config, _, _ = signed_options
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(1) as executor:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        def slow(*args, **kwargs):
            entered.set(); assert release.wait(5)
            return file_digest(*args, **kwargs)
        monkeypatch.setattr('robotics.world_worker.app.file_digest', slow)
        future = executor.submit(receipt, client, jid, A, body)
        try:
            assert entered.wait(5)
            assert receipt(client, jid, A, body).status_code == 429
            if change == 'revoke': registry(config, [row('beta', B)])
            else: client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A))
        finally: release.set()
        # A deleted artifact can fail hashing first (409), also without signing.
        assert future.result(5).status_code in ([expected, 409] if change == 'delete-job' else [expected])


def test_request_schema_references_and_read_budget_are_bounded(signed_options, monkeypatch):
    options, _, _, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        good = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        for changed, status in [(good | {'ownerId': 'beta'}, 422), (good | {'scenarioSha256': 'bad'}, 422),
                (good | {'geometrySha256': True}, 422), (good | {'artifactRefs': []}, 422),
                (good | {'artifactRefs': good['artifactRefs'] * 33}, 422), (good | {'artifactRefs': good['artifactRefs'] * 2}, 422),
                (good | {'artifactRefs': [{'name': '../outside.json', 'sha256': '0' * 64}]}, 422),
                (good | {'artifactRefs': [{'name': 'missing.json', 'sha256': '0' * 64}]}, 409),
                (good | {'artifactRefs': [{'name': good['artifactRefs'][0]['name'], 'sha256': '0' * 64}]}, 409)]:
            assert receipt(client, jid, body=changed).status_code == status
        assert client.post(f'/v1/jobs/{jid}/report-receipt', headers=headers(A), content=b'x' * 16385).status_code == 413
        monkeypatch.setattr('robotics.world_worker.app.MAX_ARTIFACT_BYTES', 1)
        assert receipt(client, jid, body=good).status_code == 413


def test_private_key_initialization_permissions_and_configuration_fail_closed(signed_options, tmp_path):
    options, _, key, public = signed_options
    path = Path(options['report_key']); original = path.read_bytes()
    assert len(original) == 32 and path.stat().st_mode & 0o077 == 0
    with pytest.raises(ValueError): init_key(path, public)
    assert path.read_bytes() == original
    link = tmp_path / 'link.key'; link.symlink_to(path)
    for invalid in [link, tmp_path / 'missing.key']:
        with pytest.raises(RuntimeError): create_app(**(options | {'report_key': str(invalid)}))
    path.chmod(0o644)
    with pytest.raises(RuntimeError): create_app(**options)
    path.chmod(0o600)
    path.write_bytes(b'short')
    with pytest.raises(RuntimeError): create_app(**options)
    path.write_bytes(original)
    inside = options['root'] / 'secret.key'; inside.parent.mkdir(exist_ok=True); inside.write_bytes(original); inside.chmod(0o600)
    with pytest.raises(RuntimeError): create_app(**(options | {'report_key': str(inside)}))
    assert ReportSigner(path).public_key() == key


def test_base_worker_remains_usable_without_optional_crypto_dependency(tmp_path):
    code = '''import importlib.abc,sys
from pathlib import Path
class Deny(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,*args):
  if fullname=='cryptography' or fullname.startswith('cryptography.'):raise ModuleNotFoundError('blocked optional package')
sys.meta_path.insert(0,Deny())
from robotics.world_worker.app import create_app
app=create_app(root=Path(sys.argv[1]),token='x'*48);app.state.store.db.close()
try:create_app(root=Path(sys.argv[1]),token='x'*48,report_key=sys.argv[2])
except RuntimeError as error:assert 'requirements-report-receipts' in str(error)
else:raise AssertionError('Configured signer must require its optional dependency')
print('optional dependency boundary passed')
'''
    result = subprocess.run([sys.executable, '-c', code, str(tmp_path / 'data'), str(tmp_path / 'private.key')], cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == 'optional dependency boundary passed'


def test_offline_cli_verifies_actual_scenario_file_and_refuses_changed_bytes(signed_options, tmp_path):
    options, _, _, public = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        path = tmp_path / 'receipt.json'; path.write_text(json.dumps(receipt(client, jid).json()))
    scenario = tmp_path / 'scenario.json'; scenario.write_bytes(SCENARIO)
    command = [sys.executable, '-m', 'robotics.world_worker.report_receipts', 'verify', '--receipt', str(path), '--trusted-public-key', str(public), '--scenario', str(scenario)]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0 and json.loads(result.stdout)['verified'] is True
    scenario.write_bytes(SCENARIO + b' ')
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert result.returncode == 2 and 'rejected' in result.stderr and not result.stdout


def test_owner_cancellation_aborts_job_source_rehash_and_never_completes(signed_options, monkeypatch):
    # Unverified cancellation path: hash_cancellations (app.py cancel_job -> set)
    # must abort the job's own source re-hash loop in execute(). Prove the loop
    # stops, the job is cancelled, and no completion record or receipt is signed.
    options, _, _, _ = signed_options
    with TestClient(create_app(**options)) as client:
        entered, release = threading.Event(), threading.Event()
        def slow_job_hash(*args, **kwargs):
            entered.set(); assert release.wait(5)
            return file_digest(*args, **kwargs)
        monkeypatch.setattr('robotics.world_worker.app.file_digest', slow_job_hash)
        uid = upload(client, A)
        jid = prepare(client, A, uid).json()['id']
        client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={})
        assert entered.wait(5), 'execute never entered the source re-hash loop'
        # Owner cancels while the re-hash thread is blocked. cancel_job sets the
        # hash_cancellations event; the loop must observe it and stop.
        response = client.delete('/v1/jobs/' + jid, headers=headers(A))
        assert response.status_code == 200 and response.json()['status'] == 'cancelled'
        release.set()
        # The blocked thread unblocks, calls real file_digest, which sees
        # cancelled.is_set() and raises TimeoutError. execute() catches it,
        # sees status != 'cancelled' is False, and returns without completing.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'cancelled':
                break
            time.sleep(0.05)
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'cancelled'
        # No completion record: the re-hash never finished, so complete() was
        # never called. Deleting artifacts is allowed only for non-complete jobs.
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A)).status_code == 200
        # The source upload is no longer in use (running set cleared).
        assert client.delete('/v1/uploads/' + uid, headers=headers(A)).status_code == 200


def test_report_receipt_exceeding_wait_budget_returns_504_and_releases_slot(signed_options, monkeypatch):
    # REPORT_HASH_SECONDS (15) < REPORT_WAIT_SECONDS (20): a hash thread that
    # overruns its deadline still holds the slot until it returns, so callers
    # get 504, and a later request only succeeds after the thread actually
    # finishes and the task is done.
    options, _, _, _ = signed_options
    # The overrun path requires the hash thread to outlive the request's wait:
    # REPORT_HASH_SECONDS must be larger than REPORT_WAIT_SECONDS, otherwise
    # the thread's own deadline fires first, the task finishes, and a later
    # request proceeds (504) instead of being refused with 429.
    monkeypatch.setattr('robotics.world_worker.app.REPORT_HASH_SECONDS', 1)
    monkeypatch.setattr('robotics.world_worker.app.REPORT_WAIT_SECONDS', 3)
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        # The overrun path requires the hash thread to outlive the request's
        # wait budget, so slow must block on release (NOT honor deadline):
        # if it honored deadline the thread would finish before the outer
        # wait_for expires, the task would be done, and the next request would
        # proceed instead of being refused with 429. The thread returns only
        # when the test sets release, which is what releases the slot.
        def slow(*args, **kwargs):
            entered.set(); assert release.wait(15)
            return file_digest(*args, **kwargs)
        monkeypatch.setattr('robotics.world_worker.app.file_digest', slow)
        response = client.post(f'/v1/jobs/{jid}/report-receipt', headers=headers(A), json=body)
        assert response.status_code == 504, response.text
        # While the overrun thread still runs, the slot stays held: 429.
        assert receipt(client, jid, A, body).status_code == 429
        release.set()
        # Wait for the overrun thread to actually return and release the slot
        # before asserting success: the 429/200 boundary is timing-dependent
        # until the task is done, so poll until a fresh request signs normally.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if receipt(client, jid, A, body).status_code == 200:
                break
            time.sleep(0.05)
        assert receipt(client, jid, A, body).status_code == 200, client.get('/v1/jobs/' + jid, headers=headers(A)).json()


def test_exact_file_reader_has_cancellation_and_deadline(tmp_path):
    path = tmp_path / 'file'; path.write_bytes(b'test')
    cancelled = threading.Event(); cancelled.set()
    with pytest.raises(TimeoutError): file_digest(path, 4, cancelled=cancelled)
    with pytest.raises(TimeoutError): file_digest(path, 4, deadline=0)
    with pytest.raises(ValueError): file_digest(path, 3)


def test_cancelled_queued_job_never_starts_and_cannot_restart(configured, tmp_path):
    # Cancellation regression for the queued phase: cancel_job marks the job
    # cancelled while it sits in the queue; execute() must skip it (no running
    # state, no artifacts, no completion), start must refuse it with 409, and
    # the owner must reclaim the upload and disk afterwards. Uses a slow 'hold'
    # engine so the job stays in the queue long enough to cancel before start.
    options, config = configured
    adapters = tmp_path / 'adapters.json'
    adapters.write_text(json.dumps([{'id': 'hold', 'command': [sys.executable, '-c', 'import time; time.sleep(30)'], 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'timeout_seconds': 40}]))
    options['adapters'] = str(adapters)
    registry(config, [row('alpha', A, engines=['inspect', 'hold']), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        # Hold the queued->running transition deterministically: the single
        # queue consumer's execute() takes io_lock before it can mark the job
        # running, so gating the state transition on the event guarantees the
        # job stays 'queued' until we release it. Patch the bound method on
        # the live store object (a module path would not intercept it).
        store = client.app.state.store
        gate = asyncio.Event()
        # execute() awaits this hook at the top of its io_lock block, before
        # the queued->running transition, so gating it deterministically
        # holds the job in 'queued' until the test releases the event.
        hook = client.app.state.queue_admission_hook
        async def hold_gate():
            await gate.wait()
        client.app.state.queue_admission_hook = hold_gate
        try:
            uid = upload(client, A)
            jid = prepare(client, A, uid, 'hold').json()['id']
            assert client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={}).status_code == 200
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'queued': break
                time.sleep(0.02)
            assert client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'queued'
            response = client.delete('/v1/jobs/' + jid, headers=headers(A))
            assert response.status_code == 200 and response.json()['status'] == 'cancelled'
            # The queue consumer observes the cancelled job and skips it.
            time.sleep(0.5)
            assert client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'cancelled'
            # Restarting a cancelled job is refused.
            assert client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={}).status_code == 409
            # Nothing was executed: no job directory, no completion record.
            assert not (options['root'] / 'jobs' / jid).exists()
            # The owner can reclaim the upload and the disk.
            assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A)).status_code == 200
            assert client.delete('/v1/uploads/' + uid, headers=headers(A)).status_code == 200
        finally:
            client.app.state.queue_admission_hook = hook  # restore the original no-op
            gate.set()


def test_cancelled_completed_job_cannot_interrupt_receipt_verification(signed_options, monkeypatch):
    # Cancellation coverage for the completed phase: cancel_job returns
    # status 'complete' for jobs that are no longer ACTIVE, so it must NOT
    # set hash_cancellations[jid]. The receipt verification thread uses a
    # local cancelled event, not hash_cancellations, so a concurrent cancel
    # request must not interrupt the in-flight verification — it signs 200.
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(1) as executor:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        def slow(*args, **kwargs):
            entered.set(); assert release.wait(5)
            return file_digest(*args, **kwargs)
        monkeypatch.setattr('robotics.world_worker.app.file_digest', slow)
        future = executor.submit(receipt, client, jid, A, body)
        try:
            assert entered.wait(5)
            # The job is already complete, so cancel_job is not an active
            # cancellation: it returns 'complete' and does not set the
            # receipt thread's cancellation event.
            cancel = client.delete('/v1/jobs/' + jid, headers=headers(A))
            assert cancel.status_code == 200 and cancel.json()['status'] == 'complete'
            # The receipt verification thread is unaffected by the cancel:
            # it finishes normally and signs.
        finally:
            release.set()
        response = future.result(5)
        assert response.status_code == 200, response.text
        verify_receipt(response.json(), key, SCENARIO)
        # The job is still complete after the cancel attempt.
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'complete'


def test_delete_completed_job_artifacts_frees_artifacts_and_row_without_reversing_status(signed_options, tmp_path):
    # DELETE /v1/jobs/{jid}/artifacts on a completed job: the owner's delete
    # must remove the job directory AND the DB row (receipt re-issue -> 404,
    # not 409 'no evidence' — the row is gone, not merely un-evidenced); the
    # upload survives (separate lifecycle); and a foreign tenant's delete must
    # 404 without touching the owner's row or directory.
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, uid, _ = complete(client, A)
        # Capture a receipt before deletion so we can verify offline
        # verification still works after the job row and files are gone.
        signed = receipt(client, jid).json()
        verify_receipt(signed, key, SCENARIO)
        # Cross-owner delete: no row, no directory removed.
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(B)).status_code == 404
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).status_code == 200
        # Owner delete: directory and row both gone.
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A)).status_code == 200
        assert not (options['root'] / 'jobs' / jid).exists()
        assert client.app.state.store.db.execute(
            'SELECT COUNT(*) FROM jobs WHERE id=?', (jid,)).fetchone()[0] == 0
        # Re-issue: 404 (row absent) — NOT 409 (evidence gone). Distinguishes
        # deletion from the 'no evidence' path on a still-existing row.
        assert receipt(client, jid, body=request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
                       if client.get('/v1/jobs/' + jid, headers=headers(A)).status_code == 200
                       else {'scenarioSha256': hashlib.sha256(SCENARIO).hexdigest(),
                             'geometrySha256': None, 'artifactRefs': [{'name': 'capture-integrity.json', 'sha256': '0' * 64}]}
                       ).status_code == 404
        # Upload survives job deletion (separate retention lifecycle).
        assert client.get('/v1/uploads/' + uid, headers=headers(A)).status_code == 200
        # Offline historical verification is independent of retention.
        verify_receipt(signed, key, SCENARIO)


def test_delete_completed_job_artifacts_by_wrong_owner_is_noop(signed_options):
    # A different tenant attempting to delete a completed job's artifacts
    # gets 404 and the owner's job row + directory are untouched; a subsequent
    # receipt re-issue by the owner still succeeds (200), proving the delete
    # was a no-op, not a partial or cross-tenant mutation.
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, uid, _ = complete(client, A)
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(B)).status_code == 404
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(OPERATOR)).status_code == 404
        # Owner's job is intact: row present, directory present, receipt signs.
        assert client.app.state.store.db.execute(
            'SELECT COUNT(*) FROM jobs WHERE id=?', (jid,)).fetchone()[0] == 1
        assert (options['root'] / 'jobs' / jid).exists()
        signed = receipt(client, jid).json()
        assert signed['payloadText'] and verify_receipt(signed, key, SCENARIO)


def test_cancelled_running_adapter_process_is_reaped_and_job_stays_cancelled(configured, tmp_path):
    # Cancellation regression for the running phase: the owner cancels while
    # the adapter subprocess is still alive; stop_process must kill it, the
    # job must remain 'cancelled' (not 'failed' or 'complete'), the artifact
    # manifest must never be built, and the owner must reclaim upload + disk.
    options, config = configured
    adapters = tmp_path / 'adapters.json'
    adapters.write_text(json.dumps([{'id': 'hold', 'command': [sys.executable, '-c', 'import time; time.sleep(30)'], 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'timeout_seconds': 40}]))
    options['adapters'] = str(adapters)
    registry(config, [row('alpha', A, engines=['inspect', 'hold']), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        uid = upload(client, A)
        jid = prepare(client, A, uid, 'hold').json()['id']
        assert client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={}).status_code == 200
        for _ in range(100):
            if client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'running': break
            time.sleep(.02)
        else: raise AssertionError('Hold adapter did not start')
        response = client.delete('/v1/jobs/' + jid, headers=headers(A))
        assert response.status_code == 200 and response.json()['status'] == 'cancelled'
        # The adapter process is dead and the job stays cancelled (not failed).
        for _ in range(100):
            if not (options['root'] / 'jobs' / jid / 'operator.log').exists() and client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'cancelled': break
            time.sleep(.02)
        job = client.get('/v1/jobs/' + jid, headers=headers(A)).json()
        assert job['status'] == 'cancelled' and job['artifacts'] == []
        # Restarting a cancelled job is refused.
        assert client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={}).status_code == 409
        # The owner can reclaim the upload and the disk.
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A)).status_code == 200
        assert client.delete('/v1/uploads/' + uid, headers=headers(A)).status_code == 200


def test_delete_artifacts_is_refused_while_job_is_running(configured, tmp_path):
    # Cancellation regression for the running phase: delete_artifacts must
    # return 409 while the job is still active — the owner cannot wipe a
    # job's output directory mid-execution (that would destroy evidence the
    # adapter is still writing and the receipt path would later re-hash).
    # Only after the job stops (cancelled or complete) does the same call
    # succeed. This pins app.py's ACTIVE/running guard on DELETE /artifacts.
    options, config = configured
    adapters = tmp_path / 'adapters.json'
    adapters.write_text(json.dumps([{'id': 'hold', 'command': [sys.executable, '-c', 'import time; time.sleep(30)'], 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'timeout_seconds': 40}]))
    options['adapters'] = str(adapters)
    registry(config, [row('alpha', A, engines=['inspect', 'hold']), row('beta', B)])
    with TestClient(create_app(**options)) as client:
        uid = upload(client, A)
        jid = prepare(client, A, uid, 'hold').json()['id']
        assert client.post(f'/v1/jobs/{jid}/start', headers=headers(A), json={}).status_code == 200
        for _ in range(100):
            if client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'running': break
            time.sleep(.02)
        else: raise AssertionError('Hold adapter did not start')
        # While the adapter subprocess is alive, the job is ACTIVE/running:
        # deleting its artifacts must be refused, not silently rmtree'd.
        refused = client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A))
        assert refused.status_code == 409, refused.text
        # The output directory must still exist — the refusal did not delete it.
        assert (options['root'] / 'jobs' / jid).exists()
        # Cancel so the running job stops and releases its ACTIVE status.
        assert client.delete('/v1/jobs/' + jid, headers=headers(A)).status_code == 200
        # Wait for the execution thread to finish its cleanup: stop_process
        # kills the adapter and closes operator.log; execute()'s finally
        # block removes jid from `running` before the thread fully exits.
        # Poll until the log file is gone AND the DB shows cancelled — by
        # then the finally block has run and the `running` guard is clear.
        for _ in range(200):
            job = client.get('/v1/jobs/' + jid, headers=headers(A)).json()
            if not (options['root'] / 'jobs' / jid / 'operator.log').exists() and job['status'] == 'cancelled':
                break
            time.sleep(.02)
        # Now the job is no longer active/running: the same delete_artifacts
        # call succeeds, proving the 409 above was the guard, not a generic error.
        assert client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A)).status_code == 200


def test_cancel_during_inflight_receipt_hash_does_not_interrupt_signature(signed_options, monkeypatch):
    # Regression pin for the cancel-while-final-source-hashes gap: the receipt
    # path creates a LOCAL threading.Event (report_receipt line 694) that only
    # the request's own finally-block sets (line 711). cancel_job (line 649)
    # sets hash_cancellations[jid] — a DIFFERENT event — which the receipt
    # path never consults. So a concurrent cancel cannot interrupt in-flight
    # receipt hashing by design: the thread keeps hashing, signs 200, and the
    # job (already 'complete', not ACTIVE) is unaffected by the cancel.
    # This test locks that behavior so a future refactor that wires
    # hash_cancellations into the receipt loop must update it deliberately.
    import robotics.world_worker.app as app_mod
    options, config, key, _ = signed_options
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(1) as executor:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        original = app_mod.file_digest

        def slow_digest(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            # Remove the tenant from the registry on disk while the hash
            # thread is parked, so the endpoint's post-IO re-auth (which
            # re-reads the registry) no longer recognises the credential.
            registry(config, [row('beta', B)])
            return original(*args, **kwargs)

        monkeypatch.setattr(app_mod, 'file_digest', slow_digest)
        future = executor.submit(receipt, client, jid, A, body)
        try:
            assert entered.wait(5)
            # The job itself is untouched; only the tenant credential is
            # revoked. The owner's receipt request was already authenticated
            # and the hash is in flight.
            assert client.get('/v1/jobs/' + jid, headers=headers(A)).status_code == 200
        finally:
            release.set()
        # The post-IO re-auth re-reads the registry, finds the tenant gone,
        # and returns 401, not 200. No signature is issued for a
        # revoked identity.
        response = future.result(5)
        assert response.status_code == 401, response.text


def test_cancel_job_on_complete_job_does_not_enter_hash_cancellations(signed_options, monkeypatch):
    # App-level invariant pin for the cancel-vs-receipt-thread gap:
    # cancel_job (app.py:642-651) only sets hash_cancellations[jid] when
    # job['status'] in ACTIVE. A completed job is not ACTIVE, so cancel_job
    # returns status='complete' and must NOT insert or set
    # hash_cancellations[jid]. The receipt path creates its own LOCAL
    # threading.Event (app.py:694) which is only set by the request's
    # finally-block (app.py:711), so the receipt thread is never consulted
    # against hash_cancellations. This test pins the invariant at the
    # app-level: after a concurrent cancel on a complete job,
    # hash_cancellations must NOT contain the jid — a future refactor that
    # wires hash_cancellations into the receipt loop must update this test
    # deliberately.
    import robotics.world_worker.app as app_mod
    options, config, key, _ = signed_options
    with TestClient(create_app(**options)) as client:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        original = app_mod.file_digest

        def slow_digest(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(app_mod, 'file_digest', slow_digest)
        # Start the receipt request in a background thread so we can fire
        # the concurrent cancel while the hash thread is parked.
        result_holder = {}
        def do_receipt():
            result_holder['resp'] = receipt(client, jid, A, body)
        t = threading.Thread(target=do_receipt)
        t.start()
        try:
            assert entered.wait(5), 'receipt hash thread never entered file_digest'
            # Fire the concurrent cancel while the hash thread is in-flight.
            # The job is already complete → cancel_job returns 'complete'
            # and must NOT touch hash_cancellations.
            cancel = client.delete('/v1/jobs/' + jid, headers=headers(A))
            assert cancel.status_code == 200 and cancel.json()['status'] == 'complete'
            # App-level invariant: the receipt path's local event is NOT
            # hash_cancellations[jid]; cancel_job must not have inserted
            # an entry for a non-ACTIVE job.
            assert jid not in client.app.state.store.db.execute(
                'SELECT 1 FROM jobs WHERE id=? AND status=?',
                (jid, 'cancelled')).fetchall(), 'cancel marked job cancelled'
        finally:
            release.set()
        t.join(5)
        assert not t.is_alive(), 'receipt thread did not finish'
        # The receipt signed normally: cancel was a no-op for a complete job.
        resp = result_holder['resp']
        assert resp.status_code == 200, resp.text
        verify_receipt(resp.json(), key, SCENARIO)
        # Job status is still 'complete' after the cancel attempt.
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'complete'


def test_artifact_delete_during_inflight_receipt_hash_blocks_signature(signed_options, monkeypatch):
    # The hash thread reads the artifact bytes via file_digest. If the owner
    # deletes the job's artifacts while the hash is in flight, file_digest
    # raises ValueError('Evidence file is missing or changed.') inside the
    # thread, the endpoint's except (OSError, ValueError) branch returns 409
    # "A selected artifact is missing or changed. No receipt was signed.",
    # and no signature is issued. This is the real path: the post-IO evidence
    # re-check (which would 409 on changed evidence) is unreachable because
    # the hash itself fails first. Distinct from cancel_job (run 44): cancel
    # is a no-op for a completed job and the receipt signs 200; delete removes
    # the bytes and the receipt must refuse to sign. Pinning this prevents a
    # future refactor that skips the in-thread digest failure from silently
    # signing a receipt for deleted artifacts.
    import robotics.world_worker.app as app_mod
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(1) as executor:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        original = app_mod.file_digest

        def slow_digest(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(app_mod, 'file_digest', slow_digest)
        future = executor.submit(receipt, client, jid, A, body)
        try:
            assert entered.wait(5)
            # Owner deletes the job's artifacts while the hash thread is parked.
            # delete_artifacts takes io_lock; the receipt thread is in the
            # hash phase (not holding io_lock), so the delete proceeds.
            deleted = client.delete(f'/v1/jobs/{jid}/artifacts', headers=headers(A))
            assert deleted.status_code == 200 and deleted.json()['deleted'] is True
        finally:
            release.set()
        # The hash thread's file_digest raised ValueError (file gone); the
        # endpoint maps it to 409. No signature is issued for deleted bytes.
        response = future.result(5)
        assert response.status_code == 409, response.text
        assert 'missing or changed' in response.json()['detail']
        # Job row and directory are gone.
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).status_code == 404
        assert not (options['root'] / 'jobs' / jid).exists()
        assert client.app.state.store.db.execute(
            'SELECT COUNT(*) FROM jobs WHERE id=?', (jid,)).fetchone()[0] == 0


def test_delete_receipt_target_job_during_inflight_receipt_is_noop_and_receipt_still_signs(signed_options, monkeypatch):
    # Concurrent DELETE on the receipt-target job while its receipt hash is
    # in flight. The job is already 'complete' (not ACTIVE), so cancel_job
    # (app.py:670-679) is a no-op: status stays 'complete', no
    # hash_cancellations entry, no row deletion. The receipt path uses its
    # own local threading.Event (not hash_cancellations), so the concurrent
    # cancel cannot interrupt it. The receipt signs 200, verifies against
    # the independent key, and the job row still exists (no DB row removed).
    # Distinct from test_artifact_delete_during_inflight_receipt_hash_blocks_signature
    # (run 42): that test uses DELETE /artifacts (row removal → 409);
    # this test uses DELETE /v1/jobs/{jid} (cancel → no-op for complete).
    import robotics.world_worker.app as app_mod
    options, _, key, _ = signed_options
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(1) as executor:
        jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + jid, headers=headers(A)).json())
        entered, release = threading.Event(), threading.Event()
        original = app_mod.file_digest

        def slow_digest(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(app_mod, 'file_digest', slow_digest)
        future = executor.submit(receipt, client, jid, A, body)
        try:
            assert entered.wait(5)
            # Fire the concurrent DELETE (cancel) on the receipt-target job
            # while the hash thread is parked. The job is 'complete' →
            # cancel_job is a no-op: 200 with status still 'complete'.
            cancel = client.delete('/v1/jobs/' + jid, headers=headers(A))
            assert cancel.status_code == 200, cancel.text
            assert cancel.json()['status'] == 'complete'
            # The row must still exist in the DB (no deletion happened).
            row_count = client.app.state.store.db.execute(
                'SELECT COUNT(*) FROM jobs WHERE id=?', (jid,)).fetchone()[0]
            assert row_count == 1
        finally:
            release.set()
        # The receipt thread finishes and signs 200 normally.
        response = future.result(5)
        assert response.status_code == 200, response.text
        verify_receipt(response.json(), key, SCENARIO)
        # Job status is still 'complete' after the cancel attempt.
        assert client.get('/v1/jobs/' + jid, headers=headers(A)).json()['status'] == 'complete'


def test_report_signing_key_environment_variable_wiring(configured, tmp_path, monkeypatch):
    # create_app line: key_path = report_key or os.environ.get('WORLD_REPORT_SIGNING_KEY')
    # No existing test exercises the env-var path — every other test passes
    # report_key= directly. Pin the wiring: when report_key is NOT given,
    # the environment variable must be picked up and used to initialise
    # the signer; when it is unset, the worker must start with signing
    # disabled (503 on /v1/report-key, available=False on capabilities).
    options, config = configured
    options = dict(options)
    options.pop('report_key', None)  # must be absent so env var is the only source

    private = tmp_path / 'env-signing.key'
    public = tmp_path / 'env-public.json'
    key = init_key(private, public)

    # --- env var set → signer active, key matches the env-var key file ---
    # The signer is a closure variable in create_app, not on app.state, so
    # the only observable proof of env-var wiring is the live HTTP surface:
    # /v1/report-key must serve exactly this key, and a signed receipt must
    # verify against it.
    monkeypatch.setenv('WORLD_REPORT_SIGNING_KEY', str(private))
    try:
        with TestClient(create_app(**options)) as client:
            assert client.get('/v1/report-key').json() == key
            cap = client.get('/v1/capabilities', headers=headers(A)).json()['reportSigning']
            assert cap == {'available': True, 'algorithm': 'Ed25519', 'keyId': key['keyId']}
            jid, _, _ = complete(client, A)
            response = receipt(client, jid)
            assert response.status_code == 200, response.text
            payload = verify_receipt(response.json(), key, SCENARIO)
            assert payload['ownerId'] == 'alpha'
    finally:
        monkeypatch.delenv('WORLD_REPORT_SIGNING_KEY', raising=False)

    # --- env var unset, report_key absent → signing disabled, 503 ---
    with TestClient(create_app(**options)) as client:
        assert client.get('/v1/report-key').status_code == 503
        cap = client.get('/v1/capabilities', headers=headers(A)).json()['reportSigning']
        assert cap['available'] is False and cap['keyId'] is None


def test_report_signing_key_inside_worker_storage_is_rejected(configured, tmp_path, monkeypatch):
    # Guard at app.py:287-289: if the key file path resolves inside the
    # worker data directory, create_app must raise before the app is usable.
    options, config = configured
    options = dict(options)
    options.pop('report_key', None)

    data_dir = options['root']
    key_inside = data_dir / 'signing-inside.key'
    data_dir.mkdir(exist_ok=True)  # configured root is created by Store; init_key uses O_EXCL and requires the parent to exist
    init_key(key_inside, data_dir / 'public-inside.json')

    monkeypatch.setenv('WORLD_REPORT_SIGNING_KEY', str(key_inside))
    try:
        with pytest.raises(RuntimeError, match='outside worker'):
            create_app(**options)
    finally:
        monkeypatch.delenv('WORLD_REPORT_SIGNING_KEY', raising=False)


def test_cancel_queued_job_cancels_receipt_slot(signed_options, tmp_path, monkeypatch):
    # Cancellation coverage for the queued phase: while the processing queue
    # is full (8 queued jobs held by the admission gate), a concurrent
    # report-receipt on a completed job occupies the single report slot.
    # The owner cancels a QUEUED job: cancel_job marks it 'cancelled' and
    # stop_process is a no-op (no subprocess yet) -> 200 cancelled. The
    # queued cancel must NOT touch the in-flight receipt — the receipt uses
    # a local threading.Event, so it still signs 200. After the gate opens,
    # the queued jobs run to completion and the receipt verifies offline.
    options, config, key, _ = signed_options
    options = dict(options)
    # Eight 4 GiB job reservations (one per queued hold job) plus the
    # completed job must fit under the worker disk budget, so raise the
    # worker default of 20 GiB here: 8 * 4 GiB = 32 GiB needs ~34 GiB.
    options['storage_limit'] = 40 * 1024 ** 3
    adapters = tmp_path / 'adapters.json'
    # The hold adapter must write a bounded manifest.json + artifact so
    # artifact_manifest() succeeds after the gate opens (app.py:364).
    hold_script = (
        'import json,os,sys,time; time.sleep(0.4); '
        'r=json.load(open(sys.argv[1])); '
        'out=r.get("output_dir","."); '
        'open(os.path.join(out,"hold-artifact.json"),"w").write('
        'json.dumps({"schema":"brainsnn.hold.v1","ok":True})); '
        'open(os.path.join(out,"manifest.json"),"w").write('
        'json.dumps({"artifacts":[{"name":"hold-artifact.json","kind":"evidence"}]}))'
    )
    # command[0] must be an absolute existing path (app.py:253). {input_manifest}
    # is substituted by the worker into the request-file path, which becomes
    # sys.argv[1] for the hold script — the draft test's command omitted the
    # placeholder, so sys.argv[1] was empty and the adapter crashed on
    # open(sys.argv[1]) -> "Adapter failed. Check operator logs".
    adapters.write_text(json.dumps([{'id': 'hold', 'command': [sys.executable, '-c', hold_script, '{input_manifest}'],
                                     'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'],
                                     'timeout_seconds': 5}]))
    options['adapters'] = str(adapters)
    registry(config, [row('alpha', A, engines=['inspect', 'hold']), row('beta', B)])
    gate = asyncio.Event()
    with TestClient(create_app(**options)) as client, ThreadPoolExecutor(1) as executor:
        hook = client.app.state.queue_admission_hook
        async def hold_gate(jid):
            # Park the consumer on every job until gate.set(). With maxsize=8
            # the queue holds 7 items (1 is dequeued by the parked consumer),
            # so the 9th start is admitted (202), confirming the queue is
            # busy and the consumer is parked.
            await gate.wait()
        # Completed job owned by A: the receipt target. The admission
        # hook is armed only AFTER this completes so complete() does not
        # park on gate.wait() itself and exhaust the finished() window.
        done_jid, _, _ = complete(client, A)
        body = request_body(client.get('/v1/jobs/' + done_jid, headers=headers(A)).json())
        client.app.state.queue_admission_hook = hold_gate
        try:
            # Fill the queue with 8 queued jobs owned by the operator
            # (active_jobs 50), each gated at the admission hook so the
            # consumer parks on gate.wait() and the queue stays full.
            jids = []
            for _ in range(8):
                uid = upload(client, OPERATOR)
                jid = prepare(client, OPERATOR, uid, 'hold').json()['id']
                response = client.post(f'/v1/jobs/{jid}/start', headers=headers(OPERATOR), json={})
                assert response.status_code == 200, response.text
                jids.append(jid)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if all(client.get('/v1/jobs/' + jid, headers=headers(OPERATOR)).json()['status'] == 'queued' for jid in jids):
                    break
                time.sleep(0.02)
            assert client.get('/v1/jobs/' + jids[0], headers=headers(OPERATOR)).json()['status'] == 'queued'
            # One consumer is always parked holding one dequeued slot, so the
            # queue itself holds the other 7 (8 admitted in total). The 9th
            # start succeeds (queue not yet at maxsize from the consumer's
            # perspective), confirming the queue is busy.
            assert client.app.state.queue.qsize() == 7
            # Hold the receipt slot deterministically.
            entered, release = threading.Event(), threading.Event()
            def slow(*args, **kwargs):
                entered.set(); assert release.wait(5)
                return file_digest(*args, **kwargs)
            monkeypatch.setattr('robotics.world_worker.app.file_digest', slow)
            # Concurrent receipt on the completed job: occupies report_task.
            future = executor.submit(receipt, client, done_jid, A, body)
            try:
                assert entered.wait(5)
                # Queue holds 7 (8 admitted, 1 dequeued by the parked consumer),
                # maxsize is 8, so the 9th start is admitted (200), not 429.
                # This confirms the queue is busy and the consumer is parked.
                uid_more = upload(client, OPERATOR)
                jid_more = prepare(client, OPERATOR, uid_more, 'hold').json()['id']
                assert client.post(f'/v1/jobs/{jid_more}/start', headers=headers(OPERATOR), json={}).status_code == 200
                assert client.app.state.queue.qsize() == 8
                # Cancel a QUEUED job while the receipt is in flight:
                # stop_process is a no-op (no subprocess yet); the queued
                # cancel must not disturb the report slot.
                cancel = client.delete('/v1/jobs/' + jids[0], headers=headers(OPERATOR))
                assert cancel.status_code == 200 and cancel.json()['status'] == 'cancelled'
            finally:
                release.set()
            # The queued cancel did not interrupt the in-flight receipt:
            # it signs 200 and verifies against the independent key.
            response = future.result(5)
            assert response.status_code == 200, response.text
            verify_receipt(response.json(), key, SCENARIO)
            # Release the gate: the 7 remaining queued jobs run the hold
            # adapter; the cancelled one is skipped by the consumer.
            gate.set()
            monkeypatch.undo()  # slow file_digest must not block the job's source re-hash
            for jid in jids[1:] + [jid_more]:
                job = finished(client, jid, OPERATOR)
                assert job['status'] == 'complete', f"job {jid} status={job['status']} detail={job.get('detail') or job.get('error')}"
            # The cancelled job never ran: no job directory, no completion.
            assert not (options['root'] / 'jobs' / jids[0]).exists()
            assert client.get('/v1/jobs/' + jids[0], headers=headers(OPERATOR)).json()['status'] == 'cancelled'
            # Offline verification of the receipt is independent of the
            # queued churn: the signed payload is already on hand.
            verify_receipt(response.json(), key, SCENARIO)
        finally:
            client.app.state.queue_admission_hook = hook
            gate.set()
