"""Nav2 file-contract tests use authored geometry, not physical robot evidence."""
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import uuid

import pytest

from robotics.scene_compiler import nav2_export as ne
from robotics.world_worker.measurement_check import points_sha256


def scene(x0=1, x1=4, z0=2, z1=4):
    return {'schema': 'brainsnn.scene.v1', 'units': 'm', 'floor_y': 0.,
            'scale': {'source': 'user-measured', 'metresPerUnit': 1., 'selfReported': True, 'verified': False},
            'objects': [{'name': 'floor_observed', 'label': 'floor', 'centre': [(x0 + x1) / 2, -.01, (z0 + z1) / 2],
                         'size': [x1 - x0, .02, z1 - z0], 'min': [x0, -.02, z0], 'max': [x1, 0., z1]}],
            'walls': [], 'unknown': []}


def bind_floor(s, resolution=.25):
    """Four distinct floor samples per cell, with no assumption about free space."""
    f = s['objects'][0]; x0, _, z0 = f['min']; x1, _, z1 = f['max']; points = []
    for i in range(round((x1 - x0) / resolution)):
        for j in range(round((z1 - z0) / resolution)):
            for a, b in ((.25, .25), (.75, .25), (.25, .75), (.75, .75)):
                points.append([x0 + (i + a) * resolution, 0., z0 + (j + b) * resolution, 10, 20, 30])
    cloud = {'units': 'm', 'coordinateFrame': 'right-handed-y-up', 'scale': copy.deepcopy(s['scale']), 'points': points}
    s['cloudPointsSha256'] = points_sha256(cloud)
    return cloud


def load(path):
    raw = (path / ne.FILES[0]).read_bytes()
    magic, dimensions, maximum, pixels = raw.split(b'\n', 3)
    width, height = map(int, dimensions.split())
    assert magic == b'P5' and maximum == b'255' and len(pixels) == width * height
    manifest = json.loads((path / ne.FILES[2]).read_text())
    return manifest, pixels


def value(manifest, pixels, scene_x, scene_z):
    g = manifest['grid']; resolution = g['resolution']; x0, y0, _ = g['origin']
    col, row = math.floor((scene_x - x0) / resolution), math.floor((-scene_z - y0) / resolution)
    return pixels[(g['height'] - 1 - row) * g['width'] + col]


def test_asymmetric_coordinates_yaml_and_pgm_rows_follow_the_nav2_loader(tmp_path):
    s = scene(); s['objects'].append({'name': 'cabinet', 'centre': [1.5, .5, 2.5], 'size': [.2, 1., .2]})
    c = bind_floor(s); out = tmp_path / 'map'; result = ne.export(s, out, cloud=c, resolution=.25)
    m, pixels = load(out); g = m['grid']
    assert result['files'] == list(ne.FILES) and (g['width'], g['height']) == (14, 10)
    assert g['origin'] == [.75, -4.25, 0] and g['imageRowOrder'] == 'highest ROS y first'
    assert m['coordinateTransform']['matrix'] == [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
    assert value(m, pixels, 1.5, 2.5) == ne.OCCUPIED
    assert value(m, pixels, 1.5, 3.5) == ne.FREE, 'an asymmetric obstacle must not be vertically mirrored'
    assert pixels[2 * 14 + 3] == ne.OCCUPIED, 'scene z=2.5 lies near the top of the image'
    assert pixels[7 * 14 + 3] == ne.FREE
    assert all(p == ne.UNKNOWN for p in pixels[:14]), 'unknown padding at highest ROS y'
    yaml = (out / ne.FILES[1]).read_text()
    assert 'image: nav2-map.pgm\n' in yaml and 'origin: [0.75, -4.25, 0.0]' in yaml
    assert 'mode: trinary' in yaml and 'negate: 0' in yaml
    # Decode the three actual pixel values using Nav2 trinary threshold semantics.
    decode = lambda p: 100 if (255 - p) / 255 >= .65 else 0 if (255 - p) / 255 <= .196 else -1
    assert [decode(p) for p in (ne.OCCUPIED, ne.FREE, ne.UNKNOWN)] == [100, 0, -1]


def test_floor_extent_alone_is_unknown_and_sparse_samples_do_not_clear_whole_cells(tmp_path):
    s = scene(); out = tmp_path / 'no-points'; result = ne.export(s, out, resolution=.25)
    assert result['counts']['free'] == 0 and result['counts']['occupied'] == 0
    assert result['counts']['unknown'] == result['width'] * result['height']
    c = bind_floor(s); c['points'] = [c['points'][0]]; s['cloudPointsSha256'] = points_sha256(c)
    out = tmp_path / 'one-point'; ne.export(s, out, cloud=c, resolution=.25)
    m, pixels = load(out)
    assert m['counts']['free'] == 0 and m['policy']['observedFloorExtentImpliesFree'] is False
    c['points'] = [[1.0625, .2, 2.0625, 10, 20, 30], [1.1875, .2, 2.0625, 10, 20, 30],
                   [1.0625, .2, 2.1875, 10, 20, 30], [1.1875, .2, 2.1875, 10, 20, 30]]
    s['cloudPointsSha256'] = points_sha256(c)
    out = tmp_path / 'off-floor'; ne.export(s, out, cloud=c, resolution=.25)
    assert load(out)[0]['counts']['free'] == 0, 'nearby non-floor geometry cannot clear a cell'


def wall_scene(kind='opening', sill=0., height=2.1, yaw=0):
    s = scene(-2, 2, -2, 2)
    w = {'name': 'wall_1', 'centre': [0., 1.5, 0.], 'size': [4., 3., .1], 'yaw_degrees': yaw}
    s['walls'] = [w]
    s['openings'] = [{'id': 'entry', 'hostWall': 'wall_1', 'offsetMeters': 1.5, 'widthMeters': 1.,
                      'heightMeters': height, 'sillMeters': sill, 'kind': kind, 'reviewed': True,
                      'host': {k: copy.deepcopy(w[k]) for k in ('centre', 'size', 'yaw_degrees')}}]
    return s


@pytest.mark.parametrize('yaw', [0, 30, 90])
def test_floor_opening_needs_coverage_and_rotated_jambs_stay_occupied(tmp_path, yaw):
    s = wall_scene(yaw=yaw); c = bind_floor(s); out = tmp_path / 'map'
    ne.export(s, out, cloud=c, resolution=.25); m, pixels = load(out)
    assert value(m, pixels, 0., 0.) == ne.FREE
    a = math.radians(yaw)
    for along in (-1., 1.):
        assert value(m, pixels, along * math.cos(a), along * math.sin(a)) == ne.OCCUPIED
    out = tmp_path / 'no-coverage'; ne.export(s, out, resolution=.25); m, pixels = load(out)
    assert value(m, pixels, 0., 0.) == ne.UNKNOWN, 'opening authoring alone is not observed floor coverage'


@pytest.mark.parametrize('kind,sill,height', [('door', 0., 2.1), ('opening', .9, 1.2), ('opening', 0., 1.5)])
def test_closed_doors_raised_windows_and_short_voids_remain_occupied(tmp_path, kind, sill, height):
    s = wall_scene(kind=kind, sill=sill, height=height); c = bind_floor(s)
    out = tmp_path / 'map'; ne.export(s, out, cloud=c, resolution=.25); m, pixels = load(out)
    assert value(m, pixels, 0., 0.) == ne.OCCUPIED
    assert m['geometry']['closedDoorLeaves'] == int(kind == 'door')


def test_unknown_blockers_override_floor_samples_and_outside_extent_stays_unknown(tmp_path):
    s = wall_scene(); s['unknown'] = [[-.25, -.25, .5]]; c = bind_floor(s)
    s['objects'].append({'name': 'outside', 'centre': [3., .5, 0.], 'size': [1., 1., 1.]})
    out = tmp_path / 'map'; ne.export(s, out, cloud=c, resolution=.25); m, pixels = load(out)
    assert value(m, pixels, 0., 0.) == ne.UNKNOWN
    assert value(m, pixels, -2.125, 0.) == ne.UNKNOWN
    assert m['counts']['free'] > 0


def test_narrow_raw_passage_is_retained_without_robot_inflation(tmp_path):
    s = scene(-1, 1, -1, 1)
    s['objects'] += [{'name': 'left', 'centre': [-.625, .5, 0.], 'size': [.75, 1., 2.]},
                     {'name': 'right', 'centre': [.625, .5, 0.], 'size': [.75, 1., 2.]}]
    c = bind_floor(s, .05); out = tmp_path / 'map'; ne.export(s, out, cloud=c, resolution=.05); m, pixels = load(out)
    assert value(m, pixels, 0., .5) == ne.FREE and value(m, pixels, .3, .5) == ne.OCCUPIED
    assert m['policy']['robotInflationBakedIn'] is False and m['policy']['robotFootprint'] is None
    assert m['policy']['robotMarginMeters'] is None
    assert not m['validation']['physicalRobotValidated'] and not m['validation']['nav2RuntimeTested']


def test_exact_source_bytes_and_point_binding_are_verified_and_recorded(tmp_path):
    s = scene(); c = bind_floor(s)
    raw_scene = json.dumps(s, indent=1).encode(); raw_cloud = json.dumps(c, indent=3).encode()
    out = tmp_path / 'map'; result = ne.export(s, out, cloud=c, scene_bytes=raw_scene, cloud_bytes=raw_cloud, resolution=.25)
    m, _ = load(out)
    assert result['sceneSha256'] == hashlib.sha256(raw_scene).hexdigest()
    assert result['cloudSha256'] == hashlib.sha256(raw_cloud).hexdigest()
    assert m['source']['sceneDigestBasis'] == 'exact-file-bytes' and m['source']['sceneCloudBindingVerified'] is True
    for name in ne.FILES[:2]:
        assert m['artifacts'][name]['sha256'] == hashlib.sha256((out / name).read_bytes()).hexdigest()
    changed = copy.deepcopy(c); changed['points'][0][0] += .001
    with pytest.raises(ValueError, match='binding'):
        ne.export(s, tmp_path / 'wrong-cloud', cloud=changed)
    with pytest.raises(ValueError, match='source bytes'):
        ne.export(s, tmp_path / 'wrong-bytes', scene_bytes=b'{}')
    unbound = {k: v for k, v in s.items() if k != 'cloudPointsSha256'}
    with pytest.raises(ValueError, match='binding'):
        ne.export(unbound, tmp_path / 'unbound', cloud=c)
    changed = copy.deepcopy(c); changed['scale']['metresPerUnit'] = 2.
    with pytest.raises(ValueError, match='scale'):
        ne.export(s, tmp_path / 'wrong-scale', cloud=changed)


@pytest.mark.parametrize('change', [
    lambda s: s.update(units='arbitrary'), lambda s: s.update(floor_y=math.nan),
    lambda s: s['objects'][0]['size'].__setitem__(0, -1), lambda s: s['objects'][0]['centre'].__setitem__(0, True),
    lambda s: s['objects'][0]['min'].__setitem__(0, 0), lambda s: s.update(unknown=[[1, 1, -1]]),
    lambda s: s.update(objects=[]), lambda s: s.update(walls=[{'name': 'bad', 'centre': [0, 0, 0]}]),
])
def test_invalid_geometry_never_creates_output(tmp_path, change):
    s = scene(); change(s); out = tmp_path / 'map'
    with pytest.raises(ValueError):
        ne.export(s, out)
    assert not out.exists() and not list(tmp_path.iterdir())


def test_stale_overlapping_or_unreviewed_openings_and_bounded_grid_are_refused(tmp_path):
    for change in (lambda s: s['openings'][0].update(reviewed=False),
                   lambda s: s['openings'][0]['host']['centre'].__setitem__(0, 1),
                   lambda s: s['openings'].append({**s['openings'][0], 'id': 'overlap'})):
        s = wall_scene(); change(s)
        with pytest.raises(ValueError):
            ne.export(s, tmp_path / 'map')
    with pytest.raises(ValueError, match='exceeds'):
        ne.export(scene(0, 1000, 0, 1000), tmp_path / 'huge', resolution=.01)
    for resolution in (0, -1, True, math.inf):
        with pytest.raises(ValueError):
            ne.export(scene(), tmp_path / 'bad', resolution=resolution)
    assert not list(tmp_path.iterdir())


def test_component_graph_identity_fields_preserve_openings_and_reject_stale_hosts(tmp_path):
    s = wall_scene(kind='door'); w, o = s['walls'][0], s['openings'][0]
    w['componentId'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'fixture-wall'))
    o.update(componentId=str(uuid.uuid5(uuid.NAMESPACE_URL, 'fixture-opening')), hostComponentId=w['componentId'],
             doorComponentId=str(uuid.uuid5(uuid.NAMESPACE_URL, 'fixture-door')))
    assert ne.export(s, tmp_path / 'map')['written']
    for changes in ({'componentId': 'not-a-uuid'}, {'hostComponentId': str(uuid.uuid4())}, {'extra': 'invented'}):
        changed = copy.deepcopy(s); changed['openings'][0].update(changes)
        with pytest.raises(ValueError):
            ne.export(changed, tmp_path / 'bad')


def test_controlled_wall_opening_and_label_edits_export_the_edited_geometry(tmp_path):
    from robotics.scene_compiler.component_graph import attach_component_ids, apply_edits, scene_sha256, EDIT_SCHEMA
    s = wall_scene(); s['openings'][0]['support_points'] = 12
    c = bind_floor(s); s = attach_component_ids(s)
    wall_id, opening_id = s['walls'][0]['componentId'], s['openings'][0]['componentId']
    contract = {'schema': EDIT_SCHEMA, 'sourceSha256': s['componentGraph']['sourceSha256'],
                'sceneSha256': scene_sha256(s), 'revision': 0, 'edits': [
                    {'op': 'wall', 'componentId': wall_id, 'translationMeters': [0., 0., .5]},
                    {'op': 'opening', 'componentId': opening_id, 'widthMeters': 1.2},
                    {'op': 'label', 'componentId': opening_id, 'label': 'Reviewed entry'}]}
    edited = apply_edits(s, contract); opening = edited['openings'][0]
    assert opening['parameterProvenance'] == {'widthMeters': 'operator-authored-edit', 'hostPlacement': 'operator-authored-edit'}
    assert opening['labelAuthority'] == 'operator-declared' and opening['physicalReviewRequired'] is True
    assert opening['provenance'] == 'operator-authored-edit' and opening['sourceProvenance'] == 'operator-reviewed'
    assert opening['supportPointsScope'] == 'original-source-not-edited-geometry'
    out = tmp_path / 'edited'; ne.export(edited, out, cloud=c, resolution=.25); m, pixels = load(out)
    assert value(m, pixels, 0., .5) == ne.FREE, 'the edited opening survives metadata validation'
    assert value(m, pixels, -1., .5) == ne.OCCUPIED, 'the wall moves with its hosted opening'
    assert value(m, pixels, -1., 0.) == ne.FREE, 'the old wall position is not occupied'
    assert m['source']['componentGraph']['revision'] == 1
    assert m['source']['componentGraph']['evidenceStatus'] == 'invalidated-by-edit'
    assert m['validation']['physicalReviewRequired'] is True and m['validation']['metricVerified'] is False
    assert s['walls'][0]['centre'][2] == 0. and s['openings'][0]['widthMeters'] == 1., 'the source scene remains intact'
    stale = copy.deepcopy(edited); stale['walls'][0]['centre'][0] += 1
    with pytest.raises(ValueError, match='changed|stale'):
        ne.export(stale, tmp_path / 'tampered', cloud=c)


@pytest.mark.parametrize('extra', [
    {'physicalReviewRequired': False}, {'physicalReviewRequired': 1}, {'dimensionProvenance': 'measured'},
    {'parameterProvenance': {'translationMeters': 'operator-authored-edit'}},
    {'parameterProvenance': {'widthMeters': 'measured'}}, {'parameterProvenance': []},
    {'label': 'entry\nunsafe'}, {'label': ''}, {'label': 10}, {'labelAuthority': 'operator-declared'},
    {'label': 'entry', 'labelAuthority': 'verified'}, {'label': 'entry', 'labelProvenance': 'model'},
    {'provenance': 'verified'}, {'sourceProvenance': 'bad\nsource'},
    {'supportPointsScope': 'measured-edited-geometry'}, {'support_points': True}, {'support_points': -1},
])
def test_authored_opening_metadata_is_strictly_validated(tmp_path, extra):
    s = wall_scene(); s['openings'][0].update(extra)
    with pytest.raises(ValueError):
        ne.export(s, tmp_path / 'bad')
    assert not list(tmp_path.iterdir())


def test_raster_workload_is_bounded_before_output_publication(tmp_path, monkeypatch):
    s = scene(); s['objects'].append({'name': 'large', 'centre': [2.5, .5, 3.], 'size': [3., 1., 2.]})
    monkeypatch.setattr(ne, 'MAX_RASTER_CANDIDATES', 10)
    with pytest.raises(ValueError, match='workload'):
        ne.export(s, tmp_path / 'map')
    assert not list(tmp_path.iterdir())


def test_fresh_atomic_publication_never_replaces_existing_output_and_cleans_failures(tmp_path, monkeypatch):
    s = scene(); out = tmp_path / 'existing'; out.mkdir()
    with pytest.raises(FileExistsError):
        ne.export(s, out)
    def fail(source, target):
        assert set(p.name for p in source.iterdir()) == set(ne.FILES)
        raise OSError('synthetic publication failure')
    monkeypatch.setattr(ne, '_publish_directory', fail)
    with pytest.raises(OSError, match='synthetic'):
        ne.export(s, tmp_path / 'new')
    assert sorted(p.name for p in tmp_path.iterdir()) == ['existing']


def test_cli_binds_files_and_emits_a_loadable_relative_image_path(tmp_path):
    s = scene(); c = bind_floor(s); sp, cp = tmp_path / 'scene.json', tmp_path / 'cloud.json'
    sp.write_text(json.dumps(s)); cp.write_text(json.dumps(c)); out = tmp_path / 'map'
    result = subprocess.run([sys.executable, str(Path(ne.__file__)), '--scene', str(sp), '--cloud', str(cp),
                             '--out', str(out), '--resolution', '.25'], capture_output=True, text=True, check=True)
    receipt = json.loads(result.stdout)
    assert receipt['written'] and receipt['sceneSha256'] == hashlib.sha256(sp.read_bytes()).hexdigest()
    assert (out / ne.FILES[0]).is_file() and (out / ne.FILES[1]).read_text().splitlines()[0] == 'image: nav2-map.pgm'
