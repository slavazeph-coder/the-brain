"""The estimated metric scale: the depth shift, the ratio at the reconstruction's own points, and the adapter contract.
The depth model is a stand-in that returns an exact, known scene; accuracy on real photos is measured on ETH3D (see
metric_scale.py), not here."""
import json

import numpy as np
from PIL import Image
import pytest

from robotics.world_worker import metric_scale as ms

FOCAL, WIDTH, HEIGHT = 330.0, 400, 300  # the authored camera, in source pixels


class StandIn:
    """Answers like the MoGe-2 ONNX export for a scene whose true depth is depth(u, v) metres at model pixel (u, v):
    points scaled down by `scale` and shifted along the viewing axis by `shift`, as the model's affine output is."""

    def __init__(self, depth, scale=2.5, shift=.3, mask=None):
        self.depth, self.scale, self.shift, self.mask, self.calls = depth, scale, shift, mask, []

    def run(self, outputs, feed):
        height, width = feed['image'].shape[2:]
        self.calls.append((width, height, int(feed['num_tokens'])))
        diagonal = (width * width + height * height) ** .5
        u, v = np.meshgrid(np.arange(width) - (width - 1) / 2, np.arange(height) - (height - 1) / 2)
        focal = FOCAL * width / WIDTH
        z = self.depth(u, v)
        points = np.stack([u * z / focal, v * z / focal, z], -1) / self.scale
        points[..., 2] -= self.shift
        mask = np.ones((height, width)) if self.mask is None else self.mask(u, v)
        return [points[None].astype(np.float32), None, mask[None].astype(np.float32), np.array([self.scale], np.float32)]


def test_the_shift_is_the_one_that_projects_through_the_known_focal():
    session = StandIn(lambda u, v: 1.5 + .004 * (u + 200) + .002 * (v + 150), scale=1.7, shift=-.4)  # a tilted plane
    rgb = np.zeros((294, 392, 3), np.uint8)
    depth, mask = ms.metric_depth(session, rgb, FOCAL * 392 / WIDTH)
    u, v = np.meshgrid(np.arange(392) - 195.5, np.arange(294) - 146.5)
    assert mask.all() and np.allclose(depth, 1.5 + .004 * (u + 200) + .002 * (v + 150), rtol=1e-4)
    assert session.calls == [(392, 294, ms.TOKENS)]


def walk(tmp_path, frames=4):
    """A reconstruction of a wall 2 units in front of a camera that slides sideways, with every wall point observed."""
    pycolmap = pytest.importorskip('pycolmap')
    model_dir, images = tmp_path / 'model', tmp_path / 'images'
    model_dir.mkdir(); images.mkdir()
    (model_dir / 'cameras.txt').write_text(f'1 PINHOLE {WIDTH} {HEIGHT} {FOCAL} {FOCAL} 200 150\n')
    grid = [(x, y) for x in np.linspace(-.9, .9, 10) for y in np.linspace(-.6, .6, 6)]
    tracks, lines = {i + 1: [] for i in range(len(grid))}, []
    for image in range(frames):
        centre, observations = image * .1, []
        for index, (x, y) in enumerate(grid):
            observations.append(f'{FOCAL * (x - centre) / 2 + 200} {FOCAL * y / 2 + 150} {index + 1}')
            tracks[index + 1].append(f'{image + 1} {index}')
        lines.append(f'{image + 1} 1 0 0 0 {-centre} 0 0 1 frame_{image}.jpg\n{" ".join(observations)}\n')
        Image.new('RGB', (WIDTH, HEIGHT), (90, 120, 80)).save(images / f'frame_{image}.jpg')
    (model_dir / 'images.txt').write_text(''.join(lines))
    (model_dir / 'points3D.txt').write_text(''.join(f'{i} {x} {y} 2 100 110 120 0.2 {" ".join(tracks[i])}\n'
                                                     for i, (x, y) in enumerate(grid, 1)))
    return pycolmap.Reconstruction(model_dir), images


def test_the_estimate_is_metric_depth_over_reconstruction_depth_at_observed_points(tmp_path):
    model, images = walk(tmp_path)
    # The model sees the wall 0.74 m away (2 units at 0.37 m each), and invents a far surface on the left half of every
    # frame that it marks as no geometry: those pixels must not count.
    session = StandIn(lambda u, v: np.where(u < 0, 30.0, .74), mask=lambda u, v: (u >= 0).astype(float))
    result = ms.estimate(model, images, session)
    assert result['status'] == 'estimated' and result['measured'] is False and result['metric_verified'] is False
    assert result['metres_per_unit'] == pytest.approx(.37, rel=.01)
    assert result['frames_used'] == 4 and result['frame_spread_percent'] < 1
    assert all(frame['points'] >= ms.MIN_POINTS for frame in result['per_frame'])
    assert result['model'] == {k: ms.MODEL[k] for k in ('repo', 'revision', 'file', 'sha256', 'base_model', 'license')}
    assert result['model']['license'] == 'MIT' and 'not measured' in result['label']
    json.dumps(result, allow_nan=False)


def test_no_estimate_without_enough_observed_points(tmp_path):
    model, images = walk(tmp_path)
    blind = ms.estimate(model, images, StandIn(lambda u, v: .74 + 0 * u, mask=lambda u, v: 0 * u))  # the model saw only sky
    assert blind['status'] == 'unavailable' and 'metres_per_unit' not in blind and 'Measure a distance' in blind['reason']


def test_a_file_other_than_the_pinned_checkpoint_is_refused(tmp_path):
    other = tmp_path / 'model.onnx'
    other.write_bytes(b'not the pinned weights')
    with pytest.raises(RuntimeError, match='not the pinned Ruicheng/moge-2-vitb-normal-onnx'):
        ms.load_session(other)
