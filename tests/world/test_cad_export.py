"""CAD and estimating exports of a compiled scene: python -m pytest tests/world/test_cad_export.py

A small metric scene in scene.json's own form (y up): a 4 x 3 m observed floor, a wall along x, a wall along z, a sofa
turned 30 degrees and two unknown cells. Files are read back with the libraries that wrote them."""
from pathlib import Path
import copy
import csv
import json
import math
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import cad_export as ce  # noqa: E402
from component_graph import attach_component_ids, apply_edits, scene_sha256, EDIT_SCHEMA  # noqa: E402

FLOOR_Y = -1.5


def scene(units='m'):
    return {'schema': 'brainsnn.scene.v1', 'units': units, 'floor_y': FLOOR_Y,
            'scale': {'source': 'user-measured', 'distance': 2.5, 'selfReported': True, 'verified': False},
            'objects': [{'name': 'floor_observed', 'label': 'floor', 'provenance': 'observed', 'min': [0, FLOOR_Y - .02, 0], 'max': [4, FLOOR_Y, 3],
                         'centre': [2, FLOOR_Y - .01, 1.5], 'size': [4, .02, 3]},
                        {'name': 'object_1', 'label': 'sofa', 'kind': 'separated', 'provenance': 'observed', 'centre': [2, FLOOR_Y + .4, 1.5],
                         'size': [2.0, .8, .9], 'yaw_degrees': 30, 'ifcClass': 'IfcFurniture', 'labelSource': 'EfficientDet-Lite2 (COCO) on the worker',
                         'labelReviewed': False},
                        {'name': 'object_2', 'label': 'object', 'kind': 'separated', 'provenance': 'observed', 'centre': [.5, FLOOR_Y + .2, .5],
                         'size': [.4, .4, .3], 'yaw_degrees': 0}],
            'walls': [{'name': 'wall_1', 'label': 'wall', 'provenance': 'observed', 'centre': [2, FLOOR_Y + 1.25, 0], 'size': [4, 2.5, .1], 'yaw_degrees': 0},
                      {'name': 'wall_2', 'label': 'wall', 'provenance': 'observed', 'centre': [4, FLOOR_Y + 1.2, 1.5], 'size': [3, 2.4, .1], 'yaw_degrees': 90}],
            'unknown': [[3.0, 2.5, .5], [3.75, 2.5, .5]]}  # the second cell is half outside the floor


def test_footprints_follow_the_compilers_yaw_and_the_ifc_plan_frame():
    along_x = ce.footprint(0, 0, 4, .2, 0)
    assert max(p[0] for p in along_x) - min(p[0] for p in along_x) == pytest.approx(4)
    along_z = ce.footprint(1, 2, 3, .2, 90)  # length along +z, which the plan shows along -Y
    assert max(p[1] for p in along_z) - min(p[1] for p in along_z) == pytest.approx(3)
    assert all(p[1] == pytest.approx(-2, abs=1.6) for p in along_z) and sum(p[1] for p in along_z) / 4 == pytest.approx(-2)


def test_the_quantities_sheet_totals_every_element(tmp_path):
    evidence = ce.export(scene(), tmp_path)
    q = evidence['quantities']
    assert q['floor_extent_area_m2'] == 12 and q['walls'] == 2 and q['wall_length_m'] == 7 and q['wall_face_area_m2'] == pytest.approx(17.2)
    assert q['objects'] == 2 and q['named_objects'] == 1 and q['unknown_area_m2'] == .5
    assert q['observed_floor_area_m2'] == pytest.approx(11.625, abs=.01), 'the extent less the unknown inside it'
    rows = list(csv.reader((tmp_path / 'quantities.csv').open()))
    assert rows[0][:4] == ['section', 'element', 'ifc_class', 'name'] and q['rows'] == len(rows) - 1
    sofa = next(r for r in rows if r[1] == 'object_1')
    assert sofa[2:8] == ['IfcFurniture', 'sofa', '2.000', '0.900', '0.800', '1.80'] and 'unreviewed' in sofa[8]
    assert any('verified False' in r[8] for r in rows if r[1] == 'scale'), 'the sheet says the scale is not verified'


def test_unplaced_detection_does_not_invent_cad_geometry_or_quantities(tmp_path):
    data = scene()
    data['objects'].append({'name': 'unplaced', 'label': 'chair', 'provenance': 'detected-unplaced', 'reason': 'no camera pose'})
    assert not any(item['name'] == 'unplaced' for item in ce.elements(data))
    assert ce.export(data, tmp_path)['quantities']['objects'] == 2
    assert 'unplaced' not in (tmp_path / 'quantities.csv').read_text()
    assert data['objects'][-1]['reason'] == 'no camera pose', 'source evidence remains intact'


def test_the_dxf_plan_is_in_metres_with_layers_dimensions_and_the_scale_note(tmp_path):
    ezdxf = pytest.importorskip('ezdxf')
    assert ce.export(scene(), tmp_path)['dxf']['written']
    doc = ezdxf.readfile(tmp_path / 'scene-plan.dxf'); msp = doc.modelspace()
    assert doc.units == ezdxf.units.M and {'FLOOR', 'WALLS', 'OBJECTS', 'UNKNOWN', 'DIMENSIONS', 'LABELS'} <= {l.dxf.name for l in doc.layers}
    outlines = {layer: len(msp.query(f'LWPOLYLINE[layer=="{layer}"]')) for layer in ('FLOOR', 'WALLS', 'OBJECTS', 'UNKNOWN')}
    assert outlines == {'FLOOR': 1, 'WALLS': 2, 'OBJECTS': 2, 'UNKNOWN': 2}
    dims = sorted(round(d.get_measurement(), 2) for d in msp.query('DIMENSION'))
    assert dims == [3.0, 3.0, 4.0, 4.0], 'each wall and both floor sides'
    texts = [t.dxf.text for t in msp.query('TEXT')]
    assert 'sofa' in texts and '2.00 x 0.90 m' in texts and any('verified False' in t for t in texts)


def test_the_rhino_model_holds_named_measured_solids_in_metres(tmp_path):
    rhino3dm = pytest.importorskip('rhino3dm')
    assert ce.export(scene(), tmp_path)['3dm']['objects'] == 1 + 2 + 2 + 2
    model = rhino3dm.File3dm.Read(str(tmp_path / 'scene.3dm'))
    assert model.Settings.ModelUnitSystem == rhino3dm.UnitSystem.Meters and model.Strings['BrainSNN.metricVerified'] == 'false'
    assert [l.Name for l in model.Layers] == list(ce.RHINO_LAYERS)
    by_name = {o.Attributes.Name: o for o in model.Objects}
    sofa = by_name['sofa']; bb = sofa.Geometry.GetBoundingBox()
    assert sofa.Geometry.IsSolid and sofa.Attributes.GetUserString('ifcClass') == 'IfcFurniture' and sofa.Attributes.GetUserString('labelReviewed') == 'false'
    half = (2.0 * math.cos(math.radians(30)) + .9 * math.sin(math.radians(30))) / 2  # the turned box's plan extent
    assert (bb.Max.X - bb.Min.X) / 2 == pytest.approx(half, abs=1e-6) and (bb.Min.Z, bb.Max.Z) == pytest.approx((FLOOR_Y, FLOOR_Y + .8))
    assert (bb.Min.X + bb.Max.X) / 2 == pytest.approx(2) and (bb.Min.Y + bb.Max.Y) / 2 == pytest.approx(-1.5), 'plan Y is minus the scene z'
    wall = by_name['wall_2'].Geometry.GetBoundingBox()
    assert wall.Max.Y - wall.Min.Y == pytest.approx(3) and wall.Max.X - wall.Min.X == pytest.approx(.1)


def test_nothing_is_written_for_an_unscaled_scene_and_a_missing_library_is_named(tmp_path, monkeypatch):
    assert ce.export(scene('arbitrary'), tmp_path) == {'skipped': 'CAD exports need a metric scene.'} and not list(tmp_path.iterdir())
    monkeypatch.setitem(sys.modules, 'rhino3dm', None)
    evidence = ce.export(scene(), tmp_path)
    assert evidence['3dm'] == {'written': False, 'reason': 'rhino3dm is not installed (requirements-cad.txt)'}
    assert not (tmp_path / 'scene.3dm').exists() and evidence['quantities']['written']


def reviewed_scene(kind='opening', sill=0, height=2.1):
    s = scene(); w = s['walls'][0]
    s['openings'] = [{'id': 'entry', 'hostWall': w['name'], 'offsetMeters': 1.5, 'widthMeters': 1.,
                      'heightMeters': height, 'sillMeters': sill, 'kind': kind, 'reviewed': True,
                      'host': {k: w[k] for k in ('centre', 'size', 'yaw_degrees')}}]
    return s


def test_reviewed_void_has_matching_cad_solids_plan_gap_and_net_quantities(tmp_path):
    ezdxf = pytest.importorskip('ezdxf'); rhino3dm = pytest.importorskip('rhino3dm')
    s = reviewed_scene(); evidence = ce.export(s, tmp_path)
    assert evidence['quantities']['walls'] == 2 and evidence['quantities']['openings'] == 1
    assert evidence['quantities']['wall_face_area_m2'] == pytest.approx(15.1)
    wall = next(e for e in ce.elements(s) if e['name'] == 'wall_1')
    assert len(wall['solid_parts']) == 3 and len(wall['plan_parts']) == 2
    assert all(max(p[0] for p in corners) <= 1.5 or min(p[0] for p in corners) >= 2.5 for corners in wall['plan_parts'])
    doc = ezdxf.readfile(tmp_path / 'scene-plan.dxf')
    assert len(doc.modelspace().query('LWPOLYLINE[layer=="WALLS"]')) == 3
    model = rhino3dm.File3dm.Read(str(tmp_path / 'scene.3dm'))
    parts = [o for o in model.Objects if o.Attributes.GetUserString('element') == 'wall_1']
    assert len(parts) == 3 and all(o.Geometry.IsSolid for o in parts)
    volume = 0
    for o in parts:
        b = o.Geometry.GetBoundingBox(); volume += (b.Max.X - b.Min.X) * (b.Max.Y - b.Min.Y) * (b.Max.Z - b.Min.Z)
    assert volume == pytest.approx((4 * 2.5 - 2.1) * .1)
    assert s['walls'][0]['size'] == [4, 2.5, .1], 'semantic IFC host stays whole'


def test_raised_window_plan_stays_blocked_and_closed_door_is_a_separate_reference_leaf(tmp_path):
    raised = next(e for e in ce.elements(reviewed_scene(sill=.9, height=1.1)) if e['name'] == 'wall_1')
    assert len(raised['solid_parts']) == 4 and raised['plan_parts'] == [raised['corners']]
    s = reviewed_scene(kind='door'); elements = ce.elements(s)
    host = next(e for e in elements if e['name'] == 'wall_1'); leaf = next(e for e in elements if e['kind'] == 'door')
    assert len(host['plan_parts']) == 2 and leaf['width'] == .05 and leaf['height'] == 2.1
    assert ce.export(s, tmp_path)['quantities']['doors'] == 1
    assert 'closed reference leaf; no clearance validation' in (tmp_path / 'quantities.csv').read_text()


def test_rhino_component_ids_and_real_object_uuids_survive_rename_save_and_reopen(tmp_path):
    r = pytest.importorskip('rhino3dm')
    original = attach_component_ids(reviewed_scene(kind='door'), 'a' * 64)
    renamed = apply_edits(original, {'schema': EDIT_SCHEMA, 'sourceSha256': 'a' * 64,
        'sceneSha256': scene_sha256(original), 'revision': 0, 'edits': [
            {'op': 'label', 'componentId': original['objects'][1]['componentId'], 'label': 'reviewed sofa name'},
            {'op': 'label', 'componentId': original['walls'][0]['componentId'], 'label': 'North partition'},
            {'op': 'label', 'componentId': original['openings'][0]['componentId'], 'label': 'Entry'}]})
    other_capture = attach_component_ids(reviewed_scene(kind='door'), 'b' * 64)
    models = []
    for index, data in enumerate((original, renamed, other_capture)):
        directory = tmp_path / str(index); directory.mkdir(); ce.export(data, directory)
        models.append(r.File3dm.Read(str(directory / 'scene.3dm')))
    def object_ids(model):
        return {(o.Attributes.GetUserString('componentId'), o.Attributes.GetUserString('partKey')): str(o.Attributes.Id)
                for o in model.Objects}
    first, edited, other = map(object_ids, models)
    assert first == edited
    assert set(first.values()).isdisjoint(other.values()), 'identical geometry from another capture is a separate model'
    assert len(first) == len(models[0].Objects) == len(set(first.values())), 'wall parts and unknown cells have separate stable UUIDs'
    saved = tmp_path / 'saved.3dm'; models[1].Write(str(saved), 8)
    reopened = r.File3dm.Read(str(saved))
    assert object_ids(reopened) == edited
    assert any(o.Attributes.Name == 'reviewed sofa name' for o in reopened.Objects)
    assert next(o for o in reopened.Objects if o.Attributes.Name == 'reviewed sofa name').Attributes.GetUserString('labelProvenance') == 'operator-authored-edit'
    assert any(o.Attributes.Name == 'North partition part 1' for o in reopened.Objects)
    assert any(o.Attributes.Name == 'Entry door' for o in reopened.Objects)
    assert reopened.Strings['BrainSNN.sourceSha256'] == 'a' * 64
    opening = original['openings'][0]
    assert json.loads(reopened.Strings['BrainSNN.openings'])[0]['componentId'] == opening['componentId']
    leaf = next(o for o in reopened.Objects if o.Attributes.GetUserString('ifcClass') == 'IfcDoor')
    assert leaf.Attributes.GetUserString('componentId') == opening['doorComponentId']
    assert leaf.Attributes.GetUserString('hostComponentId') == opening['hostComponentId']
    assert leaf.Attributes.GetUserString('openingComponentId') == opening['componentId']
    parts = [o for o in reopened.Objects if o.Attributes.GetUserString('componentId') == original['walls'][0]['componentId']]
    assert len(parts) == 3
    assert all(json.loads(o.Attributes.GetUserString('openingComponentIds')) == [opening['componentId']] for o in parts)


def test_ifc_and_rhino_reopen_with_the_same_component_host_and_filling_identity(tmp_path):
    r = pytest.importorskip('rhino3dm'); ifcopenshell = pytest.importorskip('ifcopenshell')
    import ifcopenshell.util.element
    from ifc_export import write_ifc
    source = reviewed_scene(kind='door')
    source['walls'][0]['support_points'] = 120
    source['openings'][0].update(provenance='operator-reviewed', support_points=20)
    data = attach_component_ids(source, 'c' * 64)
    original_ids = [entry['componentId'] for entry in data['componentGraph']['components']]
    data = apply_edits(data, {'schema': EDIT_SCHEMA, 'sourceSha256': 'c' * 64,
        'sceneSha256': scene_sha256(data), 'revision': 0, 'edits': [
            {'op': 'wall', 'componentId': data['walls'][0]['componentId'], 'translationMeters': [.1, 0, 0]},
            {'op': 'opening', 'componentId': data['openings'][0]['componentId'], 'widthMeters': 1.1}]})
    assert [entry['componentId'] for entry in data['componentGraph']['components']] == original_ids
    ce.export(data, tmp_path); write_ifc(tmp_path / 'scene.ifc', data)
    model = r.File3dm.Read(str(tmp_path / 'scene.3dm')); ifc = ifcopenshell.open(tmp_path / 'scene.ifc')
    props = lambda element: ifcopenshell.util.element.get_pset(element, 'Pset_BrainSNN')
    by_id = {props(element)['ComponentId']: element for element in ifc.by_type('IfcElement') if props(element)}
    for obj in model.Objects:
        component_id = obj.Attributes.GetUserString('componentId')
        element = by_id[component_id]
        assert obj.Attributes.GetUserString('ifcGlobalId') == element.GlobalId
        assert obj.Attributes.GetUserString('sourceSha256') == props(element)['SourceSha256'] == 'c' * 64
    door = ifc.by_type('IfcDoor')[0]; opening = door.FillsVoids[0].RelatingOpeningElement
    assert props(opening)['ComponentId'] == data['openings'][0]['componentId']
    assert props(opening)['HostComponentId'] == props(opening.VoidsElements[0].RelatingBuildingElement)['ComponentId']
    import ifcopenshell.geom
    import ifcopenshell.util.shape
    wall = opening.VoidsElements[0].RelatingBuildingElement
    for element, original_provenance, support in ((wall, 'observed', 120), (opening, 'operator-reviewed', 20), (door, 'operator-reviewed', 20)):
        pset = props(element)
        assert pset['Provenance'] == pset['DimensionProvenance'] == 'operator-authored-edit'
        assert pset['SourceProvenance'] == original_provenance
        assert pset['SupportPoints'] == support
        assert pset['SupportPointsScope'] == 'original-source-not-edited-geometry'
    assert json.loads(props(opening)['ParameterProvenance'])['widthMeters'] == 'operator-authored-edit'
    for obj in model.Objects:
        component_id = obj.Attributes.GetUserString('componentId')
        if component_id not in (props(wall)['ComponentId'], props(door)['ComponentId']):
            continue
        assert obj.Attributes.GetUserString('provenance') == obj.Attributes.GetUserString('dimensionProvenance') == 'operator-authored-edit'
        assert obj.Attributes.GetUserString('sourceProvenance') == ('observed' if component_id == props(wall)['ComponentId'] else 'operator-reviewed')
        assert obj.Attributes.GetUserString('supportPoints') == ('120' if component_id == props(wall)['ComponentId'] else '20')
        assert obj.Attributes.GetUserString('supportPointsScope') == 'original-source-not-edited-geometry'
    saved_void = json.loads(model.Strings['BrainSNN.openings'])[0]
    assert saved_void['provenance'] == 'operator-authored-edit' and saved_void['sourceProvenance'] == 'operator-reviewed'
    assert source['walls'][0]['provenance'] == 'observed' and source['walls'][0]['support_points'] == 120
    actual = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), wall)
    expected_volume = (4 * 2.5 - 1.1 * 2.1) * .1
    assert ifcopenshell.util.shape.get_volume(actual.geometry) == pytest.approx(expected_volume, abs=1e-6)
    boxes = [o.Geometry.GetBoundingBox() for o in model.Objects if o.Attributes.GetUserString('componentId') == props(wall)['ComponentId']]
    assert sum((b.Max.X - b.Min.X) * (b.Max.Y - b.Min.Y) * (b.Max.Z - b.Min.Z) for b in boxes) == pytest.approx(expected_volume, abs=1e-6)
    assert min(b.Min.X for b in boxes) == pytest.approx(.1, abs=1e-6)
    assert max(b.Max.X for b in boxes) == pytest.approx(4.1, abs=1e-6)


def test_legacy_rhino_namespace_is_deterministic_and_label_independent(tmp_path):
    r = pytest.importorskip('rhino3dm')
    first = scene(); changed_label = copy.deepcopy(first); changed_label['objects'][1]['label'] = 'new sofa label'
    changed_geometry = scene(); changed_geometry['walls'][0]['centre'][0] += 1
    models = []
    for index, data in enumerate((first, changed_label, changed_geometry)):
        directory = tmp_path / str(index); directory.mkdir(); ce.export(data, directory)
        models.append(r.File3dm.Read(str(directory / 'scene.3dm')))
    assert models[0].Strings['BrainSNN.sourceSha256'] == models[1].Strings['BrainSNN.sourceSha256']
    assert {str(o.Attributes.Id) for o in models[0].Objects} == {str(o.Attributes.Id) for o in models[1].Objects}
    assert models[0].Strings['BrainSNN.sourceSha256'] != models[2].Strings['BrainSNN.sourceSha256']
    assert 'componentGraph' not in first


def test_wall_evidence_survives_quantities_and_rhino_without_measured_claims(tmp_path):
    data = scene()
    data['walls'][0]['wallEvidence'] = {'schema': 'brainsnn.wall-evidence.v1', 'status': 'two-surface-candidate',
                                      'thickness_m': .08, 'matched_cells': 12, 'subset_reviewed': False}
    data['walls'][1].update(thicknessMeasured=True, thicknessBasis='measured: both faces seen')
    rows, _ = ce.quantities(data, ce.elements(data))
    wall_rows = [r for r in rows if r[0] == 'wall']
    assert 'candidate finish-face separation: unverified' in wall_rows[0][-1]
    assert 'evidence unavailable; unverified' in wall_rows[1][-1]
    assert not any('measured: both faces seen' in str(r) for r in rows)


def test_rhino_reopens_wall_candidate_limits(tmp_path):
    rhino3dm = pytest.importorskip('rhino3dm')
    data = scene()
    data['walls'][0]['wallEvidence'] = {'schema': 'brainsnn.wall-evidence.v1', 'status': 'two-surface-candidate',
                                      'thickness_m': .08, 'matched_cells': 12, 'subset_reviewed': False}
    assert ce.export(data, tmp_path)['3dm']['written']
    model = rhino3dm.File3dm.Read(str(tmp_path / 'scene.3dm'))
    wall = next(o for o in model.Objects if o.Attributes.Name == 'wall_1')
    assert wall.Attributes.GetUserString('ThicknessCandidateMetres') == '0.08'
    assert wall.Attributes.GetUserString('PhysicalThicknessVerified') == 'false'
    assert wall.Attributes.GetUserString('ThicknessMeasured') == 'false'
