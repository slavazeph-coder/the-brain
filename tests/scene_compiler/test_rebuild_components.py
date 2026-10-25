"""Bundle admission/publication contracts with an explicit stand-in for Blender.

Native IFC/Rhino libraries run when installed. These tests are not a reconstruction
or successful Blender execution qualification.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from unittest.mock import patch

import pytest

from robotics.scene_compiler import rebuild_components as rb
from robotics.scene_compiler.component_graph import attach_component_ids, apply_edits, scene_sha256
from robotics.scene_compiler.ifc_export import emit_ifc
from robotics.world_worker.measurement_check import points_sha256
from tests.world.test_cad_export import reviewed_scene, FLOOR_Y


def inputs(tmp_path):
    scene = reviewed_scene()
    scale = {'source': 'user-measured', 'distance': 2.5, 'spanUnits': 5., 'metresPerUnit': .5,
             'selfReported': True, 'verified': False}
    cloud = {'version': 1, 'kind': 'colmap-sparse-point-cloud', 'units': 'm',
             'coordinateFrame': 'right-handed-y-up', 'sourceFrame': 'colmap', 'source': 'authored software fixture',
             'provenance': {'metricVerified': False}, 'scale': scale, 'floorEstimate': {'y': FLOOR_Y, 'units': 'm'},
             'points': [[x / 10, FLOOR_Y, z / 10, 1, 2, 3] for x in range(41) for z in range(31)]}
    scene['scale'] = scale
    scene['cloudPointsSha256'] = points_sha256(cloud)
    scene = attach_component_ids(scene, points_sha256(cloud))
    contract = {'schema': 'brainsnn.component-edits.v1', 'sourceSha256': points_sha256(cloud),
                'sceneSha256': scene_sha256(scene), 'revision': 0,
                'edits': [{'op': 'wall', 'componentId': scene['walls'][0]['componentId'], 'translationMeters': [.1, 0, 0]},
                          {'op': 'opening', 'componentId': scene['openings'][0]['componentId'], 'widthMeters': 1.1}]}
    for name, value in [('scene.json', scene), ('arena-cloud.json', cloud), ('edits.json', contract)]:
        (tmp_path / name).write_text(json.dumps(value))
    blender = tmp_path / 'blender-transport-fixture'; blender.write_text('explicit test stand-in'); blender.chmod(0o755)
    return [tmp_path / n for n in ('scene.json', 'arena-cloud.json', 'edits.json')], blender


def successful_transport(command, **_kwargs):
    def arg(name):
        return Path(command[command.index(name) + 1])
    scene = json.loads(arg('--scene').read_text()); edits = json.loads(arg('--edits').read_text())
    scene = apply_edits(scene, edits); out = arg('--out'); out.mkdir()
    emit_ifc(out, scene)
    scene['usd'] = {'written': True, 'metersPerUnit': 1}
    for name in ('scene.glb', 'scene.usda', 'scene.blend'):
        (out / name).write_bytes(b'authored transport fixture, no Blender execution')
    (out / 'scene.json').write_text(json.dumps(scene))


def test_rebuild_retains_originals_and_rebinds_all_reports(tmp_path):
    paths, blender = inputs(tmp_path)
    originals = [p.read_bytes() for p in paths]
    with patch.object(rb.subprocess, 'run', side_effect=successful_transport):
        receipt = rb.rebuild(*paths, tmp_path / 'edited', blender=blender)
    out = tmp_path / 'edited'
    assert [p.read_bytes() for p in paths] == originals
    assert (out / 'source-scene.json').read_bytes() == originals[0]
    assert (out / 'arena-cloud.json').read_bytes() == originals[1]
    assert receipt['revision'] == 1 and receipt['metric_verified'] is False
    current_hash = hashlib.sha256((out / 'scene.json').read_bytes()).hexdigest()
    for name in ('scene-measurements.json', 'component-graph.json'):
        assert json.loads((out / name).read_text())['sourceFiles']['scene']['sha256'] == current_hash
    nav = json.loads((out / 'nav2-map.json').read_text())
    assert nav['source']['sceneSha256'] == current_hash
    assert nav['validation']['nav2RuntimeTested'] is False
    report = json.loads((out / 'scene-measurements.json').read_text())
    assert any(row['basis'] == 'operator-authored-edit' for row in report['dimensions'])
    with pytest.raises(FileExistsError):
        rb.rebuild(*paths, out, blender=blender)


def test_failed_blender_never_publishes_a_partial_bundle(tmp_path):
    paths, blender = inputs(tmp_path)
    def fail(command, **kwargs):
        successful_transport(command, **kwargs)
        raise subprocess.CalledProcessError(139, command)
    with patch.object(rb.subprocess, 'run', side_effect=fail), pytest.raises(subprocess.CalledProcessError):
        rb.rebuild(*paths, tmp_path / 'edited', blender=blender)
    assert not (tmp_path / 'edited').exists()
    assert not list(tmp_path.glob('.edited.rebuild-*'))


def test_stale_edits_are_rejected_before_starting_blender(tmp_path):
    paths, blender = inputs(tmp_path)
    contract = json.loads(paths[2].read_text()); contract['revision'] = 1
    paths[2].write_text(json.dumps(contract))
    with patch.object(rb.subprocess, 'run') as run, pytest.raises(ValueError):
        rb.rebuild(*paths, tmp_path / 'edited', blender=blender)
    run.assert_not_called()
    assert not (tmp_path / 'edited').exists()
