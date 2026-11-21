"""Read a browser-exported stage using OpenUSD and compare geometry and recorded motion."""
import json
from pathlib import Path
import subprocess

import pytest

pxr = pytest.importorskip('pxr')
from pxr import Usd, UsdGeom, UsdPhysics

ROOT = Path(__file__).resolve().parents[2]


def test_showroom_stage_matches_recorded_prisms_and_animation(tmp_path):
    # An actual scene plus two positions is enough to isolate the serializer from the physics runner.
    js = """
import {createShowroomExample} from './brainsnn-r3f-app/public/world/showroom-model.mjs';
import {buildShowroomEpisodeScene,showroomEpisodeColliders} from './brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';
import {makeShowroomEpisodeUSD} from './brainsnn-r3f-app/public/world/showroom-episode-usd.mjs';
import {writeFileSync} from 'node:fs';
const room = createShowroomExample();
const scene = buildShowroomEpisodeScene(room,{objectId:room.routes.objectId,variant:'after'});
const frames = [{time:0,position:[1,4]},{time:.05,position:[1.01,4.02]}];
const episode = {scene,frames,sampleIntervalSeconds:.05,sceneSha256:'3'.repeat(64)};
writeFileSync(process.argv[1],makeShowroomEpisodeUSD(episode));
console.log(JSON.stringify({colliders:showroomEpisodeColliders(scene),height:scene.cartHeight,radius:scene.cartRadius}));
"""
    path = tmp_path / 'room.usda'
    rendered = subprocess.run(['node', '--input-type=module', '-e', js, str(path)], cwd=ROOT,
                              check=True, capture_output=True, text=True)
    actual = json.loads(rendered.stdout)
    stage = Usd.Stage.Open(str(path))
    assert stage.GetDefaultPrim().GetPath().pathString == '/World'
    assert UsdGeom.GetStageUpAxis(stage) == 'Y'
    assert UsdGeom.GetStageMetersPerUnit(stage) == 1
    assert stage.GetTimeCodesPerSecond() == 20
    assert stage.GetDefaultPrim().GetAttribute('roomSceneSha256').Get() == '3' * 64
    assert UsdPhysics.Scene.Get(stage, '/World/Physics')
    for index, collider in enumerate(actual['colliders']):
        prim = stage.GetPrimAtPath(f'/World/Collider_{index}')
        assert prim.HasAPI(UsdPhysics.CollisionAPI)
        assert prim.GetAttribute('colliderName').Get() == collider['name']
        assert prim.GetAttribute('physics:approximation').Get() == 'convexHull'
        points = UsdGeom.Mesh(prim).GetPointsAttr().Get()
        expected = [[x, y, z] for y in (collider['bottom'], collider['top']) for x, z in collider['polygon']]
        assert len(points) == len(expected)
        for pt, wanted in zip(points, expected):
            assert tuple(pt) == pytest.approx(wanted)
    cart = stage.GetPrimAtPath('/World/Cart')
    assert cart.HasAPI(UsdPhysics.CollisionAPI)
    assert UsdPhysics.RigidBodyAPI(cart).GetKinematicEnabledAttr().Get()
    assert UsdGeom.Cylinder(cart).GetRadiusAttr().Get() == actual['radius']
    move = cart.GetAttribute('xformOp:translate')
    assert move.GetTimeSamples() == [0.0, 1.0]
    assert tuple(move.Get(1)) == pytest.approx((1.01, actual['height'] / 2, 4.02))
