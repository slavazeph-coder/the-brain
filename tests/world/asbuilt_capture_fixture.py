"""Actual compiler fits/poses on authored rasters. No phone or survey experiment."""
import copy
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import numpy as np
from PIL import Image,ImageDraw
from test_component_evidence import capture,identified,camera
from robotics.world_worker import camera_frames as cf
from robotics.world_worker.geometry import write_point_cloud
from robotics.scene_compiler import component_graph as cg
from robotics.scene_compiler.ifc_export import write_ifc

def dump(path,value):path.write_text(json.dumps(value,indent=1,allow_nan=False)+'\n')

def make_capture(root):
    root=Path(root);rec=root/'reconstruction';scene_root=root/'scene';(rec/'output').mkdir(parents=True);(scene_root/'output').mkdir(parents=True);images=rec/'frames';images.mkdir()
    cloud,scene=identified(capture.__wrapped__())
    cloud.update(version=1,kind='colmap-sparse-point-cloud',sourceFrame='colmap',source='sparse-preview.ply',provenance={'metricVerified':False})
    scene.pop('componentGraph')
    for item in scene['walls']+scene['objects']:item.pop('componentId',None)
    scene['objects'][1].update(label='chair',ifcClass='IfcFurniture');scene['source']='Authored capture-frame regression fixture. Not a phone reconstruction.'
    scene=cg.attach_component_ids(scene);obj=scene['objects'][1]
    write_point_cloud(rec/'output/sparse-preview.ply',np.asarray(cloud['points'])[:,:3],np.asarray(cloud['points'])[:,3:],coordinate_frame='colmap')
    sources=[];frames=[]
    for i,at in enumerate(([.5,1.5,4],[3,1.5,3])):
        path=images/f'authored-{i}.png';image=Image.new('RGB',(640,480),(35+i*20,60,85));draw=ImageDraw.Draw(image)
        for x in range(0,640,40):draw.line((x,0,x,480),fill=(50,110,140))
        draw.rectangle((220,160,420,400),fill=(170,120,60));draw.text((15,15),'AUTHORED RASTER TEST',fill='white');image.save(path)
        source={'name':path.name,'kind':'image','sha256':hashlib.sha256(path.read_bytes()).hexdigest()};sources.append(source)
        view=camera(f'frame-{i}',at,obj['centre']);pose=view['cam_from_world'].tolist();lens={'model':'PINHOLE','params':[500,500,320,240]}
        frames.append({'frame_id':cf.frame_id(source['sha256'],source['sha256'],lens,pose),'image':cf.file_record(rec,path,width=640,height=480),
            'origin':{'sourceIndex':i,'sourceWidth':640,'sourceHeight':480,'exifOrientation':1,'sourceToFramePixelCenter':[[1,0,0],[0,1,0],[0,0,1]]},'timestamp':None,'camera':lens,'cam_from_world':pose})
    dump(rec/'output/reconstruction.json',{'schema':'brainsnn.reconstruction.v1','sources':sources,'metric_verified':False,'warnings':['Authored geometry and rasters only.']})
    cf.write(rec,{'schema':cf.SCHEMA,'sources':sources,'reconstruction':cf.file_record(rec,rec/'output/reconstruction.json'),
        'clouds':[cf.file_record(rec,rec/'output/sparse-preview.ply',coordinate_frame='colmap')],'frames':frames,'metric_verified':False})
    dump(scene_root/'output/scene.json',scene);dump(scene_root/'output/arena-cloud.json',cloud)
    prior=copy.deepcopy(scene);prior.pop('componentGraph')
    for item in prior['walls']+prior['objects']:item.pop('componentId',None)
    prior['objects'][1]['centre'][0]-=.4;prior=cg.attach_component_ids(prior)
    prior_path=root/'prior.ifc';write_ifc(prior_path,prior)
    prior_raw=prior_path.read_bytes();scene_raw=(scene_root/'output/scene.json').read_bytes()
    from robotics.scene_compiler.asbuilt_update import ifc_inventory
    rows=ifc_inventory(prior_raw)['elements'];ids={c['componentId'] for c in scene['walls']+scene['objects']};chair=next(e for e in rows if e['componentId']==obj['componentId'])
    review={'schema':'brainsnn.asbuilt-review.v1','source':{'priorIfcSha256':hashlib.sha256(prior_raw).hexdigest(),'currentSceneSha256':hashlib.sha256(scene_raw).hexdigest(),'componentRevision':0},
      'registration':{'method':'operator-reviewed-same-frame','translationMeters':[0,0,0],'yawDegrees':0,'reviewed':True,'note':'Authored same-frame fixture, not a physical registration.'},
      'toleranceMeters':.05,'maxTranslationMeters':2,'maxExtentDifferenceMeters':.05,'pairs':[{'priorGlobalId':e['globalId'],'currentComponentId':e['componentId'],'reviewed':True} for e in rows if e['componentId'] in ids],
      'selectedTranslations':[chair['globalId']],'brief':{'targets':'Authored chair placement','intendedUse':'Regression testing','accuracyTargetMeters':.05,'detail':'observed-component-proxies'},'metricVerified':False,'physicalRobotValidated':False}
    dump(root/'review.json',review)
    return {'sceneRoot':scene_root,'reconstructionRoot':rec,'scene':scene,'cloud':cloud,'review':review,'prior':prior_path,'componentId':obj['componentId']}
