"""Offline contracts; optional real OpenUSD composition without Isaac Sim."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from robotics.world_worker import simready_bridge as b
from robotics.world_worker.capture_evidence import validate_bundle, wall_candidate

URL='https://huggingface.co/datasets/nvidia/simready-assets/resolve/'+'a'*40+'/bin/com.nvidia.simready.packaging.json'

class Fixtures:
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        d=self.root/'bin'; d.mkdir()
        (d/'bin.usda').write_text('#usda 1.0\n(\n defaultPrim = "Bin"\n metersPerUnit = 1\n upAxis = "Y"\n)\ndef Xform "Bin" {}\n')
        package={'package_id':'simready.test.bin.1','license':'LicenseRef-Test'}
        (d/'com.nvidia.simready.packaging.json').write_text(json.dumps(package))
        self.library={'assets':[{'asset_name':'bin','source_url':URL,'package':{**package,'repo_id':'nvidia/simready-assets','commit':'a'*40},'license':package['license'],
                                'files':{'directory':'bin','root_usd':'bin/bin.usda'},
                                'validation':{'passed':True,'profile':'fixture','failed_features':[]}}]}
    def tearDown(self): self.tmp.cleanup()
    def records(self): return b.inspect(self.library,self.root)
    def placements(self,r):
        return {'schema':'brainsnn.simready-placements.v1','placements':[{'id':'bin_1','source_url':URL,'translation_m':[1,0,2],
                  'approval':{'license_reviewed':True,'placement_reviewed':True,'license':r[0]['license'],'package_sha256':r[0]['receipt']['sha256']}}]}

class BridgeTests(Fixtures,unittest.TestCase):
    def test_pin(self): self.assertEqual(b.pin(URL)['revision'],'a'*40)
    def test_bad_urls(self):
        for url in [URL.replace('a'*40,'main'),URL.replace('huggingface.co','localhost'),URL+'?download=1',URL.replace('https:','http:'),URL.replace('/bin/','/../')]:
            with self.subTest(url=url),self.assertRaises(ValueError): b.pin(url)
    def test_identity_mismatch(self):
        self.library['assets'][0]['package']['commit']='b'*40
        with self.assertRaises(ValueError): self.records()
    def test_manifest_license_mismatch(self):
        self.library['assets'][0]['license']='other'
        with self.assertRaises(ValueError): self.records()
    def test_missing_root(self):
        self.library['assets'][0]['files']['root_usd']='bin/absent.usda'
        with self.assertRaises(ValueError): self.records()
    def test_traversal(self):
        for v in ['../x','/tmp/a','bin/../bin/bin.usda',r'bin\bin.usda','file:bin/bin.usda']:
            with self.subTest(path=v),self.assertRaises(ValueError): b.local(self.root,v)
    def test_symlink(self):
        (self.root/'bin/link').symlink_to(self.root/'bin/bin.usda')
        with self.assertRaises(ValueError): self.records()
    def test_texture_changes_receipt(self):
        first=self.records()[0]['receipt']['sha256']; (self.root/'bin/image.png').write_bytes(b'fixture')
        self.assertNotEqual(first,self.records()[0]['receipt']['sha256'])
    def test_not_physical_qualification(self):
        r=self.records(); p=b.plan(r,self.placements(r))
        self.assertFalse(p['physics_ready']); self.assertFalse(p['metric_verified']); self.assertFalse(p['observed_geometry_replaced'])
    def test_explicit_approval(self):
        r=self.records(); p=self.placements(r); p['placements'][0]['approval']['license_reviewed']=False
        with self.assertRaises(ValueError): b.plan(r,p)
    def test_stale_approval(self):
        r=self.records(); p=self.placements(r); (self.root/'bin/bin.usda').write_text('# changed')
        with self.assertRaises(ValueError): b.plan(self.records(),p)
    def test_resizing_rejected(self):
        r=self.records(); p=self.placements(r); p['placements'][0]['scale']=2
        with self.assertRaises(ValueError): b.plan(r,p)
    def test_hull_requires_approval(self):
        r=self.records(); p=self.placements(r); p['placements'][0]['collision_policy']='convexHull'
        with self.assertRaises(ValueError): b.plan(r,p)
        p['placements'][0]['approval']['approximation_reviewed']=True
        self.assertEqual(b.plan(r,p)['placements'][0]['collision_policy'],'convexHull')
    def test_validation_failure(self):
        for v in [False,None,'true']:
            self.library['assets'][0]['validation']['passed']=v; r=self.records()
            with self.assertRaises(ValueError): b.plan(r,self.placements(r))
    def test_duplicate(self):
        r=self.records(); p=self.placements(r); p['placements']*=2
        with self.assertRaises(ValueError): b.plan(r,p)
    def test_nonfinite(self):
        r=self.records(); p=self.placements(r); p['placements'][0]['translation_m'][0]=float('nan')
        with self.assertRaises(ValueError): b.plan(r,p)
    def test_budget(self):
        r=self.records(); p=self.placements(r); p['placements']=[{**p['placements'][0],'id':f'x{i}'} for i in range(65)]
        with self.assertRaises(ValueError): b.plan(r,p)
    def test_nonfinite_json(self):
        f=self.root/'bad.json'; f.write_text('{"x":NaN}')
        with self.assertRaises(ValueError): b.read_json(f)

@unittest.skipUnless(importlib.util.find_spec('pxr'),'usd-core required: this skip is not USD qualification')
class UsdTests(Fixtures,unittest.TestCase):
    def authored(self,meters=1):
        from pxr import Usd,UsdGeom,UsdPhysics,Gf
        f=self.root/'bin/bin.usda'; f.unlink()
        s=Usd.Stage.CreateNew(str(f)); UsdGeom.SetStageMetersPerUnit(s,meters); UsdGeom.SetStageUpAxis(s,UsdGeom.Tokens.z)
        x=UsdGeom.Xform.Define(s,'/Bin'); s.SetDefaultPrim(x.GetPrim()); x.AddTranslateOp().Set(Gf.Vec3d(0,0,.25))
        cube=UsdGeom.Cube.Define(s,'/Bin/Body'); UsdPhysics.CollisionAPI.Apply(cube.GetPrim()); s.GetRootLayer().Save()
    def test_real_roundtrip(self):
        from pxr import Usd,UsdPhysics
        self.authored(); r=self.records(); result=b.compose(b.plan(r,self.placements(r)),self.root,self.root/'out')
        self.assertTrue(result['usd_reopened']); self.assertFalse(result['physics_ready'])
        s=Usd.Stage.Open(str(self.root/'out/simready-additions.usda'))
        prim=s.GetPrimAtPath('/SimReadyAdditions/bin_1/Basis/Asset')
        self.assertTrue(prim.GetAttribute('xformOp:translate').HasAuthoredValueOpinion())
        self.assertTrue(s.GetPrimAtPath('/SimReadyAdditions/bin_1/Basis/Asset/Body').HasAPI(UsdPhysics.CollisionAPI))
    def test_reject_nonmetre(self):
        self.authored(.01); r=self.records()
        with self.assertRaises(ValueError): b.compose(b.plan(r,self.placements(r)),self.root,self.root/'out')
    def test_reject_absent_colliders(self):
        r=self.records()
        with self.assertRaises(ValueError): b.compose(b.plan(r,self.placements(r)),self.root,self.root/'out')

class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name); frames=[]
        for i in range(3):
            f=self.root/f'{i}.png'; Image.new('RGB',(320,256),(i*20,0,0)).save(f)
            T=np.eye(4); T[0,3]=i*.1
            frames.append({'id':str(i),'timestamp_seconds':float(i),'image':f.name,'image_sha256':b.file_hash(f),
                           'image_size':[320,256],'intrinsics':[[300,0,160],[0,300,128],[0,0,1]],
                           'camera_to_world':T.tolist(),'tracking_state':'normal'})
        self.bundle={'schema':'brainsnn.capture.v1','pose_convention':'arkit-camera-to-world','units':'m','pixel_convention':'integer-centres','frames':frames}
    def tearDown(self): self.tmp.cleanup()
    def test_pose_conversion(self):
        result=validate_bundle(self.bundle,self.root)
        self.assertEqual(result['normal_tracking_frames'],3); self.assertFalse(result['metric_verified'])
        np.testing.assert_allclose(result['frames'][1]['world_to_colmap_camera'],[[1,0,0,-.1],[0,-1,0,0],[0,0,-1,0]])
    def test_corrupt_hash(self):
        self.bundle['frames'][1]['image_sha256']='0'*64
        with self.assertRaises(ValueError): validate_bundle(self.bundle,self.root)
    def test_duplicate_time(self):
        self.bundle['frames'][1]['timestamp_seconds']=0
        with self.assertRaises(ValueError): validate_bundle(self.bundle,self.root)
    def test_nonrigid(self):
        self.bundle['frames'][1]['camera_to_world'][0][0]=2
        with self.assertRaises(ValueError): validate_bundle(self.bundle,self.root)
    def test_raster_mismatch(self):
        self.bundle['frames'][1]['image_size']=[640,512]
        with self.assertRaises(ValueError): validate_bundle(self.bundle,self.root)
    def test_poor_tracking(self):
        self.bundle['frames'][1]['tracking_state']='limited'
        with self.assertRaises(ValueError): validate_bundle(self.bundle,self.root)
    def test_bad_intrinsics(self):
        self.bundle['frames'][1]['intrinsics'][0][0]=-1
        with self.assertRaises(ValueError): validate_bundle(self.bundle,self.root)

class WallTests(unittest.TestCase):
    def points(self,thickness=.08,two=True):
        rng=np.random.default_rng(2); s,z=np.meshgrid(np.linspace(.05,1.95,40),np.linspace(.05,1.95,40))
        a=np.column_stack((s.ravel(),z.ravel(),rng.normal(0,.001,s.size)))
        return np.vstack((a,a+[0,0,thickness])) if two else a
    def test_thin_wall_candidate(self):
        r=wall_candidate(self.points(),[0,0,0],[0,0,1],[1,0,0])
        self.assertEqual(r['status'],'two-surface-candidate'); self.assertAlmostEqual(r['thickness_m'],.08,places=3)
        self.assertFalse(r['physical_two_sides_verified'])
    def test_single_face(self):
        self.assertIsNone(wall_candidate(self.points(two=False),[0,0,0],[0,0,1],[1,0,0])['thickness_m'])
    def test_noisy_single_face(self):
        p=self.points(two=False); p[:,2]=np.random.default_rng(1).normal(0,.065,len(p))
        self.assertIsNone(wall_candidate(p,[0,0,0],[0,0,1],[1,0,0])['thickness_m'])
    def test_rotation(self):
        t=.37; R=np.array([[np.cos(t),0,np.sin(t)],[0,1,0],[-np.sin(t),0,np.cos(t)]])
        r=wall_candidate(self.points()@R.T,[0,0,0],R@[0,0,1],R@[1,0,0])
        self.assertAlmostEqual(r['thickness_m'],.08,places=3)
    def test_nonoverlap(self):
        p=self.points(); p[len(p)//2:,0]+=4
        self.assertIsNone(wall_candidate(p,[0,0,0],[0,0,1],[1,0,0])['thickness_m'])
    def test_invalid_basis(self):
        with self.assertRaises(ValueError): wall_candidate(self.points(),[0,0,0],[0,0,1],[0,0,1])

if __name__=='__main__': unittest.main()
