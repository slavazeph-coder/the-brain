"""Private source-job IFC updates and retained-frame evidence. No physical claim."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from robotics.scene_compiler import asbuilt_update as au, component_graph as cg
from robotics.world_worker import camera_frames as cf, component_evidence as ce
from robotics.world_worker.geometry import load_arena_cloud
from robotics.world_worker.measurement_check import points_sha256

EVIDENCE_SCHEMA='brainsnn.asbuilt-evidence-request.v1'
HASH=re.compile(r'^[a-f0-9]{64}$')
ID=re.compile(r'^[a-f0-9]{32}$')

def raw_file(path,limit):
    path=Path(path)
    if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<=limit:
        raise ValueError('Missing, unsafe or oversized as-built input.')
    data=path.read_bytes()
    if len(data)>limit:raise ValueError('As-built input grew beyond its limit.')
    return data

def sha(data):return hashlib.sha256(data).hexdigest()
def json_file(path,limit=1024*1024):
    raw=raw_file(path,limit)
    return ce._json(raw),raw

def evidence_options(value):
    au._keys(value,['schema','sceneSha256','componentId','reviewed'])
    if value['schema']!=EVIDENCE_SCHEMA or value['reviewed'] is not True \
            or not isinstance(value['sceneSha256'],str) or not HASH.fullmatch(value['sceneSha256']) \
            or not isinstance(value['componentId'],str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value['componentId']):
        raise ValueError('Select a source-bound component and approve private photo retrieval.')
    return value

def validate_upload(path,kind):
    if kind=='ifc':
        # Tessellation runs only inside the time/storage-bounded adapter process.
        raw=raw_file(path,au.MAX_IFC_BYTES)
        if not raw.removeprefix(b'\xef\xbb\xbf').lstrip().startswith(b'ISO-10303-21;'):
            raise ValueError('Use a STEP IFC file, not IFCZIP, XML or another format.')
        return
    value,_raw=json_file(path)
    if not isinstance(value,dict):raise ValueError('Use an as-built JSON request.')
    if value.get('schema')==EVIDENCE_SCHEMA:evidence_options(value)
    elif value.get('schema')!=au.SCHEMA or value.get('metricVerified') is not False or value.get('physicalRobotValidated') is not False:
        raise ValueError('Unsupported as-built review request or physical claim.')

def source_scene(request):
    source=request.get('source') or {}
    if source.get('missing') or not ID.fullmatch(str(source.get('job',''))) or not source.get('path'):
        raise ValueError('The completed source scene job is unavailable.')
    root=cf._root(source['path']);raw=raw_file(cf._path(root,'output/scene.json'),cg.MAX_SCENE_BYTES);scene=ce._json(raw)
    if scene.get('units')!='m' or 'componentGraph' not in scene:
        raise ValueError('Use an original metric compiler scene with component identities.')
    cg.ensure_component_ids(scene)
    return root,scene,raw

def write_json(path,value):path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def publish(out,stage,names):
    out=Path(out)
    if out.is_symlink() or not out.is_dir() or any((out/n).exists() or (out/n).is_symlink() for n in names+['manifest.json']):
        raise ValueError('Use a fresh adapter output directory.')
    for name in names:shutil.move(stage/name,out/name)
    # The worker exposes nothing until the entire adapter succeeds.
    write_json(out/'manifest.json',{'artifacts':[{'name':n,'kind':'image' if n.endswith('.jpg') else 'bim' if n.endswith('.ifc') else 'evidence'} for n in names]})

def update(request):
    inputs=request.get('inputs',[])
    if len(inputs)!=2 or sorted(i.get('kind','') for i in inputs)!=['asbuilt','ifc']:
        raise ValueError('IFC updating takes one IFC and one reviewed request.')
    source,scene,scene_raw=source_scene(request)
    prior=raw_file(next(i['path'] for i in inputs if i['kind']=='ifc'),au.MAX_IFC_BYTES)
    review,review_raw=json_file(next(i['path'] for i in inputs if i['kind']=='asbuilt'))
    updated,report=au.update_ifc(prior,scene_raw,review);report['workerSourceJob']=request['source']['job']
    receipt={'schema':'brainsnn.asbuilt-source.v1','sourceJob':request['source']['job'],
        'sceneSha256':sha(scene_raw),'priorIfcSha256':sha(prior),'requestBytesSha256':sha(review_raw),
        'outputIfcSha256':sha(updated),'componentRevision':scene['componentGraph']['revision'],
        'metricVerified':False,'physicalRobotValidated':False,
        'scope':'Reviewed placement copy. Original capture scene and other CAD/robot exports remain unchanged.'}
    with tempfile.TemporaryDirectory(prefix='asbuilt-update-') as temp:
        stage=Path(temp)
        for name,data in [('prior.ifc',prior),('capture-scene.json',scene_raw),('asbuilt-review.json',review_raw),('updated.ifc',updated)]:
            (stage/name).write_bytes(data)
        write_json(stage/'asbuilt-update-report.json',report);write_json(stage/'asbuilt-source.json',receipt)
        if raw_file(cf._path(source,'output/scene.json'),cg.MAX_SCENE_BYTES)!=scene_raw:
            raise ValueError('Source scene changed during IFC execution.')
        publish(request['output_dir'],stage,['prior.ifc','capture-scene.json','asbuilt-review.json','updated.ifc','asbuilt-update-report.json','asbuilt-source.json'])
    return receipt

def evidence(request):
    inputs=request.get('inputs',[])
    if len(inputs)!=1 or inputs[0].get('kind')!='asbuilt':raise ValueError('Photo evidence takes one reviewed component request.')
    options,_raw=json_file(inputs[0]['path']);evidence_options(options)
    source,scene,scene_raw=source_scene(request)
    if sha(scene_raw)!=options['sceneSha256']:raise ValueError('Photo request does not match the exact source scene.')
    cloud_path=cf._path(source,'output/arena-cloud.json');cloud_raw=raw_file(cloud_path,16*1024*1024)
    load_arena_cloud(cloud_path);cloud=ce._json(cloud_raw)
    if points_sha256(cloud)!=scene.get('cloudPointsSha256'):raise ValueError('Source cloud no longer matches the scene.')
    reconstruction=request['source'].get('reconstruction',{})
    rec=cf._root(reconstruction['path']) if reconstruction.get('path') and not reconstruction.get('missing') else None
    data=ce.build_component_evidence(scene,cloud,scene_bytes=scene_raw,cloud_bytes=cloud_raw,source_dir=rec)
    component=next((c for c in data['components'] if c['componentId']==options['componentId']),None)
    if component is None:raise ValueError('Selected component is not in this scene.')
    result={'schema':'brainsnn.asbuilt-photo-evidence.v1','sourceJob':request['source']['job'],
        'sceneSha256':sha(scene_raw),'cloudSha256':sha(cloud_raw),'sourcePointsSha256':points_sha256(cloud),
        'componentId':options['componentId'],'componentRevision':scene['componentGraph']['revision'],
        'projection':data['projection'],'status':'unavailable','reason':component.get('frameReason','No qualifying source frame.'),
        'frames':[],'metricVerified':False,'physicalRobotValidated':False,
        'scope':'Retained capture rasters with projected source-point bounds. No image segmentation or independent physical accuracy.'}
    with tempfile.TemporaryDirectory(prefix='asbuilt-evidence-') as temp:
        stage=Path(temp);names=[];picks=component.get('frames',[])
        if picks and rec:
            ledger_path=cf._path(rec,'output/camera-frames.json');ledger_raw=raw_file(ledger_path,cf.MAX_BYTES)
            record=cf.load_record(rec);frames={f['frame_id']:f for f in record['frames']}
            for index,pick in enumerate(picks[:2]):
                if pick['sourceBinding']!='ordered-source-subset' or pick['ledgerSha256']!=sha(ledger_raw):raise ValueError('Photo evidence has no validated capture binding.')
                frame=frames[pick['frameId']]
                if frame['image']['sha256']!=pick['imageSha256']:raise ValueError('Projected raster does not match the original ledger.')
                raster=cf._path(rec,frame['image']['name']);image_raw=raw_file(raster,cf.MAX_FILE_BYTES)
                if sha(image_raw)!=frame['image']['sha256']:raise ValueError('Source raster changed.')
                from PIL import Image
                name=f'evidence-frame-{index+1:02d}.jpg'
                with Image.open(raster) as image:
                    image.thumbnail((1280,960));image.convert('RGB').save(stage/name,quality=88)
                preview=raw_file(stage/name,4*1024*1024);w,h=frame['image']['width'],frame['image']['height']
                box=[value/(w if i%2==0 else h) for i,value in enumerate(pick['pixelBox'])]
                result['frames'].append({'frameId':frame['frame_id'],'originalImageSha256':sha(image_raw),
                    'ledgerSha256':sha(ledger_raw),'previewName':name,'previewSha256':sha(preview),
                    'originalWidth':w,'originalHeight':h,'normalizedPointBounds':box,
                    'visibleFraction':pick['visibleFraction'],'occludedFraction':pick['occludedFraction'],
                    'timestamp':frame['timestamp'],'camera':frame['camera'],'cam_from_world':frame['cam_from_world'],
                    'rasterProvenance':'Resized retained frame, not a generated image or continuous video.'})
                if raw_file(raster,cf.MAX_FILE_BYTES)!=image_raw:raise ValueError('Source raster changed during preview export.')
                names.append(name)
            if raw_file(ledger_path,cf.MAX_BYTES)!=ledger_raw:raise ValueError('Camera ledger changed during preview export.')
            result['status']='available';result['reason']='Projected member points; estimated visibility is heuristic.'
        if raw_file(cf._path(source,'output/scene.json'),cg.MAX_SCENE_BYTES)!=scene_raw or raw_file(cloud_path,16*1024*1024)!=cloud_raw:
            raise ValueError('Capture source changed during evidence retrieval.')
        write_json(stage/'asbuilt-photo-evidence.json',result);publish(request['output_dir'],stage,names+['asbuilt-photo-evidence.json'])
    return result

def run(request,operation):
    if request.get('schema')!='brainsnn.adapter.v1':raise ValueError('Invalid worker adapter request.')
    if operation not in ('update','evidence'):raise ValueError('Unsupported as-built operation.')
    return update(request) if operation=='update' else evidence(request)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-manifest',type=Path,required=True);p.add_argument('--operation',choices=['update','evidence'],required=True)
    args=p.parse_args();request,_raw=json_file(args.input_manifest);run(request,args.operation)
