"""Real destination exports through scene orchestration, with an explicit compiler stand-in.

This validates publication and exact revision binding, not Blender execution or
physical reconstruction of the user's space.
"""
import copy
import hashlib
import json

from robotics.world_worker import building_handoff, scene_usd
from robotics.scene_compiler.ifc_export import emit_ifc
from robotics.scene_compiler.component_graph import attach_component_ids
from tests.scene_compiler.test_rebuild_components import inputs
from tests.world.test_cad_export import reviewed_scene


def test_metric_scene_publishes_handoff_from_final_scene_bytes(tmp_path, monkeypatch):
    paths, blender = inputs(tmp_path)
    source_scene = json.loads(paths[0].read_text())
    original = reviewed_scene()
    original['scale'] = source_scene['scale']
    original['cloudPointsSha256'] = source_scene['cloudPointsSha256']
    original['counts'] = {'points': 1271, 'walls': 2, 'objects': 2, 'unknown_cells': 2}
    for wall in original['walls']:
        wall['support_points'] = 0
    original = attach_component_ids(original, original['cloudPointsSha256'])

    def authored_compiler(_cloud, out, **_kwargs):
        scene = copy.deepcopy(original)
        out.mkdir(parents=True, exist_ok=True)
        emit_ifc(out, scene)
        scene['usd'] = {'written': True, 'metersPerUnit': 1}
        (out / 'scene.usda').write_text('#usda 1.0\n')
        (out / 'scene.glb').write_bytes(b'compiler transport stand-in; not a reconstructed mesh')
        (out / 'scene.json').write_text(json.dumps(scene))
        return scene

    monkeypatch.setattr(scene_usd, 'compile_scene', authored_compiler)
    monkeypatch.setattr(scene_usd, 'blender_version', lambda _path: 'explicit compiler stand-in')
    out = tmp_path / 'job' / 'output'
    result = scene_usd.run({'schema': 'brainsnn.adapter.v1', 'output_dir': str(out),
                           'inputs': [{'kind': 'cloud', 'path': str(paths[1]), 'name': paths[1].name}]},
                          blender=str(blender))
    assert result['building_handoff']['written'], result['building_handoff']
    manifest = json.loads((out / 'manifest.json').read_text())['artifacts']
    names = [row['name'] for row in manifest]
    assert set(building_handoff.FILES) <= set(names)
    assert len(names) == len(set(names)) <= 32
    assert all((out / name).is_file() for name in names)
    final_scene = json.loads((out / 'scene.json').read_text())
    assert 'fit' in final_scene, 'destination hashes must bind the final scene with its fit summary'
    digest = hashlib.sha256((out / 'scene.json').read_bytes()).hexdigest()
    handoff = json.loads((out / 'building-handoff.json').read_text())
    assert handoff['sourceFiles']['scene']['sha256'] == digest
    assert handoff['sourceFiles']['scene']['binding'] == 'exact-file-bytes'
    assert handoff['destinations']['revit']['existingIfc']['sha256'] == hashlib.sha256((out / 'scene.ifc').read_bytes()).hexdigest()
    assert handoff['readiness']['roomQuantities'] is False
    assert result['metric_verified'] is False
    assert not any(name.endswith(('.esx', '.skx', '.rvt')) for name in names)
