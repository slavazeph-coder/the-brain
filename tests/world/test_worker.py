import base64
import hashlib
import hmac
import json
from pathlib import Path
import sys
import time
import io
import os
import shutil
import subprocess
import pytest
from fastapi.testclient import TestClient
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from robotics.world_worker.app import create_app, visual_metadata
from robotics.world_worker.depth_small import lift_depth
from robotics.world_worker.geometry import write_point_cloud
from robotics.world_worker.sparse_colmap import prepare_photo, extract_video, run as reconstruct
from robotics.world_worker.mapanything_apache import preview_from_predictions, camera_metadata, local_installation, verify_source, local_dino_architecture

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


def test_point_cloud_roundtrip_and_bounded_metadata(tmp_path):
    import numpy as np
    points=np.array([[0,1,2],[-3,4,-5]],dtype=float)
    colours=np.array([[255,0,0],[0,128,255]])
    entry=write_point_cloud(tmp_path/'preview.ply',points,colours,coordinate_frame='colmap')
    assert entry['bounds']=={'min':[-3,1,-5],'max':[0,4,2]}
    assert entry['point_count']==2
    assert 'element vertex 2' in (tmp_path/'preview.ply').read_text()
    assert visual_metadata(entry)['representation']=='point-cloud'
    for invalid in [np.array([[float('nan'),0,0]]),np.zeros((0,3)),np.zeros((2,2))]:
        with pytest.raises(ValueError):write_point_cloud(tmp_path/'bad.ply',invalid,np.zeros_like(invalid),coordinate_frame='colmap')


@pytest.mark.parametrize('metadata',[
    {'representation':'collision-mesh'},
    {'representation':'point-cloud','point_count':True},
    {'representation':'point-cloud','point_count':20_000_001},
    {'representation':'point-cloud','coordinate_frame':'metres-certified'},
    {'representation':'point-cloud','bounds':{'min':[0,0,0],'max':[1,1,float('nan')]}},
    {'representation':'point-cloud','bounds':{'min':[0,0,2],'max':[1,1,1]}},
])
def test_reject_invalid_visual_metadata(metadata):
    with pytest.raises(ValueError):visual_metadata(metadata)


def adapter_config(tmp_path, source):
    script=tmp_path/'adapter.py';script.write_text(source)
    config=tmp_path/'adapters.json'
    config.write_text(json.dumps([{'id':'test-adapter','label':'TEST FIXTURE','enabled':True,
        'license_reviewed':True,'input_kinds':['image'],'max_inputs':1,'timeout_seconds':5,
        'command':[sys.executable,str(script),'{input_manifest}']}]))
    return config


def test_adapter_artifacts_deliver_viewer_hints_without_certifying_geometry(tmp_path):
    metadata={'name':'preview.ply','kind':'visual','representation':'point-cloud',
        'coordinate_frame':'colmap','units':'metres','metric_verified':True,'point_count':1,
        'bounds':{'min':[0,0,0],'max':[0,0,0]},'provenance':'verified'}
    config=adapter_config(tmp_path,
        "import json,sys,os\nfrom pathlib import Path\n"
        "request=json.loads(Path(sys.argv[1]).read_text());out=Path(request['output_dir'])\n"
        "assert 'WORLD_WORKER_TOKEN' not in os.environ\n"
        "(out/'preview.ply').write_text('ply\\nformat ascii 1.0\\nend_header\\n')\n"
        f"(out/'manifest.json').write_text(json.dumps({{'artifacts':[{metadata!r}]}}))\n")
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config))) as c:
        jid,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        job=wait(c,jid);assert job['status']=='complete',job
        artifact=job['artifacts'][0]
        assert artifact['representation']=='point-cloud'
        assert artifact['point_count']==1
        assert artifact['units']=='arbitrary'
        assert artifact['metric_verified'] is False
        assert artifact['provenance']=='unverified-output'
        assert len(artifact['sha256'])==64


@pytest.mark.parametrize('artifact',[
    {'name':'../outside.json'},
    {'name':'scene.html'},
    {'name':'data.json','representation':'point-cloud','bounds':{'min':[0,0,0],'max':[0,0,float('inf')]}}
])
def test_unsafe_adapter_artifacts_fail_without_success_manifest(tmp_path,artifact):
    config=adapter_config(tmp_path,
        "import json,sys\nfrom pathlib import Path\n"
        "out=Path(json.loads(Path(sys.argv[1]).read_text())['output_dir'])\n"
        "(out/'data.json').write_text('{}')\n"
        f"(out/'manifest.json').write_text({json.dumps({'artifacts':[artifact]})!r})\n")
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config))) as c:
        jid,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        job=wait(c,jid)
        assert job['status']=='failed',job
        assert job['artifacts']==[]
        assert c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':0},headers=HEADERS).status_code==404


def test_colmap_capture_preflight_rejects_blank_and_tiny_photos(tmp_path):
    source=tmp_path/'source.png'
    for size in [(128,128),(512,512)]:
        Image.new('RGB',size,(100,100,100)).save(source)
        with pytest.raises(ValueError):prepare_photo(source,tmp_path/'output.jpg')
    assert not (tmp_path/'output.jpg').exists()


def test_colmap_photos_strip_location_metadata_and_resize(tmp_path):
    import numpy as np
    source=tmp_path/'source.jpg'
    image=Image.fromarray(np.random.default_rng(0).integers(0,256,(800,1600,3),dtype=np.uint8))
    exif=Image.Exif();exif[270]='private capture note';image.save(source,exif=exif)
    result=prepare_photo(source,tmp_path/'output.jpg')
    assert result=={'width':1280,'height':640}
    with Image.open(tmp_path/'output.jpg') as output:assert len(output.getexif())==0


def test_colmap_video_decodes_actual_mp4_and_rejects_too_short(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):pytest.skip('FFmpeg not installed')
    capture=tmp_path/'capture.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','testsrc2=size=320x256:rate=10',
                    '-t','2','-c:v','libx264','-pix_fmt','yuv420p',str(capture)],check=True,timeout=15)
    images=tmp_path/'images';images.mkdir()
    evidence=extract_video(capture,images)
    assert evidence['duration_seconds']==2
    assert len(list(images.glob('*.jpg')))==6
    # A decoded frame sequence is only capture preparation, not reconstruction success.
    assert not (tmp_path/'manifest.json').exists()
    short=tmp_path/'short.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(capture),'-t','0.5','-c','copy',str(short)],check=True,timeout=15)
    with pytest.raises(ValueError,match='2–120'):extract_video(short,images)


def test_colmap_no_overlap_never_returns_a_success_manifest(tmp_path):
    pytest.importorskip('pycolmap')
    import numpy as np
    rng=np.random.default_rng(5)
    inputs=[]
    for index in range(3):
        path=tmp_path/f'independent-{index}.png'
        Image.fromarray(rng.integers(0,256,(320,320,3),dtype=np.uint8)).save(path)
        inputs.append({'path':str(path),'kind':'image','name':path.name,'size':path.stat().st_size})
    with pytest.raises(ValueError,match='Views could not be aligned|Insufficient reconstructed geometry'):
        reconstruct({'schema':'brainsnn.adapter.v1','inputs':inputs,'output_dir':str(tmp_path/'output')})
    assert not (tmp_path/'output'/'manifest.json').exists()


@pytest.mark.parametrize('capture_kind',['photos','video'])
def test_real_colmap_upload_job_if_dataset_provided(tmp_path,capture_kind):
    """Optional full HTTP/CPU proof using separately downloaded real photographs.

    WORLD_COLMAP_TEST_CAPTURE=/path/to/images python -m pytest ... -k real_colmap
    Install requirements-colmap.txt into that test interpreter first. The test
    never downloads a dataset or substitutes a mocked reconstruction.
    """
    source=os.environ.get('WORLD_COLMAP_TEST_CAPTURE')
    if not source:pytest.skip('Set WORLD_COLMAP_TEST_CAPTURE to real overlapping photographs')
    pytest.importorskip('pycolmap')
    photos=sorted(p for p in Path(source).iterdir() if p.suffix.lower() in ['.png','.jpg','.jpeg'])[:12]
    assert len(photos)>=3
    captures=photos
    if capture_kind=='video':
        if not shutil.which('ffmpeg') or len(photos)<6:pytest.skip('Video fixture needs FFmpeg and 6+ photographs')
        frames=tmp_path/'video-source';frames.mkdir()
        for index,path in enumerate(photos):prepare_photo(path,frames/f'frame_{index:04d}.jpg')
        capture=tmp_path/'photograph-sequence.mp4'
        subprocess.run(['ffmpeg','-v','error','-framerate','2','-i',str(frames/'frame_%04d.jpg'),'-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',
                        '-c:v','libx264','-pix_fmt','yuv420p',str(capture)],check=True,timeout=30)
        captures=[capture]
    config=tmp_path/'adapters.json'
    config.write_text(json.dumps([{'id':'colmap-sparse','label':'Real CPU reconstruction','enabled':True,
        'license_reviewed':True,'input_kinds':['image','video'],'max_inputs':12,'timeout_seconds':120,
        'command':[sys.executable,str(ROOT/'robotics/world_worker/sparse_colmap.py'),'--input-manifest','{input_manifest}']}]))
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config))) as c:
        ids=[]
        for image in captures:
            payload=image.read_bytes()
            response=c.post('/v1/uploads',json={'name':image.name,'kind':'video' if capture_kind=='video' else 'image','size':len(payload)},headers=HEADERS)
            assert response.status_code==201,response.text
            uid=response.json()['id'];ids.append(uid)
            for offset in range(0,len(payload),4*1024**2):
                assert c.put(f'/v1/uploads/{uid}?offset={offset}',content=payload[offset:offset+4*1024**2],headers=HEADERS).status_code==200
        response=c.post('/v1/jobs',json={'engine':'colmap-sparse','upload_ids':ids,'consent':True},headers=HEADERS)
        assert response.status_code==201,response.text
        jid=response.json()['id'];c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            job=c.get('/v1/jobs/'+jid,headers=HEADERS).json()
            if job['status'] in ['complete','failed']:break
            time.sleep(.1)
        assert job['status']=='complete',job
        assert job['artifacts'][0]['representation']=='point-cloud'
        assert job['artifacts'][0]['point_count']>=30
        url=c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':1},headers=HEADERS).json()['url']
        evidence=c.get(url).json()
        assert evidence['capture']['registered_images']>=3
        assert evidence['metric_verified'] is False
        assert evidence['physics_ready'] is False
        assert evidence['policy_executed'] is False
        assert {s['sha256'] for s in evidence['sources']}=={hashlib.sha256(p.read_bytes()).hexdigest() for p in captures}


def predicted_view():
    """Documented output-shape fixture for conversion math; not model execution."""
    import numpy as np
    points=np.ones((1,6,6,3),dtype=np.float32)*[2,3,4]
    return {'pts3d':points,'img_no_norm':np.ones_like(points)*[1,.5,0],
            'mask':np.ones((1,6,6,1),dtype=bool),
            'camera_poses':np.eye(4)[None], 'intrinsics':np.eye(3)[None]}


def test_mapanything_converts_world_points_without_double_pose_transform():
    import numpy as np
    view=predicted_view()
    view['camera_poses'][0,:3,3]=[8,9,10]
    points,colours,counts=preview_from_predictions([view])
    assert np.all(points==[2,-3,-4])
    assert np.all(colours==[255,128,0])
    assert counts==[{'predicted_pixels':36,'valid_points':36,'preview_points':36}]
    pose=np.asarray(camera_metadata([view])[0]['camera_to_world_y_up'])
    assert np.array_equal(pose[:3,3],[8,-9,-10])


def test_mapanything_respects_mask_nonfinite_points_and_budget():
    import numpy as np
    first,second=predicted_view(),predicted_view()
    first['pts3d'][0,0,0]=float('nan')
    first['mask'][0,0,1]=False
    points,colours,counts=preview_from_predictions([first,second],max_points=40)
    assert len(points)<=40
    assert np.isfinite(points).all()
    assert counts[0]['valid_points']==34
    assert counts[1]['valid_points']==36
    assert len(colours)==len(points)


def test_mapanything_rejects_malformed_or_empty_model_geometry():
    import numpy as np
    view=predicted_view();view['mask'][:]=False
    with pytest.raises(ValueError,match='Too little'):preview_from_predictions([view])
    view=predicted_view();view['img_no_norm']*=255
    with pytest.raises(ValueError,match='colours'):preview_from_predictions([view])
    view=predicted_view();view['pts3d']=np.ones((6,6,3))
    with pytest.raises(ValueError,match='shapes'):preview_from_predictions([view])
    view=predicted_view();view['camera_poses'][0,3,0]=1
    with pytest.raises(ValueError,match='camera'):camera_metadata([view])


def test_mapanything_missing_installation_fails_before_inference(monkeypatch):
    for name in ['WORLD_MAPANYTHING_SOURCE_DIR','WORLD_DINOV2_SOURCE_DIR','WORLD_MAPANYTHING_MODEL_DIR']:
        monkeypatch.delenv(name,raising=False)
    with pytest.raises(RuntimeError,match='Install pinned'):local_installation()


def test_mapanything_model_dir_symlink_rejected_before_hash(monkeypatch, tmp_path):
    # A symlinked checkpoint would hash whatever it points at, not the file the
    # worker serves. Fail closed before the digest is ever computed. The source
    # revision gate is isolated out (monkeypatched) so this test targets the
    # model-dir symlink guard in particular.
    from robotics.world_worker import mapanything_apache as worker_module
    monkeypatch.setattr(worker_module, 'verify_source', lambda *a, **k: None)
    real = tmp_path / 'real'; real.mkdir()
    link = tmp_path / 'linked'; link.mkdir()
    (link / 'model.safetensors').symlink_to(real / 'model.safetensors')
    (link / 'config.json').write_text('config-fixture')
    monkeypatch.setenv('WORLD_MAPANYTHING_SOURCE_DIR', str(real))
    monkeypatch.setenv('WORLD_DINOV2_SOURCE_DIR', str(real))
    monkeypatch.setenv('WORLD_MAPANYTHING_MODEL_DIR', str(link))
    with pytest.raises(RuntimeError, match='model.safetensors'):
        local_installation()
    # A regular (non-symlink) checkpoint with the wrong size must also fail,
    # and only after the symlink guard has been cleared.
    (link / 'model.safetensors').unlink()
    (link / 'model.safetensors').write_bytes(b'wrong')
    with pytest.raises(RuntimeError, match='model.safetensors'):
        local_installation()


def test_mapanything_source_pin_rejects_different_revision(tmp_path):
    subprocess.run(['git','init','-q',str(tmp_path)],check=True)
    (tmp_path/'source.py').write_text('pinned = True\n')
    subprocess.run(['git','-C',str(tmp_path),'add','source.py'],check=True)
    subprocess.run(['git','-C',str(tmp_path),'-c','user.name=Test','-c','user.email=test@example.invalid',
                    '-c','commit.gpgsign=false','commit','-qm','fixture'],check=True)
    actual=subprocess.check_output(['git','-C',str(tmp_path),'rev-parse','HEAD'],text=True).strip()
    verify_source(tmp_path,actual)
    with pytest.raises(RuntimeError,match='revision'):verify_source(tmp_path,'0'*40)
    (tmp_path/'source.py').write_text('pinned = False\n')
    with pytest.raises(RuntimeError,match='clean'):verify_source(tmp_path,actual)


def test_mapanything_blocks_implicit_network_in_a_separate_process():
    code=('import sys,socket\nfrom robotics.world_worker.mapanything_apache import deny_network\n'
          'sys.addaudithook(deny_network)\n'
          'try: socket.getaddrinfo("example.invalid",443)\n'
          'except RuntimeError as e:\n assert "Network access is disabled" in str(e)\n'
          'else: raise AssertionError("DNS was not blocked")\n')
    result=subprocess.run([sys.executable,'-c',code],cwd=ROOT,capture_output=True,text=True,timeout=10)
    assert result.returncode==0,result.stderr


def test_mapanything_dino_loader_requires_local_architecture_without_weights(tmp_path):
    from types import SimpleNamespace
    calls=[]
    def original(*args,**kwargs):calls.append((args,kwargs));return 'architecture-fixture'
    torch=SimpleNamespace(hub=SimpleNamespace(load=original))
    with local_dino_architecture(torch,tmp_path):
        assert torch.hub.load('facebookresearch/dinov2','dinov2_vitg14',pretrained=False)=='architecture-fixture'
        with pytest.raises(RuntimeError):torch.hub.load('facebookresearch/dinov2','dinov2_vitg14',pretrained=True)
        with pytest.raises(RuntimeError):torch.hub.load('unreviewed/repository','dinov2_vitg14',pretrained=False)
    assert torch.hub.load is original
    assert calls==[((str(tmp_path),'dinov2_vitg14'),{'source':'local','pretrained':False})]


def test_worker_point_cloud_coordinate_limit_matches_browser(tmp_path):
    import numpy as np
    points=np.array([[10_000_000.,0,0]])
    entry=write_point_cloud(tmp_path/'boundary.ply',points,np.array([[255,0,0]]),coordinate_frame='colmap')
    assert visual_metadata(entry)['bounds']['max'][0]==10_000_000
    points[0,0]+=1
    with pytest.raises(ValueError):write_point_cloud(tmp_path/'outside.ply',points,np.array([[255,0,0]]),coordinate_frame='colmap')
    entry['bounds']['max'][0]+=1
    with pytest.raises(ValueError):visual_metadata(entry)


def blocking_adapter(tmp_path):
    release=tmp_path/'release'
    config=adapter_config(tmp_path,
        'import json,sys,time\nfrom pathlib import Path\n'
        f'release=Path({str(release)!r})\n'
        'while not release.exists(): time.sleep(.02)\n'
        "out=Path(json.loads(Path(sys.argv[1]).read_text())['output_dir'])\n"
        "(out/'data.json').write_text('{}')\n"
        "(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':'data.json'}]}))\n")
    return config,release


def test_queued_and_prepared_jobs_reserve_global_disk_capacity(tmp_path):
    config,release=blocking_adapter(tmp_path)
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config),storage_limit=8*1024**2,job_limit=2*1024**2)) as c:
        uid=upload(c)
        body={'engine':'test-adapter','upload_ids':[uid],'consent':True}
        ids=[]
        for _ in range(3):
            response=c.post('/v1/jobs',json=body,headers=HEADERS)
            assert response.status_code==201,response.text
            ids.append(response.json()['id'])
        assert c.post('/v1/jobs',json=body,headers=HEADERS).status_code==429
        for jid in ids:assert c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS).status_code==200
        assert c.get('/v1/jobs/'+ids[-1],headers=HEADERS).json()['status']=='queued'
        assert c.post('/v1/jobs',json=body,headers=HEADERS).status_code==429
        c.delete('/v1/jobs/'+ids[-1],headers=HEADERS)
        assert c.post('/v1/jobs',json=body,headers=HEADERS).status_code==201
        release.touch()
        assert wait(c,ids[0])['status']=='complete'


def test_concurrent_uploads_reserve_declared_bytes_before_chunks_arrive(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    with TestClient(create_app(root=tmp_path,token=TOKEN,storage_limit=8*1024**2,job_limit=2*1024**2)) as c:
        def prepare(_):return c.post('/v1/uploads',json={'name':'capture.png','kind':'image','size':2*1024**2},headers=HEADERS)
        with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(prepare,range(4)))
        assert sorted(response.status_code for response in responses)==[201,201,201,429]
        uid=next(response.json()['id'] for response in responses if response.status_code==201)
        data=photo()+b'\0'*(2*1024**2-len(photo()))
        assert c.put(f'/v1/uploads/{uid}?offset=0',content=data,headers=HEADERS).status_code==200
        # Other unwritten sources still occupy their promised capacity.
        assert c.post('/v1/jobs',json={'engine':'inspect','upload_ids':[uid],'consent':True},headers=HEADERS).status_code==429


def test_job_budget_checked_after_fast_adapter_exit(tmp_path):
    config=adapter_config(tmp_path,
        "import json,sys\nfrom pathlib import Path\n"
        "out=Path(json.loads(Path(sys.argv[1]).read_text())['output_dir'])\n"
        "(out/'data.json').write_bytes(b'x'*(2*1024**2))\n"
        "(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':'data.json'}]}))\n")
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config),storage_limit=8*1024**2,job_limit=1024**2)) as c:
        jid,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        job=wait(c,jid)
        assert job['status']=='failed'
        assert 'disk budget' in job['error']
        assert job['artifacts']==[]


def test_deleted_queued_job_does_not_stop_runner(tmp_path):
    config,release=blocking_adapter(tmp_path)
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(config))) as c:
        first,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{first}/start',json={},headers=HEADERS)
        second,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{second}/start',json={},headers=HEADERS)
        assert c.get('/v1/jobs/'+second,headers=HEADERS).json()['status']=='queued'
        assert c.delete('/v1/jobs/'+second,headers=HEADERS).json()['status']=='cancelled'
        assert c.delete(f'/v1/jobs/{second}/artifacts',headers=HEADERS).status_code==200
        release.touch()
        assert wait(c,first)['status']=='complete'
        third,_=make_job(c);c.post(f'/v1/jobs/{third}/start',json={},headers=HEADERS)
        assert wait(c,third)['status']=='complete'


def test_job_directory_failure_does_not_leak_running_state_or_stop_queue(tmp_path):
    with TestClient(create_app(root=tmp_path,token=TOKEN)) as c:
        jid,_=make_job(c)
        (tmp_path/'jobs'/jid).write_text('blocks directory creation')
        c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        assert wait(c,jid)['status']=='failed'
        assert c.delete(f'/v1/jobs/{jid}/artifacts',headers=HEADERS).status_code==200
        next_jid,_=make_job(c);c.post(f'/v1/jobs/{next_jid}/start',json={},headers=HEADERS)
        assert wait(c,next_jid)['status']=='complete'


def test_prepared_disk_reservations_survive_worker_restart(tmp_path):
    options={'root':tmp_path,'token':TOKEN,'storage_limit':8*1024**2,'job_limit':2*1024**2}
    with TestClient(create_app(**options)) as c:
        uid=upload(c);body={'engine':'inspect','upload_ids':[uid],'consent':True}
        for _ in range(3):assert c.post('/v1/jobs',json=body,headers=HEADERS).status_code==201
    with TestClient(create_app(**options)) as c:
        assert c.post('/v1/jobs',json=body,headers=HEADERS).status_code==429


def test_queued_jobs_survive_worker_restart(tmp_path):
    """Durable queue: jobs in 'queued' state are re-enqueued after restart.

    The in-memory asyncio queue loses its items on process exit, but the
    'queued' status is persisted in SQLite.  On restart the worker must
    recover those jobs from the database and resume execution, instead of
    losing them or failing them.
    """
    config,release=blocking_adapter(tmp_path)
    root=tmp_path/'data'
    options={'root':root,'token':TOKEN,'adapters':str(config),'storage_limit':8*1024**2,'job_limit':2*1024**2}
    jids=[]
    with TestClient(create_app(**options)) as c:
        for _ in range(3):
            jid,_=make_job(c,'test-adapter')
            assert c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS).status_code==200
            jids.append(jid)
        # The first job is running (blocked by the release gate); the other two
        # are queued.  Verify the queue state before the restart.
        statuses={c.get('/v1/jobs/'+jid,headers=HEADERS).json()['status'] for jid in jids}
        assert 'running' in statuses
        assert 'queued' in statuses
    # Simulate a worker restart: a new app instance opens the same SQLite store.
    with TestClient(create_app(**options)) as c:
        # The previously queued jobs must still exist and be 'queued' or
        # 'complete' (if the runner already started them).  They must NOT be
        # 'failed' with the restart-interrupted error.
        for jid in jids[1:]:
            job=c.get('/v1/jobs/'+jid,headers=HEADERS).json()
            assert job['status']!='failed' or 'restarted' not in (job['error'] or ''), \
                f'Job {jid} was lost to restart: {job}'
        # Release the blocking adapter so the runner can finish everything.
        release.touch()
        # jid[0] was 'running' when the first TestClient shut down; its
        # subprocess was killed and it is legitimately 'failed'.  Only the
        # recovered jobs (jids[1:]) are expected to run to completion.
        assert wait(c, jids[0])['status'] == 'failed'
        for jid in jids[1:]:
            assert wait(c, jid)['status'] == 'complete'


def test_durable_queue_double_restart_is_idempotent(tmp_path):
    """Restart the worker twice; recovered jobs must be re-enqueued exactly
    once (FIFO) and must not be re-run after completing.

    Phase 1: 3 jobs, job[0] running (blocked), jobs[1..2] queued.
    Restart 1: requeue_pending recovers the 2 queued jobs; they complete.
    Restart 2: nothing is 'queued' in the DB, so requeue_pending returns
    [].  The already-complete jobs are untouched — their immutable
    completed_evidence (DB trigger) and 'complete' status are preserved.
    """
    config, release = blocking_adapter(tmp_path)
    root = tmp_path / 'data'
    options = {'root': root, 'token': TOKEN, 'adapters': str(config),
               'storage_limit': 8 * 1024**2, 'job_limit': 2 * 1024**2}

    # Phase 1: create 3 jobs; job[0] is running (blocked by release gate),
    # jobs[1..2] are queued in FIFO order.
    with TestClient(create_app(**options)) as c:
        jids = []
        for _ in range(3):
            jid, _ = make_job(c, 'test-adapter')
            assert c.post(f'/v1/jobs/{jid}/start', json={}, headers=HEADERS).status_code == 200
            jids.append(jid)
        # Stagger created timestamps so ORDER BY created is deterministic.
        import time as _t
        db = c.app.state.store.db
        for i, jid in enumerate(jids):
            db.execute('UPDATE jobs SET created=? WHERE id=?', (_t.time() + i, jid))
        db.commit()
        statuses = [c.get('/v1/jobs/' + jid, headers=HEADERS).json()['status'] for jid in jids]
        assert statuses[0] == 'running'
        assert statuses[1] == 'queued'
        assert statuses[2] == 'queued'

    # Restart 1: queued jobs are recovered and run to completion.
    with TestClient(create_app(**options)) as c:
        store1 = c.app.state.store
        # Lifespan already called requeue_pending; read the recovered list
        # out of the app state instead of re-driving the recovery.
        recovered = c.app.state.requeue_pending_return
        assert recovered == [jids[1], jids[2]], f'FIFO order broken: {recovered}'
        release.touch()
        assert wait(c, jids[0])['status'] == 'failed'
        for jid in jids[1:]:
            assert wait(c, jid)['status'] == 'complete'
        # completed_evidence is set — the immutability trigger is live.
        for jid in jids[1:]:
            row = store1.db.execute(
                'SELECT completed_evidence FROM jobs WHERE id=?', (jid,)).fetchone()
            assert row['completed_evidence'] is not None

    # Restart 2: no queued rows remain, so requeue_pending is a no-op.
    with TestClient(create_app(**options)) as c:
        store2 = c.app.state.store
        recovered2 = c.app.state.requeue_pending_return
        assert recovered2 == [], f'jobs re-enqueued a second time: {recovered2}'
        # Completed jobs are still complete; their evidence is intact.
        for jid in jids[1:]:
            job = c.get('/v1/jobs/' + jid, headers=HEADERS).json()
            assert job['status'] == 'complete', f'job {jid} regressed: {job}'
            row = store2.db.execute(
                'SELECT completed_evidence FROM jobs WHERE id=?', (jid,)).fetchone()
            assert row['completed_evidence'] is not None
        # The running job is still failed (not resurrected).
        assert c.get('/v1/jobs/' + jids[0], headers=HEADERS).json()['status'] == 'failed'


def test_queued_job_rechecks_capacity_before_spawning_adapter(tmp_path):
    config,_=blocking_adapter(tmp_path)
    root=tmp_path/'data'
    with TestClient(create_app(root=root,token=TOKEN,adapters=str(config),storage_limit=8*1024**2,job_limit=2*1024**2)) as c:
        first,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{first}/start',json={},headers=HEADERS)
        second,_=make_job(c,'test-adapter');c.post(f'/v1/jobs/{second}/start',json={},headers=HEADERS)
        assert c.get('/v1/jobs/'+second,headers=HEADERS).json()['status']=='queued'
        with (root/'unexpected-retained-data').open('wb') as stream:stream.truncate(6*1024**2)
        assert wait(c,first)['status']=='failed'
        failed=wait(c,second)
        assert failed['status']=='failed'
        assert 'execution did not start' in failed['error']
        assert not (root/'jobs'/second/'operator.log').exists()


def test_cancelled_stopping_job_keeps_disk_and_source_reservations(tmp_path):
    with TestClient(create_app(root=tmp_path,token=TOKEN)) as c:
        jid,uid=make_job(c);store=c.app.state.store
        before=store.storage_commitment(4*1024**3)
        store.state(jid,'cancelled')
        assert store.storage_commitment(4*1024**3,[jid])>=before
        assert store.in_use(uid,[jid]) is True
        store.db.execute('UPDATE jobs SET created=0');store.db.execute('UPDATE uploads SET created=0');store.db.commit()
        store.prune(1,[jid])
        assert store.job(jid)['status']=='cancelled'
        assert store.upload_path(uid).exists()
        store.prune(1)
        assert c.get('/v1/jobs/'+jid,headers=HEADERS).status_code==404
