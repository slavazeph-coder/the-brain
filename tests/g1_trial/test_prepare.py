"""Real OpenUSD tests on explicit synthetic geometry; no Isaac physics."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from pxr import Usd, UsdGeom, Gf, UsdPhysics, UsdShade
from robotics.g1_trial.contracts import sha256, write_json
from robotics.g1_trial.prepare import prepare, verify_prepared
from robotics.g1_trial.runtime import run
from tests.g1_trial.test_contracts import spec


def fixture(root):
    pack=root/'pack';source=pack/'source';source.mkdir(parents=True)
    s=Usd.Stage.CreateNew(str(source/'scene.usda'));UsdGeom.SetStageMetersPerUnit(s,1);UsdGeom.SetStageUpAxis(s,'Y')
    s.SetDefaultPrim(UsdGeom.Xform.Define(s,'/World').GetPrim())
    for name,pos,scale in [('Floor',(3,-.05,2),(6,.1,4)),('Threshold',(2.6,.04,2),(.4,.08,3))]:
        cube=UsdGeom.Cube.Define(s,'/World/'+name);cube.CreateSizeAttr(1)
        cube.AddTranslateOp().Set(Gf.Vec3d(*pos));cube.AddScaleOp().Set(Gf.Vec3f(*scale))
    s.GetRootLayer().Save()
    write_json(source/'scene.json',{'schema':'brainsnn.scene.v1','units':'m','source':'SYNTHETIC trial fixture'})
    write_json(source/'arena-cloud.json',{'units':'m','coordinateFrame':'right-handed-y-up',
        'provenance':{'synthetic':True},'points':[[0,0,0],[6,0,0],[6,0,4],[0,0,4]]})
    manifest={'schema':'brainsnn.portable-files.v1','files':[{'path':p.relative_to(pack).as_posix(),
              'size':p.stat().st_size,'sha256':sha256(p)} for p in source.iterdir()]}
    write_json(pack/'pack-files.json',manifest)
    q=spec();q['source_sha256']={k:sha256(source/k) for k in q['source_sha256']}
    write_json(root/'scenario.json',q)
    return pack,root/'scenario.json'


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.pack,self.spec=fixture(self.root)
    def build(self):return prepare(self.pack,self.spec,self.root/'trial')
    def test_single_mesh_rotation_and_source_preservation(self):
        before=sha256(self.pack/'source/scene.usda');r=self.build()
        s=Usd.Stage.Open(str(self.root/'trial/terrain.usda'));meshes=[p for p in s.Traverse() if p.IsA(UsdGeom.Mesh)]
        self.assertEqual(len(meshes),1);self.assertEqual(UsdGeom.GetStageUpAxis(s),'Z')
        pts=UsdGeom.Mesh(meshes[0]).GetPointsAttr().Get()
        self.assertAlmostEqual(max(p[0] for p in pts),6);self.assertAlmostEqual(min(p[1] for p in pts),-4)
        self.assertAlmostEqual(max(p[2] for p in pts),.08,places=5)
        self.assertEqual(r['triangles'],24);self.assertFalse(r['ground_fill_added']);self.assertFalse(r['physics_executed'])
        self.assertEqual(before,sha256(self.pack/'source/scene.usda'));verify_prepared(self.root/'trial')
    def test_explicit_physics_material_survives_reopen(self):
        self.build(); s=Usd.Stage.Open(str(self.root/'trial/terrain.usda'))
        prim=s.GetPrimAtPath('/Terrain/Mesh')
        bound,_=UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial('physics')
        self.assertEqual(str(bound.GetPath()),'/Terrain/PhysicsMaterial')
        material=UsdPhysics.MaterialAPI(bound.GetPrim())
        self.assertEqual(material.GetStaticFrictionAttr().Get(),1.)
        self.assertAlmostEqual(material.GetDynamicFrictionAttr().Get(),.8,places=5)
    def test_changed_source_rejected(self):
        (self.pack/'source/scene.json').write_text('{}')
        with self.assertRaises(ValueError):self.build()
    def test_stale_binding_rejected(self):
        q=json.loads(self.spec.read_text());q['source_sha256']['scene.usda']='0'*64;self.spec.write_text(json.dumps(q))
        with self.assertRaisesRegex(ValueError,'changed'):self.build()
    def test_selected_parent_is_not_geometry(self):
        q=json.loads(self.spec.read_text());q['collision_prims']=['/World/Missing'];self.spec.write_text(json.dumps(q))
        with self.assertRaises(ValueError):self.build()
    def test_changed_prepared_bytes_rejected(self):
        self.build();(self.root/'trial/terrain.usda').write_text('changed')
        with self.assertRaises(ValueError):verify_prepared(self.root/'trial')
    def test_existing_or_source_output_refused(self):
        for out in (self.pack,self.pack/'trial'):
            with self.assertRaises(ValueError):prepare(self.pack,self.spec,out)
    def test_preflight_failure_is_persisted_not_a_success(self):
        self.build()
        with patch('robotics.g1_trial.runtime.preflight',return_value={'status':'blocked','blockers':['no GPU']}):
            r=run(self.root/'trial',self.root/'upstream',self.root/'run')
        self.assertEqual(r['status'],'blocked');self.assertFalse(r['physics_executed']);self.assertFalse(r['goal_reached'])
        self.assertEqual(json.loads((self.root/'run/receipt.json').read_text())['status'],'blocked')
        with self.assertRaises(FileExistsError):run(self.root/'trial',self.root/'upstream',self.root/'run')

if __name__=='__main__':unittest.main()
