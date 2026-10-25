"""CAD and estimating exports of a compiled scene: python -m pytest tests/world/test_cad_export.py

A small metric scene in scene.json's own form (y up): a 4 x 3 m observed floor, a wall along x, a wall along z, a sofa
turned 30 degrees and two unknown cells. Files are read back with the libraries that wrote them."""
from pathlib import Path
import csv
import math
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import cad_export as ce  # noqa: E402

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
