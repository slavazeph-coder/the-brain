"""Manual fourth-engine acceptance guards plus genuine native-output readback."""
import copy
import json
import os
from pathlib import Path
import sqlite3
import socket
import stat
import subprocess
import sys
import time
import urllib.request

import pytest

from robotics.world_worker.deploy.railway import biomechanics_acceptance as acceptance

ROOT = Path(__file__).resolve().parents[2]
NATIVE = os.environ.get('WORLD_BIOMECHANICS_TEST_PYTHON')


def environment(root):
    return {'RAILWAY_GIT_COMMIT_SHA': '1' * 40, 'RAILWAY_DEPLOYMENT_ID': '10000000-0000-4000-8000-000000000001',
            'WORLD_WORKER_DIR': str(root), 'WORLD_SITE_PASSCODE': 'authored-private-passcode-fixture'}


def test_manual_confirmation_deployment_and_busy_guards_precede_native_or_network(tmp_path, monkeypatch):
    root = tmp_path / 'worker'
    root.mkdir()
    with sqlite3.connect(root / 'state.sqlite') as db:
        db.execute('CREATE TABLE jobs(id TEXT, owner_id TEXT, status TEXT)')
        db.execute("INSERT INTO jobs VALUES('unrelated','another-owner','running')")
    def forbidden(*_args, **_kwargs):
        raise AssertionError('Refusal must precede native execution and HTTP.')
    monkeypatch.setattr(acceptance, 'authored_inputs', forbidden)
    monkeypatch.setattr(acceptance, 'LocalClient', forbidden)
    target = tmp_path / 'private-receipt.json'
    with pytest.raises(ValueError, match='confirmation'):
        acceptance.run_acceptance(receipt_path=target, env=environment(root))
    assert not target.exists()
    with pytest.raises(ValueError, match='commit'):
        acceptance.run_acceptance(confirmed=True, receipt_path=target, env=environment(root), expected_commit='2' * 40)
    assert not target.exists()
    before = (root / 'state.sqlite').read_bytes()
    with pytest.raises(RuntimeError, match='active jobs'):
        acceptance.run_acceptance(confirmed=True, receipt_path=target, env=environment(root))
    report = json.loads(target.read_bytes())
    assert report['status'] == 'failed' and report['jobs'] == [] and report['results'] == {}
    assert report['error_type'] == 'RuntimeError'
    assert (root / 'state.sqlite').read_bytes() == before
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert 'another-owner' not in target.read_text() and environment(root)['WORLD_SITE_PASSCODE'] not in target.read_text()


def test_cli_without_confirmation_is_safe_and_redacted(tmp_path):
    secret = 'fixture-private-never-print-this'
    result = subprocess.run([sys.executable, str(ROOT / 'robotics/world_worker/deploy/railway/biomechanics_acceptance.py'),
                             '--receipt', str(tmp_path / 'receipt.json')], cwd=tmp_path,
                            env={**os.environ, 'WORLD_SITE_PASSCODE': secret}, text=True, capture_output=True, timeout=10)
    assert result.returncode == 1 and result.stdout.strip() == 'BIOMECHANICS_HOSTED_ACCEPTANCE_FAILED ValueError'
    assert secret not in result.stdout + result.stderr and not result.stderr
    assert not (tmp_path / 'receipt.json').exists()


def test_no_startup_hook_invokes_fourth_engine_acceptance():
    assert 'biomechanics_acceptance' not in (ROOT / 'robotics/world_worker/deploy/railway/start.sh').read_text()


@pytest.fixture(scope='module')
def actual_inputs():
    if not NATIVE:
        pytest.skip('Set WORLD_BIOMECHANICS_TEST_PYTHON to the installed isolated native runtime.')
    return acceptance.authored_inputs(NATIVE)


def run_actual(tmp_path, inputs):
    rows = []
    for kind, name, raw in inputs:
        path = tmp_path / name
        path.write_bytes(raw)
        rows.append({'kind': kind, 'path': str(path), 'sha256': acceptance.sha(raw)})
    output = tmp_path / 'output'
    request = tmp_path / 'request.json'
    request.write_text(json.dumps({'schema': 'brainsnn.adapter.v1', 'inputs': rows, 'output_dir': str(output)}))
    subprocess.run([NATIVE, str(ROOT / 'robotics/world_worker/biomechanics.py'), '--input-manifest', str(request)],
                   cwd=tmp_path, check=True, timeout=60, capture_output=True)
    return {path.name: path.read_bytes() for path in output.iterdir() if path.is_file()}


@pytest.mark.parametrize('case', acceptance.CASES)
def test_real_native_outputs_satisfy_independent_geometry_and_torque_equations(tmp_path, actual_inputs, case):
    cases, runtime = actual_inputs
    payloads = run_actual(tmp_path, cases[case])
    result = acceptance.validate_outputs(cases[case], payloads, runtime)
    assert result['native_OpenSim_executed'] is True and result['frames'] == 31
    assert result['clinical_validated'] is False and result['physical_accuracy_verified'] is False
    assert max(result['max_geometry_errors'].values()) < 1e-7
    if case != 'kinematics':
        assert result['max_analytic_torque_error_Nm'] < 1e-6


def test_readback_refuses_changed_sources_runtime_claims_and_fabricated_forces(tmp_path, actual_inputs):
    cases, runtime = actual_inputs
    inputs = cases['inverse-dynamics-supplied']
    payloads = run_actual(tmp_path, inputs)
    with pytest.raises(ValueError, match='original bytes'):
        acceptance.validate_outputs(inputs, {**payloads, 'original-model.osim': b'changed model'}, runtime)
    with pytest.raises(ValueError, match='runtime'):
        acceptance.validate_outputs(inputs, payloads, {**runtime, 'manifest_sha256': '0' * 64})
    report = json.loads(payloads['biomechanics-report.json'])
    with pytest.raises(ValueError, match='claim'):
        acceptance.validate_outputs(inputs, {**payloads, 'biomechanics-report.json': acceptance.encode({**report, 'medical_validated': True})}, runtime)
    for change in ('zero-forces', 'wrong-load-mode', 'nonfinite'):
        preview = json.loads(payloads['biomechanics-preview.json'])
        if change == 'zero-forces':
            preview['inverse_dynamics']['generalized_forces'] = [[0.] for _ in range(31)]
        elif change == 'wrong-load-mode':
            preview['inverse_dynamics']['external_loads_mode'] = 'none-declared'
        else:
            preview['com_positions_m'][0][0] = float('nan')
        raw = json.dumps(preview).encode()
        changed_report = {**copy.deepcopy(report), 'preview_sha256': acceptance.sha(raw)}
        with pytest.raises(ValueError):
            acceptance.validate_outputs(inputs, {**payloads, 'biomechanics-preview.json': raw,
                                                  'biomechanics-report.json': acceptance.encode(changed_report)}, runtime)


def test_manual_acceptance_runs_three_real_native_jobs_over_local_http(tmp_path, actual_inputs):
    # The deployment identity is an explicit local transport fixture. No live
    # deployment is accessed or qualified by this test.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        local_port = sock.getsockname()[1]
    owner = 'o' * 43
    registry = tmp_path / 'tenants.json'
    registry.write_text(json.dumps({'schema': 'brainsnn.world.tenants.v1', 'tenants': [{
        'id': 'site-owner', 'token_sha256': acceptance.sha(owner.encode()), 'engines': ['biomechanics'],
    }]}))
    adapters = tmp_path / 'adapters.json'
    adapters.write_text(json.dumps([{'id': 'biomechanics', 'enabled': True, 'license_reviewed': True,
        'input_kinds': ['biomech-model', 'biomech-motion', 'biomech-options', 'biomech-loads'], 'max_inputs': 4,
        'timeout_seconds': 120, 'command': [NATIVE, str(ROOT / 'robotics/world_worker/biomechanics.py'),
                                           '--input-manifest', '{input_manifest}']}]))
    root = tmp_path / 'worker'
    values = {**environment(root), 'WORLD_BIOMECHANICS_PYTHON': NATIVE,
              'WORLD_WORKER_SITE_OWNER_TOKEN': owner, 'PORT': str(local_port)}
    env = {**os.environ, **values, 'WORLD_WORKER_TOKEN': 'operator-' + 'x' * 43,
           'WORLD_TENANTS_FILE': str(registry), 'WORLD_ADAPTERS_FILE': str(adapters)}
    with (tmp_path / 'worker.log').open('wb') as log:
        process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'robotics.world_worker.app:create_app',
            '--factory', '--host', '127.0.0.1', '--port', str(local_port), '--no-access-log'], cwd=ROOT,
            env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                assert process.poll() is None, (tmp_path / 'worker.log').read_text()
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{local_port}/healthz', timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(.1)
            else:
                raise AssertionError('Local real worker did not start.')
            target = tmp_path / 'acceptance.json'
            report = acceptance.run_acceptance(confirmed=True, receipt_path=target, env=values,
                expected_commit=values['RAILWAY_GIT_COMMIT_SHA'], expected_deployment=values['RAILWAY_DEPLOYMENT_ID'])
            assert report['status'] == 'passed' and report['all_download_hashes_verified'] is True
            assert set(report['results']) == set(acceptance.CASES) and len(report['jobs']) == 3
            assert all(row['engine'] == 'biomechanics' for row in report['jobs'])
            assert report['medical_validated'] is False and report['physical_accuracy_verified'] is False
            assert stat.S_IMODE(target.stat().st_mode) == 0o600 and owner not in target.read_text()
            assert acceptance.require_idle(root) == {'prepared': 0, 'queued': 0, 'running': 0}
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
