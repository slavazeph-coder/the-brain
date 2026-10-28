"""Hosted acceptance must prove the selected package and replace stale receipts."""
from copy import deepcopy
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from robotics.world_worker.deploy.railway import acceptance as a


def fixture():
    options={'scene_sha256':'a'*64,'cloud_sha256':'b'*64,'placements':[{'id':'acceptance_pole',
             'asset':'IV_pole_a01','package_sha256':'c'*64,'translation_m':[2,0,2]}]}
    records=[{'name':'scene-omniverse.zip','sha256':'d'*64},{'name':'omniverse-receipt.json','sha256':'e'*64}]
    receipt={'schema':'brainsnn.omniverse-pack.v1','source_scene_sha256':'a'*64,'source_cloud_sha256':'b'*64,
             'archive_sha256':'d'*64,'units':'m','up_axis':'Y','usd_reopened':True,'source_exports_unchanged':True,
             'physics_executed':False,'metric_verified':False,'physics_ready':False,'policy_executed':False,
             'library_placements':[{'id':'acceptance_pole','translation_m':[2,0,2],'rotation_xyz_deg':[0,0,0],
                'asset':{'asset':'IV_pole_a01','package_sha256':'c'*64,'physics_tested':False}}]}
    return records,{'omniverse-receipt.json':receipt},options


def test_matching_package_receipt():
    a.validate_pack(*fixture())


@pytest.mark.parametrize('names',[[],['scene-omniverse.zip'],['omniverse-receipt.json']])
def test_missing_artifacts_never_pass(names):
    records,payloads,options=fixture()
    with pytest.raises(ValueError,match='artifacts'):
        a.validate_pack([r for r in records if r['name'] in names],payloads,options)


@pytest.mark.parametrize('field,value',[
    ('source_scene_sha256','f'*64),('source_cloud_sha256','f'*64),('archive_sha256','f'*64),
    ('physics_executed',True),('metric_verified',True),('physics_ready',True),('policy_executed',None),
    ('units','cm'),('up_axis','Z'),('usd_reopened',False),('source_exports_unchanged',False),
    ('library_placements',[]),
])
def test_mismatched_or_unqualified_receipt_fails(field,value):
    records,payloads,options=fixture();payloads['omniverse-receipt.json'][field]=value
    with pytest.raises(ValueError):a.validate_pack(records,payloads,options)


@pytest.mark.parametrize('field,value',[('id','other'),('translation_m',[999,0,0]),('rotation_xyz_deg',[0,90,0]),
                                      ('asset',{'asset':'other','package_sha256':'c'*64,'physics_tested':False}),
                                      ('asset',{'asset':'IV_pole_a01','package_sha256':'f'*64,'physics_tested':False})])
def test_wrong_placement_fails(field,value):
    records,payloads,options=fixture();payloads['omniverse-receipt.json']['library_placements'][0][field]=value
    with pytest.raises(ValueError,match='placement'):a.validate_pack(records,payloads,options)


def test_empty_completed_job_cannot_download_successfully():
    with pytest.raises(ValueError,match='artifacts'):a.Client().artifacts({'id':'empty','artifacts':[]})


def test_failure_replaces_stale_success_before_network(tmp_path,monkeypatch):
    path=tmp_path/'acceptance.json';path.write_text('{"status":"passed","run_id":"old"}')
    monkeypatch.setenv('RAILWAY_DEPLOYMENT_ID','11111111-2222-3333-4444-555555555555')
    monkeypatch.setenv('RAILWAY_GIT_COMMIT_SHA','a'*40)
    def fail(client):
        started=json.loads(path.read_text())
        assert started['status']=='started' and started['run_id']!='old'
        assert started['deployment_id']=='11111111-2222-3333-4444-555555555555'
        raise RuntimeError('sensitive signed URL and credential MUST NOT persist')
    with patch.object(a,'execute',side_effect=fail),pytest.raises(RuntimeError):a.run_acceptance(path)
    report=json.loads(path.read_text())
    assert report['status']=='failed' and report['error_type']=='RuntimeError'
    assert report['commit_sha']=='a'*40 and len(report['acceptance_script_sha256'])==64
    assert 'sensitive' not in path.read_text() and 'finished_at' in report
    assert list(tmp_path.iterdir())==[path]


def test_success_retains_run_identity_and_terminal_status(tmp_path):
    path=tmp_path/'acceptance.json'
    with patch.object(a,'execute',return_value={'all_download_hashes_verified':True}):report=a.run_acceptance(path)
    assert report['status']=='passed' and report['all_download_hashes_verified'] is True
    assert json.loads(path.read_text())==report


def test_whole_run_deadline_applies_to_artifact_stream():
    client=a.Client();client.deadline=0
    with pytest.raises(TimeoutError,match='deadline'):client.remaining()
