"""The Railway worker's start-up configuration: the tenant registry built from the site's credentials, and the storage
budget from WORLD_STORAGE_BYTES. python -m pytest tests/world/test_site_worker_deploy.py"""
from pathlib import Path
import hashlib
import json
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker' / 'deploy' / 'railway'))
from robotics.world_worker.app import create_app  # noqa: E402
from robotics.world_worker.auth import Identities  # noqa: E402
from tenants import derived_credential, enabled_engines, registry  # noqa: E402

OWNER, VISITOR = 'o' * 43, 'v' * 43
ADAPTERS = ROOT / 'robotics/world_worker/deploy/railway/adapters.json'


def test_the_registry_holds_hashes_only_and_the_worker_accepts_it(tmp_path):
    engines = enabled_engines(ADAPTERS)
    assert engines == ['colmap-sparse', 'scene-usd', 'omniverse-pack']
    value = registry({'WORLD_WORKER_SITE_OWNER_TOKEN': OWNER, 'WORLD_WORKER_SITE_VISITOR_TOKEN': VISITOR}, 9 * 1024 ** 3, engines)
    raw = json.dumps(value)
    assert OWNER not in raw and VISITOR not in raw
    assert [t['id'] for t in value['tenants']] == ['site-owner', 'site-visitors']
    assert value['tenants'][0]['token_sha256'] == hashlib.sha256(OWNER.encode()).hexdigest()
    path = tmp_path / 'tenants.json'; path.write_text(raw)
    identities = Identities('w' * 43, str(path), engines, 9 * 1024 ** 3)
    owner = identities.authenticate('Bearer ' + OWNER)
    assert owner.owner_id == 'site-owner' and owner.limits['upload_bytes'] == 4 * 1024 ** 3 and owner.limits['active_jobs'] == 1
    assert identities.authenticate('Bearer ' + VISITOR).owner_id == 'site-visitors'


def test_the_scene_engine_offers_what_the_site_needs_to_build_a_metric_scene():
    # app.mjs metricSceneCard() refuses to compile without both: the page would ask to update the worker.
    scene = next(e for e in json.loads(ADAPTERS.read_text()) if e['id'] == 'scene-usd')
    assert scene['dimension_checks'] is True and scene['bim_review'] is True and scene['source_job'] is True


def test_omniverse_pack_is_bounded_and_requires_an_existing_scene_source():
    entry = next(e for e in json.loads(ADAPTERS.read_text()) if e['id'] == 'omniverse-pack')
    assert entry['enabled'] is True and entry['license_reviewed'] is True
    assert entry['input_kinds'] == ['cloud'] and entry['max_inputs'] == 1
    assert entry['source_job'] is True and entry['timeout_seconds'] == 600
    assert entry['command'] == ['/opt/worker/bin/python', '/app/robotics/world_worker/omniverse_pack.py',
                                '--input-manifest', '{input_manifest}', '--workspace', '/opt/brainsnn-simready']


def test_visitors_together_leave_the_owner_room_inside_the_workers_global_caps():
    from robotics.world_worker.app import UPLOADS_BYTES, VIDEO_BYTES
    value = registry({'WORLD_SITE_PASSCODE': 'garage-walk-2026'}, 18 * 1024 ** 3, ['colmap-sparse'])
    owner, visitors = (t['limits'] for t in value['tenants'])
    assert visitors['upload_count'] + owner['upload_count'] <= 50, 'the worker admits 50 uploads in all'
    assert UPLOADS_BYTES - visitors['upload_bytes'] >= VIDEO_BYTES, 'the owner can still reserve a full-size video'
    assert visitors['storage_bytes'] <= owner['storage_bytes'] // 2


def test_every_tenant_can_hold_one_job_or_the_worker_does_not_start():
    from tenants import ONE_JOB
    small = registry({'WORLD_SITE_PASSCODE': 'garage-walk-2026'}, 7_000_000_000, ['colmap-sparse'])
    assert all(t['limits']['storage_bytes'] >= ONE_JOB for t in small['tenants']), 'a visitor job fits on an 8 GB volume'
    with pytest.raises(ValueError, match='at least'):
        registry({'WORLD_SITE_PASSCODE': 'garage-walk-2026'}, 4_500_000_000, ['colmap-sparse'])


def test_the_passcode_alone_gives_the_worker_the_sites_credentials():
    # Pinned against the site's derivedCredential() (brainsnn-r3f-app/src/server/worldWorkerProxy.test.js pins the same).
    assert derived_credential('garage-walk-2026', 'site-owner') == 'YKSyflk5DI5jVbtSo_hHapM4BbBylsGbT7ZZXYarmjM'
    assert derived_credential('garage-walk-2026', 'site-visitors') == '81ToJqJYH2C-yj2NZH2SCRF2-sGYrKniyrVDLFwbzhU'
    value = registry({'WORLD_SITE_PASSCODE': 'garage-walk-2026'}, 9 * 1024 ** 3, ['colmap-sparse'])
    assert [t['token_sha256'] for t in value['tenants']] == [
        hashlib.sha256(b'YKSyflk5DI5jVbtSo_hHapM4BbBylsGbT7ZZXYarmjM').hexdigest(),
        hashlib.sha256(b'81ToJqJYH2C-yj2NZH2SCRF2-sGYrKniyrVDLFwbzhU').hexdigest()]
    assert 'garage-walk-2026' not in json.dumps(value)
    with pytest.raises(ValueError, match='WORLD_SITE_PASSCODE'):
        registry({'WORLD_SITE_PASSCODE': 'too-short'}, 9 * 1024 ** 3, ['colmap-sparse'])


def test_the_registry_refuses_a_missing_or_shared_credential():
    with pytest.raises(ValueError, match='OWNER_TOKEN'):
        registry({}, 9 * 1024 ** 3, ['colmap-sparse'])
    with pytest.raises(ValueError, match='its own'):
        registry({'WORLD_WORKER_SITE_OWNER_TOKEN': OWNER, 'WORLD_WORKER_SITE_VISITOR_TOKEN': OWNER}, 9 * 1024 ** 3, ['colmap-sparse'])
    assert len(registry({'WORLD_WORKER_SITE_OWNER_TOKEN': OWNER}, 9 * 1024 ** 3, ['colmap-sparse'])['tenants']) == 1


def test_storage_budget_follows_the_volume(tmp_path, monkeypatch):
    monkeypatch.setenv('WORLD_STORAGE_BYTES', str(9 * 1024 ** 3))
    with TestClient(create_app(root=tmp_path, token='w' * 43)) as client:
        limits = client.get('/v1/capabilities', headers={'Authorization': 'Bearer ' + 'w' * 43}).json()['limits']
    assert limits['storage_bytes'] == 9 * 1024 ** 3
    monkeypatch.setenv('WORLD_STORAGE_BYTES', str(1024 ** 3))  # smaller than one job's 4 GiB budget
    with pytest.raises(ValueError, match='Storage capacity'):
        create_app(root=tmp_path / 'small', token='w' * 43)
