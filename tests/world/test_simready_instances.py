"""Exercise real USD instance proxies at the SimReady placement boundary."""
import json

import pytest

pytest.importorskip('pxr')
from pxr import Gf, Usd, UsdGeom, UsdPhysics

from robotics.world_worker import simready_bridge as bridge


def instance_plan(root, *, reset=False, hull=False):
    package = root / 'bin'
    package.mkdir()
    stage = Usd.Stage.CreateNew(str(package / 'bin.usda'))
    UsdGeom.SetStageMetersPerUnit(stage, 1)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    default = UsdGeom.Xform.Define(stage, '/Bin')
    stage.SetDefaultPrim(default.GetPrim())
    UsdGeom.Xform.Define(stage, '/Template')
    mesh = UsdGeom.Mesh.Define(stage, '/Template/Piece')
    mesh.CreatePointsAttr([Gf.Vec3f(0, 0, 0), Gf.Vec3f(1, 0, 0), Gf.Vec3f(0, 1, 0)])
    mesh.CreateFaceVertexCountsAttr([3])
    mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
    mesh.AddTranslateOp().Set(Gf.Vec3d(0, 0, .25))
    mesh.SetResetXformStack(reset)
    UsdPhysics.CollisionAPI.Apply(mesh.GetPrim())
    instance = stage.DefinePrim('/Bin/Instance')
    instance.GetReferences().AddInternalReference('/Template')
    instance.SetInstanceable(True)
    if reset:
        # The old collider audit found this sibling and missed the reset proxy.
        collider = UsdGeom.Cube.Define(stage, '/Bin/Sibling')
        UsdPhysics.CollisionAPI.Apply(collider.GetPrim())
    stage.GetRootLayer().Save()
    identity = {'package_id': 'simready.test.instance.1', 'license': 'LicenseRef-Test'}
    (package / 'com.nvidia.simready.packaging.json').write_text(json.dumps(identity))
    source = ('https://huggingface.co/datasets/nvidia/simready-assets/resolve/'
              + 'a' * 40 + '/bin/com.nvidia.simready.packaging.json')
    library = {'assets': [{
        'asset_name': 'bin', 'source_url': source, 'license': identity['license'],
        'package': {**identity, 'repo_id': 'nvidia/simready-assets', 'commit': 'a' * 40},
        'files': {'directory': 'bin', 'root_usd': 'bin/bin.usda'},
        'validation': {'passed': True, 'profile': 'fixture', 'failed_features': []},
    }]}
    records = bridge.inspect(library, root)
    request = {'schema': 'brainsnn.simready-placements.v1', 'placements': [{
        'id': 'bin_1', 'source_url': source, 'translation_m': [1, 0, 2],
        'collision_policy': 'convexHull' if hull else 'authored',
        'approval': {'license_reviewed': True, 'placement_reviewed': True,
                     'approximation_reviewed': True, 'license': identity['license'],
                     'package_sha256': records[0]['receipt']['sha256']},
    }]}
    return bridge.plan(records, request)


def test_instance_proxy_collider_is_preserved_and_placed(tmp_path):
    plan = instance_plan(tmp_path)
    report = bridge.compose(plan, tmp_path, tmp_path / 'out')
    assert report['usd_reopened'] is True
    stage = Usd.Stage.Open(str(tmp_path / 'out/simready-additions.usda'))
    prim = stage.GetPrimAtPath('/SimReadyAdditions/bin_1/Basis/Asset/Instance/Piece')
    assert prim.IsInstanceProxy()
    assert prim.HasAPI(UsdPhysics.CollisionAPI)
    world = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
    assert tuple(world.ExtractTranslation()) == pytest.approx((1, .25, 2))


def test_reset_stack_inside_instance_is_rejected_before_copy(tmp_path):
    plan = instance_plan(tmp_path, reset=True)
    with pytest.raises(ValueError, match='[Rr]eset transform'):
        bridge.compose(plan, tmp_path, tmp_path / 'out')
    assert not (tmp_path / 'out').exists()


def test_hull_policy_on_instance_is_rejected_before_copy(tmp_path):
    plan = instance_plan(tmp_path, hull=True)
    with pytest.raises(ValueError, match='[Ii]nstan'):
        bridge.compose(plan, tmp_path, tmp_path / 'out')
    assert not (tmp_path / 'out').exists()


@pytest.mark.parametrize('sampled', [False, True])
@pytest.mark.parametrize('asset_path', ['missing.png', '../outside.png'])
def test_missing_or_escaping_material_asset_inside_proxy_is_rejected(tmp_path, sampled, asset_path):
    from pxr import Sdf
    plan = instance_plan(tmp_path)
    source = tmp_path / 'bin/bin.usda'
    stage = Usd.Stage.Open(str(source))
    attr = stage.GetPrimAtPath('/Template/Piece').CreateAttribute('texture', Sdf.ValueTypeNames.Asset)
    # An active instance proxy's material references were previously outside the dependency audit.
    (tmp_path / 'outside.png').write_bytes(b'outside the reviewed package')
    attr.Set(Sdf.AssetPath(asset_path), 1 if sampled else Usd.TimeCode.Default())
    stage.GetRootLayer().Save()
    plan['placements'][0]['asset']['receipt'] = bridge.receipt(tmp_path / 'bin')
    with pytest.raises(ValueError, match='missing or escapes'):
        bridge.compose(plan, tmp_path, tmp_path / 'out')
    assert not (tmp_path / 'out').exists()


def test_remote_material_asset_is_rejected_even_with_authored_collider(tmp_path):
    from pxr import Sdf
    plan = instance_plan(tmp_path)
    stage = Usd.Stage.Open(str(tmp_path / 'bin/bin.usda'))
    stage.GetPrimAtPath('/Template/Piece').CreateAttribute('texture', Sdf.ValueTypeNames.Asset).Set(Sdf.AssetPath('https://example.invalid/file.png'))
    stage.GetRootLayer().Save()
    plan['placements'][0]['asset']['receipt'] = bridge.receipt(tmp_path / 'bin')
    with pytest.raises(ValueError, match='Remote or absolute'):
        bridge.compose(plan, tmp_path, tmp_path / 'out')
    assert not (tmp_path / 'out').exists()
