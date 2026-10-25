"""Model-shaped CPU fixtures for camera/raster provenance; no weights or GPU inference.

The image tensors match the pinned load_images/infer API. They are synthetic
arrays, not learned geometry, original phone captures or an accuracy benchmark.
"""
from copy import deepcopy
from pathlib import Path
import json
import math
import sys

import numpy as np
from PIL import Image
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker import camera_frames
from robotics.world_worker.geometry import write_point_cloud
from robotics.world_worker.mapanything_apache import (
    camera_metadata, file_hash, model_frame_records, write_camera_frame_evidence,
)


NORM = {'name': 'dinov2', 'mean': np.array([.485, .456, .406], dtype=np.float32),
        'std': np.array([.229, .224, .225], dtype=np.float32)}


def fixture(tmp_path, count=2):
    root = tmp_path / 'job'
    out, images = root / 'output', root / 'mapanything-images'
    out.mkdir(parents=True)
    images.mkdir()
    predictions, loaded, paths, preparations, sources = [], [], [], [], []
    for index in range(count):
        original = tmp_path / f'upload_{index}.png'
        Image.fromarray(np.full((6, 8, 3), 40 + index * 80, dtype=np.uint8)).save(original)
        source = {'name': original.name, 'kind': 'image', 'sha256': file_hash(original)}
        path = images / f'image_{index:04d}.jpg'
        Image.open(original).save(path, quality=92)
        prep = {'image': path.name, 'sourceIndex': index, 'sourceSha256': source['sha256'],
                'sourceWidth': 8, 'sourceHeight': 6, 'exifOrientation': 1, 'timestamp': None,
                'preparation': {'width': 8, 'height': 6, 'preparedPath': path.name,
                                'preparedSha256': file_hash(path)}}
        # Deliberately different model/source dimensions: K belongs to 6x4 here.
        pixels = np.arange(4 * 6 * 3, dtype=np.uint8).reshape(4, 6, 3) + index * 100
        rgb = pixels.astype(np.float32) / 255
        angle = .37 + index * .1
        c, s = math.cos(angle), math.sin(angle)
        pose = np.array([[c, 0, s, 2 + index], [0, 1, 0, 3], [-s, 0, c, 4], [0, 0, 0, 1]], dtype=np.float32)
        K = np.array([[90, 0, 2.5], [0, 92, 1.5], [0, 0, 1]], dtype=np.float32)
        predictions.append({'img_no_norm': rgb[None], 'camera_poses': pose[None], 'intrinsics': K[None]})
        loaded.append({'img': ((rgb - NORM['mean']) / NORM['std']).transpose(2, 0, 1)[None],
                       'idx': index, 'instance': str(index), 'true_shape': np.int32([[4, 6]]),
                       'data_norm_type': ['dinov2']})
        paths.append(path)
        preparations.append(prep)
        sources.append(source)
    reconstruction = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': 'mapanything-apache',
                      'sources': sources, 'coordinate_frame': 'right-handed-y-up',
                      'metric_verified': False, 'cameras': camera_metadata(predictions)}
    (out / 'reconstruction.json').write_text(json.dumps(reconstruction))
    write_point_cloud(out / 'dense-preview.ply', np.array([[i / 100, 0, 1] for i in range(30)]),
                      np.full((30, 3), 128, dtype=np.uint8), coordinate_frame='right-handed-y-up')
    return root, out, predictions, loaded, paths, preparations, sources


def test_private_model_rasters_and_cameras_bind_the_exact_cloud_and_sources(tmp_path):
    root, out, predictions, loaded, paths, preparations, sources = fixture(tmp_path)
    record = write_camera_frame_evidence(predictions, loaded, paths, preparations, sources, out, normalization=NORM)
    assert (out / 'camera-frames.json').is_file()
    assert record['clouds'][0]['sha256'] == file_hash(out / 'dense-preview.ply')
    assert record['reconstruction']['sha256'] == file_hash(out / 'reconstruction.json')
    for index, frame in enumerate(record['frames']):
        assert frame['image']['name'] == f'mapanything-frames/view_{index:04d}.png'
        assert not (out / f'view_{index:04d}.png').exists(), 'source rasters are private, not public artifacts'
        with Image.open(root / frame['image']['name']) as image:
            assert image.size == (6, 4)
            assert np.array_equal(np.asarray(image), np.rint(predictions[index]['img_no_norm'][0] * 255).astype(np.uint8))
        assert (frame['image']['width'], frame['image']['height']) == (6, 4)
        assert (frame['preparedImage']['width'], frame['preparedImage']['height']) == (8, 6)
        assert frame['preparedImage']['sha256'] == file_hash(paths[index])
        assert frame['origin']['sourceIndex'] == index
        assert frame['origin']['sourceToFramePixelCenter'] is None
        assert frame['preprocessing']['preparedToModelPixelCenter'] is None
        assert frame['timestamp'] is None, 'no original PTS is invented from a model/frame index'
        assert frame['camera'] == {'model': 'PINHOLE', 'params': [90., 92., 2.5, 1.5],
                                   'pixelConvention': 'integer-centres'}
    assert camera_frames.validate(record, job_root=root) is not False


def test_y_up_world_projects_into_opencv_camera_without_local_axis_conjugation(tmp_path):
    root, _, predictions, loaded, paths, preparations, sources = fixture(tmp_path, count=1)
    frame = model_frame_records(predictions, loaded, paths, preparations, sources, root, normalization=NORM)[0]
    pose = predictions[0]['camera_poses'][0]
    point_cv = np.array([.2, -.1, 2., 1.])
    world_cv = pose @ point_cv
    world_y_up = np.diag([1., -1., -1., 1.]) @ world_cv
    recovered = np.asarray(frame['cam_from_world']) @ world_y_up
    assert np.allclose(recovered, point_cv[:3], atol=1e-6)
    projected = predictions[0]['intrinsics'][0] @ recovered
    assert np.allclose(projected[:2] / projected[2], [11.5, -3.1], atol=1e-5)


@pytest.mark.parametrize('corruption', ['prediction_order', 'loaded_order', 'source_hash', 'prepared_hash', 'prepared_name',
                                      'source_index', 'true_shape', 'skew'])
def test_mismatched_frame_associations_fail_before_private_rasters_are_written(tmp_path, corruption):
    root, _, predictions, loaded, paths, preparations, sources = fixture(tmp_path)
    if corruption == 'prediction_order':
        predictions.reverse()
    elif corruption == 'loaded_order':
        loaded.reverse()
    elif corruption == 'source_hash':
        preparations[0]['sourceSha256'] = '0' * 64
    elif corruption == 'prepared_hash':
        preparations[0]['preparation']['preparedSha256'] = '0' * 64
    elif corruption == 'prepared_name':
        preparations[0]['image'] = 'another.jpg'
    elif corruption == 'source_index':
        preparations[0]['sourceIndex'] = 1
    elif corruption == 'true_shape':
        loaded[0]['true_shape'] = np.int32([[6, 4]])
    elif corruption == 'skew':
        predictions[0]['intrinsics'][0, 0, 1] = .1
    with pytest.raises(ValueError):
        model_frame_records(predictions, loaded, paths, preparations, sources, root, normalization=NORM)
    assert not (root / 'mapanything-frames').exists()


def test_modified_cloud_is_rejected_after_a_frame_bundle_is_written(tmp_path):
    root, out, predictions, loaded, paths, preparations, sources = fixture(tmp_path)
    record = write_camera_frame_evidence(predictions, loaded, paths, preparations, sources, out, normalization=NORM)
    with (out / 'dense-preview.ply').open('ab') as stream:
        stream.write(b'changed')
    with pytest.raises(ValueError):
        camera_frames.validate(record, job_root=root)


def test_video_origin_remains_video_bound_without_original_timestamps(tmp_path):
    root, _, predictions, loaded, paths, preparations, sources = fixture(tmp_path, count=1)
    sources[0]['kind'] = 'video'
    preparations[0].update(sourceWidth=1920, sourceHeight=1080, exifOrientation=None, timestamp=None)
    frame = model_frame_records(predictions, loaded, paths, preparations, sources, root, normalization=NORM)[0]
    assert frame['origin'] == {'sourceIndex': 0, 'sourceWidth': 1920, 'sourceHeight': 1080,
                               'exifOrientation': None, 'sourceToFramePixelCenter': None}
    assert frame['timestamp'] is None


def test_duplicate_prepared_paths_do_not_alias_two_source_views(tmp_path):
    root, _, predictions, loaded, paths, preparations, sources = fixture(tmp_path)
    paths[1] = paths[0]
    preparations[1] = deepcopy(preparations[0])
    with pytest.raises(ValueError, match='unique'):
        model_frame_records(predictions, loaded, paths, preparations, sources, root, normalization=NORM)


def test_custom_artifact_directory_keeps_bound_camera_loading(tmp_path):
    from robotics.world_worker import camera_frames, object_names
    root, out, predictions, loaded, paths, preparations, sources = fixture(tmp_path)
    custom = root / 'custom-artifacts'; out.rename(custom)
    record = write_camera_frame_evidence(predictions, loaded, paths, preparations, sources, custom, normalization=NORM)
    assert (custom / 'camera-frames.json').is_file() and not (root / 'output').exists()
    views = camera_frames.load_views(root, ledger_path=custom / 'camera-frames.json')
    assert len(views) == len(predictions)
    cloud = {'points': [[i / 100, 0, 1, 128, 128, 128] for i in range(30)],
             'sourceFrame': 'right-handed-y-up', 'source': 'dense-preview.ply', 'fromSource': np.eye(4)[:3].tolist()}
    assert all(view['binding_status'] == 'ordered-source-subset' for view in object_names.reconstruction_views(custom, cloud))
    assert record['clouds'][0]['name'] == 'custom-artifacts/dense-preview.ply'
