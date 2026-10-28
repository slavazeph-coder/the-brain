"""Compose and relocate a SYNTHETIC room plus one actual pinned NVIDIA package.
No Isaac Sim, PhysX, rendering or phone reconstruction is executed here.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import shutil,sys,zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from pxr import Usd,UsdGeom,UsdPhysics
from robotics.world_worker import omniverse_pack as o, simready_bridge as b
from robotics.world_worker.omniverse_templates.verify_pack import verify


def qualify(workspace,out):
    if out.exists():raise ValueError('Fresh qualification output required.')
    source=out/'scene-job/output';source.mkdir(parents=True)
    cloud={'version':1,'kind':'colmap-sparse-point-cloud','coordinateFrame':'right-handed-y-up','sourceFrame':'colmap',
           'source':'synthetic qualification fixture; not a phone reconstruction','units':'m',
           'points':[[0,0,0,128,128,128],[4,0,0,128,128,128],[4,0,4,128,128,128],[0,0,4,128,128,128]],
           'floorEstimate':None,'scale':{'source':'user-measured','metresPerUnit':1,'distance':4,'spanUnits':4,'selfReported':True,'verified':False},
           'provenance':{'metricVerified':False}}
    o.json_write(source/'arena-cloud.json',cloud)
    o.json_write(source/'scene.json',{'schema':'brainsnn.scene.v1','units':'m','source':cloud['source']})
    s=Usd.Stage.CreateNew(str(source/'scene.usda'));UsdGeom.SetStageMetersPerUnit(s,1);UsdGeom.SetStageUpAxis(s,UsdGeom.Tokens.y)
    s.SetDefaultPrim(UsdGeom.Xform.Define(s,'/World').GetPrim())
    floor=UsdGeom.Cube.Define(s,'/World/Floor');floor.CreateSizeAttr(1);floor.AddScaleOp().Set((4,.02,4));floor.AddTranslateOp().Set((0,-.5,0))
    s.GetRootLayer().Save()
    o.json_write(source/'manifest.json',{'artifacts':[{'name':name,'kind':'evidence'} for name in ['scene.json','scene.usda','arena-cloud.json']]})
    assets=o.installed_assets(workspace);a=next(a for a in assets if a['asset']=='IV_pole_a01');assert a['available'],a
    options={'schema':'brainsnn.omniverse-request.v1','reviewed':True,'scene_sha256':b.file_hash(source/'scene.json'),
             'cloud_sha256':b.file_hash(source/'arena-cloud.json'),'placements':[{'id':'sample_pole','asset':a['asset'],
                'package_sha256':a['package_sha256'],'translation_m':[0,0,.5],
                'license_reviewed':True,'unqualified_physics_reviewed':True}]}
    upload=out/'request.json';o.json_write(upload,{**cloud,'omniversePack':options})
    proof=o.run({'schema':'brainsnn.adapter.v1','inputs':[{'kind':'cloud','path':str(upload)}],
                 'source':{'engine':'scene-usd','path':str(source.parent)},'output_dir':str(out/'result')},workspace)
    moved=out/'relocated';moved.mkdir()
    with zipfile.ZipFile(out/'result/scene-omniverse.zip') as z:z.extractall(moved)
    verify(moved);o.audit_dependencies(moved/'world.usda',moved)
    stage=Usd.Stage.Open(str(moved/'world.usda'));assert stage and stage.GetDefaultPrim()
    rigid=sum(p.HasAPI(UsdPhysics.RigidBodyAPI) for p in o.traversed(stage))
    colliders=sum(p.HasAPI(UsdPhysics.CollisionAPI) for p in o.traversed(stage))
    assert colliders>1 and rigid>0
    assert b.receipt(moved/'assets'/a['asset'])['sha256']==a['package_sha256']
    report={'schema':'brainsnn.omniverse-qualification.v1','source_kind':'synthetic-room-plus-real-nvidia-asset',
            'asset':a,'portable_usd_reopened':True,'all_dependencies_local':True,'authored_rigid_bodies':rigid,
            'authored_colliders':colliders,'archive_sha256':proof['archive_sha256'],
            'physics_executed':False,'rendering_executed':False,'phone_reconstruction_executed':False}
    o.json_write(out/'result/qualification.json',report);print(json.dumps(report,indent=2));shutil.rmtree(moved)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--workspace',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();qualify(a.workspace,a.out)
