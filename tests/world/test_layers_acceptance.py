"""Manual-acceptance guards and real CPU readback, without deployed API calls."""
import copy
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys

import pytest

from robotics.world_worker.deploy.railway import layers_acceptance as acceptance
from robotics.world_worker.deploy.railway.tenants import derived_credential
from robotics.motion_retarget.setup_runtime import ZERO
from robotics.motion_retarget.validation import BVH, parse_bvh
from robotics.world_worker import splat_repair, localization_job

ROOT = Path(__file__).resolve().parents[2]


def database(root, rows=()):
    root.mkdir()
    with sqlite3.connect(root / 'state.sqlite') as connection:
        connection.execute('CREATE TABLE jobs(id TEXT,owner_id TEXT,status TEXT)')
        connection.executemany('INSERT INTO jobs VALUES(?,?,?)', rows)


def env(root):
    return {'RAILWAY_GIT_COMMIT_SHA': '1' * 40, 'RAILWAY_DEPLOYMENT_ID': '10000000-0000-4000-8000-000000000001',
            'WORLD_WORKER_DIR': str(root), 'WORLD_SITE_PASSCODE': 'authored-private-passcode-fixture'}


@pytest.fixture
def authored(tmp_path):
    # A tiny authored BVH only tests fixture generation. It is never represented
    # as the actual SOMA rig or submitted to a native retargeter in this suite.
    runtime = tmp_path / 'fixture-runtime'; path = runtime / ZERO; path.parent.mkdir(parents=True)
    joints = [{'name': 'Root', 'parent': -1, 'offset': [0, 0, 0],
               'channels': ['Xposition', 'Yposition', 'Zposition', 'Zrotation', 'Yrotation', 'Xrotation']},
              {'name': 'LeftArm', 'parent': 0, 'offset': [0, 100, 0], 'channels': ['Zrotation', 'Yrotation', 'Xrotation']},
              {'name': 'LeftForeArm', 'parent': 1, 'offset': [20, 0, 0], 'channels': ['Zrotation', 'Yrotation', 'Xrotation']}]
    path.write_bytes(BVH(joints, [[0] * 12], 1 / 30).canonical_bytes())
    return acceptance.authored_inputs(runtime)


def test_all_owner_active_guard_is_read_only_and_does_not_create_missing_database(tmp_path):
    root = tmp_path / 'worker'
    database(root, [('a', 'owner-one', 'prepared'), ('b', 'owner-two', 'queued'), ('c', 'owner-three', 'running'),
                    ('d', 'owner-four', 'complete'), ('e', 'owner-five', 'cancelled')])
    before = (root / 'state.sqlite').read_bytes()
    assert acceptance.active_counts(root) == {'prepared': 1, 'queued': 1, 'running': 1}
    with pytest.raises(RuntimeError, match='active jobs'):
        acceptance.require_idle(root)
    assert (root / 'state.sqlite').read_bytes() == before
    with pytest.raises(ValueError, match='Existing'):
        acceptance.active_counts(tmp_path / 'missing')
    assert not (tmp_path / 'missing').exists()


def test_confirmation_and_busy_refusals_never_construct_api_client(tmp_path, monkeypatch):
    root = tmp_path / 'worker'; database(root, [('other', 'unrelated-owner', 'running')])
    target = tmp_path / 'private-receipt.json'
    def forbidden(*_args, **_kwargs):
        raise AssertionError('Refusal must precede any API client or fixture runtime.')
    monkeypatch.setattr(acceptance, 'LocalClient', forbidden)
    monkeypatch.setattr(acceptance, 'authored_inputs', forbidden)
    with pytest.raises(ValueError, match='confirmation'):
        acceptance.run_acceptance(receipt_path=target, env=env(root))
    assert not target.exists()
    before = (root / 'state.sqlite').read_bytes()
    with pytest.raises(RuntimeError, match='active jobs'):
        acceptance.run_acceptance(confirmed=True, receipt_path=target, env=env(root))
    report = json.loads(target.read_bytes())
    assert report['status'] == 'failed' and report['error_type'] == 'RuntimeError'
    assert report['jobs'] == [] and report['results'] == {}
    assert 'unrelated-owner' not in target.read_text() and env(root)['WORLD_SITE_PASSCODE'] not in target.read_text()
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert (root / 'state.sqlite').read_bytes() == before


def test_expected_deployment_and_owner_credentials_are_fail_closed(tmp_path):
    values = env(tmp_path)
    identity = acceptance.deployment_identity(values, values['RAILWAY_GIT_COMMIT_SHA'], values['RAILWAY_DEPLOYMENT_ID'])
    assert identity['commit_sha'] == '1' * 40
    with pytest.raises(ValueError, match='commit'):
        acceptance.deployment_identity(values, '2' * 40)
    with pytest.raises(ValueError, match='identity'):
        acceptance.deployment_identity({**values, 'RAILWAY_DEPLOYMENT_ID': 'not-a-deployment'})
    assert acceptance.owner_credential(values) == derived_credential(values['WORLD_SITE_PASSCODE'], 'site-owner')
    assert acceptance.owner_credential({**values, 'WORLD_WORKER_SITE_OWNER_TOKEN': 'z' * 43}) == 'z' * 43
    with pytest.raises(ValueError):
        acceptance.owner_credential({'WORLD_WORKER_SITE_OWNER_TOKEN': 'invalid token', **values})


def test_cli_without_confirmation_is_safe_and_redacts_secrets(tmp_path):
    secret = 'private-cli-fixture-never-print-this'
    result = subprocess.run([sys.executable, str(ROOT / 'robotics/world_worker/deploy/railway/layers_acceptance.py'),
                             '--receipt', str(tmp_path / 'no-receipt.json')], cwd=tmp_path,
                            env={**os.environ, 'WORLD_SITE_PASSCODE': secret}, text=True, capture_output=True, timeout=10)
    assert result.returncode == 1
    assert result.stdout.strip() == 'LAYERS_HOSTED_ACCEPTANCE_FAILED ValueError'
    assert secret not in result.stdout + result.stderr and not result.stderr
    assert not (tmp_path / 'no-receipt.json').exists()


def test_receipt_is_private_and_cannot_follow_a_symlink(tmp_path):
    path = tmp_path / 'receipt.json'; path.write_text('earlier result'); path.chmod(0o644)
    acceptance.write_receipt(path, {'status': 'started'})
    assert json.loads(path.read_bytes()) == {'status': 'started'} and stat.S_IMODE(path.stat().st_mode) == 0o600
    alias = tmp_path / 'alias'; alias.symlink_to(path)
    with pytest.raises(ValueError, match='private receipt'):
        acceptance.write_receipt(alias, {'status': 'passed'})
    assert json.loads(path.read_bytes()) == {'status': 'started'}


def test_procedural_inputs_are_bounded_and_explicitly_authored(authored):
    assert set(authored) == set(acceptance.ENGINES)
    for inputs in authored.values():
        assert len(inputs) == 2 and all(0 < len(raw) < 4 * acceptance.MIB for _, _, raw in inputs)
    assert b'AUTHORED DEPLOYMENT TEST' in authored['splat-repair'][0][2]
    assert b'NOT MEASURED LIDAR' in authored['localization-map'][0][2]
    motion = parse_bvh(authored['motion-retarget'][0][2])
    assert len(motion.frames) == 31 and motion.fps == pytest.approx(30)
    assert motion.frames[15] != motion.frames[0]


def run_adapter(tmp_path, engine, inputs):
    root = tmp_path / engine; root.mkdir()
    rows = []
    for kind, name, raw in inputs:
        path = root / name; path.write_bytes(raw); rows.append({'kind': kind, 'path': str(path)})
    output = root / 'output'; output.mkdir()
    request = {'schema': 'brainsnn.adapter.v1', 'inputs': rows, 'output_dir': str(output)}
    (splat_repair if engine == 'splat-repair' else localization_job).run(request)
    return {path.name: path.read_bytes() for path in output.iterdir() if path.is_file()}


def test_repair_acceptance_uses_real_core_and_rejects_changed_original(tmp_path, authored):
    inputs = authored['splat-repair']
    payloads = run_adapter(tmp_path, 'splat-repair', inputs)
    result = acceptance.validate_repair(inputs, payloads)
    assert result['actual_generated_fill'] is True and result['generated_vertices'] >= 30
    changed = {**payloads, 'original.ply': payloads['original.ply'] + b'changed'}
    with pytest.raises(ValueError, match='original bytes'):
        acceptance.validate_repair(inputs, changed)
    bad = json.loads(payloads['repair-receipt.json']); bad['metric_verified'] = True
    with pytest.raises(ValueError, match='qualification'):
        acceptance.validate_repair(inputs, {**payloads, 'repair-receipt.json': acceptance.encode(bad)})


def test_map_acceptance_checks_actual_coordinates_bytes_units_and_source(tmp_path, authored):
    inputs = authored['localization-map']
    payloads = run_adapter(tmp_path, 'localization-map', inputs)
    assert acceptance.validate_map(inputs, payloads)['points'] == 208
    changed = {**payloads, 'localization-map.pcd': payloads['localization-map.pcd'][:-1] + b'x'}
    with pytest.raises(ValueError, match='binding'):
        acceptance.validate_map(inputs, changed)
    bad = json.loads(payloads['localization-map.json']); bad['units'] = 'cm'
    with pytest.raises(ValueError, match='metre'):
        acceptance.validate_map(inputs, {**payloads, 'localization-map.json': acceptance.encode(bad)})


def test_motion_validator_rejects_a_substituted_original_before_runtime_access(authored, tmp_path):
    inputs = authored['motion-retarget']
    with pytest.raises(ValueError, match='source'):
        acceptance.validate_motion(inputs, {'original-motion.bvh': b'not the source'}, tmp_path / 'unread-runtime')


def test_failure_cleanup_can_only_cancel_a_job_created_by_this_client():
    client = acceptance.LocalClient('fixture-token', duration=1)
    calls = []
    def request(path, **kwargs):
        calls.append((path, kwargs))
        return {'status': 'cancelled' if kwargs.get('method') == 'DELETE' else 'running'}
    client.json = request
    own = 'a' * 32; other = 'b' * 32
    client.jobs = [{'engine': 'splat-repair', 'id': own}]
    client.active_job = other
    with pytest.raises(ValueError, match='unrelated'):
        client.cancel_own_active()
    assert calls == []
    client.active_job = own; client.deadline = 0
    assert client.cancel_own_active() == 'requested'
    assert len(calls) == 2 and all(path == '/v1/jobs/' + own and kwargs['cleanup'] for path, kwargs in calls)
    calls.clear(); client.json = lambda *_args, **_kwargs: {'status': 'complete'}
    assert client.cancel_own_active() == 'already-terminal' and not calls


def test_artifact_transport_rejects_redirect_paths_and_changed_bytes():
    client = acceptance.LocalClient('fixture-token')
    job = {'id': 'a' * 32, 'artifacts': [{'name': 'receipt.json', 'size': 2, 'sha256': acceptance.sha(b'{}')}]}
    client.json = lambda *_args, **_kwargs: {'url': 'https://outside.example/steal'}
    with pytest.raises(ValueError, match='download path'):
        client.artifacts(job)
    client.json = lambda *_args, **_kwargs: {'url': '/v1/download/abc.' + '1' * 64}
    client.call = lambda *_args, **_kwargs: io.BytesIO(b'[]')
    with pytest.raises(ValueError, match='hash/size'):
        client.artifacts(job)
    client.call = lambda *_args, **_kwargs: io.BytesIO(b'{}')
    records, payloads = client.artifacts(job)
    assert records[0]['sha256'] == acceptance.sha(b'{}') and payloads == {'receipt.json': b'{}'}


def test_local_client_never_follows_a_redirect_or_uses_a_remote_host():
    with pytest.raises(ValueError, match='redirect'):
        acceptance.NoRedirect().redirect_request(None, None, None, None, None, None)
    for port in (0, 65536, True, '8080'):
        with pytest.raises(ValueError, match='port'):
            acceptance.LocalClient('fixture-token', port=port)
    assert acceptance.LocalClient('fixture-token').base == 'http://127.0.0.1:8080'


def test_no_startup_hook_invokes_manual_acceptance():
    script = ROOT / 'robotics/world_worker/deploy/railway/start.sh'
    assert 'layers_acceptance' not in script.read_text()
