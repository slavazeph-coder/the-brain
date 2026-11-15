"""VGGT benchmark contracts and actual PyCOLMAP math, without GPU/model inference."""
import hashlib
import json
import socket
import subprocess

import numpy as np
from PIL import Image
import pytest

from robotics.world_worker import comparison_vggt as vggt


def cameras():
    poses = np.repeat(np.eye(4)[None, :3], 3, axis=0)
    poses[:, 0, 3] = [.4, 0, -.4]
    k = np.repeat(np.array([[400., 0, 258.25], [0, 420., 259.75], [0, 0, 1]])[None], 3, axis=0)
    names = [f'frame_{i:04d}.jpg' for i in range(3)]
    return names, poses, k


def test_square_transform_preserves_half_pixel_centres_and_odd_padding():
    # A601x400 landscape image gets100px top padding and101px bottom padding.
    a = np.array(vggt.square_transform(601, 400))
    np.testing.assert_allclose(a @ [0, 0, 1], [(.5 * 518 / 601) - .5, 100.5 * 518 / 601 - .5, 1])
    # Compose the exact1024px Pillow stage and518px interpolate stage.
    first = np.array(vggt.square_transform(601, 400, 1024))
    second = np.array(vggt.square_transform(1024, 1024, 518))
    np.testing.assert_allclose(second @ first, a, atol=1e-13)
    portrait = np.array(vggt.square_transform(400, 601))
    np.testing.assert_allclose(portrait[0, 2], a[1, 2])
    np.testing.assert_allclose(portrait[1, 2], a[0, 2])
    assert vggt.square_transform(518, 518) == [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]]


@pytest.mark.parametrize('values', [(0, 1), (True, 500), (500., 500), (100, -1)])
def test_transform_rejects_invalid_dimensions(values):
    with pytest.raises(ValueError):
        vggt.square_transform(*values)


def test_camera_records_keep_model_calibration_and_bound_prepared_affine():
    names, poses, k = cameras()
    records = vggt.camera_records(names, [(1280, 720), (720, 1280), (518, 518)], poses, k)
    assert records[0]['width'] == records[0]['height'] == 518
    assert records[0]['preparedWidth'] == 1280
    assert records[0]['camera'] == {'model': 'PINHOLE', 'params': [400., 420., 258.25, 259.75],
                                     'pixelConvention': 'integer-centres'}
    assert records[0]['cam_from_world'] == poses[0].tolist()
    assert records[0]['preparedToCameraPixelCenter'] == vggt.square_transform(1280, 720)
    assert records[1]['preparedToCameraPixelCenter'] == vggt.square_transform(720, 1280)
    # No principal point recentering and no conversion of world axes.
    assert records[2]['camera']['params'][2:] == [258.25, 259.75]
    assert records[2]['cam_from_world'][0][3] == -.4


@pytest.mark.parametrize('change', ['reflection', 'shear', 'nan', 'skew', 'negative-focal', 'duplicates', 'traversal'])
def test_malformed_output_is_refused_before_native_camera_use(change):
    names, poses, k = cameras()
    if change == 'reflection': poses[0, 0, 0] = -1
    if change == 'shear': poses[0, 0, 1] = .2
    if change == 'nan': poses[0, 2, 3] = np.nan
    if change == 'skew': k[0, 0, 1] = .1
    if change == 'negative-focal': k[0, 0, 0] = -1
    if change == 'duplicates': names[1] = names[0]
    if change == 'traversal': names[0] = '../frame_0000.jpg'
    with pytest.raises(ValueError):
        vggt.camera_records(names, [(518, 518)] * 3, poses, k)


def fixture_checkout(tmp_path, monkeypatch):
    source = tmp_path / 'source'; source.mkdir()
    subprocess.run(['git', 'init', '-q', str(source)], check=True)
    (source / 'README.md').write_text('Authored checkout fixture, no VGGT model code.')
    subprocess.run(['git', '-C', str(source), 'add', 'README.md'], check=True)
    subprocess.run(['git', '-C', str(source), '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                    'commit', '-qm', 'fixture'], check=True)
    revision = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], check=True,
                              capture_output=True, text=True).stdout.strip()
    checkpoint = tmp_path / 'fixture.safetensors'; checkpoint.write_bytes(b'fixture only, not a model')
    monkeypatch.setattr(vggt, 'SOURCE_REVISION', revision)
    monkeypatch.setattr(vggt, 'MODEL_BYTES', checkpoint.stat().st_size)
    monkeypatch.setattr(vggt, 'MODEL_SHA256', hashlib.sha256(checkpoint.read_bytes()).hexdigest())
    return source, checkpoint


def test_preflight_reports_exact_sources_and_never_downloads(tmp_path, monkeypatch):
    source, checkpoint = fixture_checkout(tmp_path, monkeypatch)
    with vggt._offline():
        result = vggt.preflight(source, checkpoint)
    assert result['checkpoint']['repository'] == 'facebook/VGGT-1B-Commercial'
    assert result['checkpoint']['sha256'] == vggt.MODEL_SHA256
    assert result['networkDownloads'] is False
    assert result['paperBenchmarkReproduced'] is False
    assert str(tmp_path) not in json.dumps(result)


@pytest.mark.parametrize('bad', ['dirty-tracked', 'untracked', 'revision', 'hash', 'size', 'symlink'])
def test_preflight_rejects_wrong_or_changed_installation(tmp_path, monkeypatch, bad):
    source, checkpoint = fixture_checkout(tmp_path, monkeypatch)
    if bad == 'dirty-tracked': (source / 'README.md').write_text('Changed model implementation')
    if bad == 'untracked': (source / 'extra.py').write_text('Unreviewed model code')
    if bad == 'revision': monkeypatch.setattr(vggt, 'SOURCE_REVISION', '0' * 40)
    if bad == 'hash': checkpoint.write_bytes(b'X' * checkpoint.stat().st_size)
    if bad == 'size': checkpoint.write_bytes(b'wrong size')
    if bad == 'symlink':
        original = checkpoint; checkpoint = tmp_path / 'model.safetensors'; checkpoint.symlink_to(original)
    with pytest.raises(ValueError):
        vggt.preflight(source, checkpoint)


def test_offline_context_denies_helpers_and_restores_socket_and_environment(monkeypatch):
    monkeypatch.setenv('HF_HUB_OFFLINE', 'existing-value')
    connect, resolve = socket.socket.connect, socket.getaddrinfo
    with vggt._offline():
        import os
        assert os.environ['HF_HUB_OFFLINE'] == '1'
        with pytest.raises(RuntimeError, match='disabled'):
            socket.getaddrinfo('example.invalid', 443)
        with socket.socket() as connection:
            with pytest.raises(RuntimeError, match='disabled'):
                connection.connect(('127.0.0.1', 1))
    import os
    assert os.environ['HF_HUB_OFFLINE'] == 'existing-value'
    assert socket.socket.connect is connect and socket.getaddrinfo is resolve


def test_shared_images_have_exact_hashes_and_are_readonly(tmp_path):
    for i in range(3):
        Image.new('RGB', (600, 400), (30 + i, 50, 80)).save(tmp_path / f'frame_{i:04d}.jpg')
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    paths, sizes, records = vggt._images(tmp_path)
    assert sizes == [(600, 400)] * 3
    assert [r['image'] for r in records] == [p.name for p in paths]
    assert all(r['sha256'] == hashlib.sha256(before[r['image']]).hexdigest() for r in records)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    (tmp_path / 'surprise.txt').write_text('No invisible extra input')
    with pytest.raises(ValueError): vggt._images(tmp_path)


def bundle_fixture():
    names, poses, k = cameras()
    rng = np.random.default_rng(5)
    points = rng.uniform([-.6, -.4, 3.], [.6, .4, 5.], size=(50, 3))
    pixels, _depths = vggt._projection(points, poses, k)
    return names, points, np.full((50, 3), [20, 30, 40], dtype=np.uint8), poses, k, pixels, np.ones((3, 50)), np.ones((3, 50))


def test_actual_pycolmap_bundle_preserves_half_pixel_calibration_and_observations():
    pytest.importorskip('pycolmap')
    names, points, colours, poses, k, tracks, visibility, confidence = bundle_fixture()
    reconstruction, summary = vggt.build_bundle(points, colours, poses, k, tracks, visibility, confidence, names=names)
    assert reconstruction.num_reg_images() == 3
    assert reconstruction.num_points3D() == 50
    assert reconstruction.compute_num_observations() == 150
    assert summary['observationsPerFrame'] == [50, 50, 50]
    for i in range(3):
        image = reconstruction.image(i + 1)
        camera = reconstruction.camera(image.camera_id)
        np.testing.assert_allclose(camera.calibration_matrix()[:2, 2], k[i, :2, 2] + .5)
        np.testing.assert_allclose(np.array([p.xy for p in image.points2D]), tracks[i] + .5)
        projected = camera.img_from_cam(points @ poses[i, :, :3].T + poses[i, :, 3]) - .5
        np.testing.assert_allclose(projected, tracks[i], atol=1e-12)
        np.testing.assert_allclose(image.cam_from_world().matrix(), poses[i], atol=1e-12)


def test_actual_bounded_pycolmap_ba_reduces_authored_noisy_fit_without_metrology_claim():
    pytest.importorskip('pycolmap')
    names, points, colours, poses, k, tracks, visibility, confidence = bundle_fixture()
    rng = np.random.default_rng(7)
    initial = points + rng.normal(0, .008, points.shape)
    reconstruction, _summary = vggt.build_bundle(initial, colours, poses, k, tracks, visibility, confidence, names=names)
    # compute_mean_reprojection_error uses cached errors until updated.
    def residual():
        distances = []
        for identifier in reconstruction.reg_image_ids():
            image = reconstruction.image(identifier)
            camera = reconstruction.camera(image.camera_id)
            for observation in image.points2D:
                if observation.has_point3D():
                    p = reconstruction.point3D(observation.point3D_id).xyz
                    projected = camera.img_from_cam(image.cam_from_world() * p)
                    distances.append(np.linalg.norm(projected - observation.xy))
        return np.mean(distances)
    before = residual()
    report = vggt.refine_bundle(reconstruction)
    assert residual() < before * .01
    assert report['meanReprojectionErrorPixels'] == pytest.approx(residual(), rel=1e-7, abs=1e-8)
    assert report['gauge'] == 'TWO_CAMS_FROM_WORLD'
    assert report['maxSeconds'] == 300
    assert report['principalPointRefined'] is False
    assert 'metricVerified' not in report  # Native fit is not metric validation.


@pytest.mark.parametrize('bad', ['badshape', 'nonfinite', 'visibility', 'confidence', 'behind', 'inconsistent', 'few'])
def test_invalid_or_insufficient_tracks_fail_without_silent_unrefined_ba(bad):
    pytest.importorskip('pycolmap')
    names, points, colours, poses, k, tracks, visibility, confidence = bundle_fixture()
    if bad == 'badshape': tracks = tracks[:, :, :1]
    if bad == 'nonfinite': tracks[0, 0, 0] = np.nan
    if bad == 'visibility': visibility[:] = 0
    if bad == 'confidence': confidence[:] = 0
    if bad == 'behind': points[:, 2] = -1
    if bad == 'inconsistent': tracks += 100
    if bad == 'few':
        visibility[:, 2:] = 0
    with pytest.raises(ValueError):
        vggt.build_bundle(points, colours, poses, k, tracks, visibility, confidence, names=names)
