"""LingBot-Map adapter on CPU, without the checkpoint.

A small textured room is ray-cast with numpy from known cameras, so the conventions (camera-to-world OpenCV poses,
integer pixel centres, principal point at W/2, H/2), the Y-up output and the turn check run against exact geometry and
real image matches. The model stand-in returns that exact geometry; nothing here measures LingBot-Map's accuracy,
which needs the GPU qualification in docs/hermes-gpu-tasks.md. The last test runs the real architecture with random
weights where torch and lingbot_map are installed, to check the API the adapter calls.
"""
from pathlib import Path
import json
import math
import sys

import numpy as np
from PIL import Image
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker import camera_frames, lingbot_map_stream as lm
from robotics.world_worker.mapanything_apache import file_hash

BOX = np.array([[-3., -1.5, -4.], [3., 1.5, 4.]])  # world x right, y down, z forward (OpenCV-like), metres
SIZE = (240, 320)  # rows, columns


def textures(seed=7):
    """One distinct texture per face: coarse blocks for corners plus fine noise, never the same pattern twice."""
    rng = np.random.default_rng(seed)
    faces = []
    for _ in range(6):
        coarse = np.kron(rng.integers(0, 256, (24, 24, 3)), np.ones((16, 16, 1)))
        fine = np.kron(rng.integers(-40, 40, (96, 96, 3)), np.ones((4, 4, 1)))
        faces.append(np.clip(coarse + fine, 0, 255).astype(np.uint8))
    return faces


def yaw(angle_degrees, centre):
    """Camera-to-world pose turned about the vertical (world y) axis, standing at centre."""
    a = math.radians(angle_degrees)
    pose = np.eye(4)
    pose[:3, :3] = [[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]]
    pose[:3, 3] = centre
    return pose


def intrinsics(height=SIZE[0], width=SIZE[1], focal=260.):
    return np.array([[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1.]])


def render(poses, K, faces=None):
    """Ray-cast the box room: integer pixel centres, depth along the optical axis, and each pixel's world hit."""
    faces = textures() if faces is None else faces
    height, width = SIZE
    u, v = np.meshgrid(np.arange(width), np.arange(height))
    local = np.stack([(u - K[0, 2]) / K[0, 0], (v - K[1, 2]) / K[1, 1], np.ones_like(u, float)], -1)
    rasters, depths, hits = [], [], []
    for pose in poses:
        direction = local @ pose[:3, :3].T
        origin = pose[:3, 3]
        bound = np.where(direction > 0, BOX[1], BOX[0])
        with np.errstate(divide='ignore'):
            exits = np.where(np.abs(direction) > 1e-12, (bound - origin) / direction, np.inf)
        axis = exits.argmin(-1)
        t = exits.min(-1)
        hit = origin + direction * t[..., None]
        pixels = np.zeros((height, width, 3), np.uint8)
        for a in range(3):
            for side in range(2):
                face = faces[2 * a + side]
                mask = (axis == a) & ((direction[..., a] > 0) == bool(side))
                s_axis, t_axis = [b for b in range(3) if b != a]
                s = (hit[..., s_axis] - BOX[0, s_axis]) / (BOX[1, s_axis] - BOX[0, s_axis])
                r = (hit[..., t_axis] - BOX[0, t_axis]) / (BOX[1, t_axis] - BOX[0, t_axis])
                rows = np.clip((r * (face.shape[0] - 1)).round().astype(int), 0, face.shape[0] - 1)
                cols = np.clip((s * (face.shape[1] - 1)).round().astype(int), 0, face.shape[1] - 1)
                pixels[mask] = face[rows[mask], cols[mask]]
        rasters.append(pixels); depths.append(t); hits.append(hit)
    return np.stack(rasters), np.stack(depths), np.stack(hits)


def walk(count=10):
    """A slow walk down the room, turning a little: about 0.3 m and 3 degrees between frames."""
    return [yaw(-12 + 3 * i, [-1.2 + .1 * i, .2, -2.5 + .3 * i]) for i in range(count)]


def model_output(poses, K, depths):
    return {'extrinsic': np.stack([pose[:3] for pose in poses]), 'intrinsic': np.stack([K] * len(poses)),
            'depth': depths[..., None], 'depth_conf': np.full(depths.shape, 3.)}


def test_model_crop_matches_the_pinned_loader_arithmetic():
    width, height, transform, dropped = lm.model_crop(1280, 720)
    assert (width, height, dropped) == (518, 294, 0)
    # Pillow maps pixel centres by (x + .5) * scale - .5: the first and last prepared centres land half a model pixel in.
    sx, sy = 518 / 1280, 294 / 720
    assert np.allclose(np.array(transform) @ [0, 0, 1], [(sx - 1) / 2, (sy - 1) / 2, 1])
    assert np.allclose(np.array(transform) @ [1279, 719, 1], [518 - .5 - sx / 2, 294 - .5 - sy / 2, 1])
    width, height, transform, dropped = lm.model_crop(720, 1280)
    resized = round(1280 * 518 / 720 / 14) * 14
    assert (width, height, dropped) == (518, 518, resized - 518), 'a portrait frame is centre-cropped to a square'
    assert np.isclose(transform[1][2], (resized / 1280 - 1) / 2 - (resized - 518) // 2)


def test_cameras_keep_pose_and_calibration_and_reject_non_rigid_or_off_centre_ones():
    poses, K = walk(3), intrinsics()
    cameras = lm.cameras_from_predictions(np.stack([p[:3] for p in poses]), np.stack([K] * 3), SIZE)
    assert all(np.allclose(c['camera_to_world'], p) and np.allclose(c['K'], K) for c, p in zip(cameras, poses))
    bad = []
    reflected = np.stack([p[:3] for p in poses]); reflected[0, :, 0] *= -1; bad.append((reflected, np.stack([K] * 3)))
    sheared = np.stack([p[:3] for p in poses]); sheared[1, 0, 1] += .2; bad.append((sheared, np.stack([K] * 3)))
    shifted = np.stack([K] * 3).copy(); shifted[2, 0, 2] += 5; bad.append((np.stack([p[:3] for p in poses]), shifted))
    skewed = np.stack([K] * 3).copy(); skewed[0, 0, 1] = 1; bad.append((np.stack([p[:3] for p in poses]), skewed))
    nan = np.stack([p[:3] for p in poses]); nan[2, 0, 3] = np.nan; bad.append((nan, np.stack([K] * 3)))
    for extrinsic, intrinsic in bad:
        with pytest.raises(ValueError):
            lm.cameras_from_predictions(extrinsic, intrinsic, SIZE)


def test_depth_through_each_camera_lands_on_the_surface_that_pixel_saw():
    poses, K = walk(3), intrinsics()
    _, depths, hits = render(poses, K)
    cameras = lm.cameras_from_predictions(np.stack([p[:3] for p in poses]), np.stack([K] * 3), SIZE)
    assert np.allclose(lm.world_points(depths[..., None], cameras), hits, atol=1e-9)


def test_preview_flips_to_y_up_drops_unconfident_points_and_keeps_the_budget():
    poses, K = walk(2), intrinsics()
    rasters, depths, hits = render(poses, K)
    confidence = np.full(depths.shape, 3.)
    confidence[0, :, :40] = 1.2  # below the upstream visibility threshold
    depths[1, 0, 0] = np.nan
    points, colours, counts = lm.preview(hits, depths, confidence, rasters, max_points=2000)
    assert len(points) <= 2000 and colours.dtype == np.uint8 and len(colours) == len(points)
    assert counts[0]['confident_points'] <= SIZE[0] * (SIZE[1] - 40)
    assert counts[1]['confident_points'] < SIZE[0] * SIZE[1]
    # Y-up: the floor (world y = +1.5, OpenCV down) becomes y = -1.5.
    assert points[:, 1].min() >= -1.5 - 1e-9 and points[:, 1].max() <= 1.5 + 1e-9
    assert np.isclose(points[:, 1].min(), -1.5, atol=1e-6)
    with pytest.raises(ValueError):
        lm.preview(hits, depths, np.zeros(depths.shape), rasters)


def test_two_view_turn_recovers_the_turn_and_refuses_a_camera_turning_on_the_spot():
    rng = np.random.default_rng(3)
    K = intrinsics()
    world = np.column_stack([rng.uniform(-2.5, 2.5, 200), rng.uniform(-1.2, 1.2, 200), rng.uniform(3, 6, 200)])
    def pixels(pose):
        local = (world - pose[:3, 3]) @ pose[:3, :3]
        return (local[:, :2] / local[:, 2:]) * K[0, 0] + K[:2, 2]
    first, second = yaw(0, [0, 0, 0]), yaw(6, [.4, 0, .2])
    R, inliers = lm.two_view_turn(pixels(first), pixels(second), K, K)
    expected = second[:3, :3].T @ first[:3, :3]
    assert inliers >= 150 and lm.angle_between(R, expected) < .2
    R, reason = lm.two_view_turn(pixels(first), pixels(yaw(6, [0, 0, 0])), K, K)
    assert R is None and reason == 'planar or turning on the spot'


def test_turn_check_passes_the_true_walk_and_catches_one_jumped_pose():
    poses, K = walk(10), intrinsics()
    rasters, _, _ = render(poses, K)
    names = [f'image_{i:04d}.jpg' for i in range(10)]
    true = lm.cameras_from_predictions(np.stack([p[:3] for p in poses]), np.stack([K] * 10), SIZE)
    record = lm.turn_check(true, rasters, names)
    assert record['status'] == 'consistent' and record['pairsChecked'] >= 7
    assert record['worstDisagreementDegrees'] < 2
    # The model turns frames 6-9 by another 40 degrees: the walk itself never did.
    jumped = [p if i < 6 else p @ yaw(40, [0, 0, 0]) for i, p in enumerate(poses)]
    cameras = lm.cameras_from_predictions(np.stack([p[:3] for p in jumped]), np.stack([K] * 10), SIZE)
    record = lm.turn_check(cameras, rasters, names)
    assert record['status'] == 'folded' and record['pairsDisagreeing'] == 1
    assert record['disagreeing'][0]['from'] == 'image_0005.jpg' and record['disagreeing'][0]['disagreementDegrees'] > 35


def job(tmp_path, poses, K):
    """A prepared job: frames as colmap-sparse would write them, plus the model stand-in's output."""
    rasters, depths, _ = render(poses, K)
    root, out = tmp_path / 'job', tmp_path / 'job' / 'output'
    images = root / 'lingbot-images'; images.mkdir(parents=True); out.mkdir()
    video = tmp_path / 'walk.mp4'; video.write_bytes(b'stand-in video bytes')
    sources = [{'name': 'walk.mp4', 'kind': 'video', 'sha256': file_hash(video)}]
    preparations, paths = [], []
    for i, pixels in enumerate(rasters):
        path = images / f'image_{i:04d}.jpg'
        Image.fromarray(pixels).save(path, quality=95)
        preparations.append({'image': path.name, 'sourceIndex': 0, 'sourceSha256': sources[0]['sha256'],
                             'sourceWidth': SIZE[1], 'sourceHeight': SIZE[0], 'exifOrientation': None,
                             'sourceToFramePixelCenter': None, 'timestamp': None,
                             'preparation': {'width': SIZE[1], 'height': SIZE[0], 'preparedSha256': file_hash(path)}})
        paths.append(path)
    crops = [lm.model_crop(SIZE[1], SIZE[0])] * len(paths)
    prepared = (sources, {'duration_seconds': 4.0, 'frames': preparations}, preparations, paths, crops)
    return root, out, prepared, model_output(poses, K, depths), rasters


def test_published_job_binds_cameras_cloud_and_frames_and_projects_back_to_the_pixel(tmp_path):
    poses, K = walk(8), intrinsics()
    root, out, prepared, predictions, rasters = job(tmp_path, poses, K)
    evidence = lm.publish(out, prepared, predictions, rasters, run_record={'device': 'test'})
    assert evidence['pipeline'] == 'lingbot-map-stream' and evidence['metric_verified'] is False
    assert evidence['capture']['consistency']['status'] == 'consistent'
    assert 'frames' not in evidence['capture'] and evidence['capture']['registered_images'] == 8
    camera = evidence['cameras'][3]
    flip = np.diag([1., -1., -1., 1.])
    assert np.allclose(camera['camera_to_world_y_up'], flip @ poses[3] @ flip)
    assert np.allclose(camera['camera_center'], (flip @ poses[3])[:3, 3]) and camera['image'] == 'image_0003.jpg'
    manifest = json.loads((out / 'manifest.json').read_text())
    assert [a['name'] for a in manifest['artifacts']] == ['dense-preview.ply', 'reconstruction.json', 'camera-frames.json']
    views = camera_frames.load_views(root, ledger_path='output/camera-frames.json')
    assert len(views) == 8
    # A wall point seen at pixel (200, 150) of frame 3, in the published Y-up frame, projects back onto that pixel.
    _, _, hits = render([poses[3]], K)
    world = flip[:3, :3] @ hits[0, 150, 200]
    local = views[3]['cam_from_world'] @ np.append(world, 1)
    assert np.allclose(views[3]['project'](local[None])[0], [200, 150], atol=1e-6)


@pytest.mark.parametrize('corruption', ['source_hash', 'prepared_hash', 'prepared_name', 'source_index'])
def test_mismatched_frames_fail_before_any_private_raster_is_written(tmp_path, corruption):
    poses, K = walk(4), intrinsics()
    root, out, prepared, predictions, rasters = job(tmp_path, poses, K)
    prep = prepared[2][1]
    if corruption == 'source_hash':
        prep['sourceSha256'] = '0' * 64
    elif corruption == 'prepared_hash':
        prep['preparation']['preparedSha256'] = '0' * 64
    elif corruption == 'prepared_name':
        prep['image'] = 'another.jpg'
    else:
        prep['sourceIndex'] = 1
    with pytest.raises(ValueError):
        lm.publish(out, prepared, predictions, rasters, run_record={})
    assert not (root / 'lingbot-frames').exists()


def test_installation_refuses_before_loading_anything(monkeypatch, tmp_path):
    for name in ['WORLD_LINGBOT_SOURCE_DIR', 'WORLD_LINGBOT_MODEL_PATH']:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(RuntimeError, match='set WORLD_LINGBOT_SOURCE_DIR'):
        lm.local_installation()
    checkpoint = tmp_path / 'lingbot-map.pt'; checkpoint.write_bytes(b'not the checkpoint')
    monkeypatch.setenv('WORLD_LINGBOT_SOURCE_DIR', str(tmp_path)); monkeypatch.setenv('WORLD_LINGBOT_MODEL_PATH', str(checkpoint))
    with pytest.raises(Exception):
        lm.local_installation()  # tmp_path is not the pinned, clean source checkout
    monkeypatch.setattr(lm, 'verify_source', lambda path, revision: None)
    with pytest.raises(RuntimeError, match='not pinned yet'):
        lm.local_installation()
    monkeypatch.setattr(lm, 'MODEL_SHA256', 'a' * 64)
    with pytest.raises(RuntimeError, match='does not match the pinned checkpoint'):
        lm.local_installation()


def test_model_lineup_is_one_video_or_three_to_twelve_ordered_photos(tmp_path):
    out = tmp_path / 'job' / 'output'; out.mkdir(parents=True)
    for items in ([], [{'kind': 'image'}] * 2, [{'kind': 'image'}] * 13, [{'kind': 'video'}] * 2,
                  [{'kind': 'video'}, {'kind': 'image'}, {'kind': 'image'}]):
        with pytest.raises(ValueError):
            lm.prepare(items, out)
    assert not (tmp_path / 'job' / 'lingbot-images').exists()


def test_real_architecture_returns_what_the_adapter_reads():
    """Random weights, CPU, three small frames: the pinned API's keys, shapes and camera conventions, not geometry."""
    torch = pytest.importorskip('torch')
    pytest.importorskip('lingbot_map')
    poses, K = walk(3), intrinsics()
    rasters, _, _ = render(poses, K)
    images = torch.from_numpy(rasters[:, :112, :154].copy()).permute(0, 3, 1, 2).float() / 255
    model = lm.load_model(torch, None, 'sdpa', torch.device('cpu'))
    predictions = lm.infer(torch, model, images, torch.device('cpu'))
    assert tuple(predictions['extrinsic'].shape) == (3, 3, 4) and tuple(predictions['intrinsic'].shape) == (3, 3, 3)
    assert tuple(predictions['depth'].shape) == (3, 112, 154, 1) and tuple(predictions['depth_conf'].shape) == (3, 112, 154)
    assert np.allclose(predictions['intrinsic'][:, :2, 2].numpy(), [154 / 2, 112 / 2])
    rotation = predictions['extrinsic'][:, :, :3].numpy()
    assert np.allclose(rotation @ rotation.transpose(0, 2, 1), np.eye(3), atol=1e-4), 'decoded poses are rigid even untrained'
