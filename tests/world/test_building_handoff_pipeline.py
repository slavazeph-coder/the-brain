"""Real destination exports through scene orchestration, with an explicit compiler stand-in.

This validates publication and exact revision binding, not Blender execution or
physical reconstruction of the user's space.
"""
import copy
import hashlib
import json
import re
from pathlib import Path

from robotics.world_worker import building_handoff, drawing_set, scene_usd
from robotics.world_worker.app import MAX_ARTIFACTS
from robotics.scene_compiler.ifc_export import emit_ifc
from robotics.scene_compiler.component_graph import attach_component_ids, scene_sha256
from tests.scene_compiler.test_rebuild_components import inputs
from tests.world.test_cad_export import reviewed_scene


def run_scene(tmp_path, monkeypatch):
    """scene_usd.run on the authored cloud with the compiler stood in. Returns the output directory and the evidence."""
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
    return out, result


def test_metric_scene_publishes_handoff_from_final_scene_bytes(tmp_path, monkeypatch):
    out, result = run_scene(tmp_path, monkeypatch)
    assert result['building_handoff']['written'], result['building_handoff']
    manifest = json.loads((out / 'manifest.json').read_text())['artifacts']
    names = [row['name'] for row in manifest]
    assert set(building_handoff.FILES) <= set(names)
    assert len(names) == len(set(names)) <= MAX_ARTIFACTS
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


def test_metric_scene_publishes_the_drawing_set_of_the_final_scene(tmp_path, monkeypatch):
    out, result = run_scene(tmp_path, monkeypatch)
    drawings = result['drawing_set']
    assert drawings['written'] and drawings['pages'] == 12 and 'artifacts' not in drawings, drawings
    manifest = json.loads((out / 'manifest.json').read_text())['artifacts']
    assert {'name': 'drawing-set.pdf', 'kind': 'cad'} in manifest
    assert {'name': 'drawing-preview.json', 'kind': 'cad'} in manifest
    preview = json.loads((out / 'drawing-preview.json').read_text())
    assert preview['source']['sceneFileSha256'] == hashlib.sha256((out / 'scene.json').read_bytes()).hexdigest()
    raw = (out / 'drawing-set.pdf').read_bytes()
    assert raw.startswith(b'%PDF-1.4') and drawings['sha256'] == hashlib.sha256(raw).hexdigest()
    final_scene = json.loads((out / 'scene.json').read_text())
    assert drawings['canonicalSceneSha256'] == scene_sha256(final_scene), 'drawn from the scene that was published'
    assert drawings['counts'] == {'walls': 2, 'openings': 1, 'objects': 2, 'unknownCells': 2}
    assert drawings['metricVerified'] is False and drawings['physicalDimensionsVerified'] is False
    assert json.loads((out / 'scene-usd.json').read_text())['drawing_set'] == drawings
    assert not any(out.glob('.drawing-set-*'))


def test_a_drawing_problem_never_costs_the_job_its_scene(tmp_path, monkeypatch):
    def refuse(*_args, **_kwargs):
        raise ValueError('The plan footprint is degenerate.')
    monkeypatch.setattr(drawing_set, 'write_drawing_set', refuse)
    out, result = run_scene(tmp_path, monkeypatch)
    assert result['drawing_set'] == {'written': False, 'reason': 'ValueError: The plan footprint is degenerate.'}
    names = [row['name'] for row in json.loads((out / 'manifest.json').read_text())['artifacts']]
    assert 'drawing-set.pdf' not in names and 'scene.ifc' in names and set(building_handoff.FILES) <= set(names)


def test_the_drawing_set_gives_way_when_the_manifest_is_full(tmp_path, monkeypatch):
    (tmp_path / 'first').mkdir(); (tmp_path / 'second').mkdir()
    out, result = run_scene(tmp_path / 'first', monkeypatch)
    full = len(json.loads((out / 'manifest.json').read_text())['artifacts'])
    monkeypatch.setattr(scene_usd, 'ARTIFACT_LIMIT', full - 2)
    out, result = run_scene(tmp_path / 'second', monkeypatch)
    names = [row['name'] for row in json.loads((out / 'manifest.json').read_text())['artifacts']]
    assert len(names) == full - 2 and 'drawing-set.pdf' not in names and not (out / 'drawing-set.pdf').exists()
    assert 'drawing-preview.json' not in names and not (out / 'drawing-preview.json').exists()
    assert result['drawing_set']['written'] is False and 'already publishes' in result['drawing_set']['reason']
    assert json.loads((out / 'scene-usd.json').read_text())['drawing_set'] == result['drawing_set']
    assert all((out / name).is_file() for name in names)


def test_worker_site_and_adapter_agree_on_the_artifact_bound():
    client = (Path(__file__).resolve().parents[2] / 'brainsnn-r3f-app/public/world/worker-client.mjs').read_text()
    assert int(re.search(r'export const MAX_ARTIFACTS=(\d+);', client).group(1)) == MAX_ARTIFACTS == scene_usd.ARTIFACT_LIMIT
    # A count by hand of everything scene_usd can publish at once: the walkthrough's six files and every optional
    # export. It does not follow the exporters; the guard tested above is what keeps a longer manifest from failing a job.
    worst = 6 + 3 + 3 + 3 + len(building_handoff.FILES) + 1 + 2 + 2 + 1 + 1 + 1 + 1 + 3 + 1 + 1
    assert worst == 33 <= MAX_ARTIFACTS, 'reconstruction, scene, CAD, stand-ins, building, drawings, evidence, fit, checks, components, Nav2, cloud, names'
