"""Adapter-neutral source association and naming transport on authored geometry.

No reconstruction/model or external naming service runs in these tests.
"""
import base64
import copy
import hashlib
import json

import numpy as np
import pytest

from robotics.world_worker import camera_frames as cf, object_names as on, detector_names
from robotics.world_worker.geometry import write_point_cloud
from tests.world import test_object_names as fixtures


def job(tmp_path):
    out = tmp_path / 'output'; out.mkdir()
    frames = tmp_path / 'private-frames'; frames.mkdir()
    cloud = fixtures.cloud(); cloud['sourceFrame'] = 'colmap'; cloud['source'] = 'sparse-preview.ply'
    P, _ = on.source_points(cloud['points'], cloud['fromSource'])
    write_point_cloud(out / 'sparse-preview.ply', P, np.asarray(cloud['points'])[:, 3:], coordinate_frame='colmap')
    cameras = [fixtures.camera('front', (.5, 1.4, 3.), (.5, .45, 0), frames),
               fixtures.camera('side', (2.6, 1.4, 1.8), (.5, .45, 0), frames),
               fixtures.camera('lamp', (-1.2, 1.5, 3.6), (-1.2, .6, 1.2), frames)]
    sources, records = [], []
    for index, view in enumerate(cameras):
        image = cf.file_record(tmp_path, view['path'], width=view['width'], height=view['height'])
        source = {'name': f'authored-input-{index}.png', 'kind': 'image', 'sha256': image['sha256']}
        sources.append(source)
        camera = {'model': 'PINHOLE', 'params': [fixtures.F, fixtures.F, fixtures.W / 2, fixtures.H / 2],
                  'pixelConvention': 'integer-centres'}
        pose = view['cam_from_world'].tolist()
        records.append({'frame_id': cf.frame_id(source['sha256'], image['sha256'], camera, pose), 'image': image,
                        'origin': {'sourceIndex': index, 'sourceWidth': view['width'], 'sourceHeight': view['height'],
                                   'exifOrientation': 1, 'sourceToFramePixelCenter': [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
                        'timestamp': None, 'camera': camera, 'cam_from_world': pose})
    (out / 'reconstruction.json').write_text(json.dumps({'sources': sources}))
    ledger = {'schema': cf.SCHEMA, 'sources': sources, 'frames': records, 'metric_verified': False,
              'clouds': [cf.file_record(tmp_path, out / 'sparse-preview.ply', coordinate_frame='colmap')],
              'reconstruction': cf.file_record(tmp_path, out / 'reconstruction.json')}
    cf.write(tmp_path, ledger)
    return cloud, ledger


def test_transformed_trimmed_thinned_cloud_keeps_ordered_camera_source_binding(tmp_path):
    cloud, ledger = job(tmp_path)
    cloud['points'] = cloud['points'][25:-20:3]
    saved = copy.deepcopy(cloud)
    views = on.reconstruction_views(tmp_path, cloud)
    assert len(views) == 3 and cloud == saved
    assert all(v['binding_status'] == 'ordered-source-subset' for v in views)
    assert all(v['source_cloud_sha256'] == ledger['clouds'][0]['sha256'] for v in views)


@pytest.mark.parametrize('change', ['point', 'colour', 'order', 'frame', 'shear', 'reflection'])
def test_foreign_or_modified_geometry_cannot_borrow_registered_cameras(tmp_path, change):
    cloud, _ = job(tmp_path)
    if change == 'point': cloud['points'][123][0] += .1
    if change == 'colour': cloud['points'][123][3] += 1
    if change == 'order': cloud['points'][100], cloud['points'][300] = cloud['points'][300], cloud['points'][100]
    if change == 'frame': cloud['sourceFrame'] = 'right-handed-y-up'
    if change == 'shear': cloud['fromSource'][0][1] += .1
    if change == 'reflection': cloud['fromSource'][0] = [-v for v in cloud['fromSource'][0]]
    with pytest.raises(on.NamingSkipped): on.reconstruction_views(tmp_path, cloud)


def test_present_stale_ledger_never_falls_back_to_legacy_colmap(tmp_path, monkeypatch):
    cloud, _ = job(tmp_path)
    (tmp_path / 'output' / 'camera-frames.json').write_text('{}')
    def forbidden(_root): raise AssertionError('Invalid ledger must not fall back')
    monkeypatch.setattr(on, 'colmap_views', forbidden)
    with pytest.raises(ValueError): on.reconstruction_views(tmp_path, cloud)


def test_actual_artifact_directory_can_be_passed_to_bound_loader(tmp_path):
    cloud, _ = job(tmp_path)
    views = on.reconstruction_views(tmp_path / 'output', cloud)
    assert all(view['binding_status'] == 'ordered-source-subset' for view in views)
    relative = on.reconstruction_views(tmp_path, cloud, ledger_path='output/camera-frames.json')
    assert [view['frame_id'] for view in relative] == [view['frame_id'] for view in views]


def test_named_objects_retain_exact_frame_and_transmitted_crop_hashes(tmp_path):
    cloud, _ = job(tmp_path)
    before = copy.deepcopy(cloud); client = fixtures.FakeClient(fixtures.by_size)
    names, receipt = on.name_objects(cloud, tmp_path, client=client)
    assert receipt['frame_evidence']['bound'] is True and cloud == before
    transmitted = {hashlib.sha256(base64.b64decode(block['source']['data'])).hexdigest()
                   for block in client.calls[0]['messages'][0]['content'] if block['type'] == 'image'}
    assert transmitted
    for item in names['objects']:
        assert item['frameEvidence']
        for frame in item['frameEvidence']:
            assert frame['frameId'] and frame['imageSha256'] and frame['cameraLedgerSha256']
            assert frame['bindingStatus'] == 'ordered-source-subset'
            assert frame['crop']['cropSha256'] in transmitted
            assert frame['pixelConvention'] == 'integer-centres'


def test_changed_image_refuses_crop_and_local_detector_before_use(tmp_path):
    cloud, _ = job(tmp_path)
    view = on.reconstruction_views(tmp_path, cloud)[0]
    view['path'].write_bytes(b'replaced raster')
    with pytest.raises(on.NamingSkipped): on.crop(view, [10, 10, 100, 100])
    calls = []
    item = {'id': '1', 'picks': [{'view': view, 'box': [10, 10, 100, 100]}]}
    with pytest.raises(on.NamingSkipped): detector_names.answer([item], lambda path: calls.append(path))
    assert calls == []


def test_same_basename_frames_do_not_share_detector_results(tmp_path):
    cloud, _ = job(tmp_path)
    views = on.reconstruction_views(tmp_path, cloud)[:2]
    calls = []
    for view in views: view['name'] = 'same-basename.png'
    def detect(path):
        calls.append(path)
        return [('chair' if path == views[0]['path'] else 'couch', .95, (10, 10, 100, 100))]
    items = [{'id': str(i), 'picks': [{'view': view, 'box': [10, 10, 100, 100]}]} for i, view in enumerate(views)]
    answers, _model, _usage = detector_names.answer(items, detect)
    assert len(calls) == 2 and answers['0']['label'] == 'chair' and answers['1']['label'] == 'sofa'


def test_trimmed_far_outlier_cannot_legitimize_a_moved_room_point():
    source = np.array([[0, 0, 0, 100, 100, 100], [1_000_000, 0, 0, 100, 100, 100]], dtype=float)
    cloud = {'points': [[.1, 0, 0, 100, 100, 100]], 'fromSource': np.eye(4)[:3].tolist()}
    with pytest.raises(on.NamingSkipped): on._ordered_source_subset(cloud, source, np.array([[.1, 0, 0]]))


def test_large_scale_cannot_turn_source_roundoff_into_half_a_metre():
    source = np.array([[0, 0, 0, 100, 100, 100]], dtype=float)
    transform = np.hstack([np.eye(3) * 1_000_000, np.zeros((3, 1))])
    cloud = {'points': [[.5, 0, 0, 100, 100, 100]], 'fromSource': transform.tolist()}
    with pytest.raises(on.NamingSkipped): on._ordered_source_subset(cloud, source, np.array([[5e-7, 0, 0]]))
