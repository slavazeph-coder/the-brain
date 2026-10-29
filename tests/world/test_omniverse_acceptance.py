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


def building_fixture(tmp_path):
    """Real PNG/CSV/IFC writers; authored scene, no Blender or physical capture."""
    import hashlib
    from robotics.world_worker import building_handoff
    from robotics.scene_compiler.component_graph import attach_component_ids
    from robotics.scene_compiler.ifc_export import emit_ifc
    from robotics.world_worker.measurement_check import points_sha256
    from tests.world.test_building_handoff import scene as authored_scene
    cloud=a.synthetic_room();scene=authored_scene();scene['scale']=cloud['scale']
    scene['cloudPointsSha256']=points_sha256(cloud)
    scene=attach_component_ids(scene,scene['cloudPointsSha256'])
    emit_ifc(tmp_path,scene)
    (tmp_path/'scene.json').write_text(json.dumps(scene))
    (tmp_path/'arena-cloud.json').write_text(json.dumps(cloud))
    building_handoff.write_building_handoff(scene,tmp_path,scene_path=tmp_path/'scene.json')
    names=['scene.json','arena-cloud.json','scene.ifc',*a.BUILDING_FILES]
    raw={name:(tmp_path/name).read_bytes() for name in names}
    records=[{'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'hash_verified':True}
             for name,data in raw.items()]
    payloads={name:json.loads(data) if name in a.EVIDENCE_JSON else data for name,data in raw.items() if name!='scene.ifc'}
    return records,payloads,cloud,raw


def test_real_building_files_reopen_and_bind_to_the_request(tmp_path):
    records,payloads,cloud,_=building_fixture(tmp_path)
    result=a.validate_building(records,payloads,cloud)
    assert result=={'building_handoff_verified':True,'building_schedule_rows':5,
                   'building_wall_count':2,'building_component_revision':0}


@pytest.mark.parametrize('name',['scene.json','arena-cloud.json','scene.ifc',*a.BUILDING_FILES])
def test_missing_required_building_file_fails(tmp_path,name):
    records,payloads,cloud,_=building_fixture(tmp_path)
    with pytest.raises(ValueError,match='Required building artifacts'):
        a.validate_building([row for row in records if row['name']!=name],payloads,cloud)


@pytest.mark.parametrize('mutation',[
    'source_hash','companion_hash','ifc_hash','revision','scale','cloud','unverified_download','graph_source','scene_cloud',
    'png','png_size','csv','csv_revision','csv_count','wall_count','ruler','instructions','qualification',
])
def test_corrupt_or_unbound_building_evidence_fails(tmp_path,mutation):
    import io
    from PIL import Image
    records,payloads,cloud,_=building_fixture(tmp_path);h=payloads['building-handoff.json']
    if mutation=='source_hash':h['sourceFiles']['scene']['sha256']='f'*64
    elif mutation=='companion_hash':h['files']['building-schedule.csv']['sha256']='f'*64
    elif mutation=='ifc_hash':h['destinations']['revit']['existingIfc']['sha256']='f'*64
    elif mutation=='revision':h['componentRevision']=9
    elif mutation=='scale':h['scale']['metresPerUnit']=2
    elif mutation=='cloud':payloads['arena-cloud.json']['points'][0][0]=99
    elif mutation=='graph_source':payloads['scene.json']['componentGraph']['sourceSha256']='f'*64
    elif mutation=='scene_cloud':payloads['scene.json']['cloudPointsSha256']='f'*64
    elif mutation=='unverified_download':records[0]['hash_verified']=False
    elif mutation=='png':payloads['xactimate-underlay.png']=b'not a PNG'
    elif mutation=='png_size':
        out=io.BytesIO();Image.new('RGB',(1,1)).save(out,format='PNG');payloads['xactimate-underlay.png']=out.getvalue()
    elif mutation=='csv':payloads['building-schedule.csv']=b'not,a,schedule\n'
    elif mutation=='csv_revision':
        text=payloads['building-schedule.csv'].decode();payloads['building-schedule.csv']=text.replace(',0\r\n',',99\r\n').encode()
    elif mutation=='csv_count':h['scheduleRows']+=1
    elif mutation=='wall_count':h['walls'].pop()
    elif mutation=='ruler':h['calibration']['lengthMetres']*=2
    elif mutation=='instructions':payloads['BUILDING-IMPORT.txt']=b'placeholder'
    elif mutation=='qualification':h['readiness']['xactimateApplicationValidated']=True
    with pytest.raises(ValueError):a.validate_building(records,payloads,cloud)


def test_artifact_transport_retains_bounded_building_content(tmp_path,monkeypatch):
    import io
    records,_,cloud,raw=building_fixture(tmp_path)
    client=a.Client()
    monkeypatch.setattr(client,'json',lambda path,body:{'url':'/api/world/worker/v1/download/'+str(body['artifact'])})
    monkeypatch.setattr(client,'call',lambda path:io.BytesIO(raw[records[int(path.rsplit('/',1)[-1])]['name']]))
    job={'id':'fixture','artifacts':[dict(row,size=row['bytes']) for row in records]}
    downloaded,payloads=client.artifacts(job)
    assert isinstance(payloads['xactimate-underlay.png'],bytes)
    assert a.validate_building(downloaded,payloads,cloud)['building_handoff_verified'] is True
    job['artifacts'][3]['sha256']='f'*64
    with pytest.raises(ValueError,match='Artifact hash mismatch'):client.artifacts(job)


def test_execute_rejects_missing_building_output_before_pack(tmp_path,monkeypatch):
    records,payloads,cloud,_=building_fixture(tmp_path)
    monkeypatch.setenv('WORLD_SITE_PASSCODE','synthetic-fixture-passcode')
    monkeypatch.setattr(a,'synthetic_room',lambda:cloud)
    class FixtureClient:
        def __init__(self):self.engines=[]
        def json(self,path,**kwargs):
            return {'token':'fixture'} if path.endswith('/session') else {'engines':[{'id':'omniverse-pack','available':True}],
                'simready_assets':[{'available':True,'asset':'fixture','package_sha256':'c'*64}]}
        def run(self,engine,*args):self.engines.append(engine);return {'id':'scene'}
        def artifacts(self,job):return [row for row in records if row['name']!='xactimate-underlay.png'],payloads
    client=FixtureClient()
    with pytest.raises(ValueError,match='Required building artifacts'):a.execute(client)
    assert client.engines==['scene-usd']
