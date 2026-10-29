"""Portable-package tests with explicitly synthetic USD and a mock NVIDIA cache."""
import hashlib,io,json
from pathlib import Path
import shutil,tempfile,unittest,zipfile
from pxr import Usd,UsdGeom,UsdPhysics,Sdf
from robotics.world_worker import omniverse_pack as o, simready_bridge as b, nvidia_pack as n
from robotics.world_worker.omniverse_templates.verify_pack import verify


def dump(path,data):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data))


def fixture(root):
    source,workspace=root/'source',root/'library';source.mkdir();workspace.mkdir()
    cloud={'version':1,'kind':'colmap-sparse-point-cloud','units':'m','coordinateFrame':'right-handed-y-up','sourceFrame':'colmap',
           'source':'synthetic test fixture','points':[[0,0,0,0,0,0],[1,0,1,255,255,255],[1,2,1,255,255,255]],'floorEstimate':None,
           'scale':{'source':'user-measured','metresPerUnit':1,'distance':1,'spanUnits':1,'selfReported':True,'verified':False},'provenance':{'metricVerified':False}}
    dump(source/'arena-cloud.json',cloud);dump(source/'scene.json',{'schema':'brainsnn.scene.v1','units':'m','source':'synthetic fixture'})
    s=Usd.Stage.CreateNew(str(source/'scene.usda'));UsdGeom.SetStageMetersPerUnit(s,1);UsdGeom.SetStageUpAxis(s,UsdGeom.Tokens.y)
    s.SetDefaultPrim(UsdGeom.Xform.Define(s,'/World').GetPrim());UsdGeom.Cube.Define(s,'/World/Floor');s.GetRootLayer().Save()
    dump(source/'manifest.json',{'artifacts':[{'name':name,'kind':'evidence'} for name in ['scene.json','scene.usda','arena-cloud.json']]})
    asset=workspace/'IV_pole_a01';asset.mkdir();(asset/'simready_usd').mkdir();(asset/'.metadata').mkdir()
    (asset/'.metadata/LICENSE.txt').write_text('Synthetic fixture, not NVIDIA content.')
    package={'package_id':f'simready.hf.{n.REPO.replace("/", ".")}.IV_pole_a01.fixture','license':'CC-BY-4.0'}
    dump(asset/'com.nvidia.simready.packaging.json',package)
    s=Usd.Stage.CreateNew(str(asset/'simready_usd/root.usda'));UsdGeom.SetStageMetersPerUnit(s,1);UsdGeom.SetStageUpAxis(s,UsdGeom.Tokens.z)
    s.SetDefaultPrim(UsdGeom.Xform.Define(s,'/Root').GetPrim());shape=UsdGeom.Cube.Define(s,'/Root/Body');UsdPhysics.CollisionAPI.Apply(shape.GetPrim())
    s.GetRootLayer().customLayerData={'SimReady_Metadata':{'validation':{'old_profile':{'passed':False}}}};s.GetRootLayer().Save()
    refresh(workspace,package);catalog=o.installed_assets(workspace)
    request={'schema':'brainsnn.omniverse-request.v1','scene_sha256':b.file_hash(source/'scene.json'),'cloud_sha256':b.file_hash(source/'arena-cloud.json'),'reviewed':True,
             'placements':[{'id':'pole_1','asset':'IV_pole_a01','package_sha256':catalog[0]['package_sha256'],'translation_m':[1,0,2],'license_reviewed':True,'unqualified_physics_reviewed':True}]}
    return source,workspace,request,cloud


def refresh(workspace,package=None):
    folder=workspace/'IV_pole_a01';package=package or json.loads((folder/'com.nvidia.simready.packaging.json').read_text())
    data={'repo':n.REPO,'revision':n.REVISION,'asset':'IV_pole_a01','package_id':package['package_id'],
          'source_url':f'https://huggingface.co/datasets/{n.REPO}/resolve/{n.REVISION}/IV_pole_a01/com.nvidia.simready.packaging.json',
          'root_usd':'simready_usd/root.usda','files':[{'path':p.relative_to(workspace).as_posix(),'size':p.stat().st_size,'sha256':b.file_hash(p)} for p in folder.rglob('*') if p.is_file()]}
    dump(workspace/'IV_pole_a01.receipt.json',data)


class PackTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.source,self.workspace,self.request,self.cloud=fixture(self.root)
    def tearDown(self):self.tmp.cleanup()
    def build(self):return o.package_scene(self.source,self.root/'pack',self.request,self.workspace)
    def test_portable_reopen_and_original_bytes(self):
        before={p.name:b.file_hash(p) for p in self.source.iterdir()};proof=self.build();moved=self.root/'relocated';shutil.move(self.root/'pack',moved);verify(moved)
        s=Usd.Stage.Open(str(moved/'world.usda'));self.assertTrue(s)
        self.assertTrue(s.GetPrimAtPath('/World/LibraryAdditions/pole_1/Basis/Asset/Body').HasAPI(UsdPhysics.CollisionAPI))
        self.assertEqual(before,{p.name:b.file_hash(p) for p in self.source.iterdir()});self.assertFalse(proof['physics_ready']);self.assertFalse(proof['physics_executed'])
        self.assertTrue((moved/'assets/IV_pole_a01/.metadata/LICENSE.txt').is_file())
    def test_no_assets_required_for_source_pack(self):
        self.request['placements']=[];shutil.rmtree(self.workspace);self.assertEqual(self.build()['library_placements'],[])
    def test_prior_failures_not_hidden(self):self.assertEqual(o.installed_assets(self.workspace)[0]['upstream_failed_features'],['old_profile'])
    def test_real_instance_proxies_count(self):
        p=self.workspace/'IV_pole_a01/simready_usd/root.usda';s=Usd.Stage.Open(str(p));s.GetPrimAtPath('/Root/Body').SetInstanceable(True)
        child=self.workspace/'IV_pole_a01/simready_usd/shape.usda';t=Usd.Stage.CreateNew(str(child));x=UsdGeom.Xform.Define(t,'/Shape');t.SetDefaultPrim(x.GetPrim())
        UsdPhysics.CollisionAPI.Apply(UsdGeom.Cube.Define(t,'/Shape/Mesh').GetPrim());t.GetRootLayer().Save()
        q=s.DefinePrim('/Root/Instance');q.GetReferences().AddReference('shape.usda');q.SetInstanceable(True);s.GetRootLayer().Save();refresh(self.workspace)
        self.assertGreaterEqual(o.installed_assets(self.workspace)[0]['authored_colliders'],2)
    def test_changed_texture(self):
        (self.workspace/'IV_pole_a01/.metadata/LICENSE.txt').write_text('changed')
        with self.assertRaises(ValueError):self.build()
    def test_extra_file(self):
        (self.workspace/'IV_pole_a01/unknown').write_text('extra')
        with self.assertRaises(ValueError):self.build()
    def test_stale_source(self):
        self.request['scene_sha256']='0'*64
        with self.assertRaises(ValueError):self.build()
    def test_bad_hash_type(self):
        self.request['cloud_sha256']=123
        with self.assertRaises(ValueError):o.validate_request(self.request,[])
    def test_missing_review(self):
        self.request['reviewed']=False
        with self.assertRaises(ValueError):self.build()
    def test_asset_acknowledgements_required(self):
        for key in ('license_reviewed','unqualified_physics_reviewed'):
            with self.subTest(key=key):
                self.request['placements'][0][key]=False
                with self.assertRaises(ValueError):self.build()
                self.request['placements'][0][key]=True
    def test_no_resizing_or_collider_changes(self):
        for key,value in [('scale',2),('scale',True),('collision_policy','convexHull')]:
            self.request['placements'][0][key]=value
            with self.assertRaises(ValueError):self.build()
            self.request['placements'][0].pop(key)
    def test_invalid_placement(self):
        self.request['placements'][0]['translation_m']=[float('nan'),0,0]
        with self.assertRaises(ValueError):self.build()
    def test_duplicate_ids(self):
        self.request['placements']*=2
        with self.assertRaises(ValueError):self.build()
    def test_placement_budget(self):
        self.request['placements']=[{**self.request['placements'][0],'id':f'p{i}'} for i in range(65)]
        with self.assertRaises(ValueError):self.build()
    def test_dependency_escape(self):
        p=self.workspace/'IV_pole_a01/simready_usd/root.usda';s=Usd.Stage.Open(str(p));s.GetRootLayer().subLayerPaths.append('../../../outside.usda');s.GetRootLayer().Save();refresh(self.workspace)
        with self.assertRaises(ValueError):o.installed_assets(self.workspace)
    def test_remote_texture(self):
        p=self.workspace/'IV_pole_a01/simready_usd/root.usda';s=Usd.Stage.Open(str(p));s.GetDefaultPrim().CreateAttribute('texture',Sdf.ValueTypeNames.Asset).Set(Sdf.AssetPath('https://example.com/a.png'));s.GetRootLayer().Save();refresh(self.workspace)
        with self.assertRaises(ValueError):o.installed_assets(self.workspace)
    def test_missing_texture(self):
        p=self.workspace/'IV_pole_a01/simready_usd/root.usda';s=Usd.Stage.Open(str(p));s.GetDefaultPrim().CreateAttribute('texture',Sdf.ValueTypeNames.Asset).Set(Sdf.AssetPath('missing.png'));s.GetRootLayer().Save();refresh(self.workspace)
        with self.assertRaises(ValueError):o.installed_assets(self.workspace)
    def test_symlink(self):
        (self.workspace/'IV_pole_a01/link').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):self.build()
    def test_verifier_detects_tampering(self):
        self.build();(self.root/'pack/source/scene.json').write_text('{}')
        with self.assertRaises(ValueError):verify(self.root/'pack')
    def test_adapter_source_binding_and_zip(self):
        job=self.root/'job';job.mkdir();shutil.move(self.source,job/'output');upload=self.root/'upload.json';dump(upload,{**self.cloud,'omniversePack':self.request});out=self.root/'next/output'
        proof=o.run({'schema':'brainsnn.adapter.v1','source':{'engine':'scene-usd','path':str(job)},'inputs':[{'kind':'cloud','path':str(upload)}],'output_dir':str(out)},self.workspace)
        self.assertEqual(proof['archive_sha256'],b.file_hash(out/'scene-omniverse.zip'))
        with zipfile.ZipFile(out/'scene-omniverse.zip') as z:self.assertIn('world.usda',z.namelist())
    def test_different_cloud(self):
        job=self.root/'job';job.mkdir();shutil.move(self.source,job/'output');self.cloud['points'][0][0]=.1;upload=self.root/'upload.json';dump(upload,{**self.cloud,'omniversePack':self.request})
        with self.assertRaises(ValueError):o.run({'schema':'brainsnn.adapter.v1','source':{'engine':'scene-usd','path':str(job)},'inputs':[{'kind':'cloud','path':str(upload)}],'output_dir':str(self.root/'out')},self.workspace)


class DownloadTests(unittest.TestCase):
    def test_bad_paths(self):
        for p in ('../x','/x',r'a\b','file:x','a//b','a/./b','a\nx'):
            with self.subTest(path=p),self.assertRaises(ValueError):n.safe_relative(p)
    def test_unknown_asset(self):
        with self.assertRaises(ValueError):n.listing('unknown')
    def test_stream_hash_validation(self):
        with tempfile.TemporaryDirectory() as d:
            data=b'example';row={'path':'IV_pole_a01/test','size':len(data),'oid':hashlib.sha1(b'blob 7\0'+data).hexdigest()};result=n.fetch_file(row,Path(d),lambda _:io.BytesIO(data));self.assertEqual(result['sha256'],hashlib.sha256(data).hexdigest())
    def test_stream_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as d:
            row={'path':'IV_pole_a01/test','size':7,'oid':'0'*40}
            with self.assertRaises(ValueError):n.fetch_file(row,Path(d),lambda _:io.BytesIO(b'example'))

if __name__=='__main__':unittest.main()
