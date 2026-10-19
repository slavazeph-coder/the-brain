import base64
import hashlib
import hmac
import json
from pathlib import Path
import sys
import time
import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from robotics.world_worker.app import create_app
from robotics.world_worker.depth_small import lift_depth

TOKEN='test-operator-token-not-production-'+'x'*32
HEADERS={'Authorization':'Bearer '+TOKEN}

def photo():
    buf=io.BytesIO();Image.new('RGB',(12,12),(70,120,160)).save(buf,format='PNG');return buf.getvalue()

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(root=tmp_path,token=TOKEN)) as c:yield c

def upload(c,data=None):
    data=data or photo()
    r=c.post('/v1/uploads',json={'name':'room.png','kind':'image','size':len(data)},headers=HEADERS);assert r.status_code==201,r.text
    uid=r.json()['id'];r=c.put(f'/v1/uploads/{uid}?offset=0',content=data,headers=HEADERS|{'Content-Type':'application/octet-stream'});assert r.status_code==200,r.text
    return uid

def make_job(c,engine='inspect'):
    uid=upload(c);r=c.post('/v1/jobs',json={'engine':engine,'upload_ids':[uid],'consent':True},headers=HEADERS);assert r.status_code==201,r.text;return r.json()['id'],uid

def wait(c,jid):
    for _ in range(100):
        j=c.get('/v1/jobs/'+jid,headers=HEADERS).json()
        if j['status'] in ['complete','failed','cancelled']:return j
        time.sleep(.04)
    raise AssertionError('Job did not terminate')

def test_authentication(client):
    assert client.get('/v1/capabilities').status_code==401
    assert client.get('/v1/capabilities',headers={'Authorization':'Bearer wrong'}).status_code==401
    assert client.get('/healthz').json()['public_processing'] is False
    assert client.get('/v1/capabilities',headers=HEADERS).json()['operator_only'] is True

def test_unsigned_artifact_route_is_denied(client):
    assert client.get('/v1/download/invented').status_code==403

def test_resumable_offsets(client):
    data=photo();r=client.post('/v1/uploads',json={'name':'room.png','kind':'image','size':len(data)},headers=HEADERS);uid=r.json()['id']
    assert client.put(f'/v1/uploads/{uid}?offset=0',content=data[:20],headers=HEADERS).json()['offset']==20
    assert client.put(f'/v1/uploads/{uid}?offset=0',content=data[:20],headers=HEADERS).status_code==409
    assert client.get('/v1/uploads/'+uid,headers=HEADERS).json()['offset']==20
    assert client.put(f'/v1/uploads/{uid}?offset=20',content=data[20:],headers=HEADERS).json()['offset']==len(data)

def test_body_caps_and_size(client):
    assert client.post('/v1/uploads',json={'name':'huge.png','kind':'image','size':201*1024**2},headers=HEADERS).status_code==422
    assert client.post('/v1/uploads',content=b'x'*20000,headers=HEADERS).status_code==413
    uid=upload(client);assert client.put(f'/v1/uploads/{uid}?offset=0',content=b'x'*(4*1024**2+1),headers=HEADERS).status_code==413

def test_consent_and_disabled_engines(client):
    uid=upload(client)
    for consent in [False,'yes']:
        assert client.post('/v1/jobs',json={'engine':'inspect','upload_ids':[uid],'consent':consent},headers=HEADERS).status_code==422
    assert client.post('/v1/jobs',json={'engine':'lyra','upload_ids':[uid],'consent':True},headers=HEADERS).status_code==409

def test_media_magic_and_unsafe_inputs(client):
    uid=upload(client,b'<script>not an image</script>')
    assert client.post('/v1/jobs',json={'engine':'inspect','upload_ids':[uid],'consent':True},headers=HEADERS).status_code==422
    assert client.get('/v1/uploads/not-an-id',headers=HEADERS).status_code==404
    assert client.post('/v1/uploads',json={'name':'x.exe','kind':'image','size':20},headers=HEADERS).status_code==422

def test_prepared_job_never_spends_compute_without_start(client):
    jid,uid=make_job(client);time.sleep(.05)
    assert client.get('/v1/jobs/'+jid,headers=HEADERS).json()['status']=='prepared'
    assert client.delete('/v1/uploads/'+uid,headers=HEADERS).status_code==409
    assert client.delete('/v1/jobs/'+jid,headers=HEADERS).json()['status']=='cancelled'
    assert client.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS).status_code==409
    assert client.delete('/v1/uploads/'+uid,headers=HEADERS).json()['deleted'] is True

def test_integrity_job_and_ticketed_streaming(client):
    jid,uid=make_job(client)
    assert client.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS).status_code==200
    job=wait(client,jid);assert job['status']=='complete',job
    ticket=client.post(f'/v1/jobs/{jid}/ticket',json={'artifact':0},headers=HEADERS).json()['url']
    assert TOKEN not in ticket
    r=client.get(ticket);assert r.status_code==200
    assert r.headers['content-disposition'].startswith('attachment')
    assert r.json()['model_executed'] is False
    assert r.json()['sources'][0]['sha256']==hashlib.sha256(photo()).hexdigest()
    rr=client.get(ticket,headers={'Range':'bytes=0-15'});assert rr.status_code==206;assert len(rr.content)==16
    assert client.get(ticket+'wrong').status_code==403
    payload=base64.urlsafe_b64encode(json.dumps({'job':jid,'artifact':0,'expires':int(time.time())-1}).encode()).decode().rstrip('=')
    sig=hmac.new(TOKEN.encode(),payload.encode(),hashlib.sha256).hexdigest()
    assert client.get(f'/v1/download/{payload}.{sig}').status_code==403

def test_no_wildcard_cors(client):
    r=client.options('/v1/capabilities',headers={'Origin':'https://evil.example','Access-Control-Request-Method':'GET'})
    assert 'access-control-allow-origin' not in r.headers
    r=client.options('/v1/capabilities',headers={'Origin':'https://www.brainsnn.com','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})
    assert r.headers['access-control-allow-origin']=='https://www.brainsnn.com'

def test_retention(tmp_path):
    with TestClient(create_app(root=tmp_path,token=TOKEN)) as c:
        jid,uid=make_job(c);c.delete('/v1/jobs/'+jid,headers=HEADERS)
        store=c.app.state.store;store.db.execute('UPDATE uploads SET created=0');store.db.execute('UPDATE jobs SET created=0');store.db.commit();store.prune(1)
        assert c.get('/v1/uploads/'+uid,headers=HEADERS).status_code==404
        assert c.get('/v1/jobs/'+jid,headers=HEADERS).status_code==404

def test_small_depth_lifting_math_without_model():
    import numpy as np
    points,colours=lift_depth(np.zeros((4,5,3),dtype=np.uint8),np.ones((4,5)))
    assert points.shape==(20,3);assert colours.shape==(20,3);assert np.isfinite(points).all()
    with pytest.raises(ValueError):lift_depth(np.zeros((4,5,3)),np.zeros((2,3)))

def test_actual_adapter_process_cancellation(tmp_path):
    script=tmp_path/'sleep.py';script.write_text('import time\ntime.sleep(60)\n')
    config=tmp_path/'adapters.json';config.write_text(json.dumps([{'id':'test-sleep','label':'TEST FIXTURE','enabled':True,'license_reviewed':True,'input_kinds':['image'],'max_inputs':1,'timeout_seconds':5,'command':[sys.executable,str(script)]}]))
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config))) as c:
        jid,uid=make_job(c,'test-sleep');c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        for _ in range(30):
            if c.get('/v1/jobs/'+jid,headers=HEADERS).json()['status']=='running':break
            time.sleep(.03)
        assert c.delete('/v1/jobs/'+jid,headers=HEADERS).json()['status']=='cancelled'
        assert c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS).status_code==409

def test_large_artifact_range_without_browser_buffer(tmp_path):
    with TestClient(create_app(root=tmp_path,token=TOKEN)) as c:
        jid,uid=make_job(c);c.delete('/v1/jobs/'+jid,headers=HEADERS)
        out=tmp_path/'jobs'/jid/'output';out.mkdir(parents=True)
        big=out/'large.ply'
        with big.open('wb') as f:f.truncate(70*1024**2)
        c.app.state.store.state(jid,'complete',artifacts=[{'name':'large.ply','size':big.stat().st_size}])
        url=c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':0},headers=HEADERS).json()['url']
        r=c.get(url,headers={'Range':'bytes=70000000-70000031'})
        assert r.status_code==206;assert len(r.content)==32
