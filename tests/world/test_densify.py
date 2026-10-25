"""Dense CPU points without the model: python -m pytest tests/world/test_densify.py

A synthetic room seen by four cameras, where the "model" disparity is the true inverse depth under a per-frame scale
and shift. One frame also invents a surface that its neighbours do not see."""
from pathlib import Path
import math
import sys
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker import densify as dn

W, H, F = 96, 72, 80.0
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1.0]])


def look(centre, yaw):
    """cam_from_world (3×4) for a camera at `centre` turned `yaw` radians about the vertical (y down in COLMAP)."""
    c, s = math.cos(yaw), math.sin(yaw)
    R = np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])
    return np.hstack([R, (-R @ np.asarray(centre, float))[:, None]])


def true_depth(M):
    """Depth of a room: the plane z = 6 (a wall) and the floor y = 1.5, from the camera with pose M."""
    rows, cols = np.mgrid[0:H, 0:W]
    rays = np.stack([(cols + .5 - K[0, 2]) / F, (rows + .5 - K[1, 2]) / F, np.ones((H, W))], -1)
    R, t = M[:, :3], M[:, 3]; origin = -R.T @ t; dirs = rays @ R
    hits = []
    for normal, offset in (((0, 0, 1), 6.0), ((0, 1, 0), 1.5)):
        n = np.array(normal, float); denom = dirs @ n
        lam = np.where(np.abs(denom) > 1e-9, (offset - origin @ n) / np.where(np.abs(denom) > 1e-9, denom, 1), np.inf)
        hits.append(np.where(lam > 0, lam, np.inf))
    return np.minimum(*hits)  # ray parameter = depth along the camera's z because rays have z = 1 in camera space


def frame(centre, yaw, s, t, invent=False):
    M = look(centre, yaw); z = true_depth(M)
    disparity = (1 / z - t) / s
    if invent: disparity[10:30, 10:40] = (1 / 2.0 - t) / s  # a surface 2 m away that is not there
    return M, z, disparity


def aligned(M, z, disparity):
    rng = np.random.default_rng(0); rows, cols = rng.integers(0, H, 200), rng.integers(0, W, 200)
    s, t, error, n = dn.fit_inverse_depth(disparity[rows, cols], z[rows, cols])
    return {'z': dn.depth_map(disparity, s, t, (0.5, 50)), 'K': K, 'cam_from_world': M, 'rgb': np.full((H, W, 3), 128, np.uint8),
            'centre': -M[:, :3].T @ M[:, 3]}


def test_the_fit_recovers_each_frames_scale_and_shift():
    M, z, disparity = frame((0, 0, 0), 0.0, s=0.37, t=0.02)
    rows, cols = np.mgrid[0:H:6, 0:W:6]
    s, t, error, n = dn.fit_inverse_depth(disparity[rows, cols].ravel(), z[rows, cols].ravel())
    assert math.isclose(1 / s, 1 / 0.37, rel_tol=1e-6) and math.isclose(t, 0.02, abs_tol=1e-9) and error < 1e-9
    assert dn.fit_inverse_depth([1.0] * 5, [2.0] * 5) is None  # too few points
    assert dn.fit_inverse_depth(np.linspace(0, 1, 50), np.linspace(1, 5, 50)) is None  # depth order reversed: slope ≤ 0


def test_fused_points_lie_on_the_room_and_an_invented_surface_is_dropped():
    frames = [aligned(*frame(c, y, s, t, invent=(i == 0))) for i, (c, y, s, t) in enumerate(
        [((0, 0, 0), 0.0, .5, .01), ((.4, 0, .1), -.05, .8, .03), ((-.4, 0, .1), .05, .3, .0), ((0, -.2, -.3), 0.0, 1.2, .02)])]
    points, colours, stats = dn.fuse(frames, stride=2, neighbours=3, min_agree=2, tolerance=0.02)
    assert stats['confirmed'] > 2000 and len(points) == stats['points'] <= 50_000
    on_wall, on_floor = np.abs(points[:, 2] - 6.0) < 0.05, np.abs(points[:, 1] - 1.5) < 0.05
    assert (on_wall | on_floor).mean() > 0.99
    assert not np.any(np.abs(points[:, 2] - 2.0) < 0.3), 'the surface only frame 0 saw was not confirmed'


def test_fusion_thins_to_the_point_budget():
    frames = [aligned(*frame(c, 0.0, .5, .01)) for c in ((0, 0, 0), (.2, 0, 0), (-.2, 0, 0))]
    points, _, stats = dn.fuse(frames, stride=1, neighbours=2, min_agree=1, max_points=1500)
    assert len(points) <= 1500 and stats['voxel'] > 0 and stats['confirmed'] > 1500


def test_model_input_matches_the_processor_and_a_wrong_file_is_refused(tmp_path):
    assert dn.model_size(1280, 852) == (784, 518) and dn.model_size(852, 1280) == (518, 784)
    fake = tmp_path / 'model.onnx'; fake.write_bytes(b'not the pinned model')
    pytest.importorskip('onnxruntime')
    with pytest.raises(RuntimeError, match='is not the pinned'):
        dn.load_session(fake)


class Radial:
    """A SIMPLE_RADIAL-like lens (pycolmap's cam_from_img / img_from_cam) at map resolution: strong k so a pinhole is wrong."""
    def __init__(self, k=0.15): self.k = k
    def img_from_cam(self, cam):
        x, y = cam[:, 0] / cam[:, 2], cam[:, 1] / cam[:, 2]; d = 1 + self.k * (x * x + y * y)
        return np.stack([F * x * d + W / 2, F * y * d + H / 2], 1)
    def cam_from_img(self, uv):
        xd, yd = (uv[:, 0] - W / 2) / F, (uv[:, 1] - H / 2) / F; x, y = xd.copy(), yd.copy()
        for _ in range(20): d = 1 + self.k * (x * x + y * y); x, y = xd / d, yd / d
        return np.stack([x, y], 1)


def test_lens_distortion_is_carried_through_lifting_and_reprojection():
    lens = Radial(); rows, cols = np.mgrid[0:H, 0:W]
    rays = lens.cam_from_img(np.stack([cols.ravel() + .5, rows.ravel() + .5], 1)).reshape(H, W, 2)
    def distorted(centre, yaw, s, t):
        M = look(centre, yaw); R, tvec = M[:, :3], M[:, 3]; origin = -R.T @ tvec
        dirs = np.concatenate([rays, np.ones((H, W, 1))], -1) @ R  # the true ray through each (distorted) pixel
        hits = []
        for normal, offset in (((0, 0, 1), 6.0), ((0, 1, 0), 1.5)):
            n = np.array(normal, float); denom = dirs @ n
            lam = np.where(np.abs(denom) > 1e-9, (offset - origin @ n) / np.where(np.abs(denom) > 1e-9, denom, 1), np.inf)
            hits.append(np.where(lam > 0, lam, np.inf))
        z = np.minimum(*hits); frame = aligned(M, z, (1 / z - t) / s)
        frame.update(rays=rays, project=lambda cam: lens.img_from_cam(cam)); return frame
    frames = [distorted(c, y, s, t) for c, y, s, t in [((0, 0, 0), 0.0, .5, .01), ((.4, 0, .1), -.05, .8, .03), ((-.4, 0, .1), .05, .3, 0.), ((0, -.2, -.3), 0., 1.2, .02)]]
    off_room = lambda P: np.minimum(np.abs(P[:, 2] - 6.0), np.abs(P[:, 1] - 1.5))  # distance to the nearer true surface
    points, _, stats = dn.fuse(frames, stride=2, neighbours=3, min_agree=2, tolerance=0.02)
    assert stats['confirmed'] > 2000 and np.percentile(off_room(points), 95) < 0.005
    pinhole = [{k: v for k, v in f.items() if k not in ('rays', 'project')} for f in frames]
    p2, _, _ = dn.fuse(pinhole, stride=2, neighbours=3, min_agree=2, tolerance=0.02)
    assert np.percentile(off_room(p2), 95) > 0.03, 'ignoring the lens bends the room'
