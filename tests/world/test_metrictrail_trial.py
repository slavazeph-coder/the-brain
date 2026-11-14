"""Authored numeric artifacts exercise the bridge. No model inference or physical capture."""
import copy
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import pytest
from robotics.world_worker import metrictrail_trial as mt

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value));return path

def fixture(tmp_path):
    root=tmp_path/'raw';name='authored';video=tmp_path/'authored.mp4';video.write_bytes(b'authored provenance bytes; no video decode in importer')
    matrix=np.repeat(np.eye(4)[None],16,axis=0);matrix[:,0,3]=np.arange(16)/10
    (root/'pose').mkdir(parents=True);np.savez(root/'pose'/f'{name}.npz',data=matrix,source_frame_ids=np.arange(16)*2)
    (root/'intrinsics').mkdir();np.savez(root/'intrinsics'/f'{name}.npz',data=np.repeat([[100,100,100,100]],16,axis=0))
    # A camera-up Z plane becomes Y-up, with a nonzero range on both floor axes.
    points=[(x/10,y/10,0) for y in range(10) for x in range(10)]
    (root/'pointcloud').mkdir();ply=root/'pointcloud'/f'{name}.ply'
    ply.write_text('ply\nformat ascii 1.0\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'+'\n'.join(f'{x} {y} {z} 100 120 140' for x,y,z in points)+'\n')
    run={'schema':'metrictrail_vipe_run_v1','status':'success','name':name,'tracking_status':'tracked',
        'tracking':{'metric_prior_status':'applied'},'tracking_stride':{'source_frame_ids':list(range(0,32,2))},
        'input_raster':{'source_fps':30,'source_frames':32,'target_hw':[280,504]}}
    write(root/'vipe'/f'{name}_metrictrail.json',run)
    fusion=write(tmp_path/'fusion.json',{'frame':'z_up','world_to_output_rotation':np.eye(3).tolist(),
        'frames':16,'voxels':100,'settings':{'min_consistent':4,'voxel_size_m':.02}})
    return dict(video=video,run_root=root,name=name,fusion=fusion,out=tmp_path/'handoff',evaluation_only=True)

def test_real_point_bridge_preserves_inputs_scale_distinctions_and_camera_frame(tmp_path):
    args=fixture(tmp_path);original={p:p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    receipt=mt.ingest(**args)
    assert receipt['status']=='imported' and not receipt['metricVerified'] and not receipt['productionEngineEnabled']
    estimated=json.loads((args['out']/'estimated-metric-cloud.json').read_text())
    browser=json.loads((args['out']/'arena-cloud.json').read_text())
    assert estimated['scale']['source']=='model-estimated' and estimated['scale']['selfReported'] is False
    assert browser['units']=='arbitrary' and browser['scale'] is None and browser['multiView'] is False
    assert len(browser['points'])<=50000 and browser['provenance']['metricVerified'] is False
    assert all(p.read_bytes()==b for p,b in original.items())
    poses=json.loads((args['out']/'camera-path.json').read_text())['frames']
    assert poses[1]['timeSeconds']==pytest.approx(2/30)
    a=np.asarray(estimated['fromSource']);p=np.asarray(poses[1]['cameraToHandoff'])
    np.testing.assert_allclose(p[:3,3],a[:,:3]@np.array([.1,0,0])+a[:,3])
    for name,row in receipt['outputs'].items():assert row['sha256']==hashlib.sha256((args['out']/name).read_bytes()).hexdigest()
    with pytest.raises(ValueError,match='fresh'):mt.ingest(**args)

@pytest.mark.parametrize('change', ['static','no-prior','wrong-rotation','no-filter','wrong-count','wrong-ids','unsigned-order','reflection','bad-fps','traversal','pickle'])
def test_failed_or_mismatched_artifacts_never_publish_success(tmp_path,change):
    args=fixture(tmp_path);path=args['run_root']/'vipe'/'authored_metrictrail.json'
    run=json.loads(path.read_text());fused=json.loads(args['fusion'].read_text())
    if change=='static':run['tracking_status']='not_initialized_static_or_too_short'
    if change=='no-prior':run['tracking']['metric_prior_status']='not_applied'
    if change=='wrong-rotation':fused['world_to_output_rotation'][0][0]=2
    if change=='no-filter':fused['settings']['min_consistent']=0
    if change=='wrong-count':fused['voxels']=99
    if change=='wrong-ids':run['tracking_stride']['source_frame_ids'][1]=99
    if change=='unsigned-order':
        ids=np.arange(16,dtype=np.uint64)*2;ids[0],ids[1]=ids[1],ids[0]
        run['tracking_stride']['source_frame_ids']=ids.tolist()
        np.savez(args['run_root']/'pose'/'authored.npz',data=np.repeat(np.eye(4)[None],16,axis=0),source_frame_ids=ids)
    if change=='reflection':
        poses=np.repeat(np.eye(4)[None],16,axis=0);poses[:,0,0]=-1
        np.savez(args['run_root']/'pose'/'authored.npz',data=poses,source_frame_ids=np.arange(16)*2)
    if change=='bad-fps':run['input_raster']['source_fps']=True
    if change=='traversal':args['name']='../authored'
    if change=='pickle':np.savez(args['run_root']/'pose'/'authored.npz',data=np.array([object()],dtype=object),source_frame_ids=np.arange(16)*2)
    write(path,run);write(args['fusion'],fused)
    with pytest.raises((ValueError,KeyError)):mt.ingest(**args)
    assert not args['out'].exists()

def test_large_cloud_stays_inside_existing_fifty_thousand_point_budget(tmp_path,monkeypatch):
    args=fixture(tmp_path);ply=args['run_root']/'pointcloud'/'authored.ply';count=90000
    ply.write_text('ply\nformat ascii 1.0\nelement vertex '+str(count)+'\nproperty float x\nproperty float y\nproperty float z\nend_header\n'+'\n'.join(f'{x*.021} {y*.021} 0' for y in range(300) for x in range(300))+'\n')
    f=json.loads(args['fusion'].read_text());f['voxels']=count;write(args['fusion'],f)
    monkeypatch.setattr(mt.scene_usd,'fit_floor_plane',lambda *_:None)
    result=mt.ingest(**args)
    assert result['sampling']['points_in_file']==count
    assert result['sampling']['points_kept']<=50000 and result['sampling']['voxel_metres']>.02
    assert result['pointsHandedOff']<=50000

def test_unreviewed_code_or_tampered_weights_are_rejected_before_execution(tmp_path,monkeypatch):
    source=tmp_path/'source';source.mkdir();weights={}
    pins=copy.deepcopy(mt.WEIGHTS)
    for key in pins:
        path=tmp_path/key;path.write_bytes(key.encode());weights[key]=path
        pins[key].update(sha256=hashlib.sha256(key.encode()).hexdigest(),bytes=len(key))
    monkeypatch.setattr(mt,'WEIGHTS',pins)
    class Result:
        def __init__(self,text):self.stdout=text
    monkeypatch.setattr(mt.subprocess,'run',lambda cmd,**kw:Result(mt.SOURCE_REVISION if cmd[-1]=='HEAD' else ''))
    assert mt.preflight(source,weights)['targetGpuQualified'] is False
    weights['moge'].write_bytes(b'changed')
    with pytest.raises(ValueError,match='Unreviewed'):mt.preflight(source,weights)
    monkeypatch.setattr(mt.subprocess,'run',lambda *a,**kw:Result('dirty'))
    with pytest.raises(ValueError,match='clean'):mt.preflight(source,weights)

def test_failed_tracking_is_retained_as_failure_without_a_handoff(tmp_path,monkeypatch):
    video=tmp_path/'test.mp4';video.write_bytes(b'authored')
    monkeypatch.setattr(mt,'preflight',lambda *a:{'targetGpuQualified':False})
    monkeypatch.setattr(mt.rc,'bounded_process',lambda *a,**kw:{'status':'timeout','exitCode':-9})
    with pytest.raises(RuntimeError,match='tracking did not complete'):
        mt.execute(source=tmp_path,video=video,python=Path(sys.executable),weights={k:tmp_path/k for k in mt.WEIGHTS},out=tmp_path/'trial',evaluation_only=True)
    report=json.loads((tmp_path/'trial'/'execution.json').read_text())
    assert report['status']=='failed' and not (tmp_path/'trial'/'handoff').exists()

def test_evaluation_scope_is_explicit(tmp_path):
    args=fixture(tmp_path);args['evaluation_only']=False
    with pytest.raises(ValueError,match='evaluation-only'):mt.ingest(**args)
