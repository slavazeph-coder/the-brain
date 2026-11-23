"""Registered scans enter the existing worker without impersonating camera reconstructions."""
import json
import hashlib
import importlib.util
from pathlib import Path
import shutil
import sys
import time

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker.geometry import load_arena_cloud
from robotics.world_worker.scene_usd import handoff_input
from robotics.world_worker.app import create_app

TOKEN = 'test-bim-workbench-token-' + 'x' * 40
HEADERS = {'Authorization': 'Bearer ' + TOKEN}


def scan(**overrides):
    return {'version': 1, 'kind': 'survey-scan-point-cloud', 'units': 'm', 'coordinateFrame': 'right-handed-y-up',
            'sourceFrame': 'survey-scan', 'source': 'Authored scan test fixture',
            'points': [[0, 0, 0, 120, 120, 120], [2, 0, 2, 120, 120, 120], [2, 2, 0, 120, 120, 120]],
            'scale': {'source': 'scan-file', 'metresPerUnit': 1, 'distance': None, 'spanUnits': None,
                      'selfReported': True, 'verified': False}, 'provenance': {'metricVerified': False, 'voxelMetres': .02}, **overrides}


def write(path, value):
    path.write_text(json.dumps(value))
    return path


def config(path, **overrides):
    return write(path, [{'id': 'scene-usd', 'label': 'Test scene adapter', 'enabled': True, 'license_reviewed': True,
                         'input_kinds': ['cloud'], 'max_inputs': 1, 'dimension_checks': True, 'bim_review': True,
                         'command': [sys.executable, '-c', 'pass'], **overrides}])


def test_scan_handoff_keeps_its_actual_kind_declared_units_and_provenance(tmp_path):
    path = write(tmp_path / 'arena-cloud.json', scan(multiView=True))
    validated = load_arena_cloud(path)
    assert validated['kind'] == 'survey-scan-point-cloud' and validated['sourceFrame'] == 'survey-scan'
    assert validated['scale']['source'] == 'scan-file' and validated['scale']['verified'] is False
    assert validated['provenance']['voxelMetres'] == .02 and 'multiView' not in validated
    cloud, evidence = handoff_input({'schema': 'brainsnn.adapter.v1', 'inputs': [{'kind': 'cloud', 'path': str(path), 'name': path.name}]})
    assert cloud['sourceFrame'] == 'survey-scan' and len(evidence['sha256']) == 64


@pytest.mark.parametrize('override', [
    {'kind': 'colmap-sparse-point-cloud'}, {'sourceFrame': 'colmap'}, {'units': 'arbitrary'},
    {'scale': {'source': 'user-measured', 'metresPerUnit': 1, 'selfReported': True, 'verified': False}},
    {'scale': {'source': 'scan-file', 'metresPerUnit': 1, 'selfReported': True, 'verified': True}},
    {'scale': {'source': 'scan-file', 'metresPerUnit': True, 'selfReported': True, 'verified': False}},
    {'scale': {'source': 'scan-file', 'metresPerUnit': 1, 'selfReported': True, 'verified': False, 'distance': 2}},
    {'points': [[0, 0, float('inf'), 0, 0, 0]]},
])
def test_scan_and_reconstruction_contracts_cannot_be_mixed(tmp_path, override):
    with pytest.raises(ValueError):
        load_arena_cloud(write(tmp_path / 'bad.json', scan(**override)))


def test_single_view_reconstruction_still_cannot_use_the_scan_path(tmp_path):
    value = scan(kind='colmap-sparse-point-cloud', sourceFrame='right-handed-y-up')
    value['scale']['source'] = 'user-measured'
    path = write(tmp_path / 'single.json', value)
    with pytest.raises(ValueError, match='multi-view'):
        handoff_input({'schema': 'brainsnn.adapter.v1', 'inputs': [{'kind': 'cloud', 'path': str(path)}]})


def test_registered_scan_upload_and_prepared_job_use_existing_worker_contract(tmp_path):
    adapter = config(tmp_path / 'adapters.json', registered_survey_cloud=True)
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(adapter))) as client:
        engines = {e['id']: e for e in client.get('/v1/capabilities', headers=HEADERS).json()['engines']}
        assert engines['scene-usd']['registered_survey_cloud'] is True
        assert 'registered_survey_cloud' not in engines['inspect']
        raw = json.dumps(scan()).encode()
        result = client.post('/v1/uploads', headers=HEADERS, json={'name': 'arena-cloud.json', 'kind': 'cloud', 'size': len(raw)})
        assert result.status_code == 201, result.text
        uid = result.json()['id']
        result = client.put(f'/v1/uploads/{uid}?offset=0', headers=HEADERS, content=raw)
        assert result.status_code == 200, result.text
        result = client.post('/v1/jobs', headers=HEADERS, json={'engine': 'scene-usd', 'upload_ids': [uid], 'consent': True})
        assert result.status_code == 201, result.text
        assert result.json()['status'] == 'prepared' and result.json()['upload_ids'] == [uid]
        assert client.delete('/v1/jobs/' + result.json()['id'], headers=HEADERS).json()['status'] == 'cancelled'


def test_survey_capability_requires_an_explicit_boolean_flag(tmp_path):
    adapter = config(tmp_path / 'adapters.json')
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(adapter))) as client:
        assert all('registered_survey_cloud' not in e for e in client.get('/v1/capabilities', headers=HEADERS).json()['engines'])
    for bad in ('true', 1, None, []):
        config(adapter, registered_survey_cloud=bad)
        with pytest.raises(ValueError, match='registered_survey_cloud'):
            create_app(root=tmp_path / 'bad', token=TOKEN, adapters=str(adapter))


@pytest.mark.skipif(not shutil.which('blender'), reason='The actual Blender executable is optional in lightweight CI.')
def test_actual_scene_adapter_publishes_ifc_from_an_authored_registered_scan(tmp_path):
    """No compiler stand-in: authenticated upload, subprocess, IFC and hashed download on an authored room."""
    points = [[i * .125, 0, j * .125, 150, 150, 150] for i in range(41) for j in range(33)]
    for k in range(25):
        points += [[x, k * .125, j * .125, 200, 200, 200] for j in range(33) for x in (0, 5)]
        points += [[i * .125, k * .125, z, 200, 200, 200] for i in range(41) for z in (0, 4)]
    raw = json.dumps(scan(points=points, provenance={'voxelMetres': .125, 'metricVerified': False})).encode()
    adapter = config(tmp_path / 'adapters.json', registered_survey_cloud=True, timeout_seconds=120,
                     command=[sys.executable, str(ROOT / 'robotics/world_worker/scene_usd.py'), '--input-manifest', '{input_manifest}',
                              '--blender', shutil.which('blender')])
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(adapter))) as client:
        uploaded = client.post('/v1/uploads', headers=HEADERS, json={'name': 'arena-cloud.json', 'kind': 'cloud', 'size': len(raw)})
        assert uploaded.status_code == 201, uploaded.text
        uid = uploaded.json()['id']
        assert client.put(f'/v1/uploads/{uid}?offset=0', headers=HEADERS, content=raw).status_code == 200
        created = client.post('/v1/jobs', headers=HEADERS, json={'engine': 'scene-usd', 'upload_ids': [uid], 'consent': True})
        assert created.status_code == 201, created.text
        jid = created.json()['id']
        assert client.post(f'/v1/jobs/{jid}/start', headers=HEADERS, json={}).status_code == 200
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            job = client.get(f'/v1/jobs/{jid}', headers=HEADERS).json()
            if job['status'] in ('complete', 'failed', 'cancelled'):
                break
            time.sleep(.1)
        assert job['status'] == 'complete', job
        names = {a['name'] for a in job['artifacts']}
        assert {'scene.glb', 'scene.ifc', 'scene.json', 'scene-measurements.json', 'component-graph.json'} <= names
        if importlib.util.find_spec('ezdxf'):
            assert 'scene-plan.dxf' in names
        assert not any(name.endswith('.rvt') for name in names)
        for index, artifact in enumerate(job['artifacts']):
            if artifact['name'] not in ('scene.ifc', 'scene-plan.dxf'):
                continue
            ticket = client.post(f'/v1/jobs/{jid}/ticket', headers=HEADERS, json={'artifact': index}).json()['url']
            result = client.get(ticket)
            assert result.status_code == 200 and hashlib.sha256(result.content).hexdigest() == artifact['sha256']
        output = tmp_path / 'data' / 'jobs' / jid / 'output'
        assert json.loads((output / 'arena-cloud.json').read_text())['sourceFrame'] == 'survey-scan'
        scene = json.loads((output / 'scene.json').read_text())
        assert scene['units'] == 'm' and scene['scale']['source'] == 'scan-file' and scene['scale']['verified'] is False
        if importlib.util.find_spec('ifcopenshell'):
            import ifcopenshell
            model = ifcopenshell.open(str(output / 'scene.ifc'))
            assert model.schema == 'IFC4' and len(model.by_type('IfcWall')) == 4
