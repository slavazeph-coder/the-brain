"""Private camera ledgers on authored rasters/poses; no reconstruction accuracy claim."""
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from robotics.world_worker import camera_frames as cf


POSE = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]


def make_job(root):
    (root / 'output').mkdir()
    images = root / 'colmap-work/images'; images.mkdir(parents=True)
    Image.new('RGB', (64, 48), (30, 60, 90)).save(images / 'image_0000.png')
    (root / 'output/sparse-preview.ply').write_text(
        'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\n'
        'property float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 1 30 60 90\n')
    sources = [{'name': 'authored-source.png', 'kind': 'image',
                'sha256': hashlib.sha256(b'authored source receipt, not a real photograph').hexdigest()}]
    (root / 'output/reconstruction.json').write_text(json.dumps({'sources': sources, 'metric_verified': False}))
    image = cf.file_record(root, images / 'image_0000.png', width=64, height=48)
    camera = {'model': 'PINHOLE', 'params': [100, 150, 20, 15], 'pixelConvention': 'integer-centres'}
    frame = {'frame_id': cf.frame_id(sources[0]['sha256'], image['sha256'], camera, POSE),
        'image': image, 'origin': {'sourceIndex': 0, 'sourceWidth': 128, 'sourceHeight': 96,
            'exifOrientation': 1, 'sourceToFramePixelCenter': [[.5, 0, -.25], [0, .5, -.25], [0, 0, 1]]},
        'timestamp': None, 'camera': camera, 'cam_from_world': copy.deepcopy(POSE)}
    return {'schema': cf.SCHEMA, 'sources': sources,
        'reconstruction': cf.file_record(root, root / 'output/reconstruction.json'),
        'clouds': [cf.file_record(root, root / 'output/sparse-preview.ply', coordinate_frame='colmap')],
        'frames': [frame], 'metric_verified': False}


def rekey(record):
    for frame in record['frames']:
        frame['frame_id'] = cf.frame_id(record['sources'][frame['origin']['sourceIndex']]['sha256'],
                                        frame['image']['sha256'], frame['camera'], frame['cam_from_world'])


def receipt(root, record):
    path = root / 'output/reconstruction.json'
    path.write_text(json.dumps({'sources': record['sources'], 'metric_verified': False}))
    record['reconstruction'] = cf.file_record(root, path)


def test_write_load_binds_private_raster_receipt_and_cloud_without_mutation(tmp_path):
    record = make_job(tmp_path); before = copy.deepcopy(record)
    path = cf.write(tmp_path, record)
    assert record == before
    assert cf.load_record(tmp_path) == record
    assert str(tmp_path) not in path.read_text()
    view, = cf.load_views(tmp_path, record['clouds'][0]['sha256'])
    assert view['name'] == 'image_0000.png' and view['path'].is_file()
    assert view['image_sha256'] == record['frames'][0]['image']['sha256']
    assert view['image_bytes_size'] == view['path'].stat().st_size
    assert view['ledger_sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert view['source_cloud_name'] == 'output/sparse-preview.ply'
    assert view['source_cloud_coordinate_frame'] == 'colmap'
    assert view['pixel_convention'] == 'integer-centres'
    assert not view['cam_from_world'].flags.writeable
    np.testing.assert_allclose(view['project']([[1, 2, 4], [0, 0, 2]]), [[45, 90], [20, 15]])
    assert np.isnan(view['project']([[0, 0, 0], [0, 0, -1]])).all()
    with pytest.raises(FileExistsError): cf.write(tmp_path, record)
    assert cf.load_record(tmp_path) == before


def test_world_to_camera_pose_and_radial_projection_are_not_pinhole_approximations(tmp_path):
    record = make_job(tmp_path); frame = record['frames'][0]
    frame['camera'] = {'model': 'SIMPLE_RADIAL', 'params': [100, 20, 15, .1]}
    frame['cam_from_world'] = [[0, -1, 0, 2], [1, 0, 0, 3], [0, 0, 1, 4]]
    rekey(record); cf.write(tmp_path, record)
    view, = cf.load_views(tmp_path)
    camera_points = np.array([[1, 2, 6]]) @ view['cam_from_world'][:, :3].T + view['cam_from_world'][:, 3]
    np.testing.assert_allclose(camera_points, [[0, 4, 10]])
    np.testing.assert_allclose(view['project'](camera_points), [[20, 55.64]])
    np.testing.assert_allclose(view['project']([[1, 2, 4]]), [[45.78125, 66.5625]])


@pytest.mark.parametrize('model,params', [('PINHOLE', [100, 150, 20, 15]), ('SIMPLE_RADIAL', [100, 20, 15, .12])])
def test_native_colmap_forward_projection_matches_pycolmap_in_common_integer_centres(tmp_path, model, params):
    pycolmap = pytest.importorskip('pycolmap')
    record = make_job(tmp_path); frame = record['frames'][0]
    frame['camera'] = {'model': model, 'params': params, 'pixelConvention': 'colmap-half-pixel'}
    rekey(record); cf.write(tmp_path, record)
    points = np.array([[0, 0, 1], [1, 2, 4], [-.8, .2, 2]], float)
    native = pycolmap.Camera(model=model, width=64, height=48, params=params)
    view, = cf.load_views(tmp_path)
    np.testing.assert_allclose(view['project'](points), native.img_from_cam(points) - .5, atol=1e-10)
    assert view['camera_pixel_convention'] == 'colmap-half-pixel'
    assert cf.load_record(tmp_path)['frames'][0]['camera']['params'] == params


def test_nontrivial_exif_rotation_resize_and_unavailable_transform_are_explicit(tmp_path):
    record = make_job(tmp_path); frame = record['frames'][0]
    path = tmp_path / frame['image']['name']
    Image.new('RGB', (30, 50), (1, 2, 3)).save(path)
    frame['image'] = cf.file_record(tmp_path, path, width=30, height=50)
    # Original 100x60, EXIF6 clockwise90, then a half-size30x50 raster.
    matrix = [[0, -.5, 29.25], [.5, 0, -.25], [0, 0, 1]]
    frame['origin'].update(sourceWidth=100, sourceHeight=60, exifOrientation=6, sourceToFramePixelCenter=matrix)
    rekey(record)
    result = cf.validate(record, tmp_path)
    np.testing.assert_allclose(np.array(matrix) @ [10, 20, 1], [19.25, 4.75, 1])
    assert result['frames'][0]['origin']['sourceToFramePixelCenter'] == matrix
    frame['origin'].update(sourceWidth=None, sourceHeight=None, exifOrientation=None, sourceToFramePixelCenter=None)
    assert cf.validate(record, tmp_path)['frames'][0]['origin']['sourceToFramePixelCenter'] is None


def test_model_raster_prepared_file_and_unknown_preprocessing_are_bound(tmp_path):
    record = make_job(tmp_path); frame = record['frames'][0]
    prepared = tmp_path / 'colmap-work/images/prepared.png'
    Image.new('RGB', (80, 60), (1, 2, 3)).save(prepared)
    frame['preparedImage'] = cf.file_record(tmp_path, prepared, width=80, height=60)
    frame['preprocessing'] = {'sourceToModelPixelCenter': None, 'preparedToModelPixelCenter': None,
        'reason': 'Pinned loader crop transform unavailable', 'raster': 'derived model input RGB, rounded to uint8'}
    assert cf.validate(record, tmp_path) == record
    prepared.write_bytes(b'stale raster')
    with pytest.raises(ValueError): cf.validate(record, tmp_path)


def test_stale_source_receipt_rejected_even_when_receipt_file_binding_is_refreshed(tmp_path):
    record = make_job(tmp_path)
    changed = copy.deepcopy(record); changed['sources'][0]['sha256'] = 'f' * 64
    receipt(tmp_path, changed)
    record['reconstruction'] = changed['reconstruction']
    with pytest.raises(ValueError, match='Original source'): cf.validate(record, tmp_path)


@pytest.mark.parametrize('target', ['image', 'cloud', 'receipt'])
def test_any_stale_bound_file_prevents_crop_view_loading(tmp_path, target):
    record = make_job(tmp_path); cf.write(tmp_path, record)
    name = {'image': record['frames'][0]['image']['name'], 'cloud': record['clouds'][0]['name'],
            'receipt': record['reconstruction']['name']}[target]
    with (tmp_path / name).open('ab') as stream: stream.write(b' ')
    with pytest.raises(ValueError): cf.load_views(tmp_path)


def test_same_hash_with_forged_raster_dimensions_is_rejected(tmp_path):
    record = make_job(tmp_path)
    record['frames'][0]['image']['width'] = 65
    with pytest.raises(ValueError, match='dimensions'): cf.validate(record, tmp_path)


def test_cloud_selection_can_use_any_declared_cloud_but_never_an_unrelated_one(tmp_path):
    record = make_job(tmp_path)
    path = tmp_path / 'output/dense-preview.ply'
    path.write_bytes((tmp_path / record['clouds'][0]['name']).read_bytes() + b'\n')
    second = cf.file_record(tmp_path, path, coordinate_frame='colmap')
    record['clouds'].append(second); cf.write(tmp_path, record)
    view, = cf.load_views(tmp_path, second['sha256'])
    assert view['source_cloud_sha256'] == second['sha256']
    assert view['source_cloud_name'] == second['name']
    with pytest.raises(ValueError, match='another point-cloud'): cf.load_views(tmp_path, '0' * 64)


@pytest.mark.parametrize('name', ['../image.png', '/tmp/image.png', 'colmap-work/../image.png',
                                  'colmap-work//images/image.png', 'C:\\image.png', './image.png'])
def test_traversal_and_host_paths_are_rejected(tmp_path, name):
    record = make_job(tmp_path); record['frames'][0]['image']['name'] = name
    with pytest.raises(ValueError): cf.validate(record, tmp_path)


def test_file_and_parent_symlinks_are_rejected(tmp_path):
    record = make_job(tmp_path); original = tmp_path / record['frames'][0]['image']['name']
    link = original.with_name('link.png'); link.symlink_to(original)
    record['frames'][0]['image']['name'] = 'colmap-work/images/link.png'
    with pytest.raises(ValueError, match='Symlink'): cf.validate(record, tmp_path)
    link.unlink(); parent = tmp_path / 'alias'; parent.symlink_to(original.parent, target_is_directory=True)
    record['frames'][0]['image']['name'] = 'alias/image_0000.png'
    with pytest.raises(ValueError, match='Symlink'): cf.validate(record, tmp_path)


def test_frame_identity_follows_source_raster_and_camera_not_private_path(tmp_path):
    record = make_job(tmp_path); frame = record['frames'][0]; identifier = frame['frame_id']
    path = tmp_path / frame['image']['name']; moved = path.with_name('renamed.png'); moved.write_bytes(path.read_bytes())
    frame['image']['name'] = 'colmap-work/images/renamed.png'
    assert cf.validate(record, tmp_path)['frames'][0]['frame_id'] == identifier
    frame['camera']['params'][0] = 101
    with pytest.raises(ValueError, match='identity'): cf.validate(record, tmp_path)


def test_video_pts_is_exact_rational_or_unavailable_never_invented_seconds(tmp_path):
    record = make_job(tmp_path); record['sources'][0]['kind'] = 'video'; receipt(tmp_path, record)
    frame = record['frames'][0]
    assert cf.validate(record, tmp_path)['frames'][0]['timestamp'] is None
    frame['timestamp'] = {'pts': 9009, 'timeBase': [1, 90000]}
    assert cf.validate(record, tmp_path)['frames'][0]['timestamp'] == frame['timestamp']
    for timestamp in ({'pts': 1.2, 'timeBase': [1, 30]}, {'pts': True, 'timeBase': [1, 30]},
                      {'pts': 1, 'timeBase': [1, 0]}, {'pts': 1, 'timeBase': [1, 30], 'seconds': .03}):
        frame['timestamp'] = timestamp
        with pytest.raises(ValueError): cf.validate(record, tmp_path)


@pytest.mark.parametrize('change', [
    lambda r: r.update(metric_verified=0),
    lambda r: r.update(extra='unknown field'),
    lambda r: r['frames'][0]['origin'].update(sourceIndex=True),
    lambda r: r['frames'][0]['origin'].update(sourceIndex=12),
    lambda r: r['frames'][0]['origin'].update(sourceWidth=None),
    lambda r: r['frames'][0]['origin'].update(exifOrientation=9),
    lambda r: r['frames'][0]['origin'].update(sourceToFramePixelCenter=[[0, 0, 0], [0, 0, 0], [0, 0, 1]]),
    lambda r: r['frames'][0]['camera'].update(model='OPENCV'),
    lambda r: r['frames'][0]['camera'].update(pixelConvention='unknown'),
    lambda r: r['frames'][0]['camera']['params'].__setitem__(0, False),
    lambda r: r['frames'][0]['camera']['params'].__setitem__(0, 0),
    lambda r: r['frames'][0]['cam_from_world'][0].__setitem__(0, -1),
    lambda r: r['frames'][0]['cam_from_world'][0].__setitem__(0, 2),
    lambda r: r['frames'][0]['cam_from_world'][0].__setitem__(3, float('nan')),
    lambda r: r['frames'][0]['image'].update(width=24_000_000),
    lambda r: r['frames'].append(copy.deepcopy(r['frames'][0])),
])
def test_invalid_camera_origin_pose_or_claims_fail_closed(tmp_path, change):
    record = make_job(tmp_path); change(record)
    with pytest.raises(ValueError): cf.validate(record, tmp_path)


def test_ledger_byte_frame_bounds_and_duplicate_json_keys(tmp_path):
    record = make_job(tmp_path)
    too_many = copy.deepcopy(record); too_many['frames'] *= 61
    with pytest.raises(ValueError, match='60'): cf.validate(too_many)
    too_large = copy.deepcopy(record); too_large['extra'] = 'x' * cf.MAX_BYTES
    with pytest.raises(ValueError, match='1 MiB'): cf.validate(too_large)
    (tmp_path / 'output/camera-frames.json').write_text('{"schema":"one","schema":"two"}')
    with pytest.raises(ValueError, match='Duplicate'): cf.load_record(tmp_path)


def test_nonstandard_adapter_output_directory_is_explicit_and_contained(tmp_path):
    record = make_job(tmp_path)
    (tmp_path / 'output').rename(tmp_path / 'test-output')
    record['reconstruction']['name'] = 'test-output/reconstruction.json'
    record['clouds'][0]['name'] = 'test-output/sparse-preview.ply'
    target = tmp_path / 'test-output/camera-frames.json'
    assert cf.write(tmp_path, record, output_path=target) == target
    assert cf.load_record(tmp_path, ledger_path=target) == record
    assert len(cf.load_views(tmp_path, ledger_path='test-output/camera-frames.json')) == 1
    for path in ('../camera-frames.json', '/tmp/camera-frames.json', 'test-output/../camera-frames.json'):
        with pytest.raises(ValueError): cf.write(tmp_path, record, output_path=path)
