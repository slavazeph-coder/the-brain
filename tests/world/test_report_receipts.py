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


def test_exact_file_reader_has_cancellation_and_deadline(tmp_path):
    path = tmp_path / 'file'; path.write_bytes(b'test')
    cancelled = threading.Event(); cancelled.set()
    with pytest.raises(TimeoutError): file_digest(path, 4, cancelled=cancelled)
    with pytest.raises(TimeoutError): file_digest(path, 4, deadline=0)
    with pytest.raises(ValueError): file_digest(path, 3)
