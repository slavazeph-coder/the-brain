"""Offline CPU deployment-image qualification on explicit authored fixtures.

No phone reconstruction, independent physical measurements, BIM-app import or
robot execution is implied. Does not enable an adapter or deploy a service.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import numpy as np
from PIL import Image
import trimesh
from robotics.world_worker import camera_frames as cf, demo_replay as dr
from robotics.world_worker.geometry import write_point_cloud


def dump(path, value):
    path.write_text(json.dumps(value, allow_nan=False))


def qualify(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError('Use an empty qualification directory.')
    # Exercise the actual image dependencies; the adapter stays disabled.
    config = json.loads((dr.ROOT/'robotics/world_worker/deploy/railway/adapters.json').read_text())
    adapter = next(a for a in config if a['id'] == 'demo-replay')
    if adapter['enabled'] or adapter['license_reviewed']:
        raise ValueError('This qualification expects the unactivated adapter.')
    node = subprocess.check_output(['node', '--version'], text=True).strip()
    if int(node.lstrip('v').split('.')[0]) < 22:
        raise ValueError('Node 22+ is required by the real planner.')
    if not Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf').is_file():
        raise ValueError('The deployed DejaVu font is missing.')
    with tempfile.TemporaryDirectory(prefix='demo-image-') as tmp:
        root = Path(tmp); rec = root/'reconstruction'; output = rec/'output'; output.mkdir(parents=True)
        rasters = rec/'colmap-work/images'; rasters.mkdir(parents=True)
        sources = [{'name':'authored-runtime-fixture.mp4', 'kind':'video',
                    'sha256':hashlib.sha256(b'authored runtime fixture, no real video').hexdigest()}]
        frames = []
        for i in (0, 2, 4):
            path = rasters/f'image_{i:04d}.jpg'
            Image.new('RGB', (320,240), (50+i*30,80,150)).save(path)
            camera = {'model':'PINHOLE','params':[250,250,159.5,119.5]}
            pose = [[1,0,0,-i*.15],[0,1,0,0],[0,0,1,0]]
            frames.append({'frame_id':cf.frame_id(sources[0]['sha256'],dr.sha(path),camera,pose),
                'image':cf.file_record(rec,path,width=320,height=240),
                'origin':{'sourceIndex':0,'sourceWidth':320,'sourceHeight':240,'exifOrientation':1,
                          'sourceToFramePixelCenter':[[1,0,0],[0,1,0],[0,0,1]]},
                'timestamp':None,'camera':camera,'cam_from_world':pose})
        points = np.array([[x,y,z] for x in (-1,0,1) for y in (-.5,.5) for z in (2,3)],float)
        write_point_cloud(output/'sparse-preview.ply',points,np.full_like(points,100),coordinate_frame='colmap')
        dump(output/'reconstruction.json',{'schema':'brainsnn.reconstruction.v1','sources':sources,
            'capture':{'images':5,'registered_images':3,'consistency':{'status':'consistent'}},
            'warnings':['Authored image-build qualification, not physical capture.'],'metric_verified':False})
        cf.write(rec,{'schema':cf.SCHEMA,'sources':sources,
            'reconstruction':cf.file_record(rec,output/'reconstruction.json'),
            'clouds':[cf.file_record(rec,output/'sparse-preview.ply',coordinate_frame='colmap')],
            'frames':frames,'metric_verified':False})
        options = {'schema':dr.SCHEMA,'source_artifact':'reconstruction.json',
            'source_sha256':dr.sha(output/'reconstruction.json'),'title':'Authored runtime qualification',
            'credit':'Authored rasters and geometry; not a physical accuracy test',
            'capture_kind':'authored-fixture','ending':'reconstruction','reviewed':True}
        formats = {'landscape':(1280,720,1),'social':(1080,1350,1),'short':(1080,1350,1)}
        dr.render(rec,rec,root/'movies',options,formats=formats,fps=24)
        videos = []
        for name,(width,height,_) in formats.items():
            path = root/'movies'/f'demo-{name}.mp4'
            probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(path)]))
            stream = probe['streams'][0]
            if (stream['codec_name'],stream['width'],stream['height'],int(stream['nb_frames'])) != ('h264',width,height,24):
                raise ValueError('Wrong encoded format or frame count.')
            videos.append({'name':path.name,'sha256':dr.sha(path),'bytes':path.stat().st_size,
                           'width':width,'height':height,'frames':24,'codec':'h264'})
        bundle = dr.prepare(rec,rec,options)
        if bundle['total'] != 5 or len(bundle['frames']) != 3 or bundle['timed'] or 'PARTIAL' not in bundle['warning']:
            raise ValueError('Source coverage or unknown-time warning was lost.')
        scene_root = root/'scene'; so = scene_root/'output'; so.mkdir(parents=True)
        transformed = bundle['points']
        cloud = {'version':1,'kind':'colmap-sparse-point-cloud','units':'m','coordinateFrame':'right-handed-y-up',
            'sourceFrame':'colmap','source':'sparse-preview.ply','points':np.c_[transformed,np.full_like(transformed,100)].tolist(),
            'fromSource':[[1,0,0,0],[0,1,0,0],[0,0,1,0]],'floorEstimate':None,
            'scale':{'source':'user-measured','metresPerUnit':1,'distance':1,'spanUnits':1,'selfReported':True,'verified':False},
            'provenance':{'metricVerified':False,'floorAligned':True}}
        scene = {'schema':'brainsnn.scene.v1','units':'m','scale':cloud['scale'],'walls':[],
            'objects':[{'name':'floor_observed','label':'floor','kind':'floor','min':[-3,-.02,-3],
                'max':[3,0,3],'centre':[0,-.01,0],'size':[6,.02,6],'provenance':'observed'}],
            'unknown':[],'floor_y':0,'counts':{'walls':0,'objects':1,'input_points':len(transformed)}}
        dump(so/'arena-cloud.json',cloud);dump(so/'scene.json',scene);dump(so/'scene-usd.json',{'units':'m'})
        glb = trimesh.Scene();glb.add_geometry(trimesh.creation.box(extents=[6,.02,6]),node_name='floor_observed')
        (so/'scene.glb').write_bytes(glb.export(file_type='glb'))
        scene_options = {**options,'source_artifact':'scene.json','source_sha256':dr.sha(so/'scene.json'),'ending':'bim'}
        compiled = dr.prepare(scene_root,rec,scene_options)
        if len(compiled['mesh'][0]) != 12:
            raise ValueError('Actual GLB triangle parsing failed.')
        route = dr.plan_route(compiled, root/'robot-route.json')
        if not route['route'] or route['provenance']['physicalRobotValidated'] is not False:
            raise ValueError('Actual website planner or physical-validation disclosure failed.')
        report = {'schema':'brainsnn.demo-runtime-qualification.v1','passed':True,
            'scope':'offline authored fixtures in the current runtime; image-build provenance is recorded separately by CI',
            'python':platform.python_version(),'node':node,'threeCuts':videos,
            'actualGlbTriangles':12,'actualWebsitePlanner':True,'sourceCoverage':{'posed':3,'selected':5},
            'metricAccuracyValidated':False,'physicalRobotValidated':False,'adapterActivated':False,
            'sourceSha256':options['source_sha256'],'glbSha256':dr.sha(so/'scene.glb')}
        dump(out/'demo-runtime-qualification.json',report)
        shutil.copy(root/'movies/demo-receipt.json',out/'authored-demo-receipt.json')
        print(json.dumps(report,sort_keys=True))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',required=True)
    qualify(parser.parse_args().out)
