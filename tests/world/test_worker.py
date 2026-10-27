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
from robotics.world_worker.app import create_app, directory_bytes, visual_metadata
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
    # A five-minute walkthrough can be over a gigabyte: videos may be up to 2 GiB, photos stay at 200 MiB.
    assert client.post('/v1/uploads',json={'name':'walk.mov','kind':'video','size':1536*1024**2},headers=HEADERS).status_code==201
    assert client.post('/v1/uploads',json={'name':'walk.mov','kind':'video','size':2*1024**3+1},headers=HEADERS).status_code==422
    assert client.get('/v1/capabilities',headers=HEADERS).json()['limits']['video_bytes']==2*1024**3
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

def test_tickets_keep_a_reverse_proxy_prefix(tmp_path):
    # Behind a proxy that strips /prefix (uvicorn --root-path /prefix), clients only trust URLs under that prefix.
    with TestClient(create_app(root=tmp_path,token=TOKEN),root_path='/prefix') as c:
        jid,_=make_job(c)
        assert c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS).status_code==200
        assert wait(c,jid)['status']=='complete'
        url=c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':0},headers=HEADERS).json()['url']
        assert url.startswith('/prefix/v1/download/'),url
    with TestClient(create_app(root=tmp_path,token=TOKEN)) as c:
        jid,_=make_job(c);c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS);wait(c,jid)
        assert c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':0},headers=HEADERS).json()['url'].startswith('/v1/download/')

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


def test_navigation_artifacts_use_signed_downloads_with_exact_bytes_and_hashes(tmp_path):
    """A fake adapter tests transport only, never a navigation map or a physical robot result."""
    payloads = {
        'nav2-map.pgm': b'P5\n3 2\n255\n\x00\xcd\xfe\xff\x0a\x00',
        'nav2-map.yaml': (b'image: nav2-map.pgm\nmode: trinary\nresolution: 0.05\n'
                          b'origin: [-1.0, -2.0, 0.0]\nnegate: 0\n'
                          b'occupied_thresh: 0.65\nfree_thresh: 0.196\n'),
        'nav2-evidence.json': (b'{\n  "schema": "authored-transport-fixture",\n'
                               b'  "physicalRobotValidated": false\n}\n')}
    config = adapter_config(tmp_path,
        "import json,sys\nfrom pathlib import Path\n"
        "out=Path(json.loads(Path(sys.argv[1]).read_text())['output_dir'])\n"
        f"payloads={payloads!r}\n"
        "for name,data in payloads.items(): (out/name).write_bytes(data)\n"
        "(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':n,'kind':'evidence'} for n in payloads]}))\n")
    with TestClient(create_app(root=tmp_path/'data', token=TOKEN, adapters=str(config))) as c:
        jid, _ = make_job(c, 'test-adapter')
        assert c.post(f'/v1/jobs/{jid}/start', json={}, headers=HEADERS).status_code == 200
        job = wait(c, jid)
        assert job['status'] == 'complete', job
        assert [a['name'] for a in job['artifacts']] == list(payloads)
        for index, artifact in enumerate(job['artifacts']):
            expected = payloads[artifact['name']]
            assert artifact['size'] == len(expected)
            assert artifact['sha256'] == hashlib.sha256(expected).hexdigest()
            assert artifact['metric_verified'] is False and artifact['provenance'] == 'unverified-output'
            assert c.post(f'/v1/jobs/{jid}/ticket', json={'artifact': index}).status_code == 401
            ticket = c.post(f'/v1/jobs/{jid}/ticket', json={'artifact': index}, headers=HEADERS)
            assert ticket.status_code == 200
            url = ticket.json()['url']
            assert url.startswith('/v1/download/') and TOKEN not in url
            downloaded = c.get(url)  # The short-lived signature grants this download, without the bearer token.
            assert downloaded.status_code == 200
            assert downloaded.content == expected
            assert downloaded.headers['content-disposition'].startswith('attachment')
            assert int(downloaded.headers['content-length']) == len(expected)
            assert hashlib.sha256(downloaded.content).hexdigest() == artifact['sha256']
            assert c.get(url + 'tampered').status_code == 403


def test_navigation_output_extensions_do_not_expand_allowed_uploads(client):
    for name in ('nav2-map.pgm', 'nav2-map.yaml', 'nav2-map.yml'):
        for kind in ('image', 'video', 'cloud'):
            response = client.post('/v1/uploads', json={'name': name, 'kind': kind, 'size': 10}, headers=HEADERS)
            assert response.status_code == 422, (name, kind, response.text)
    assert client.post('/v1/uploads', json={'name': 'nav2.json', 'kind': 'navigation', 'size': 10},
                       headers=HEADERS).status_code == 422


@pytest.mark.parametrize('count', [32, 33])
def test_adapter_artifact_count_stays_bounded_at_32(tmp_path, count):
    config = adapter_config(tmp_path,
        "import json,sys\nfrom pathlib import Path\n"
        "out=Path(json.loads(Path(sys.argv[1]).read_text())['output_dir'])\n"
        f"names=[f'part-{{i}}.json' for i in range({count})]\n"
        "for name in names: (out/name).write_bytes(b'{}\\n')\n"
        "(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':n,'kind':'evidence'} for n in names]}))\n")
    with TestClient(create_app(root=tmp_path/'data', token=TOKEN, adapters=str(config))) as c:
        jid, _ = make_job(c, 'test-adapter')
        c.post(f'/v1/jobs/{jid}/start', json={}, headers=HEADERS)
        job = wait(c, jid)
        if count == 32:
            assert job['status'] == 'complete' and len(job['artifacts']) == 32, job
            url = c.post(f'/v1/jobs/{jid}/ticket', json={'artifact': 31}, headers=HEADERS).json()['url']
            assert c.get(url).content == b'{}\n'
        else:
            assert job['status'] == 'failed' and job['artifacts'] == [], job
            assert c.post(f'/v1/jobs/{jid}/ticket', json={'artifact': 0}, headers=HEADERS).status_code == 404
        assert c.post(f'/v1/jobs/{jid}/ticket', json={'artifact': 32}, headers=HEADERS).status_code == 422


@pytest.mark.parametrize('name,mode', [
    ('../nav2-map.yaml', 'file'), ('nested/nav2-map.pgm', 'file'), ('nav2-map.yml', 'file'),
    ('nav2-map.yaml', 'symlink'), ('nav2-map.pgm', 'symlink'), ('nav2-map.yaml', 'duplicate')])
def test_unsafe_navigation_artifacts_fail_even_when_the_named_file_exists(tmp_path, name, mode):
    config = adapter_config(tmp_path,
        "import json,sys\nfrom pathlib import Path\n"
        "out=Path(json.loads(Path(sys.argv[1]).read_text())['output_dir'])\n"
        f"name,mode={name!r},{mode!r}\n"
        "target=out/name;target.parent.mkdir(parents=True,exist_ok=True)\n"
        "if mode=='symlink':\n"
        " source=out.parent/'source-map';source.write_bytes(b'authored test output');target.symlink_to(source)\n"
        "else: target.write_bytes(b'authored test output')\n"
        "entries=[{'name':name,'kind':'evidence'}]*(2 if mode=='duplicate' else 1)\n"
        "(out/'manifest.json').write_text(json.dumps({'artifacts':entries}))\n")
    with TestClient(create_app(root=tmp_path/'data', token=TOKEN, adapters=str(config))) as c:
        jid, _ = make_job(c, 'test-adapter')
        c.post(f'/v1/jobs/{jid}/start', json={}, headers=HEADERS)
        job = wait(c, jid)
        assert job['status'] == 'failed' and job['artifacts'] == [], job
        assert c.post(f'/v1/jobs/{jid}/ticket', json={'artifact': 0}, headers=HEADERS).status_code == 404


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
    with pytest.raises(ValueError,match='2 seconds to 5 minutes'):extract_video(short,images)


def test_a_long_video_gets_one_frame_a_second_and_matching_that_scales():
    from robotics.world_worker import sparse_colmap
    # Up to a minute: 60 frames, as before. Longer: one a second, up to five minutes.
    assert [sparse_colmap.frame_budget(d) for d in (2, 30, 60, 90, 300)]==[60,60,60,90,300]
    assert len(sparse_colmap.image_pairs(60))==60*59//2, 'up to 60 frames every pair is matched'
    pairs=set(sparse_colmap.image_pairs(300))
    assert len(pairs)<6000, 'not the 44,850 pairs of matching everything'
    assert all((i,i+k) in pairs for i in range(285) for k in range(1,16)), 'each frame meets its next 15'
    far={(i,j) for i,j in pairs if j-i>15}
    keys={i for pair in far for i in pair}
    assert len(keys)<=60 and (0,299) in far, 'only keyframes meet far frames, and they close the loop from start to end'


def test_a_three_minute_video_is_sampled_at_one_frame_a_second(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):pytest.skip('FFmpeg not installed')
    capture=tmp_path/'walk.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','testsrc2=size=320x256:rate=4',
                    '-t','180','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',str(capture)],check=True,timeout=120)
    images=tmp_path/'images';images.mkdir()
    evidence=extract_video(capture,images)
    assert evidence['frame_budget']==180 and evidence['sample_fps']==1
    assert len(list(images.glob('*.jpg')))==180-evidence['near_duplicate_frames']


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


def walk_and_matches(bridged=False):
    """Five frames of a walk past a wall of points, with COLMAP's own two-view geometry between consecutive frames, and
    between frames two apart too when bridged."""
    pycolmap=pytest.importorskip('pycolmap')
    import numpy as np,types
    rng=np.random.default_rng(3)
    points=np.c_[rng.uniform(-3,3,400),rng.uniform(-1,1.5,400),rng.uniform(4,6,400)]
    camera=pycolmap.Camera(model='PINHOLE',width=640,height=480,params=[500,500,320,240],camera_id=1)
    def turn(degrees):
        a=np.radians(degrees);return np.array([[np.cos(a),0,-np.sin(a)],[0,1,0],[np.sin(a),0,np.cos(a)]])
    poses=[]
    for k in range(5):  # 0.3 m a frame along x, turning 4 degrees a frame
        R=turn(4*k-8);poses.append(pycolmap.Rigid3d(pycolmap.Rotation3d(R),-R@np.array([.3*k-.6,0,0])))
    pixels=[]
    for pose in poses:
        local=points@pose.rotation.matrix().T+pose.translation
        pixels.append(np.c_[500*local[:,0]/local[:,2]+320,500*local[:,1]/local[:,2]+240])
    every=np.c_[np.arange(len(points)),np.arange(len(points))].astype(np.uint32)
    pairs=[(a,a+1) for a in range(1,5)]+([(a,a+2) for a in range(1,4)] if bridged else [])
    geometries={(a,b):pycolmap.estimate_calibrated_two_view_geometry(camera,pixels[a-1],camera,pixels[b-1],every) for a,b in pairs}
    database=types.SimpleNamespace(exists_two_view_geometry=lambda a,b:(a,b) in geometries,
        read_two_view_geometry=lambda a,b:geometries[(a,b)],read_keypoints=lambda image:np.c_[pixels[image-1],np.zeros((len(points),4))])
    def model(poses):
        images={k+1:types.SimpleNamespace(name=f'image_{k:04d}.jpg',image_id=k+1,camera_id=1,cam_from_world=lambda pose=pose:pose)
                for k,pose in enumerate(poses)}
        return types.SimpleNamespace(reg_image_ids=lambda:list(images),image=images.__getitem__,camera=lambda _:camera)
    return pycolmap,database,model,poses,turn,[f'image_{k:04d}.jpg' for k in range(5)]

def test_a_model_that_agrees_with_its_consecutive_frames_is_consistent():
    from robotics.world_worker import sparse_colmap
    pycolmap,database,model,poses,turn,names=walk_and_matches()
    turns,skipped=sparse_colmap.consecutive_turns(database,model(poses),names)
    check=sparse_colmap.fold_check(turns,skipped)
    assert check['status']=='consistent' and check['pairsChecked']==4 and skipped==0
    assert check['worstDisagreementDegrees']<.5, check

def test_a_model_turned_against_its_own_frames_is_folded():
    # The fold: one frame placed facing the opposite wall, as false matches between two alike walls put it.
    from robotics.world_worker import sparse_colmap
    pycolmap,database,model,poses,turn,names=walk_and_matches()
    folded=list(poses);R=turn(180)@poses[3].rotation.matrix();folded[3]=pycolmap.Rigid3d(pycolmap.Rotation3d(R),poses[3].translation)
    check=sparse_colmap.fold_check(*sparse_colmap.consecutive_turns(database,model(folded),names))
    assert check['status']=='folded' and check['pairsDisagreeing']==2
    assert {(t['from'],t['to']) for t in check['disagreeing']}=={('image_0002.jpg','image_0003.jpg'),('image_0003.jpg','image_0004.jpg')}
    assert 170<check['worstDisagreementDegrees']<=180
    # A frame the model left out: the frames either side of it are compared if they were matched, and skipped if not.
    unregistered=model(poses);unregistered.reg_image_ids=lambda:[1,2,4,5]
    turns,skipped=sparse_colmap.consecutive_turns(database,unregistered,names)
    assert [(t['from'],t['to']) for t in turns]==[('image_0000.jpg','image_0001.jpg'),('image_0003.jpg','image_0004.jpg')] and skipped==1

def test_a_hinge_is_folded_when_the_pairs_across_it_confirm_it():
    # A hinge: the walk after frame 2 is joined at 25 degrees. Only one consecutive pair turns wrongly, as one pair's own
    # misread two-view pose would, but every pair that bridges it turns wrongly too.
    from robotics.world_worker import sparse_colmap
    def hinged(bridged):
        pycolmap,database,model,poses,turn,names=walk_and_matches(bridged)
        moved=list(poses)
        for k in (3,4):
            R=turn(25)@poses[k].rotation.matrix();moved[k]=pycolmap.Rigid3d(pycolmap.Rotation3d(R),R@poses[k].rotation.matrix().T@poses[k].translation)
        return sparse_colmap.fold_check(*sparse_colmap.consecutive_turns(database,model(moved),names))
    check=hinged(True)
    assert check['status']=='folded' and check['pairsDisagreeing']==1 and 24<check['worstDisagreementDegrees']<26, check
    bridges=check['disagreeing'][0]['bridges']
    assert [(b['from'],b['to']) for b in bridges]==[('image_0001.jpg','image_0003.jpg'),('image_0002.jpg','image_0004.jpg')]
    assert all(24<b['disagreementDegrees']<26 for b in bridges)
    # Where nothing bridges the pair, one moderate pair cannot be told from a misread one: unconfirmed, with the pair listed.
    check=hinged(False)
    assert check['status']=='unconfirmed' and check['disagreeing'][0]['bridges']==[], check

def test_a_lone_pair_is_unconfirmed_only_while_nothing_else_points_to_a_fold():
    from robotics.world_worker import sparse_colmap
    def pair(degrees,bridges=None,k=0):
        turn={'from':f'image_{k:04d}.jpg','to':f'image_{k+1:04d}.jpg','matches':76,'disagreementDegrees':degrees}
        if bridges is not None:turn['bridges']=[{'from':'a','to':'b','matches':60,'disagreementDegrees':d} for d in bridges]
        return turn
    calm=[pair(3,k=k) for k in range(1,9)]
    status=lambda turns:sparse_colmap.fold_check(turns,0)['status']
    # The real case: frames 38 and 39 read 23.6 degrees from 76 matches, nothing bridged them, the cameras matched a
    # consistent mapping of the same video to 0.4 degrees.
    assert status(calm+[pair(23.6,[])])=='unconfirmed'
    assert status(calm+[pair(23.6,[2.1,4.0])])=='unconfirmed'
    assert status(calm+[pair(23.6,[2.1,19.0])])=='folded'      # a bridge turns wrongly too
    assert status(calm+[pair(46,[])])=='folded'                # beyond any misread seen; folds read 59 or more
    assert status(calm+[pair(20,[],k=10),pair(20,[],k=20)])=='folded'
    assert status(calm+[pair(15,[])])=='consistent'
    check=sparse_colmap.fold_check(calm+[pair(23.6,[])],0)
    assert check['pairsDisagreeing']==1 and check['disagreeing'][0]['disagreementDegrees']==23.6

def test_a_check_with_nothing_to_compare_says_so():
    from robotics.world_worker import sparse_colmap
    assert sparse_colmap.fold_check([],3)=={'method':'model turn against two-view turn, consecutive registered frames',
        'thresholdDegrees':15,'status':'not-checked','pairsChecked':0,'pairsSkipped':3,'pairsDisagreeing':0,
        'worstDisagreementDegrees':None,'disagreeing':[]}
    many=[{'from':str(k),'to':str(k+1),'matches':99,'disagreementDegrees':20+k} for k in range(30)]
    check=sparse_colmap.fold_check(many,0)
    assert check['pairsDisagreeing']==30 and len(check['disagreeing'])==20 and check['disagreeing'][0]['disagreementDegrees']==49


def fake_mapper(monkeypatch,joined_by_seed):
    """A stand-in pycolmap whose mapping joins joined_by_seed[seed] frames per model (an empty list finds none)."""
    import types
    class Model:
        def __init__(self,frames):self.frames=frames
        def num_reg_images(self):return self.frames
        def num_points3D(self):return self.frames*100
    seeds=[]
    def incremental_mapping(database,images,target,options):
        assert options['random_seed']==seeds[-1]
        for index,_ in enumerate(joined_by_seed[seeds[-1]]):(target/str(index)).mkdir()
        return {index:Model(frames) for index,frames in enumerate(joined_by_seed[seeds[-1]])}
    monkeypatch.setitem(sys.modules,'pycolmap',types.SimpleNamespace(set_random_seed=seeds.append,
        IncrementalPipelineOptions=dict,incremental_mapping=incremental_mapping))
    return seeds

def test_colmap_mapping_retries_another_seed_when_a_walkthrough_splits(tmp_path,monkeypatch):
    from robotics.world_worker.sparse_colmap import map_frames
    # Measured on a 62 s room video: seed 0 split it into 33 + 26 frames, seed 1 joined 57 of 60.
    seeds=fake_mapper(monkeypatch,{0:[33,26],1:[57],2:[57]})
    models,index,model,attempts=map_frames(tmp_path/'database.db',tmp_path/'images',tmp_path,60)
    assert seeds==[0,1] and model.num_reg_images()==57 and index==0
    assert attempts==[{'seed':0,'registered_images':33,'models_found':2},{'seed':1,'registered_images':57,'models_found':1}]
    assert (tmp_path/'sparse'/'selected.txt').read_text()=='0' and (tmp_path/'sparse'/'0').is_dir()
    assert not list(tmp_path.glob('sparse-seed-*'))

def test_colmap_mapping_keeps_the_best_attempt_and_stops_once_joined(tmp_path,monkeypatch):
    from robotics.world_worker.sparse_colmap import map_frames
    seeds=fake_mapper(monkeypatch,{0:[58]})
    assert map_frames(tmp_path/'database.db',tmp_path/'images',tmp_path,60)[2].num_reg_images()==58 and seeds==[0]
    other=tmp_path/'other';other.mkdir()
    seeds=fake_mapper(monkeypatch,{0:[20,10],1:[40,15],2:[]})
    models,index,model,attempts=map_frames(other/'database.db',other/'images',other,60)
    assert seeds==[0,1,2] and model.num_reg_images()==40 and [a['registered_images'] for a in attempts]==[20,40,0]
    empty=tmp_path/'empty';empty.mkdir()
    fake_mapper(monkeypatch,{0:[],1:[],2:[]})
    with pytest.raises(ValueError,match='Views could not be aligned'):map_frames(empty/'database.db',empty/'images',empty,60)
    assert not (empty/'sparse').exists()


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


def arena_cloud(**over):
    """A browser Arena hand-off (toArenaCloud shape) with a user-measured scale."""
    value={'version':1,'kind':'colmap-sparse-point-cloud','units':'m','coordinateFrame':'right-handed-y-up','sourceFrame':'colmap',
           'source':'sparse-preview.ply','points':[[x*.1,0,z*.1,90,80,70] for x in range(20) for z in range(20)],
           'floorEstimate':{'y':0,'origin':[0,0],'width':1.9,'depth':1.9,'support':1,'units':'m'},
           'scale':{'source':'user-measured','metresPerUnit':.42,'distance':.84,'spanUnits':2,'selfReported':True,'verified':False},
           'provenance':{'totalPoints':400,'keptPoints':400,'metricVerified':False}}
    return value|over


def upload_cloud(c,data,name='brainsnn-point-cloud.json'):
    r=c.post('/v1/uploads',json={'name':name,'kind':'cloud','size':len(data)},headers=HEADERS)
    if r.status_code!=201:return r
    uid=r.json()['id'];assert c.put(f'/v1/uploads/{uid}?offset=0',content=data,headers=HEADERS).status_code==200
    return uid


def cloud_adapter(tmp_path):
    script=tmp_path/'adapter.py';script.write_text(
        "import json,sys\nfrom pathlib import Path\n"
        "request=json.loads(Path(sys.argv[1]).read_text());out=Path(request['output_dir'])\n"
        "assert [i['kind'] for i in request['inputs']]==['cloud']\n"
        "cloud=json.loads(Path(request['inputs'][0]['path']).read_text())\n"
        "(out/'echo.json').write_text(json.dumps({'units':cloud['units'],'points':len(cloud['points'])}))\n"
        "(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':'echo.json','kind':'evidence'}]}))\n")
    config=tmp_path/'adapters.json'
    config.write_text(json.dumps([{'id':'scene-test','label':'TEST FIXTURE','enabled':True,'license_reviewed':True,
        'input_kinds':['video','cloud'],'max_inputs':1,'timeout_seconds':5,'command':[sys.executable,str(script),'{input_manifest}']}]))
    return config


def test_measured_cloud_handoff_reaches_a_cloud_engine(tmp_path):
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(cloud_adapter(tmp_path)))) as c:
        caps=c.get('/v1/capabilities',headers=HEADERS).json()
        assert next(e for e in caps['engines'] if e['id']=='scene-test')['input_kinds']==['video','cloud']
        uid=upload_cloud(c,json.dumps(arena_cloud()).encode())
        # The integrity engine never takes a cloud; the cloud engine does.
        assert c.post('/v1/jobs',json={'engine':'inspect','upload_ids':[uid],'consent':True},headers=HEADERS).status_code==422
        r=c.post('/v1/jobs',json={'engine':'scene-test','upload_ids':[uid],'consent':True},headers=HEADERS);assert r.status_code==201,r.text
        jid=r.json()['id'];c.post(f'/v1/jobs/{jid}/start',json={},headers=HEADERS)
        job=wait(c,jid);assert job['status']=='complete',job
        url=c.post(f'/v1/jobs/{jid}/ticket',json={'artifact':0},headers=HEADERS).json()['url']
        assert json.loads(c.get(url).content)=={'units':'m','points':400}


@pytest.mark.parametrize('bad',[
    b'not json', b'{"version":1,"points":[[0,0,0,1,2,NaN]]}', b'['*100_000+b']'*100_000,
    json.dumps(arena_cloud(kind='gaussian')).encode(),
    json.dumps(arena_cloud(points=[])).encode(),
    json.dumps(arena_cloud(points=[[0,0,0,1,2,3]]*50_001)).encode(),
    json.dumps(arena_cloud(points=[[0,0,0,1,2,300]])).encode(),
    json.dumps(arena_cloud(points=[[1e9,0,0,1,2,3]])).encode(),
    json.dumps(arena_cloud(points=[[0,0,0,1,2,True]])).encode(),
    # A few points at opposite corners of the coordinate limit: valid numbers, but a footprint of ~10^15 grid cells.
    json.dumps(arena_cloud(points=[[x,0,z,1,2,3] for x in (-9e6,9e6) for z in (-9e6,9e6) for _ in range(50)])).encode(),
    json.dumps(arena_cloud(points=[[x*2,0,z*2,1,2,3] for x in range(160) for z in range(160)])).encode(),
    json.dumps(arena_cloud(floorEstimate={'y':1e308,'units':'m'})).encode(),
    # A flat z exactly on a cell boundary must not zero out a huge x span.
    json.dumps(arena_cloud(points=[[x,0,0,1,2,3] for x in (-9e6,9e6) for _ in range(50)])).encode(),
    json.dumps(arena_cloud(floorEstimate={'y':.5,'units':'m'})).encode(),  # all points at y=0: beyond the 0.05 margin
    json.dumps(arena_cloud(scale=None)).encode(),
    json.dumps(arena_cloud(scale={'source':'user-measured','metresPerUnit':.42,'selfReported':True,'verified':True})).encode(),
    json.dumps(arena_cloud(units='arbitrary')).encode(),
])
def test_malformed_or_overclaiming_cloud_handoffs_are_refused(tmp_path,bad):
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(cloud_adapter(tmp_path)))) as c:
        uid=upload_cloud(c,bad)
        assert c.post('/v1/jobs',json={'engine':'scene-test','upload_ids':[uid],'consent':True},headers=HEADERS).status_code==422


def test_cloud_uploads_are_json_only_and_bounded(client):
    assert upload_cloud(client,b'{}',name='cloud.png').status_code==422
    assert client.post('/v1/uploads',json={'name':'cloud.json','kind':'cloud','size':16*1024**2+1},headers=HEADERS).status_code==422
    assert client.post('/v1/uploads',json={'name':'room.json','kind':'image','size':20},headers=HEADERS).status_code==422


def test_metric_artifact_units_are_kept_as_a_hint_never_verified():
    assert visual_metadata({'representation':'triangle-mesh','units':'m'})['units']=='m'
    for units in ['metres','M','ft',None]:
        assert visual_metadata({'representation':'triangle-mesh','units':units})['units']=='arbitrary'


def test_dense_multi_view_cloud_in_a_y_up_frame_is_admitted(tmp_path):
    with TestClient(create_app(root=tmp_path/'data',token=TOKEN,adapters=str(cloud_adapter(tmp_path)))) as c:
        uid=upload_cloud(c,json.dumps(arena_cloud(sourceFrame='right-handed-y-up',multiView=True)).encode())
        assert c.post('/v1/jobs',json={'engine':'scene-test','upload_ids':[uid],'consent':True},headers=HEADERS).status_code==201



def test_disk_check_tolerates_files_the_adapter_deletes_mid_walk(tmp_path, monkeypatch):
    """An adapter deletes its extracted video frames while the worker measures the job folder; that must not fail the job."""
    (tmp_path / 'frames').mkdir(); (tmp_path / 'frames' / 'a.jpg').write_bytes(b'x' * 10); (tmp_path / 'b.ply').write_bytes(b'y' * 5)
    os.symlink(tmp_path / 'b.ply', tmp_path / 'link.ply')
    assert directory_bytes(tmp_path) == 15  # symlinks are not counted twice
    real = os.lstat
    def vanishing(path, *args, **kwargs):
        if str(path).endswith('a.jpg'): raise FileNotFoundError(path)
        return real(path, *args, **kwargs)
    monkeypatch.setattr(os, 'lstat', vanishing)
    assert directory_bytes(tmp_path) == 5


def source_config(tmp_path, *, secret=None):
    """An adapter that may read an earlier job and receives one secret; it records what it was given."""
    script = tmp_path / 'source_adapter.py'
    script.write_text("import json,sys,os\nfrom pathlib import Path\n"
                      "request=json.loads(Path(sys.argv[1]).read_text());out=Path(request['output_dir'])\n"
                      "seen={'source':request.get('source'),'secret':os.environ.get('FIXTURE_NAMING_KEY'),'token':'WORLD_WORKER_TOKEN' in os.environ}\n"
                      "(out/'seen.json').write_text(json.dumps(seen))\n"
                      "(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':'seen.json','kind':'evidence'}]}))\n")
    config = tmp_path / 'adapters.json'
    config.write_text(json.dumps([
        {'id': 'test-source', 'label': 'TEST FIXTURE', 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'],
         'max_inputs': 1, 'timeout_seconds': 5, 'source_job': True, 'secrets': ['FIXTURE_NAMING_KEY'],
         'object_naming': {'provider': 'Fixture', 'model': 'fixture-model'}, 'command': [sys.executable, str(script), '{input_manifest}']},
        {'id': 'test-plain', 'label': 'TEST FIXTURE', 'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'],
         'max_inputs': 1, 'timeout_seconds': 5, 'command': [sys.executable, str(script), '{input_manifest}']}]))
    return config


def test_a_job_reads_an_earlier_job_only_where_configured_and_receives_only_its_own_secret(tmp_path, monkeypatch):
    monkeypatch.setenv('FIXTURE_NAMING_KEY', 'fixture-secret-value')
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(source_config(tmp_path)))) as c:
        engines = {e['id']: e for e in c.get('/v1/capabilities', headers=HEADERS).json()['engines']}
        assert engines['test-source']['object_naming'] == {'provider': 'Fixture', 'model': 'fixture-model'}
        assert 'object_naming' not in engines['test-plain']
        earlier, _ = make_job(c)
        uid = upload(c)
        body = {'engine': 'test-source', 'upload_ids': [uid], 'consent': True, 'source_job': earlier}
        assert c.post('/v1/jobs', json=body, headers=HEADERS).status_code == 409, 'the earlier job has not run yet'
        c.post(f'/v1/jobs/{earlier}/start', json={}, headers=HEADERS); assert wait(c, earlier)['status'] == 'complete'
        assert c.post('/v1/jobs', json=body | {'engine': 'test-plain'}, headers=HEADERS).status_code == 422
        assert c.post('/v1/jobs', json=body | {'source_job': 'f' * 32}, headers=HEADERS).status_code == 404
        r = c.post('/v1/jobs', json=body, headers=HEADERS); assert r.status_code == 201, r.text
        jid = r.json()['id']; c.post(f'/v1/jobs/{jid}/start', json={}, headers=HEADERS)
        assert wait(c, jid)['status'] == 'complete'
        seen = json.loads((tmp_path / 'data' / 'jobs' / jid / 'output' / 'seen.json').read_text())
        assert seen['source'] == {'job': earlier, 'engine': 'inspect', 'path': str((tmp_path / 'data' / 'jobs' / earlier).resolve())}
        assert seen['secret'] == 'fixture-secret-value' and seen['token'] is False
        # The plain adapter gets no source and not the other adapter's secret.
        plain, _ = make_job(c, 'test-plain'); c.post(f'/v1/jobs/{plain}/start', json={}, headers=HEADERS); wait(c, plain)
        seen = json.loads((tmp_path / 'data' / 'jobs' / plain / 'output' / 'seen.json').read_text())
        assert seen == {'source': None, 'secret': None, 'token': False}


def test_naming_is_not_offered_without_its_secret_and_bad_secret_names_are_refused(tmp_path, monkeypatch):
    monkeypatch.delenv('FIXTURE_NAMING_KEY', raising=False)
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(source_config(tmp_path)))) as c:
        assert all('object_naming' not in e for e in c.get('/v1/capabilities', headers=HEADERS).json()['engines'])
    config = source_config(tmp_path); entries = json.loads(config.read_text())
    for bad in (['WORLD_WORKER_TOKEN'], ['lower_case'], 'ANTHROPIC_API_KEY', ['A', 'B', 'C', 'D', 'E']):
        entries[0]['secrets'] = bad; config.write_text(json.dumps(entries))
        with pytest.raises(ValueError, match='secrets'):
            create_app(root=tmp_path / 'data2', token=TOKEN, adapters=str(config))


def test_on_worker_detection_is_offered_without_a_secret_and_must_be_well_formed(tmp_path, monkeypatch):
    monkeypatch.delenv('FIXTURE_NAMING_KEY', raising=False)
    config = source_config(tmp_path); entries = json.loads(config.read_text())
    entries[0]['object_detection'] = {'provider': 'on-worker detector', 'model': 'EfficientDet-Lite2 (COCO)'}
    config.write_text(json.dumps(entries))
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(config))) as c:
        engines = c.get('/v1/capabilities', headers=HEADERS).json()['engines']
        assert [e['object_detection'] for e in engines if 'object_detection' in e] == [entries[0]['object_detection']]
        assert all('object_naming' not in e for e in engines)
    for bad in ('EfficientDet', {'provider': 'x', 'weights': 'y'}, {'provider': ''}, {'model': 'x' * 81}):
        entries[0]['object_detection'] = bad; config.write_text(json.dumps(entries))
        with pytest.raises(ValueError, match='object_detection'):
            create_app(root=tmp_path / 'data2', token=TOKEN, adapters=str(config))


def test_dimensional_and_bim_review_capabilities_need_explicit_boolean_flags(tmp_path):
    config = source_config(tmp_path); entries = json.loads(config.read_text())
    entries[0].update(dimension_checks=True, bim_review=False)
    entries[1].update(dimension_checks=False, bim_review=True)
    config.write_text(json.dumps(entries))
    with TestClient(create_app(root=tmp_path / 'data', token=TOKEN, adapters=str(config))) as c:
        engines = {e['id']: e for e in c.get('/v1/capabilities', headers=HEADERS).json()['engines']}
        assert engines['test-source']['dimension_checks'] is True and 'bim_review' not in engines['test-source']
        assert engines['test-plain']['bim_review'] is True and 'dimension_checks' not in engines['test-plain']
        assert 'dimension_checks' not in engines['inspect'] and 'bim_review' not in engines['inspect']
    for feature in ('dimension_checks', 'bim_review'):
        for bad in (1, 0, 'true', None, [], {}):
            rows = json.loads(json.dumps(entries)); rows[0][feature] = bad
            config.write_text(json.dumps(rows))
            with pytest.raises(ValueError, match=feature):
                create_app(root=tmp_path / 'bad-data', token=TOKEN, adapters=str(config))


def test_a_hand_off_keeps_its_source_transform_and_naming_approval_only_when_well_formed(tmp_path):
    from robotics.world_worker.geometry import load_arena_cloud
    path = tmp_path / 'cloud.json'
    good = [[.4, 0, 0, 1.0], [0, .4, 0, -2.0], [0, 0, .4, 3.0]]
    path.write_text(json.dumps(arena_cloud(fromSource=good, nameObjects=True)))
    cloud = load_arena_cloud(path)
    assert cloud['fromSource'] == good and cloud['nameObjects'] is True
    path.write_text(json.dumps(arena_cloud(nameObjects='yes')))
    assert 'nameObjects' not in load_arena_cloud(path) and 'fromSource' not in load_arena_cloud(path)
    for bad in ([[1, 0, 0, 0], [0, 1, 0, 0]], [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, '0']], [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1e9, 0]], 'identity'):
        path.write_text(json.dumps(arena_cloud(fromSource=bad)))
        with pytest.raises(ValueError, match='transform'):
            load_arena_cloud(path)
