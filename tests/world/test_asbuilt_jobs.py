"""Real private worker adapter and HTTP, authored fits/rasters, no learned model."""
import json
from pathlib import Path
import sys
import time
import pytest
from fastapi.testclient import TestClient
from asbuilt_capture_fixture import make_capture,dump
from robotics.world_worker import asbuilt_jobs as aj
from robotics.world_worker.app import create_app

ROOT=Path(__file__).resolve().parents[2]
TOKEN='private-asbuilt-fixture-'+'x'*43
HEADERS={'Authorization':'Bearer '+TOKEN}

@pytest.fixture
def capture_case(tmp_path):return make_capture(tmp_path)

def request(case,tmp_path,operation='update'):
    out=tmp_path/'out';out.mkdir()
    inputs=[{'path':str(tmp_path/'review.json'),'kind':'asbuilt'}]
    if operation=='update':inputs.append({'path':str(case['prior']),'kind':'ifc'})
    else:dump(tmp_path/'review.json',{'schema':aj.EVIDENCE_SCHEMA,'sceneSha256':aj.sha((case['sceneRoot']/'output/scene.json').read_bytes()),'componentId':case['componentId'],'reviewed':True})
    return {'schema':'brainsnn.adapter.v1','inputs':inputs,'output_dir':str(out),'source':{'job':'a'*32,'path':str(case['sceneRoot']),'reconstruction':{'job':'b'*32,'path':str(case['reconstructionRoot'])}}}

def test_real_adapter_preserves_input_bytes_and_writes_verified_ifc_bundle(capture_case,tmp_path):
    r=request(capture_case,tmp_path);before={p:p.read_bytes() for p in [capture_case['prior'],capture_case['sceneRoot']/'output/scene.json']}
    receipt=aj.run(r,'update');out=Path(r['output_dir'])
    assert all(p.read_bytes()==data for p,data in before.items())
    assert (out/'prior.ifc').read_bytes()==capture_case['prior'].read_bytes()
    assert receipt['outputIfcSha256']==aj.sha((out/'updated.ifc').read_bytes())
    assert json.loads((out/'asbuilt-update-report.json').read_text())['updatedCount']==1
    assert receipt['metricVerified'] is receipt['physicalRobotValidated'] is False
    with pytest.raises(ValueError,match='fresh'):aj.run(r,'update')

def test_real_component_frame_projection_and_raster_hashes_are_retained(capture_case,tmp_path):
    r=request(capture_case,tmp_path,'evidence');result=aj.run(r,'evidence')
    assert result['status']=='available',result
    assert 1<=len(result['frames'])<=2
    for f in result['frames']:
        assert aj.sha((Path(r['output_dir'])/f['previewName']).read_bytes())==f['previewSha256']
        assert all(0<=v<=1 for v in f['normalizedPointBounds'])
        assert f['originalImageSha256'] in {aj.sha(p.read_bytes()) for p in (capture_case['reconstructionRoot']/'frames').glob('*.png')}
    assert result['metricVerified'] is result['physicalRobotValidated'] is False
    assert str(tmp_path) not in json.dumps(result)

@pytest.mark.parametrize('field',['scene','cloud','raster','ledger'])
def test_changed_sources_never_publish_substitute_photos(capture_case,tmp_path,field):
    r=request(capture_case,tmp_path,'evidence');c=capture_case
    if field=='scene':p=c['sceneRoot']/'output/scene.json'
    elif field=='cloud':p=c['sceneRoot']/'output/arena-cloud.json'
    elif field=='ledger':p=c['reconstructionRoot']/'output/camera-frames.json'
    else:p=next((c['reconstructionRoot']/'frames').glob('*.png'))
    p.write_bytes(p.read_bytes()+b'changed')
    try:result=aj.run(r,'evidence')
    except (ValueError,KeyError):assert not (Path(r['output_dir'])/'manifest.json').exists()
    else:assert result['status']=='unavailable' and not result['frames']

def test_missing_camera_ancestry_returns_explicit_unavailable_evidence(capture_case,tmp_path):
    r=request(capture_case,tmp_path,'evidence');r['source']['reconstruction']={'missing':True}
    result=aj.run(r,'evidence');assert result['status']=='unavailable' and result['frames']==[]

@pytest.mark.parametrize('change',[lambda r:r['source'].update(job='../private'),lambda r:r.update(inputs=[]),lambda r:r['source'].update(missing=True)])
def test_bad_source_or_inputs_fail_before_publication(capture_case,tmp_path,change):
    r=request(capture_case,tmp_path);change(r)
    with pytest.raises(ValueError):aj.run(r,'update')
    assert not (Path(r['output_dir'])/'manifest.json').exists()

def adapters(path):
    rows=[]
    for operation in ('update','evidence'):
        rows.append({'id':'asbuilt-'+operation,'enabled':True,'license_reviewed':True,'input_kinds':['ifc','asbuilt'] if operation=='update' else ['asbuilt'],'max_inputs':2 if operation=='update' else 1,'source_job':True,'timeout_seconds':30,'command':[sys.executable,str(ROOT/'robotics/world_worker/asbuilt_jobs.py'),'--operation',operation,'--input-manifest','{input_manifest}']})
    dump(path,rows)

def seed(app,case,owner='operator'):
    store=app.state.store;sid='a'*32;rid='b'*32
    import shutil
    for key,folder,engine,parent in [(sid,case['sceneRoot'],'scene-usd',rid),(rid,case['reconstructionRoot'],'colmap-sparse',None)]:
        shutil.copytree(folder,store.root/'jobs'/key)
        store.db.execute('INSERT INTO jobs(id,engine,status,uploads,created,error,artifacts,owner_id,source_job) VALUES(?,?,?,?,?,?,?,?,?)',(key,engine,'complete','[]',time.time(),None,'[]',owner,parent))
    store.db.commit();return sid

def upload(client,data,kind,name,headers=HEADERS):
    r=client.post('/v1/uploads',headers=headers,json={'name':name,'kind':kind,'size':len(data)});assert r.status_code==201,r.text
    uid=r.json()['id'];r=client.put(f'/v1/uploads/{uid}?offset=0',headers=headers,content=data);assert r.status_code==200,r.text
    return uid

def test_actual_http_ifc_job_and_signed_integrity_download(capture_case,tmp_path):
    config=tmp_path/'adapters.json';adapters(config);app=create_app(root=tmp_path/'worker',token=TOKEN,adapters=str(config))
    with TestClient(app) as client:
        sid=seed(app,capture_case)
        assert client.post('/v1/uploads',headers=HEADERS,json={'name':'large.ifc','kind':'ifc','size':16*1024*1024+1}).status_code==422
        assert client.post('/v1/uploads',headers=HEADERS,json={'name':'large.json','kind':'asbuilt','size':1024*1024+1}).status_code==422
        ids=[upload(client,capture_case['prior'].read_bytes(),'ifc','prior.ifc'),upload(client,json.dumps(capture_case['review']).encode(),'asbuilt','review.json')]
        body={'engine':'asbuilt-update','upload_ids':ids,'source_job':sid,'consent':True}
        assert client.post('/v1/jobs',headers=HEADERS,json={**body,'consent':False}).status_code==422
        r=client.post('/v1/jobs',headers=HEADERS,json=body);assert r.status_code==201,r.text
        jid=r.json()['id'];client.post(f'/v1/jobs/{jid}/start',headers=HEADERS)
        for _ in range(150):
            job=client.get('/v1/jobs/'+jid,headers=HEADERS).json()
            if job['status'] in ('complete','failed'):break
            time.sleep(.05)
        assert job['status']=='complete',job
        i,a=next((i,a) for i,a in enumerate(job['artifacts']) if a['name']=='updated.ifc')
        url=client.post(f'/v1/jobs/{jid}/ticket',headers=HEADERS,json={'artifact':i}).json()['url']
        assert aj.sha(client.get(url).content)==a['sha256']
        assert client.get('/v1/jobs/'+jid).status_code==401

def test_tenant_boundaries_and_foreign_camera_ancestry(capture_case,tmp_path):
    config=tmp_path/'adapters.json';adapters(config);tenants=tmp_path/'tenants.json'
    a,b,v='a'*43,'b'*43,'v'*43
    dump(tenants,{'schema':'brainsnn.world.tenants.v1','tenants':[{'id':name,'token_sha256':aj.sha(token.encode()),'engines':engines} for name,token,engines in [('alpha',a,['asbuilt-update','asbuilt-evidence']),('beta',b,['asbuilt-update','asbuilt-evidence']),('visitor',v,['inspect'])]]})
    app=create_app(root=tmp_path/'worker',token=TOKEN,adapters=str(config),tenants=str(tenants))
    ha={'Authorization':'Bearer '+a};hb={'Authorization':'Bearer '+b};hv={'Authorization':'Bearer '+v}
    with TestClient(app) as client:
        sid=seed(app,capture_case,'alpha')
        assert not any(e['id'].startswith('asbuilt') for e in client.get('/v1/capabilities',headers=hv).json()['engines'])
        assert client.post('/v1/uploads',headers=hv,json={'name':'prior.ifc','kind':'ifc','size':100}).status_code==403
        options={'schema':aj.EVIDENCE_SCHEMA,'sceneSha256':aj.sha((capture_case['sceneRoot']/'output/scene.json').read_bytes()),'componentId':capture_case['componentId'],'reviewed':True}
        ua=upload(client,json.dumps(options).encode(),'asbuilt','options.json',ha)
        ub=upload(client,json.dumps(options).encode(),'asbuilt','options.json',hb)
        body={'engine':'asbuilt-evidence','upload_ids':[ua],'source_job':sid,'consent':True}
        assert client.post('/v1/jobs',headers=hb,json={**body,'upload_ids':[ub]}).status_code==404
        assert client.post('/v1/jobs',headers=hb,json=body).status_code==404
        # An owned scene must not expose a foreign ancestor's rasters.
        app.state.store.db.execute("UPDATE jobs SET owner_id='beta' WHERE id=?",('b'*32,));app.state.store.db.commit()
        created=client.post('/v1/jobs',headers=ha,json=body);assert created.status_code==201,created.text
        jid=created.json()['id'];client.post(f'/v1/jobs/{jid}/start',headers=ha)
        for _ in range(150):
            job=client.get('/v1/jobs/'+jid,headers=ha).json()
            if job['status'] in ('complete','failed'):break
            time.sleep(.05)
        assert job['status']=='failed' and job['artifacts']==[]

@pytest.mark.parametrize('raw,kind',[(b'<xml>','ifc'),(b'{"schema":1,"schema":2}','asbuilt'),(b'{"value":NaN}','asbuilt')])
def test_new_uploads_reject_wrong_signatures_duplicate_keys_and_nonfinite_json(tmp_path,raw,kind):
    p=tmp_path/'input';p.write_bytes(raw)
    with pytest.raises(ValueError):aj.validate_upload(p,kind)
