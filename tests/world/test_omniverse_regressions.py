"""USD paths and immutable launcher regressions discovered on real packages."""
from pathlib import Path
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
    def test_launcher_does_not_mutate_package(self):
        self.request['placements']=[];pack=self.root/'pack';o.package_scene(self.source,pack,self.request,self.library)
        run=subprocess.run([sys.executable,str(pack/'isaac_smoke.py'),'--out',str(self.root/'result.json')],capture_output=True,text=True,timeout=15)
        self.assertIn('files_verified',run.stdout)
        self.assertFalse((pack/'__pycache__').exists())
        if run.returncode:self.assertIn('isaacsim',run.stderr)
if __name__=='__main__':unittest.main()
