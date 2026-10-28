"""USD paths and immutable launcher regressions discovered on real packages."""
from pathlib import Path
import importlib.util
import json
import subprocess,sys,tempfile,unittest
from pxr import Sdf,Usd,UsdGeom
from robotics.world_worker import omniverse_pack as o
from test_omniverse_pack import fixture,refresh
class Regressions(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.source,self.library,self.request,_=fixture(self.root)
    def tearDown(self):self.tmp.cleanup()
    def test_relationship_target_paths(self):
        p=self.library/'IV_pole_a01/simready_usd/root.usda';s=Usd.Stage.Open(str(p));s.GetDefaultPrim().CreateRelationship('fixture:targets').SetTargets([Sdf.Path('/Root/Body')]);s.GetRootLayer().Save();refresh(self.library)
        self.assertTrue(o.installed_assets(self.library)[0]['available'])
    def test_reset_transform_rejected(self):
        p=self.library/'IV_pole_a01/simready_usd/root.usda';s=Usd.Stage.Open(str(p));UsdGeom.Xformable(s.GetDefaultPrim()).SetResetXformStack(True);s.GetRootLayer().Save();refresh(self.library)
        with self.assertRaisesRegex(ValueError,'reset transform'):o.installed_assets(self.library)
    def test_output_cannot_recurse(self):
        with self.assertRaises(ValueError):o.package_scene(self.source,self.source/'pack',self.request,self.library)
        with self.assertRaises(ValueError):o.package_scene(self.source,self.library/'pack',self.request,self.library)
    def test_adapter_rejects_nested_output_before_writing(self):
        cloud=json.loads((self.source/'arena-cloud.json').read_text());cloud['omniversePack']=self.request
        upload=self.root/'request.json';upload.write_text(json.dumps(cloud))
        for output in (self.library/'new-output',self.source/'new-output'):
            with self.subTest(output=output):
                with self.assertRaisesRegex(ValueError,'outside'):
                    o.run({'schema':'brainsnn.adapter.v1','inputs':[{'kind':'cloud','path':str(upload)}],
                           'source':{'engine':'scene-usd','path':str(self.source.parent)},'output_dir':str(output)},self.library)
                self.assertFalse(output.exists())
    def test_qualifier_rejects_nested_output_before_writing(self):
        path=Path(__file__).resolve().parents[2]/'scripts/world-demo/qualify_omniverse.py'
        spec=importlib.util.spec_from_file_location('qualify_omniverse',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        output=self.library/'qualification'
        before={p.relative_to(self.library):p.read_bytes() for p in self.library.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError,'outside'):module.qualify(self.library,output)
        self.assertFalse(output.exists())
        self.assertEqual(before,{p.relative_to(self.library):p.read_bytes() for p in self.library.rglob('*') if p.is_file()})
    def test_source_requires_explicit_unit_metadata(self):
        path=self.source/'scene.usda';stage=Usd.Stage.Open(str(path));stage.ClearMetadata('upAxis');stage.GetRootLayer().Save()
        with self.assertRaisesRegex(ValueError,'metre-authored'):o.package_scene(self.source,self.root/'pack',self.request,self.library)
    def test_broken_composition_rejected_even_when_dependency_exists(self):
        path=self.library/'IV_pole_a01/simready_usd/root.usda';stage=Usd.Stage.Open(str(path))
        stage.DefinePrim('/Root/Broken').GetReferences().AddInternalReference('/NoSuchPrim');stage.GetRootLayer().Save();refresh(self.library)
        with self.assertRaisesRegex(ValueError,'NVIDIA stage'):o.installed_assets(self.library)
    def test_launcher_does_not_mutate_package(self):
        self.request['placements']=[];pack=self.root/'pack';o.package_scene(self.source,pack,self.request,self.library)
        run=subprocess.run([sys.executable,str(pack/'isaac_smoke.py'),'--out',str(self.root/'result.json')],capture_output=True,text=True,timeout=15)
        self.assertIn('files_verified',run.stdout)
        self.assertFalse((pack/'__pycache__').exists())
        if run.returncode:self.assertIn('isaacsim',run.stderr)
if __name__=='__main__':unittest.main()
