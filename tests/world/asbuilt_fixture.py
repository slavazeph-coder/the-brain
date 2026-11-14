"""Deterministic authored room variants. Not a capture, survey or paper reproduction."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.scene_compiler import component_graph as cg
from robotics.scene_compiler.ifc_export import write_ifc
from robotics.world_worker.measurement_check import points_sha256

def scenario():
    scene={'schema':'brainsnn.scene.v1','source':'Authored as-built comparison fixture. Not a reconstruction.',
      'units':'m','scale':{'source':'authored-example','metresPerUnit':1,'selfReported':True,'verified':False},
      'floor_y':0,'unknown':[],'openings':[],'walls':[
        {'name':'wall_1','label':'wall','centre':[0,1.35,-2.9],'size':[6,2.7,.18],'yaw_degrees':0,'provenance':'authored-example'},
        {'name':'wall_2','label':'wall','centre':[2.5,1.35,.2],'size':[3,2.7,.18],'yaw_degrees':72,'provenance':'authored-example'}],
      'objects':[
        {'name':'floor_observed','label':'floor','centre':[0,-.02,0],'size':[6,.04,6],'min':[-3,-.04,-3],'max':[3,0,3],'yaw_degrees':0,'provenance':'authored-example'},
        {'name':'chair_1','label':'chair','centre':[1,.45,1],'size':[.5,.9,.5],'yaw_degrees':25,'kind':'separated','ifcClass':'IfcFurniture','provenance':'authored-example'},
        {'name':'cabinet_1','label':'cabinet','centre':[-1.6,.8,1.5],'size':[1.5,1.6,.5],'yaw_degrees':0,'kind':'separated','ifcClass':'IfcFurniture','provenance':'authored-example'},
        {'name':'table_1','label':'table','centre':[.1,.4,-1.2],'size':[1.1,.8,.7],'yaw_degrees':0,'kind':'separated','ifcClass':'IfcFurniture','provenance':'authored-example'}]}
    points=[]
    for record in scene['walls']+scene['objects']:
        a=math.radians(record.get('yaw_degrees',0));c,s=math.cos(a),math.sin(a)
        for axis in range(3):
            for side in (-1,1):
                for i in range(9):
                    for j in range(9):
                        local=[0.,0.,0.];local[axis]=side*record['size'][axis]/2
                        other=[d for d in range(3) if d!=axis]
                        local[other[0]]=(i/8-.5)*record['size'][other[0]];local[other[1]]=(j/8-.5)*record['size'][other[1]]
                        p=[record['centre'][0]+c*local[0]-s*local[2],record['centre'][1]+local[1],record['centre'][2]+s*local[0]+c*local[2]]
                        points.append([*p,110,210,205])
    cloud={'units':'m','coordinateFrame':'right-handed-y-up','source':'Authored box surface samples, not a scan','points':points,'scale':scene['scale']}
    point_hash=points_sha256(cloud);scene['cloudPointsSha256']=point_hash
    prior=copy.deepcopy(scene);prior['objects'][1]['centre'][0]=.3;prior['objects'][2]['size']=[1.,1.,.5]
    return cg.attach_component_ids(prior),cg.attach_component_ids(scene),cloud

def files():
    prior,current,cloud=scenario()
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'prior.ifc';write_ifc(path,prior,name='Authored out-of-date room')
        raw=re.sub(rb"FILE_NAME\('scene.ifc','[^']*'",b"FILE_NAME('scene.ifc','2026-11-14T00:00:00'",path.read_bytes())
    current_raw=(json.dumps(current,indent=2)+'\n').encode()
    reference={'schema':'brainsnn.component-reference.v1','units':'m','coordinateFrame':'right-handed-y-up',
      'sceneSha256':hashlib.sha256(current_raw).hexdigest(),'frameReviewed':True,'origin':'synthetic-fixture',
      'method':'Authored negative test: one chair is displaced by 1 m relative to the declared reference.',
      'instrument':'Software fixture; not a tape, laser or TLS survey','measuredOn':'2026-11-14',
      'usedForModeling':False,'usedForRegistration':False,'isPriorModel':False,'derivedFromSha256':None,
      'sourceSha256':hashlib.sha256(b'Authored negative component-reference specification v1; not physical data.').hexdigest(),
      'toleranceMeters':.2,'components':[]}
    for i,p in enumerate(current['walls']+current['objects']):
        c=copy.deepcopy(p['centre'])
        if p['label']=='chair':c[0]+=1
        reference['components'].append({'id':'ref-'+str(i),'class':p['label'],'centreMeters':c,
          'positionMode':'exclude' if p['label']=='floor' else 'horizontal','uncertaintyMeters':0})
    return {'asbuilt-prior.ifc':raw,'asbuilt-current.scene.json':current_raw,
            'asbuilt-source.cloud.json':(json.dumps(cloud,separators=(',',':'))+'\n').encode(),
            'asbuilt-reference.json':(json.dumps(reference,indent=2)+'\n').encode()}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,required=True);args=parser.parse_args()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for name,raw in files().items():(args.output_dir/name).write_bytes(raw)
