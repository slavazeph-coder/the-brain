"""Real PNG/CSV handoff checks; no Revit or Xactimate runtime is simulated."""
from pathlib import Path
import copy
import csv
import hashlib
import json
import math
import sys

import pytest
from PIL import Image, ImageColor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import building_handoff as bh  # noqa: E402
from component_graph import attach_component_ids, apply_edits, scene_sha256, EDIT_SCHEMA  # noqa: E402


def scene():
    return {'schema': 'brainsnn.scene.v1', 'units': 'm', 'floor_y': 0,
            'scale': {'source': 'user-measured', 'metresPerUnit': 1., 'distance': 2.5,
                      'spanUnits': 2.5, 'selfReported': True, 'verified': False},
            'walls': [{'name': 'wall_1', 'centre': [2, 1.25, 0], 'size': [4, 2.5, .1],
                       'yaw_degrees': 0, 'provenance': 'observed'},
                      {'name': 'wall_2', 'centre': [4, 1.2, 1.5], 'size': [3, 2.4, .1],
                       'yaw_degrees': 90, 'provenance': 'observed'}],
            'objects': [{'name': 'floor_observed', 'min': [0, -.02, 0], 'max': [4, 0, 3],
                         'centre': [2, -.01, 1.5], 'size': [4, .02, 3], 'provenance': 'observed'},
                        {'name': 'object_1', 'label': 'cart', 'centre': [2, .5, 1.5], 'size': [1.8, 1, .8],
                         'yaw_degrees': 30, 'provenance': 'observed'}],
            'unknown': [[.4, 2, .5]],
            'openings': [{'id': 'entry', 'hostWall': 'wall_1', 'offsetMeters': 1.5,
                          'widthMeters': 1, 'heightMeters': 2.1, 'sillMeters': 0,
                          'kind': 'opening', 'reviewed': True}]}


def load(out):
    return json.loads((out / 'building-handoff.json').read_text())


def test_reopened_png_ruler_is_exact_and_both_axes_have_one_scale(tmp_path):
    result = bh.write_building_handoff(scene(), tmp_path)
    assert result['written'] and {a['name'] for a in result['artifacts']} == set(bh.FILES)
    payload = load(tmp_path); transform = payload['planTransform']; ruler = payload['calibration']
    with Image.open(tmp_path / 'xactimate-underlay.png') as image:
        assert image.size == (1800, 1400) and image.format == 'PNG'
        image.verify()
    assert math.dist(ruler['startPixel'], ruler['endPixel']) / transform['pixelsPerMetre'] == pytest.approx(ruler['lengthMetres'])
    origin = bh._pixel([0, 0], transform)
    assert math.dist(origin, bh._pixel([1, 0], transform)) == pytest.approx(transform['pixelsPerMetre'])
    assert math.dist(origin, bh._pixel([0, 1], transform)) == pytest.approx(transform['pixelsPerMetre'])
    assert bh._pixel([0, 1], transform)[1] < origin[1]
    assert ruler['independentMeasurement'] is False and payload['metricVerified'] is False


def test_arbitrary_rotation_keeps_metric_lengths_and_source_yaw(tmp_path):
    data = scene(); data['openings'] = []; data['walls'][0]['yaw_degrees'] = 37
    bh.write_building_handoff(data, tmp_path)
    payload = load(tmp_path); polygon = payload['walls'][0]['planPolygonsMetres'][0]
    pixels = [bh._pixel(p, payload['planTransform']) for p in polygon]
    assert math.dist(polygon[0], polygon[1]) == pytest.approx(4)
    assert math.dist(polygon[1], polygon[2]) == pytest.approx(.1)
    assert math.dist(pixels[0], pixels[1]) == pytest.approx(4 * payload['planTransform']['pixelsPerMetre'])
    # The plan basis is (x,-z), so a positive scene yaw descends in plan Y.
    assert math.degrees(math.atan2(polygon[1][1] - polygon[0][1], polygon[1][0] - polygon[0][0])) == pytest.approx(-37)


def test_floor_extent_does_not_turn_two_open_walls_into_a_room_quantity(tmp_path):
    bh.write_building_handoff(scene(), tmp_path)
    payload = load(tmp_path)
    assert len(payload['walls']) == 2 and payload['floorExtentIsRoomBoundary'] is False
    assert payload['readiness']['roomBoundaries'] == 'not-established'
    assert payload['readiness']['roomQuantities'] is False and payload['readiness']['ceilingQuantities'] is False
    with (tmp_path / 'building-schedule.csv').open() as stream:
        rows = list(csv.DictReader(stream))
    floor = next(r for r in rows if r['kind'] == 'floor')
    assert floor['area_m2'] == floor['area_ft2'] == '' and 'not a closed room' in floor['quantity_basis']
    assert not any(r['kind'] in ('room', 'ceiling', 'unknown') for r in rows)
    walls = [r for r in rows if r['kind'] == 'wall']
    assert sum(float(r['area_m2']) for r in walls) == pytest.approx(4 * 2.5 + 3 * 2.4 - 2.1)


def test_plan_preserves_opening_gap_and_unknown_cells(tmp_path):
    bh.write_building_handoff(scene(), tmp_path)
    payload = load(tmp_path); transform = payload['planTransform']
    assert len(payload['walls'][0]['planPolygonsMetres']) == 2
    assert payload['unknownCells'] == 1
    image = Image.open(tmp_path / 'xactimate-underlay.png').convert('RGB')
    def colour(point):
        return image.getpixel(tuple(round(v) for v in bh._pixel(point, transform)))
    assert colour([.75, 0]) == ImageColor.getrgb(bh.COLOURS['wall'])
    assert colour([4, -1.5]) == ImageColor.getrgb(bh.COLOURS['wall']), 'a label must not create a visual wall gap'
    assert colour([2, 0]) != ImageColor.getrgb(bh.COLOURS['wall'])
    assert colour([.63, -2.24]) in {ImageColor.getrgb(bh.COLOURS['unknown']), ImageColor.getrgb(bh.COLOURS['unknown_line'])}
    assert payload['openings'][0]['planEndpointsMetres'] == [[1.5, 0], [2.5, 0]]


def test_raised_opening_does_not_make_floor_level_gap(tmp_path):
    data = scene(); data['openings'][0].update(sillMeters=.8, heightMeters=1)
    bh.write_building_handoff(data, tmp_path)
    payload = load(tmp_path)
    assert len(payload['walls'][0]['planPolygonsMetres']) == 1
    assert payload['openings'][0]['sillMetres'] == .8


def test_labels_never_erase_intersecting_walls(tmp_path):
    data = scene(); data['openings'] = []; data['unknown'] = []
    data['objects'] = data['objects'][:1]
    data['walls'][0]['centre'] = [2, 1.25, 1.5]
    data['walls'][1]['centre'] = [2, 1.2, 1.5]
    bh.write_building_handoff(data, tmp_path)
    transform = load(tmp_path)['planTransform']
    with Image.open(tmp_path / 'xactimate-underlay.png') as source:
        image = source.convert('RGB')
    dark = ImageColor.getrgb(bh.COLOURS['wall'])
    # The former W2 label erased W1 at x=1.6/1.7. Check the full interiors of
    # both wall centrelines, including their crossing and any candidate labels.
    points = [[x / 20, -1.5] for x in range(1, 80)] + [[2, -z / 20] for z in range(1, 60)]
    assert all(image.getpixel(tuple(round(v) for v in bh._pixel(point, transform))) == dark for point in points)


def test_labels_cannot_cover_unknown_coverage(tmp_path):
    data = scene(); data['openings'] = []; data['walls'] = data['walls'][:1]
    data['walls'][0]['centre'] = [2, 1.25, 1.5]
    data['objects'] = data['objects'][:1]
    data['unknown'] = [[0, 0, 4]]
    bh.write_building_handoff(data, tmp_path)
    transform = load(tmp_path)['planTransform']
    with Image.open(tmp_path / 'xactimate-underlay.png') as source:
        image = source.convert('RGB')
    evidence = {ImageColor.getrgb(bh.COLOURS[key]) for key in ('unknown', 'unknown_line', 'wall')}
    points = [[x / 10, -z / 10] for x in range(1, 40) for z in range(1, 40)]
    assert all(image.getpixel(tuple(round(v) for v in bh._pixel(point, transform))) in evidence for point in points)


@pytest.mark.parametrize('change', [
    {'units': 'arbitrary'}, {'scale': None},
    {'scale': {'source': 'user-measured', 'metresPerUnit': 1, 'selfReported': True, 'verified': True}},
    {'scale': {'source': 'device-estimate', 'metresPerUnit': 1, 'selfReported': True, 'verified': False}},
    {'scale': {'source': 'user-measured', 'metresPerUnit': True, 'selfReported': True, 'verified': False}},
    {'scale': {'source': 'user-measured', 'metresPerUnit': float('nan'), 'selfReported': True, 'verified': False}},
])
def test_metric_policy_refuses_unscaled_or_unadmitted_scale_without_files(tmp_path, change):
    data = scene(); data.update(change)
    result = bh.write_building_handoff(data, tmp_path)
    assert result['written'] is False and result['reason'] and result['artifacts'] == []
    assert list(tmp_path.iterdir()) == []


def test_missing_png_dependency_does_not_publish_partial_schedule(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, 'PIL', None)
    assert bh.write_building_handoff(scene(), tmp_path)['written'] is False
    assert list(tmp_path.iterdir()) == []


def test_exact_scene_bytes_and_companion_hashes_are_bound(tmp_path):
    data = attach_component_ids(scene(), source_sha256='a' * 64)
    path = tmp_path / 'scene.json'; raw = json.dumps(data, indent=4).encode(); path.write_bytes(raw)
    bh.write_building_handoff(data, tmp_path, scene_path=path)
    payload = load(tmp_path)
    assert payload['sourceFiles']['scene'] == {'name': 'scene.json', 'sha256': hashlib.sha256(raw).hexdigest(),
                                              'bytes': len(raw), 'binding': 'exact-file-bytes'}
    assert payload['sourceSha256'] == 'a' * 64 and payload['canonicalSceneSha256'] == scene_sha256(data)
    for name, entry in payload['files'].items():
        content = (tmp_path / name).read_bytes()
        assert entry == {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}


def test_stale_scene_bytes_rejected_before_output(tmp_path):
    data = scene(); altered = copy.deepcopy(data); altered['walls'][0]['size'][0] = 4.5
    path = tmp_path / 'scene.json'; path.write_text(json.dumps(altered))
    with pytest.raises(ValueError, match='do not match'):
        bh.write_building_handoff(data, tmp_path / 'export', scene_path=path)
    assert not (tmp_path / 'export').exists()


def test_duplicate_json_keys_are_rejected(tmp_path):
    data = scene(); path = tmp_path / 'scene.json'
    path.write_text(json.dumps(data)[:-1] + ', "units": "m"}')
    with pytest.raises(ValueError, match='Duplicate'):
        bh.write_building_handoff(data, tmp_path / 'export', scene_path=path)
    assert not (tmp_path / 'export').exists()


def test_edit_preserves_component_identity_updates_geometry_hashes_and_revision(tmp_path):
    data = attach_component_ids(scene(), source_sha256='a' * 64)
    before = tmp_path / 'before'; after = tmp_path / 'after'
    bh.write_building_handoff(data, before)
    identifier = data['walls'][1]['componentId']
    edited = apply_edits(data, {'schema': EDIT_SCHEMA, 'sourceSha256': 'a' * 64,
                              'sceneSha256': scene_sha256(data), 'revision': 0,
                              'edits': [{'op': 'wall', 'componentId': identifier, 'translationMeters': [.2, 0, 0]}]})
    bh.write_building_handoff(edited, after)
    first, second = load(before), load(after)
    assert first['componentRevision'] == 0 and second['componentRevision'] == 1
    assert second['walls'][1]['componentId'] == first['walls'][1]['componentId'] == identifier
    assert second['canonicalSceneSha256'] != first['canonicalSceneSha256']
    assert second['files']['xactimate-underlay.png']['sha256'] != first['files']['xactimate-underlay.png']['sha256']
    assert second['walls'][1]['dimensionProvenance'] == 'operator-authored-edit'
    assert second['physicalDimensionsVerified'] is False


def test_csv_uses_exact_unit_conversion_and_neutralizes_formula_labels(tmp_path):
    data = scene(); data['walls'][0]['label'] = '=1+1'
    bh.write_building_handoff(data, tmp_path)
    with (tmp_path / 'building-schedule.csv').open() as stream:
        rows = list(csv.DictReader(stream))
    wall = next(r for r in rows if r['plan_label'] == 'W1')
    assert wall['name'] == "'=1+1"
    assert float(wall['length_ft']) == pytest.approx(4 / .3048, abs=1e-6)
    assert float(wall['area_ft2']) == pytest.approx((10 - 2.1) / .3048 ** 2, abs=1e-6)
    assert wall['review_status'] == 'unverified'


def test_failed_staging_preserves_preexisting_artifacts(tmp_path, monkeypatch):
    bh.write_building_handoff(scene(), tmp_path)
    before = {name: (tmp_path / name).read_bytes() for name in bh.FILES}
    def fail(*args, **kwargs):
        raise OSError('injected schedule failure')
    monkeypatch.setattr(bh, '_schedule', fail)
    with pytest.raises(OSError, match='schedule failure'):
        bh.write_building_handoff(scene(), tmp_path)
    assert before == {name: (tmp_path / name).read_bytes() for name in bh.FILES}
    assert not list(tmp_path.glob('.building-handoff-*'))


def test_standalone_cli_refuses_mixing_existing_revisions(tmp_path, monkeypatch):
    source = tmp_path / 'source.json'; source.write_text(json.dumps(scene()))
    out = tmp_path / 'older'; out.mkdir()
    retained = out / 'scene.ifc'; retained.write_bytes(b'prior revision')
    monkeypatch.setattr('sys.argv', ['building_handoff', '--scene', str(source), '--out', str(out)])
    with pytest.raises(SystemExit) as error:
        bh.main()
    assert error.value.code == 2
    assert retained.read_bytes() == b'prior revision'
    assert {p.name for p in out.iterdir()} == {'scene.ifc'}


def test_claims_and_instructions_do_not_promise_native_application_import(tmp_path):
    bh.write_building_handoff(scene(), tmp_path)
    payload = load(tmp_path); guide = (tmp_path / 'BUILDING-IMPORT.txt').read_text()
    assert payload['readiness']['nativeRevitValidated'] is False
    assert payload['readiness']['xactimateProjectGenerated'] is False
    assert payload['readiness']['xactimateApplicationValidated'] is False
    assert 'Import Underlay Image' in guide and 'requires tracing' in guide
    assert 'read-only' in guide and 'does not include a native RVT' in guide
    assert not list(tmp_path.glob('*.esx')) and not list(tmp_path.glob('*.skx'))


@pytest.mark.parametrize('cell', [[0, 0, 0], [0, 0, -1], [True, 0, 1], [0, 0, float('inf')]])
def test_invalid_unknown_geometry_never_publishes_files(tmp_path, cell):
    data = scene(); data['unknown'] = [cell]
    with pytest.raises(ValueError):
        bh.write_building_handoff(data, tmp_path)
    assert list(tmp_path.iterdir()) == []
