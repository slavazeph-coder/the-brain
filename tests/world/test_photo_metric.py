"""One photo to a 3D preview in estimated metres: the camera solve, edge removal and the adapter contract. The depth model
is a stand-in returning an exact, known scene; accuracy on real photos is measured on ETH3D (photo_metric.py, docs)."""
import json

import numpy as np
from PIL import Image
import pytest

from robotics.world_worker import photo_metric as pm

FOV = 70.0  # the stand-in camera's horizontal field of view


class StandIn:
    """Answers like the MoGe-2 ONNX export for a scene at depth(u, v) metres: points divided by `scale` and shifted."""

    def __init__(self, depth, scale=1.8, shift=.4, mask=None):
        self.depth, self.scale, self.shift, self.mask = depth, scale, shift, mask

    def run(self, outputs, feed):
        height, width = feed['image'].shape[2:]
        u, v = np.meshgrid(np.arange(width) - (width - 1) / 2, np.arange(height) - (height - 1) / 2)
        focal = width / 2 / np.tan(np.radians(FOV / 2))
        z = self.depth(u, v)
        points = np.stack([u * z / focal, v * z / focal, z], -1) / self.scale
        points[..., 2] -= self.shift
        mask = np.ones((height, width)) if self.mask is None else self.mask(u, v)
        return [points[None].astype(np.float32), None, mask[None].astype(np.float32), np.array([self.scale], np.float32)]


def floor_and_wall(u, v):
    return 2.5 + .004 * (v + 300)  # smooth: nearer towards the bottom of the photo, like a floor running to a wall


def test_the_unknown_camera_and_shift_are_solved_together():
    session = StandIn(floor_and_wall)
    points, keep, camera = pm.metric_points(session, np.zeros((392, 588, 3), np.uint8))
    u, v = np.meshgrid(np.arange(588) - 293.5, np.arange(392) - 195.5)
    assert keep.mean() > .95
    assert np.allclose(points[..., 2][keep], floor_and_wall(u, v)[keep], rtol=1e-3)
    assert 2 * np.degrees(np.arctan(588 / 2 / camera['focal_pixels'])) == pytest.approx(FOV, abs=.2)


def test_depth_edges_drop_pixels_that_straddle_two_surfaces():
    depth = np.full((20, 20), 2.0); depth[:, 10:] = 5.0
    edges = pm.depth_edges(depth)
    assert edges[:, 9:11].all() and not edges[:, :8].any() and not edges[:, 12:].any()


def photo(tmp_path, size=(640, 480)):
    path = tmp_path / 'room.jpg'
    Image.fromarray(np.random.default_rng(3).integers(30, 220, (size[1], size[0], 3), dtype=np.uint8)).save(path)
    return {'path': str(path), 'name': path.name, 'kind': 'image'}


def test_a_photo_becomes_a_labelled_preview_in_estimated_metres(tmp_path, monkeypatch):
    # The left quarter is sky to the model: no geometry, so no points there.
    session = StandIn(floor_and_wall, mask=lambda u, v: (u > -u.max() / 2).astype(float))
    monkeypatch.setattr(pm.metric_scale, 'load_session', lambda path, threads: session)
    out = tmp_path / 'job' / 'output'
    evidence = pm.run({'schema': 'brainsnn.adapter.v1', 'inputs': [photo(tmp_path)], 'output_dir': str(out)}, tmp_path / 'model.onnx')
    stored = json.loads((out / 'photo-metric.json').read_text())
    assert stored == evidence and stored['schema'] == 'brainsnn.photo-metric.v1'
    assert stored['measured'] is False and stored['metric_verified'] is False and stored['generative'] is False
    assert stored['collision_ready'] is False and 'not measured' in stored['label'].lower() and 'only surfaces the photo shows' in stored['hidden_surfaces']
    assert stored['camera']['estimated_horizontal_fov_degrees'] == pytest.approx(FOV, abs=.3)
    assert 2.5 < stored['depth_metres']['median'] < 4 and stored['depth_metres']['p5'] < stored['depth_metres']['p95']
    assert stored['model']['license'] == 'MIT' and stored['model']['repo'] == pm.metric_scale.MODEL['repo']
    manifest = json.loads((out / 'manifest.json').read_text())
    cloud = manifest['artifacts'][0]
    assert cloud['name'] == 'photo-metric.ply' and cloud['kind'] == 'visual' and cloud['coordinate_frame'] == 'right-handed-y-up'
    assert cloud['units'] == 'arbitrary', 'estimated metres are never declared measured units'
    assert {'name': 'photo-metric.json', 'kind': 'evidence'} in manifest['artifacts']
    # Camera at the origin looking down -z, y up: every point is in front of the camera; none from the masked sky.
    assert cloud['bounds']['max'][2] < 0 and stored['points']['dropped_as_no_geometry_or_edges'] > .2 * stored['points']['kept']


def test_one_photo_only_and_only_the_pinned_model(tmp_path):
    base = {'schema': 'brainsnn.adapter.v1', 'output_dir': str(tmp_path / 'out')}
    with pytest.raises(ValueError, match='exactly one photo'):
        pm.run({**base, 'inputs': [photo(tmp_path), photo(tmp_path)]}, tmp_path / 'model.onnx')
    with pytest.raises(ValueError, match='exactly one photo'):
        pm.run({**base, 'inputs': [{'path': 'walk.mp4', 'name': 'walk.mp4', 'kind': 'video'}]}, tmp_path / 'model.onnx')
    other = tmp_path / 'model.onnx'; other.write_bytes(b'other weights')
    with pytest.raises(RuntimeError, match='not the pinned'):
        pm.run({**base, 'inputs': [photo(tmp_path)]}, other)
    assert not (tmp_path / 'out').exists()


def test_a_photo_the_model_cannot_place_is_refused_with_the_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(pm.metric_scale, 'load_session', lambda path, threads: StandIn(floor_and_wall, mask=lambda u, v: 0 * u))
    with pytest.raises(ValueError, match='too little geometry'):
        pm.run({'schema': 'brainsnn.adapter.v1', 'inputs': [photo(tmp_path)], 'output_dir': str(tmp_path / 'out')}, tmp_path / 'm.onnx')
