"""Research-only MetricTrail trial and bounded result bridge. Not a production worker engine.

Uses reviewed local code/weights, never installs or downloads them. Predicted metres
are retained in a separate experimental cloud; the browser handoff stays unscaled.
"""
from __future__ import annotations
import argparse
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
from . import reconstruction_comparison as rc, scene_usd, survey_cloud
from robotics.scene_compiler.nav2_export import _publish_directory

SOURCE_REVISION = 'ead2e008bc055310121736a49ff306bba50d10dc'
WEIGHTS = {
    'dpvo': {'sha256':'d0aa57e165b159fc84bdb9d94918ad9b508c153acfb4c46f5058ab80421fb5f5', 'bytes':13739570,
             'repository':'nvidia/MetricTrail', 'revision':'f5a3ce1cebd2a6a35c30ffb138caa07122731fff'},
    'dino': {'sha256':'08c60483bc63c04f533611e34bf70b120eedb7240f469bc16e9e20bf344b941d',
             'file':'dinov3_vits16_pretrain_lvd1689m-08c60483.pth'},
    'moge': {'sha256':'3eefd4abb2102f38f12b2d1992e5ff15e4923e5431c67dd494afe157e0111cd5', 'bytes':1305030700,
             'repository':'Ruicheng/moge-2-vitl', 'revision':'39c4d5e957afe587e04eec59dc2bcc3be5ecd968'},
}
MAX_FRAMES = 1500

def file_record(path, limit=2*1024**3):
    path=rc.regular_source(path,limit)
    return {'name':path.name,'bytes':path.stat().st_size,'sha256':rc.sha(path)}

def preflight(source, weights):
    source=Path(source)
    if not source.is_absolute() or source.is_symlink() or not source.is_dir():
        raise ValueError('Use an absolute regular ViPE source checkout.')
    command=['git','-c','core.fsmonitor=false','-C',str(source)]
    head=subprocess.run([*command,'rev-parse','HEAD'],check=True,capture_output=True,text=True,timeout=15).stdout.strip()
    dirty=subprocess.run([*command,'status','--porcelain','--untracked-files=all'],check=True,capture_output=True,text=True,timeout=15).stdout.strip()
    if head!=SOURCE_REVISION or dirty:raise ValueError('Use clean ViPE source at '+SOURCE_REVISION)
    result={}
    for key,pin in WEIGHTS.items():
        actual=file_record(weights[key])
        if actual['sha256']!=pin['sha256'] or ('bytes' in pin and actual['bytes']!=pin['bytes']):
            raise ValueError('Unreviewed '+key+' checkpoint. No inference started.')
        result[key]={**pin,**actual}
    return {'repository':'https://github.com/nv-tlabs/vipe','revision':head,'weights':result,
            'weightUse':'noncommercial research/evaluation only; dependent model terms also apply',
            'targetGpuQualified':False,'paperBenchmarksReproduced':False}

def rigid(matrix):
    m=np.asarray(matrix,dtype=float)
    return m.shape==(3,3) and np.isfinite(m).all() and np.allclose(m.T@m,np.eye(3),atol=1e-5,rtol=0) and np.isclose(np.linalg.det(m),1,atol=1e-5)

def poses(path):
    """Read bounded numeric NPZ only. Never unpickle the upstream _info.pkl."""
    rc.regular_source(path,16*1024**2)
    with zipfile.ZipFile(path) as archive:
        if sum(x.file_size for x in archive.infolist())>32*1024**2:raise ValueError('Expanded pose archive exceeds limit.')
    with np.load(path,allow_pickle=False) as data:
        matrices=np.asarray(data['data'],float)
        frame_ids=np.asarray(data['source_frame_ids'])
    if (matrices.ndim!=3 or matrices.shape[1:]!=(4,4) or not 16<=len(matrices)<=MAX_FRAMES
            or frame_ids.shape!=(len(matrices),) or not np.issubdtype(frame_ids.dtype,np.integer)
            or np.any(frame_ids<0) or np.any(np.diff(frame_ids)<=0) or not np.isfinite(matrices).all()
            or np.abs(matrices[:,:3,3]).max()>100000 or not np.allclose(matrices[:,3],[0,0,0,1],atol=1e-7,rtol=0)
            or not all(rigid(m[:3,:3]) for m in matrices)):
        raise ValueError('Expected bounded proper camera-to-world poses and ordered source frame IDs.')
    return matrices,frame_ids

def ingest(*, video, run_root, name, fusion, out, evaluation_only=False):
    if evaluation_only is not True:raise ValueError('Explicit --evaluation-only required; no commercial engine is enabled.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}',name):raise ValueError('Use a plain run name.')
    video=rc.regular_source(video);root=Path(run_root);out=Path(out)
    if root.is_symlink() or not root.is_dir() or out.exists() or out.is_symlink():raise ValueError('Use a regular run directory and fresh output directory.')
    record_path=root/'vipe'/f'{name}_metrictrail.json';pose_path=root/'pose'/f'{name}.npz'
    cloud_path=root/'pointcloud'/f'{name}.ply';intrinsics=root/'intrinsics'/f'{name}.npz'
    run=rc.read_json(record_path);fused=rc.read_json(fusion)
    if (run.get('schema')!='metrictrail_vipe_run_v1' or run.get('status')!='success' or run.get('name')!=name
            or run.get('tracking_status')!='tracked' or run.get('tracking',{}).get('metric_prior_status')!='applied'):
        raise ValueError('Successful initialized tracking with an applied metric prior is required, not a partial/static result.')
    if fused.get('frame')!='z_up' or not rigid(fused.get('world_to_output_rotation')):
        raise ValueError('Use the z-up upstream point-cloud export with its proper recorded rotation.')
    settings=fused.get('settings',{})
    if (type(settings.get('min_consistent')) is not int or settings['min_consistent']<2
            or type(fused.get('frames')) is not int or not 1<=fused['frames']<=MAX_FRAMES):
        raise ValueError('Multi-view point filtering must be enabled and reported.')
    camera,frame_ids=poses(pose_path)
    rc.regular_source(intrinsics,16*1024**2)
    with zipfile.ZipFile(intrinsics) as archive:
        if sum(x.file_size for x in archive.infolist())>32*1024**2:raise ValueError('Expanded intrinsics exceed limit.')
    with np.load(intrinsics,allow_pickle=False) as data:calibration=np.asarray(data['data'],float)
    if calibration.shape!=(len(camera),4) or not np.isfinite(calibration).all() or np.any(calibration[:,:2]<=0):
        raise ValueError('Expected finite positive pinhole calibration for every pose.')
    recorded_ids=run.get('tracking_stride',{}).get('source_frame_ids')
    if recorded_ids!=frame_ids.tolist():raise ValueError('Pose IDs differ from the run record.')
    raster=run.get('input_raster',{});fps=raster.get('source_fps');source_frames=raster.get('source_frames');hw=raster.get('target_hw')
    if (not isinstance(fps,(int,float)) or isinstance(fps,bool) or not np.isfinite(fps) or not 0<fps<=240
            or type(source_frames) is not int or not 16<=source_frames<=1000000 or int(frame_ids[-1])>=source_frames):
        raise ValueError('Original video frame count/rate is required for source timing.')
    if not isinstance(hw,list) or len(hw)!=2 or any(type(v) is not int or not 16<=v<=8192 for v in hw):
        raise ValueError('Tracked raster dimensions are required for camera intrinsics.')
    snapshots={k:file_record(p) for k,p in {'video':video,'run':record_path,'fusion':fusion,'poses':pose_path,
                                          'intrinsics':intrinsics,'pointcloud':cloud_path}.items()}
    xyz,rgb,facts=survey_cloud.read_thinned(cloud_path)
    if (fused.get('voxels')!=facts['points_in_file'] or facts['non_finite_dropped']
            or not np.isfinite(xyz).all() or np.abs(xyz).max()>100000):
        raise ValueError('Point cloud does not match fusion counts or contains invalid coordinates.')
    # Upstream's explicit mean-camera-up rotation is not an independently measured gravity vector.
    upright=survey_cloud.to_y_up(xyz,'z')
    rows=np.column_stack((upright,rgb)).tolist()
    cloud=scene_usd.to_arena_cloud(rows,source='MetricTrail research output',metres_per_unit=1.0)
    cloud['scale']={'source':'model-estimated','metresPerUnit':1.0,'selfReported':False,'verified':False,
                    'distance':None,'spanUnits':None}
    cloud['provenance'].update(voxelMetres=facts['voxel_metres'],learnedMetricPrior=True,metricVerified=False)
    # Do not claim per-point view membership or enable a production scene engine from a supplied PLY/report.
    cloud['multiView']=False
    browser=copy.deepcopy(cloud);browser.update(units='arbitrary',scale=None)
    if browser.get('floorEstimate'):browser['floorEstimate']['units']='arbitrary'
    axis=np.array([[1,0,0],[0,0,1],[0,-1,0]],float)
    handoff=np.asarray(cloud['fromSource'],float);rotation=axis@np.asarray(fused['world_to_output_rotation'],float)
    transformed=[]
    for c,frame,k in zip(camera,frame_ids,calibration):
        target=np.eye(4);target[:3,:3]=handoff[:,:3]@rotation@c[:3,:3]
        target[:3,3]=handoff[:,:3]@rotation@c[:3,3]+handoff[:,3]
        transformed.append({'sourceFrameId':int(frame),'timeSeconds':int(frame)/fps,'cameraToHandoff':target.tolist(),
            'camera':{'model':'PINHOLE','params':k.tolist(),'width':hw[1],'height':hw[0]}})
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.metrictrail-',dir=out.parent) as temp:
        stage=Path(temp)/'bundle';stage.mkdir()
        rc.write_json(stage/'arena-cloud.json',browser)
        rc.write_json(stage/'estimated-metric-cloud.json',cloud)
        rc.write_json(stage/'camera-path.json',{'schema':'brainsnn.metrictrail-cameras.v1','frames':transformed,
            'timeBasis':'Source frame ID / nominal FPS; not decoded video presentation timestamps.',
            'scope':'Predicted poses and original frame IDs. No retained raster ledger or occlusion validation.'})
        for key,path in {'video':video,'run':record_path,'fusion':fusion,'poses':pose_path,'intrinsics':intrinsics,'pointcloud':cloud_path}.items():
            if file_record(path)!=snapshots[key]:raise ValueError('Input changed during import.')
        receipt={'schema':'brainsnn.metrictrail-trial.v1','status':'imported','sourceRevisionExpected':SOURCE_REVISION,
            'binding':'Operator-supplied local artifacts and video hashes; not independent capture attestation.',
            'source':snapshots,'sampling':facts,'pointsHandedOff':len(cloud['points']),
            'scale':'Learned metric depth, unverified. Browser handoff is unscaled; enter a separate measured distance.',
            'gravity':'Mean camera orientation followed by an internal floor fit, not measured IMU gravity.',
            'metricsScope':'No trajectory ground truth, survey comparison or physical robot test executed.',
            'metricVerified':False,'physicalRobotValidated':False,'productionEngineEnabled':False,
            'outputs':{p.name:file_record(p) for p in stage.iterdir()}}
        rc.write_json(stage/'metrictrail-receipt.json',receipt);_publish_directory(stage,out)
    return receipt

def execute(*,source,video,python,weights,out,timeout=1800,evaluation_only=False):
    if evaluation_only is not True:raise ValueError('Explicit --evaluation-only required.')
    if type(timeout) is not int or not 30<=timeout<=7200:raise ValueError('Trial timeout must be 30 to 7200 seconds.')
    pins=preflight(source,weights);video=rc.regular_source(video);python=Path(python).absolute()
    # Preserve a venv's interpreter symlink: resolving it would silently discard pyvenv.cfg.
    if not python.is_file() or not os.access(python,os.X_OK):raise ValueError('Use an executable local Python interpreter.')
    if video.suffix.lower() not in ('.mp4','.mov'):raise ValueError('Use an MP4 or MOV video.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}',video.stem):raise ValueError('Use a plain video basename.')
    out=Path(out);out.mkdir(parents=True,exist_ok=False);out=out.resolve();raw=out/'raw'
    before=file_record(video)
    env={**os.environ,'PYTHONPATH':str(source),'VIPE_MOGE2_CHECKPOINT':str(Path(weights['moge']).resolve()),
         'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_DATASETS_OFFLINE':'1','PYTHONUNBUFFERED':'1'}
    command=[str(python),str(Path(source)/'run.py'),'pipeline=metrictrail',f'streams.base_path={video}',
             f'pipeline.output.path={raw}',f'pipeline.slam.weights={Path(weights["dpvo"]).resolve()}',
             f'pipeline.slam.dinov3_weights={Path(weights["dino"]).resolve()}','pipeline.init.input_raster.max_frames=1500']
    report={'schema':'brainsnn.metrictrail-execution.v1','status':'started','source':before,'installation':pins,
            'metricVerified':False,'physicalRobotValidated':False,'evaluationOnly':True}
    rc.write_json(out/'execution.json',report)
    try:
        tracked=rc.bounded_process(command,out/'tracking.log',timeout=timeout,env=env);report['tracking']=tracked
        if tracked['status']!='completed':raise RuntimeError('MetricTrail tracking did not complete. See bounded tracking.log.')
        fused=rc.bounded_process([str(python),'-m','vipe.metrictrail.pointcloud',str(raw),'--name',video.stem,
            '--video',str(video),'--filter','strict'],out/'fusion.log',timeout=timeout,env=env)
        report['fusion']=fused
        if fused['status']!='completed':raise RuntimeError('MetricTrail point export did not complete. See bounded fusion.log.')
        # Only the exporter prints a complete JSON summary line; never parse arbitrary partial stdout as success.
        values=[]
        for line in (out/'fusion.log').read_text().splitlines():
            try:value=json.loads(line)
            except ValueError:continue
            if isinstance(value,dict) and 'world_to_output_rotation' in value:values.append(value)
        if len(values)!=1:raise ValueError('Expected exactly one upstream fusion summary.')
        rc.write_json(out/'fusion.json',values[0])
        if file_record(video)!=before:raise ValueError('Original video changed during inference.')
        preflight(source,weights)
        ingest(video=video,run_root=raw,name=video.stem,fusion=out/'fusion.json',out=out/'handoff',evaluation_only=True)
        report['status']='completed'
    except Exception as error:
        report.update(status='failed',error=str(error)[:500]);raise
    finally:rc.write_json(out/'execution.json',report)
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__.split('\n')[0]);sub=p.add_subparsers(dest='action',required=True)
    run=sub.add_parser('run');run.add_argument('--source',type=Path,required=True);run.add_argument('--python',type=Path,required=True)
    for key in WEIGHTS:run.add_argument('--'+key,type=Path,required=True)
    run.add_argument('--timeout',type=int,default=1800)
    read=sub.add_parser('ingest');read.add_argument('--run-root',type=Path,required=True);read.add_argument('--name',required=True);read.add_argument('--fusion',type=Path,required=True)
    for parser in (run,read):
        parser.add_argument('--video',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--evaluation-only',action='store_true')
    args=vars(p.parse_args());action=args.pop('action')
    if action=='run':args['weights']={k:args.pop(k) for k in WEIGHTS};result=execute(**args)
    else:result=ingest(**args)
    print(json.dumps({'status':result['status'],'metricVerified':False,'physicalRobotValidated':False}))

if __name__=='__main__':main()
