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
    assert engines == ['colmap-sparse', 'locate-photo', 'photo-metric', 'scene-usd', 'omniverse-pack', 'demo-replay', 'asbuilt-update', 'asbuilt-evidence',
                       'splat-repair', 'localization-map', 'motion-retarget', 'biomechanics']
    value = registry({'WORLD_WORKER_SITE_OWNER_TOKEN': OWNER, 'WORLD_WORKER_SITE_VISITOR_TOKEN': VISITOR}, 9 * 1024 ** 3, engines)
    raw = json.dumps(value)
    assert OWNER not in raw and VISITOR not in raw
    assert [t['id'] for t in value['tenants']] == ['site-owner', 'site-visitors']
    assert value['tenants'][0]['engines'] == engines
    assert value['tenants'][1]['engines'] == ['colmap-sparse', 'photo-metric', 'scene-usd']
    assert value['tenants'][0]['token_sha256'] == hashlib.sha256(OWNER.encode()).hexdigest()
    path = tmp_path / 'tenants.json'; path.write_text(raw)
    identities = Identities('w' * 43, str(path), engines, 9 * 1024 ** 3)
    owner = identities.authenticate('Bearer ' + OWNER)
    assert owner.owner_id == 'site-owner' and owner.limits['upload_bytes'] == 4 * 1024 ** 3 and owner.limits['active_jobs'] == 1
    assert identities.authenticate('Bearer ' + VISITOR).owner_id == 'site-visitors'
    assert {'splat-repair', 'localization-map', 'motion-retarget', 'biomechanics'} <= set(owner.engines)
    assert not {'splat-repair', 'localization-map', 'motion-retarget', 'biomechanics'} & set(identities.authenticate('Bearer ' + VISITOR).engines)


def test_processing_layers_keep_their_actual_bounded_runtimes_and_input_contracts():
    profile = {row['id']: row for row in json.loads(ADAPTERS.read_text())}
    expected = {
        'splat-repair': (['splat', 'repair'], '/opt/worker/bin/python', 'splat_repair.py', 180),
        'localization-map': (['survey', 'localization'], '/opt/worker/bin/python', 'localization_job.py', 180),
        'motion-retarget': (['motion', 'retarget'], '/opt/soma/venv/bin/python', 'motion_retarget.py', 900),
        'biomechanics': (['biomech-model', 'biomech-motion', 'biomech-options', 'biomech-loads'],
                         '/opt/biomechanics/venv/bin/python', 'biomechanics.py', 900),
    }
    for name, (kinds, interpreter, script, timeout) in expected.items():
        entry = profile[name]
        assert entry['enabled'] is True and entry['license_reviewed'] is True
        assert entry['input_kinds'] == kinds and entry['max_inputs'] == len(kinds)
        assert entry['timeout_seconds'] == timeout
        assert entry['command'] == [interpreter, '/app/robotics/world_worker/' + script,
                                    '--input-manifest', '{input_manifest}']
    assert profile['localization-map']['source_job'] is True


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


def test_hosted_metric_scale_photo_preview_and_model_pins_match_worker_image():
    """Prevent deployment-branch drift: both model engines, exact checked checkpoint, and worker-only Railway boot."""
    from robotics.world_worker import metric_scale

    adapter_by_id = {entry['id']: entry for entry in json.loads(ADAPTERS.read_text())}
    model_file = '/opt/brainsnn-models/moge-2-vitb-normal.onnx'
    colmap = adapter_by_id['colmap-sparse']
    photo = adapter_by_id['photo-metric']
    assert colmap['enabled'] and colmap['license_reviewed']
    assert photo['enabled'] and photo['license_reviewed']
    assert colmap['command'][-2:] == ['--scale-model', model_file]
    assert photo['command'][-2:] == ['--model', model_file]
    assert photo['input_kinds'] == ['image'] and photo['max_inputs'] == 1
    assert photo['timeout_seconds'] == 300

    docker = (ROOT / 'robotics/world_worker/deploy/railway/Dockerfile').read_text()
    dense = (ROOT / 'robotics/world_worker/requirements-dense.txt').read_text()
    assert metric_scale.MODEL['revision'] in docker
    assert metric_scale.MODEL['sha256'] in docker
    assert 'requirements-dense.txt' in docker
    assert '-r requirements-colmap.txt' in dense
    assert 'onnxruntime==' in dense
    assert 'photo_metric.py' in photo['command'][1]
    assert 'sparse_colmap.py' in colmap['command'][1]

    # Deployment-only branch, do not replace with website main's root railway.toml.
    railway = (ROOT / 'railway.toml').read_text()
    assert 'robotics/world_worker/deploy/railway/Dockerfile' in railway
    assert 'startCommand = "/bin/sh /app/robotics/world_worker/deploy/railway/launch.sh"' in railway
    launcher = (ROOT / 'robotics/world_worker/deploy/railway/launch.sh').read_text()
    assert 'robotics/world_worker/deploy/railway/start.sh' in launcher
    assert 'G1_DEPLOYMENT_CHECK' in launcher
    assert 'brainsnn-r3f-app/railway.toml' not in railway


def test_asbuilt_deployment_fixture_uses_the_actual_verified_ifc_writer(tmp_path):
    sys.path.insert(0,str(ROOT/'tests/world'))
    from asbuilt_capture_fixture import make_capture
    from robotics.world_worker.deploy.railway.asbuilt_acceptance import prior_review
    from robotics.scene_compiler.asbuilt_update import update_ifc
    case=make_capture(tmp_path/'capture');raw=(case['sceneRoot']/'output/scene.json').read_bytes()
    prior,review,_component=prior_review(json.loads(raw),hashlib.sha256(raw).hexdigest())
    output,report=update_ifc(prior,raw,review)
    assert output!=prior and report['updatedCount']==1
    assert report['metricVerified'] is report['physicalRobotValidated'] is False


@pytest.mark.parametrize('preflight_failure',[False,True])
def test_versioned_launcher_runs_the_primary_check_and_preserves_foreground_exec(tmp_path,preflight_failure):
    import os,subprocess
    root=tmp_path/'app';scripts=root/'robotics/world_worker/deploy/railway';scripts.mkdir(parents=True)
    events=tmp_path/'events';python=tmp_path/'python'
    python.write_text('''#!/bin/sh
if [ "$1" = "-B" ]; then
  cat >/dev/null
  printf '%s\\n' preflight >> "$EVENTS"
  if [ "${FAIL_PREFLIGHT:-0}" = "1" ]; then exit 93; fi
else
  case "$1" in
    *asbuilt_acceptance.py) printf '%s\\n' asbuilt >> "$EVENTS" ;;
    *acceptance.py) printf '%s\\n' legacy >> "$EVENTS"; touch "$DONE" ;;
    *) exit 94 ;;
  esac
fi
''');python.chmod(0o700)
    start=scripts/'start.sh';start.write_text('''#!/bin/sh
printf '%s\\n' foreground-worker >> "$EVENTS"
i=0
while [ ! -f "$DONE" ] && [ "$i" -lt 100 ]; do i=$((i+1)); sleep .01; done
test -f "$DONE"
''');start.chmod(0o700)
    source=(ROOT/'robotics/world_worker/deploy/railway/launch.sh').read_text()
    # Only filesystem roots differ; execute the reviewed shell/control flow.
    source=source.replace('/app',str(root)).replace('/opt/worker/bin/python',str(python))
    launcher=tmp_path/'launch.sh';launcher.write_text(source)
    env={**os.environ,'EVENTS':str(events),'DONE':str(tmp_path/'done'),'WORLD_DEPLOY_SMOKE':'1','FAIL_PREFLIGHT':str(int(preflight_failure))}
    completed=subprocess.run(['/bin/sh',str(launcher)],env=env,capture_output=True,text=True,timeout=5)
    rows=events.read_text().splitlines()
    if preflight_failure:
        assert completed.returncode==93 and rows==['preflight']
    else:
        assert completed.returncode==0 and rows[0]=='preflight' and 'foreground-worker' in rows
        assert rows.index('asbuilt')<rows.index('legacy')
        assert 'ASBUILT_HOSTED_ACCEPTANCE_STARTING' in completed.stdout


def test_asbuilt_acceptance_reuses_same_deployment_success_without_another_job(tmp_path,monkeypatch):
    from robotics.world_worker.deploy.railway import asbuilt_acceptance as a
    commit='a'*40;deployment='12345678-1234-1234-1234-123456789abc';monkeypatch.setenv('RAILWAY_GIT_COMMIT_SHA',commit);monkeypatch.setenv('RAILWAY_DEPLOYMENT_ID',deployment)
    path=tmp_path/'acceptance.json';previous={'status':'passed','commitSha':commit,'deploymentId':deployment};path.write_text(json.dumps(previous))
    monkeypatch.setattr(a,'execute',lambda _client:pytest.fail('A verified commit must not run another job.'))
    assert a.run_acceptance(path)==previous


def test_new_deployment_with_the_same_commit_must_recheck_its_environment(tmp_path,monkeypatch):
    from robotics.world_worker.deploy.railway import asbuilt_acceptance as a
    commit='a'*40;monkeypatch.setenv('RAILWAY_GIT_COMMIT_SHA',commit);monkeypatch.setenv('RAILWAY_DEPLOYMENT_ID','12345678-1234-1234-1234-123456789abc')
    path=tmp_path/'acceptance.json';path.write_text(json.dumps({'status':'passed','commitSha':commit,'deploymentId':'87654321-1234-1234-1234-123456789abc'}))
    calls=[];monkeypatch.setattr(a,'execute',lambda _client:calls.append(True) or {'physicalAccuracyVerified':False})
    assert a.run_acceptance(path)['status']=='passed' and calls==[True]


def test_asbuilt_acceptance_failure_replaces_old_success_without_logging_credentials(tmp_path,monkeypatch,capsys):
    from robotics.world_worker.deploy.railway import asbuilt_acceptance as a
    monkeypatch.setenv('RAILWAY_GIT_COMMIT_SHA','b'*40)
    path=tmp_path/'acceptance.json';path.write_text(json.dumps({'status':'passed','commitSha':'a'*40}))
    secret='fixture-credential-and-signed-URL-never-log'
    def fail(_client):raise RuntimeError(secret)
    monkeypatch.setattr(a,'execute',fail)
    report=a.run_acceptance(path)
    assert report['status']=='failed' and report['errorType']=='RuntimeError'
    assert secret not in path.read_text()+capsys.readouterr().out
