"""Authored geometry, actual H.264 encoding and private HTTP export contracts."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image
import pytest
from fastapi.testclient import TestClient

from robotics.world_worker import camera_frames as cf, demo_replay as dr
from robotics.world_worker.app import create_app
from robotics.world_worker.geometry import write_point_cloud


def dump(path, value):
    path.write_text(json.dumps(value, allow_nan=False))


def authored_job(root):
    (root/'output').mkdir(parents=True)
    images=root/'colmap-work/images';images.mkdir(parents=True)
    source=[{'name':'authored-fixture.mp4','kind':'video','sha256':hashlib.sha256(b'authored fixture, no real video').hexdigest()}]
    frames=[]
    for ordinal in (0,2,4):
        image=images/f'image_{ordinal:04d}.jpg'
        Image.new('RGB',(320,240),(30+ordinal*40,80,160)).save(image)
        pose=[[1,0,0,-ordinal*.15],[0,1,0,0],[0,0,1,0]]
        camera={'model':'PINHOLE','params':[250,250,159.5,119.5]}
        frame={'frame_id':cf.frame_id(source[0]['sha256'],dr.sha(image),camera,pose),
            'image':cf.file_record(root,image,width=320,height=240),
            'origin':{'sourceIndex':0,'sourceWidth':320,'sourceHeight':240,'exifOrientation':1,
                      'sourceToFramePixelCenter':[[1,0,0],[0,1,0],[0,0,1]]},
            'timestamp':None,'camera':camera,'cam_from_world':pose}
        frames.append(frame)
    points=np.array([[x,y,z] for x in (-1,0,1) for y in (-.5,.5) for z in (2,3)],float)
    write_point_cloud(root/'output/sparse-preview.ply',points,np.full_like(points,100),coordinate_frame='colmap')
    dump(root/'output/reconstruction.json',{'schema':'brainsnn.reconstruction.v1','sources':source,
        'capture':{'images':5,'registered_images':3,'consistency':{'status':'consistent'}},
        'warnings':['Explicit authored test, not a phone reconstruction.'],'metric_verified':False})
    record={'schema':cf.SCHEMA,'sources':source,
        'reconstruction':cf.file_record(root,root/'output/reconstruction.json'),
        'clouds':[cf.file_record(root,root/'output/sparse-preview.ply',coordinate_frame='colmap')],
        'frames':frames,'metric_verified':False}
    cf.write(root,record)
    options={'schema':dr.SCHEMA,'source_artifact':'reconstruction.json','source_sha256':dr.sha(root/'output/reconstruction.json'),
        'title':'Authored replay test','credit':'Authored rasters and geometry; no physical accuracy claim',
        'capture_kind':'authored-fixture','ending':'reconstruction','reviewed':True}
    return options


def scene_job(root, reconstruction):
    import trimesh
    (root/'output').mkdir(parents=True)
    points=dr.prepare(reconstruction,reconstruction,authored_options(reconstruction))['points']
    cloud={'version':1,'kind':'colmap-sparse-point-cloud','units':'m','coordinateFrame':'right-handed-y-up',
        'sourceFrame':'colmap','source':'sparse-preview.ply','points':np.c_[points,np.full_like(points,100)].tolist(),
        'fromSource':[[1,0,0,0],[0,1,0,0],[0,0,1,0]],'floorEstimate':None,
        'scale':{'source':'user-measured','metresPerUnit':1,'distance':1,'spanUnits':1,'selfReported':True,'verified':False},
        'provenance':{'metricVerified':False,'floorAligned':True}}
    scene={'schema':'brainsnn.scene.v1','units':'m','scale':cloud['scale'],'walls':[],
        'objects':[{'name':'floor_observed','label':'floor','kind':'floor','min':[-3,-.02,-3],
                    'max':[3,0,3],'centre':[0,-.01,0],'size':[6,.02,6],'provenance':'observed'}],
        'unknown':[],'floor_y':0,'counts':{'walls':0,'objects':1,'input_points':len(points)}}
    dump(root/'output/arena-cloud.json',cloud);dump(root/'output/scene.json',scene);dump(root/'output/scene-usd.json',{'units':'m'})
    mesh=trimesh.Scene();mesh.add_geometry(trimesh.creation.box(extents=[6,.02,6]),node_name='floor_observed')
    (root/'output/scene.glb').write_bytes(mesh.export(file_type='glb'))
    return {**authored_options(reconstruction),'source_artifact':'scene.json','source_sha256':dr.sha(root/'output/scene.json'),'ending':'bim'}


def authored_options(root):
    return {'schema':dr.SCHEMA,'source_artifact':'reconstruction.json','source_sha256':dr.sha(root/'output/reconstruction.json'),
            'title':'Authored replay test','credit':'Authored test only','capture_kind':'authored-fixture','ending':'reconstruction','reviewed':True}


@pytest.mark.parametrize('change',[
    lambda o:o.update(reviewed=False),lambda o:o.update(source_artifact='../scene.json'),
    lambda o:o.update(source_sha256='wrong'),lambda o:o.update(title=''),lambda o:o.update(credit='\nprivate'),
    lambda o:o.update(ending='bim'),lambda o:o.update(capture_kind='surveyed'),
    lambda o:o.update(path='/etc/passwd'),lambda o:o.update(title='x'*81)])
def test_request_rejects_unreviewed_unbound_or_injected_options(tmp_path,change):
    options=authored_job(tmp_path/'job');change(options)
    with pytest.raises(ValueError):dr.validate_options(options)


def test_prepare_preserves_exact_frame_hashes_ordinals_denominator_and_unknown_time(tmp_path):
    job=tmp_path/'job';options=authored_job(job)
    bundle=dr.prepare(job,job,options)
    assert [f['ordinal'] for f in bundle['frames']]==[0,2,4]
    assert bundle['total']==5 and not bundle['timed']
    assert 'PARTIAL' in bundle['warning']
    assert 'AUTHORED' in bundle['capture_label']
    assert len(bundle['points'])==12
    for f in bundle['frames']:assert dr.sha(job/f['image']['name'])==f['image']['sha256']


@pytest.mark.parametrize('which',['source','image','points','ledger'])
def test_stale_source_or_frame_bytes_never_render(tmp_path,which):
    job=tmp_path/'job';options=authored_job(job)
    path={'source':'output/reconstruction.json','image':'colmap-work/images/image_0000.jpg',
          'points':'output/sparse-preview.ply','ledger':'output/camera-frames.json'}[which]
    with (job/path).open('ab') as stream:stream.write(b'changed')
    with pytest.raises((ValueError,json.JSONDecodeError)):dr.prepare(job,job,options)


def test_original_pts_are_used_only_when_bound_and_strictly_increasing(tmp_path):
    job=tmp_path/'job';options=authored_job(job)
    ledger=dr.read_json(job/'output/camera-frames.json')
    for i,f in enumerate(ledger['frames']):f['timestamp']={'pts':i*i+2,'timeBase':[1,10]}
    dump(job/'output/camera-frames.json',ledger)
    assert dr.prepare(job,job,options)['timed']
    ledger['frames'][1]['timestamp']=ledger['frames'][0]['timestamp'];dump(job/'output/camera-frames.json',ledger)
    with pytest.raises(ValueError,match='strictly increasing'):dr.prepare(job,job,options)


def test_metric_scene_uses_actual_glb_and_rejects_wrong_source_cloud(tmp_path):
    reconstruction=tmp_path/'rec';authored_job(reconstruction)
    scene=tmp_path/'scene';options=scene_job(scene,reconstruction)
    bundle=dr.prepare(scene,reconstruction,options)
    assert len(bundle['mesh'][0])==12 and bundle['scene']['units']=='m'
    # Unscaled compiled jobs still support truthful reconstruction playback.
    unscaled=dr.read_json(scene/'output/scene.json');unscaled.update(units='arbitrary',scale=None);dump(scene/'output/scene.json',unscaled)
    cloud=dr.read_json(scene/'output/arena-cloud.json');cloud.update(units='arbitrary',scale=None);dump(scene/'output/arena-cloud.json',cloud)
    options.update(source_sha256=dr.sha(scene/'output/scene.json'),ending='reconstruction')
    assert dr.prepare(scene,reconstruction,options)['scene']['units']=='arbitrary'
    with pytest.raises(ValueError,match='metric'):dr.prepare(scene,reconstruction,{**options,'ending':'bim'})
    cloud=dr.read_json(scene/'output/arena-cloud.json');cloud['points'][0][0]+=.2;dump(scene/'output/arena-cloud.json',cloud)
    with pytest.raises(ValueError):dr.prepare(scene,reconstruction,options)


def test_actual_site_planner_route_retains_automated_review_and_physical_limits(tmp_path):
    if not shutil.which('node'):pytest.skip('Node is required for the real site planner')
    rec=tmp_path/'rec';authored_job(rec);scene=tmp_path/'scene';options=scene_job(scene,rec);options['ending']='robot'
    route=dr.plan_route(dr.prepare(scene,rec,options),tmp_path/'route.json')
    assert route['route'] and route['distance']>0
    assert route['provenance']['automatedReviewFlags'] and not route['provenance']['humanAccepted']
    assert not route['provenance']['physicalRobotValidated']


def test_actual_h264_has_expected_frames_and_source_bound_receipt(tmp_path):
    if not shutil.which('ffmpeg'):pytest.skip('FFmpeg required')
    job=tmp_path/'job';options=authored_job(job);out=tmp_path/'videos'
    result=dr.render(job,job,out,options,formats={'landscape':(640,480,1)},fps=4)
    assert not result['realtimeProcessing'] and not result['incrementalGeometryClaimed']
    assert result['registeredFrames']==3 and result['inputFrames']==5
    assert result['geometryPlayback']=='complete-final-cloud-throughout'
    assert not result['metric_verified'] and not result['bimApplicationImportShown'] and not result['physicalRobotValidated']
    movie=out/'demo-landscape.mp4'
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',str(movie)]))
    stream=probe['streams'][0]
    assert stream['codec_name']=='h264' and (stream['width'],stream['height'])==(640,480) and stream['nb_read_frames']=='4'
    assert result['outputs'][0]['sha256']==dr.sha(movie)
    assert len(dr.read_json(out/'manifest.json')['artifacts'])==2
    with pytest.raises(ValueError,match='fresh'):dr.render(job,job,out,options,formats={'landscape':(640,480,1)},fps=1)


def test_source_mutation_during_render_publishes_no_success(tmp_path,monkeypatch):
    job=tmp_path/'job';options=authored_job(job);out=tmp_path/'videos'
    def changed(paint,path,width,height,seconds,**kw):
        path.write_bytes(b'explicit encoder stand-in')
        (job/'colmap-work/images/image_0000.jpg').write_bytes(b'changed')
        return {'name':path.name}
    monkeypatch.setattr(dr,'encode',changed)
    with pytest.raises(ValueError):dr.render(job,job,out,options,formats={'landscape':(640,480,1)})
    assert not (out/'manifest.json').exists() and not list(out.glob('*.mp4'))


def test_nested_output_is_refused_without_source_changes(tmp_path):
    job=tmp_path/'job';options=authored_job(job)
    with pytest.raises(ValueError,match='separate'):dr.render(job,job,job/'videos',options)
    assert not (job/'videos').exists()


def test_private_http_job_renders_and_signed_download_matches_hash(tmp_path):
    if not shutil.which('ffmpeg'):pytest.skip('FFmpeg required')
    adapter=tmp_path/'adapter.py'
    adapter.write_text('import sys,json\nfrom pathlib import Path\nsys.path.insert(0,'+repr(str(dr.ROOT))+')\nfrom robotics.world_worker import demo_replay as d\nr=d.read_json(sys.argv[1]);s=r["source"];o=d.read_json(r["inputs"][0]["path"]);d.render(s["path"],s["reconstruction"]["path"],r["output_dir"],o,formats={"landscape":(640,480,1)},fps=2)\n')
    config=tmp_path/'adapters.json';dump(config,[{'id':'demo-replay','enabled':True,'license_reviewed':True,'input_kinds':['replay'],
        'max_inputs':1,'source_job':True,'timeout_seconds':30,'command':[sys.executable,str(adapter),'{input_manifest}']}])
    token='private-test-token-'+'x'*40;headers={'Authorization':'Bearer '+token}
    app=create_app(root=tmp_path/'worker',token=token,adapters=str(config))
    with TestClient(app) as client:
        store=app.state.store;sid='a'*32;job=store.root/'jobs'/sid
        options=authored_job(job)
        store.db.execute('INSERT INTO jobs(id,engine,status,uploads,created,error,artifacts,owner_id) VALUES(?,?,?,?,?,?,?,?)',
            (sid,'colmap-sparse','complete','[]',time.time(),None,'[]','operator'));store.db.commit()
        assert client.get('/v1/capabilities').status_code==401
        assert client.post('/v1/uploads',headers=headers,json={'name':'large.json','kind':'replay','size':8193}).status_code==422
        data=json.dumps(options).encode()
        uid=client.post('/v1/uploads',headers=headers,json={'name':'request.json','kind':'replay','size':len(data)}).json()['id']
        assert client.put(f'/v1/uploads/{uid}?offset=0',headers=headers,content=data).status_code==200
        response=client.post('/v1/jobs',headers=headers,json={'engine':'demo-replay','upload_ids':[uid],'source_job':sid,'consent':True})
        assert response.status_code==201,response.text
        jid=response.json()['id'];client.post(f'/v1/jobs/{jid}/start',headers=headers)
        for _ in range(200):
            response=client.get(f'/v1/jobs/{jid}',headers=headers).json()
            if response['status'] in ('complete','failed'):break
            time.sleep(.05)
        assert response['status']=='complete',response
        index,entry=next((i,a) for i,a in enumerate(response['artifacts']) if a['name'].endswith('.mp4'))
        ticket=client.post(f'/v1/jobs/{jid}/ticket',headers=headers,json={'artifact':index}).json()
        downloaded=client.get(ticket['url']);assert hashlib.sha256(downloaded.content).hexdigest()==entry['sha256']
        assert client.get(f'/v1/jobs/{jid}',headers={'Authorization':'Bearer wrong'}).status_code==401
        # Even an owned scene must not inherit another owner's private rasters.
        foreign_id,scene_id='b'*32,'c'*32
        foreign=store.root/'jobs'/foreign_id;authored_job(foreign)
        owned_scene=store.root/'jobs'/scene_id;scene_options=scene_job(owned_scene,foreign)
        for key,engine,owner,parent in [(foreign_id,'colmap-sparse','another-owner',None),(scene_id,'scene-usd','operator',foreign_id)]:
            store.db.execute('INSERT INTO jobs(id,engine,status,uploads,created,error,artifacts,owner_id,source_job) VALUES(?,?,?,?,?,?,?,?,?)',
                (key,engine,'complete','[]',time.time(),None,'[]',owner,parent))
        store.db.commit()
        assert client.post('/v1/jobs',headers=headers,json={'engine':'demo-replay','upload_ids':[uid],'source_job':foreign_id,'consent':True}).status_code==404
        data=json.dumps(scene_options).encode()
        second=client.post('/v1/uploads',headers=headers,json={'name':'scene-request.json','kind':'replay','size':len(data)}).json()['id']
        client.put(f'/v1/uploads/{second}?offset=0',headers=headers,content=data)
        blocked=client.post('/v1/jobs',headers=headers,json={'engine':'demo-replay','upload_ids':[second],'source_job':scene_id,'consent':True}).json()['id']
        client.post(f'/v1/jobs/{blocked}/start',headers=headers)
        for _ in range(200):
            state=client.get(f'/v1/jobs/{blocked}',headers=headers).json()
            if state['status'] in ('failed','complete'):break
            time.sleep(.05)
        assert state['status']=='failed' and state['artifacts']==[]
