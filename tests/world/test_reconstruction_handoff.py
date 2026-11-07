"""A GPU adapter's metric reconstruction handed to the scene compiler: validation, the arena cloud it becomes, and the
camera-height scale check. No GPU, no Blender: synthetic room, synthetic cameras."""
import json
import math
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import mapanything_apache  # noqa: E402
import scene_usd  # noqa: E402


def write_room(path: Path, *, size=6.0, height=2.6, step=0.08):
    """An ASCII PLY of a box room (floor, two walls) in a right-handed y-up frame, floor at y = 0."""
    rows = []
    n = int(size / step)
    for i in range(n):
        for j in range(n):
            rows.append((i * step, 0.0, j * step, 120, 120, 120))
    for i in range(n):
        for k in range(int(height / step)):
            rows.append((i * step, k * step, 0.0, 200, 200, 200))
            rows.append((0.0, k * step, i * step, 200, 200, 200))
    with path.open('w', encoding='ascii') as f:
        f.write('ply\nformat ascii 1.0\nelement vertex %d\nproperty float x\nproperty float y\nproperty float z\n'
                'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n' % len(rows))
        for r in rows:
            f.write('%f %f %f %d %d %d\n' % r)
    return len(rows)


def camera(x, y, z):
    return {'view': 0, 'camera_to_world_y_up': [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]],
            'intrinsics_opencv': [[500, 0, 259], [0, 500, 194], [0, 0, 1]]}


def reconstruction(tmp_path: Path, cameras, **overrides):
    out = tmp_path / 'output'
    out.mkdir(exist_ok=True)
    write_room(out / 'dense-preview.ply')
    evidence = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': 'mapanything-apache', 'model': 'facebook/map-anything-apache',
                'model_sha256': 'f' * 64, 'coordinate_frame': 'right-handed-y-up', 'device': 'cuda', 'metric_verified': False,
                'cameras': cameras, **overrides}
    (out / 'reconstruction.json').write_text(json.dumps(evidence))
    return {'schema': 'brainsnn.adapter.v1', 'inputs': [{'kind': 'reconstruction', 'name': 'reconstruction.json', 'path': str(out / 'reconstruction.json')}]}


def test_budgets_default_and_caps():
    assert mapanything_apache.budgets({}) == (12, 100_000)
    assert mapanything_apache.budgets({'max_views': 48, 'preview_points': 700_000}) == (48, 700_000)
    for bad in ({'max_views': 0}, {'max_views': 65}, {'max_views': '12'}, {'preview_points': 5_000_000}, {'max_views': 12, 'preview_points': 11}):
        with pytest.raises(ValueError):
            mapanything_apache.budgets(bad)


def test_handoff_becomes_metric_cloud_with_plausible_camera_height(tmp_path):
    cams = [camera(1.0 + i * 0.3, 1.4 + (i % 2) * 0.05, 2.0) for i in range(6)]
    cloud, source = scene_usd.reconstruction_input(reconstruction(tmp_path, cams))
    assert source['kind'] == 'reconstruction-handoff' and source['views'] == 6 and source['pipeline'] == 'mapanything-apache'
    assert cloud['units'] == 'm' and cloud['multiView'] is True and cloud['scale']['source'] == 'model-metric-estimate'
    assert cloud['scale']['verified'] is False and cloud['scale']['metresPerUnit'] == 1.0
    check = cloud['scale']['cameraHeightCheck']
    assert check['status'] == 'plausible' and check['cameras'] == 6
    assert abs(check['medianM'] - 1.4) < 0.1, check
    assert 1.3 < check['minM'] <= check['maxM'] < 1.55


def test_camera_height_outside_phone_range_is_flagged(tmp_path):
    cams = [camera(1.0 + i * 0.3, 0.35, 2.0) for i in range(4)]
    cloud, _ = scene_usd.reconstruction_input(reconstruction(tmp_path, cams))
    check = cloud['scale']['cameraHeightCheck']
    assert check['status'] == 'implausible' and abs(check['medianM'] - 0.35) < 0.1
    assert 'suspect' in check['note']


def test_rejects_non_metric_or_single_view_or_missing_cloud(tmp_path):
    with pytest.raises(ValueError, match='metric multi-view'):
        scene_usd.reconstruction_input(reconstruction(tmp_path, [camera(0, 1.4, 0)]))
    with pytest.raises(ValueError, match='metric multi-view'):
        scene_usd.reconstruction_input(reconstruction(tmp_path, [camera(0, 1.4, 0), camera(1, 1.4, 0)], pipeline='depth-anything-v2'))
    req = reconstruction(tmp_path, [camera(0, 1.4, 0), camera(1, 1.4, 0)])
    (tmp_path / 'output' / 'dense-preview.ply').unlink()
    with pytest.raises(ValueError, match='dense-preview.ply'):
        scene_usd.reconstruction_input(req)
    assert scene_usd.reconstruction_input({'schema': 'brainsnn.adapter.v1', 'inputs': [{'kind': 'video', 'path': '/x'}]}) is None
