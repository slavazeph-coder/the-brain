"""Camera provenance contracts on authored rasters/poses, not reconstruction accuracy."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image
import pytest

from robotics.world_worker import sparse_colmap as sc


def textured(path, size=(400, 300), orientation=1, seed=2):
    rng = np.random.default_rng(seed)
    raster = rng.integers(25, 220, (size[1], size[0], 3), dtype=np.uint8)
    # Large, asymmetric patches survive JPEG re-encoding and make orientation observable.
    marks = [(30, 40, (245, 10, 20)), (size[0] - 45, 55, (10, 235, 25)),
             (60, size[1] - 35, (15, 20, 240))]
    for x, y, colour in marks:
        raster[y - 10:y + 11, x - 10:x + 11] = colour
    exif = Image.Exif(); exif[274] = orientation; exif[270] = 'private source metadata'
    Image.fromarray(raster).save(path, exif=exif)
    return marks


@pytest.mark.parametrize('orientation', range(1, 9))
def test_photo_evidence_maps_all_exif_orientations_to_actual_prepared_pixels(tmp_path, orientation):
    source, prepared = tmp_path / 'original.png', tmp_path / 'prepared.jpg'
    marks = textured(source, orientation=orientation)
    before = source.read_bytes(); result = sc.prepare_photo(source, prepared, with_evidence=True)
    assert source.read_bytes() == before
    assert result['sourceSha256'] == hashlib.sha256(before).hexdigest()
    assert result['preparedSha256'] == hashlib.sha256(prepared.read_bytes()).hexdigest()
    assert (result['sourceWidth'], result['sourceHeight'], result['exifOrientation']) == (400, 300, orientation)
    expected = (300, 400) if orientation >= 5 else (400, 300)
    assert (result['width'], result['height']) == expected
    assert result['preparedPath'] == prepared.name
    matrix = np.asarray(result['sourceToPreparedPixelCenter'])
    with Image.open(prepared) as raster:
        assert raster.size == expected and not raster.getexif()
        for x, y, colour in marks:
            px, py, scale = matrix @ [x, y, 1]
            assert scale == 1
            actual = raster.getpixel((round(px), round(py)))
            assert np.max(np.abs(np.array(actual) - colour)) < 20, f'orientation {orientation}, source {x},{y}'


def test_resized_photo_records_pixel_centres_not_just_an_edge_scale(tmp_path):
    source, prepared = tmp_path / 'original.png', tmp_path / 'prepared.jpg'
    textured(source, size=(1600, 800), orientation=6)
    result = sc.prepare_photo(source, prepared, with_evidence=True)
    assert (result['width'], result['height']) == (640, 1280)
    transform = np.asarray(result['sourceToPreparedPixelCenter'])
    assert transform @ [0, 0, 1] == pytest.approx([639.1, -.1, 1])
    assert transform @ [1599, 799, 1] == pytest.approx([-.1, 1279.1, 1])
    assert np.linalg.det(transform) == pytest.approx(.64), 'EXIF rotation is followed by a .8/.8 resize'
    # Existing callers retain their exact width/height result until explicitly opting into evidence.
    assert sc.prepare_photo(source, tmp_path / 'legacy.jpg') == {'width': 640, 'height': 1280}


def test_video_deduplication_retains_accepted_resampled_indices_without_invented_pts(tmp_path, monkeypatch):
    source = tmp_path / 'capture.mp4'; source.write_bytes(b'\x00\x00\x00\x18ftyp' + b'explicit encoded transport fixture')
    images = tmp_path / 'images'; images.mkdir()
    metadata = {'format': {'duration': '3'}, 'streams': [{'codec_type': 'video', 'width': 400, 'height': 300}]}
    def run(command, **kwargs):
        if '-show_entries' in command:
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(metadata).encode())
        raw = Path(command[-1]).parent
        for index in range(8):
            if index == 2:
                shutil.copyfile(raw / 'frame_0002.jpg', raw / 'frame_0003.jpg')
            else:
                textured(raw / f'frame_{index + 1:04d}.jpg', seed=index)
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(sc.shutil, 'which', lambda name: '/transport-fixture/' + name)
    monkeypatch.setattr(sc.subprocess, 'run', run)
    capture = sc.extract_video(source, images)
    assert capture['near_duplicate_frames'] == 1 and len(capture['frames']) == 7
    assert [frame['resampledOutputIndex'] for frame in capture['frames']] == [0, 1, 3, 4, 5, 6, 7]
    assert [frame['image'] for frame in capture['frames']] == [f'image_{i:04d}.jpg' for i in range(7)]
    for frame in capture['frames']:
        assert frame['timestamp'] is None and frame['sourceToFramePixelCenter'] is None
        assert frame['sourceSha256'] == hashlib.sha256(source.read_bytes()).hexdigest()
        assert frame['preparation']['preparedSha256'] == hashlib.sha256((images / frame['image']).read_bytes()).hexdigest()
    assert 'not a source PTS' in capture['timestamp_evidence']
    assert not (tmp_path / 'video-frames').exists(), 'discarded decoding intermediates are removed'


def authored_model(path, names=('image_0000.jpg',), *, points=0):
    """Real PyCOLMAP parser/camera objects with explicit authored test poses."""
    pycolmap = pytest.importorskip('pycolmap')
    path.mkdir()
    (path / 'cameras.txt').write_text('7 SIMPLE_RADIAL 400 300 330 200 150 0.06\n')
    (path / 'images.txt').write_text(''.join(f'{i + 3} 1 0 0 0 {i * .1} -0.2 1 7 {name}\n\n' for i, name in enumerate(names)))
    (path / 'points3D.txt').write_text(''.join(f'{i + 1} {i * .01} 0 2 100 110 120 0.2\n' for i in range(points)))
    return pycolmap.Reconstruction(path)


def prepared_association(images, source, index=0):
    target = images / f'image_{index:04d}.jpg'; prep = sc.prepare_photo(source, target, with_evidence=True)
    return {'image': target.name, 'sourceIndex': index, 'sourceSha256': prep['sourceSha256'],
            'sourceWidth': prep['sourceWidth'], 'sourceHeight': prep['sourceHeight'], 'exifOrientation': prep['exifOrientation'],
            'sourceToFramePixelCenter': prep['sourceToPreparedPixelCenter'], 'timestamp': None, 'preparation': prep}


def test_selected_pycolmap_cameras_keep_distortion_and_exact_source_raster_binding(tmp_path):
    from robotics.world_worker import camera_frames
    images = tmp_path / 'colmap-work' / 'images'; images.mkdir(parents=True)
    sources, associations = [], []
    for index in range(2):
        original = tmp_path / f'photo-{index}.png'; textured(original, seed=index)
        association = prepared_association(images, original, index)
        sources.append({'name': original.name, 'kind': 'image', 'sha256': association['sourceSha256']}); associations.append(association)
    # Only image_0001 registered in the chosen model. Never pair it with source 0 by list position.
    model = authored_model(tmp_path / 'model', ['image_0001.jpg'])
    frames = sc.camera_frame_records(model, images, associations, sources, tmp_path)
    assert len(frames) == 1 and frames[0]['origin']['sourceIndex'] == 1
    frame = frames[0]; image = model.image(3); camera = model.camera(7)
    assert frame['image']['name'] == 'colmap-work/images/image_0001.jpg'
    assert frame['camera'] == {'model': 'SIMPLE_RADIAL', 'params': [330., 200., 150., .06], 'pixelConvention': 'colmap-half-pixel'}
    assert frame['frame_id'] == camera_frames.frame_id(sources[1]['sha256'], frame['image']['sha256'], frame['camera'], frame['cam_from_world'])
    world = np.array([.5, .4, 2.]); local = np.asarray(frame['cam_from_world']) @ np.r_[world, 1]
    expected = camera.img_from_cam(image.cam_from_world() * world)
    x, y = local[:2] / local[2]; f, cx, cy, k = frame['camera']['params']; radial = 1 + k * (x * x + y * y)
    assert [f * x * radial + cx, f * y * radial + cy] == pytest.approx(expected, abs=1e-10)
    assert np.linalg.norm(expected - [f * x + cx, f * y + cy]) > .01, 'dropping radial distortion changes this projection'
    changed = copy.deepcopy(associations); changed[1]['sourceSha256'] = '0' * 64
    with pytest.raises(ValueError, match='source hash'):
        sc.camera_frame_records(model, images, changed, sources, tmp_path)
    with (images / 'image_0001.jpg').open('ab') as stream:
        stream.write(b'altered')
    with pytest.raises(ValueError, match='raster changed'):
        sc.camera_frame_records(model, images, associations, sources, tmp_path)


@pytest.mark.parametrize('dense,output_name', [(False, 'output'), (True, 'output'), (False, 'custom-artifacts')])
def test_run_publishes_actual_cloud_hashes_and_ledger_with_authored_mapping_standin(tmp_path, monkeypatch, dense, output_name):
    """Preparation/serialization runs; mapping is an explicit software stand-in."""
    pycolmap = pytest.importorskip('pycolmap')
    from robotics.world_worker import camera_frames
    inputs = []
    for index in range(3):
        source = tmp_path / f'photo-{index}.png'; textured(source, seed=index)
        inputs.append({'path': str(source), 'name': source.name, 'kind': 'image'})
    model = authored_model(tmp_path / 'authored-model', [f'image_{i:04d}.jpg' for i in range(3)], points=30)
    monkeypatch.setattr(pycolmap, 'extract_features', lambda *args, **kwargs: None)
    monkeypatch.setattr(pycolmap, 'match_exhaustive', lambda *args, **kwargs: None)
    monkeypatch.setattr(sc, 'map_frames', lambda *args: ({0: model}, 0, model, [{'seed': 0, 'registered_images': 3, 'models_found': 1}]))
    if dense:
        monkeypatch.setattr(sc.densify, 'load_session', lambda path: None)
        monkeypatch.setattr(sc.densify, 'frames_from_model', lambda *args, **kwargs: ([object()], {'frames': 1}))
        monkeypatch.setattr(sc.densify, 'fuse', lambda frames: (np.array([[i * .01, .1, 3.] for i in range(40)]),
                                                              np.full((40, 3), 100), {'points': 40}))
    out = tmp_path / output_name
    evidence = sc.run({'schema': 'brainsnn.adapter.v1', 'inputs': inputs, 'output_dir': str(out)},
                      densify_model=tmp_path / 'explicit-dense-transport-standin.onnx' if dense else None)
    manifest = json.loads((out / 'manifest.json').read_text())
    assert {'name': 'camera-frames.json', 'kind': 'evidence'} in manifest['artifacts']
    ledger = json.loads((out / 'camera-frames.json').read_text())
    assert camera_frames.validate(ledger, tmp_path)
    assert len(ledger['clouds']) == (2 if dense else 1)
    for cloud in ledger['clouds']:
        assert cloud['sha256'] == hashlib.sha256((tmp_path / cloud['name']).read_bytes()).hexdigest()
    assert {Path(cloud['name']).name for cloud in ledger['clouds']} == ({'dense-preview.ply', 'sparse-preview.ply'} if dense else {'sparse-preview.ply'})
    assert evidence['point_clouds'] == ledger['clouds']
    assert ledger['reconstruction']['sha256'] == hashlib.sha256((out / 'reconstruction.json').read_bytes()).hexdigest()
    assert [frame['origin']['sourceIndex'] for frame in ledger['frames']] == [0, 1, 2]
    assert [c['frame_id'] for c in evidence['cameras']] == [frame['frame_id'] for frame in ledger['frames']]
    assert all((tmp_path / frame['image']['name']).is_file() for frame in ledger['frames'])
    views = camera_frames.load_views(tmp_path, expected_cloud_sha256=ledger['clouds'][0]['sha256'], ledger_path=out / 'camera-frames.json')
    world = np.array([.5, .4, 2.]); local = model.image(3).cam_from_world() * world
    native = model.camera(7).img_from_cam(local)
    assert views[0]['project'](np.array([local]))[0] == pytest.approx(native - .5, abs=1e-10)
    assert not ledger['metric_verified'] and not evidence['physics_ready']
