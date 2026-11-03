"""Visual positioning against a finished reconstruction: matching, the pose solve and the job contract."""
import numpy as np
import pytest

from robotics.world_worker import locate_photo as lp

pycolmap = pytest.importorskip('pycolmap')


def test_matching_keeps_mutual_pairs_that_pass_the_ratio_test():
    rng = np.random.default_rng(4)
    frame = rng.random((300, 128), dtype=np.float32)
    order = rng.permutation(300)[:120]
    # 120 photo features seen in the frame with a little noise, plus 80 the frame never saw.
    query = np.vstack([frame[order] + rng.normal(0, .01, (120, 128)).astype(np.float32), rng.random((80, 128), dtype=np.float32)])
    pairs = lp.match(lp.unit_rows(query), lp.unit_rows(frame))
    found = {int(q): int(f) for q, f in pairs}
    assert all(found.get(i) == order[i] for i in range(120))
    assert sum(q >= 120 for q in found) <= 2  # unseen features rarely pass both checks
    assert lp.match(lp.unit_rows(query[:1]), lp.unit_rows(frame)).shape == (0, 2)


def test_database_descriptors_are_read_through_their_data_array():
    stored = pycolmap.FeatureDescriptors(pycolmap.FeatureExtractorType.SIFT, np.full((3, 128), 7, dtype=np.uint8))
    rows = lp.unit_rows(stored)
    assert rows.shape == (3, 128) and np.allclose(np.linalg.norm(rows, axis=1), 1)


def scene(rng, outliers=0.3, count=200):
    """Points in front of a known camera, their exact projections, and a share of wrong matches."""
    truth = pycolmap.Camera(model='SIMPLE_RADIAL', width=1280, height=960, params=[1000, 640, 480, 0])
    rotation = pycolmap.Rotation3d(np.array([.05, -.2, .03]))
    pose = pycolmap.Rigid3d(rotation, np.array([.3, -.1, .5]))
    camera_points = np.column_stack([rng.uniform(-2, 2, count), rng.uniform(-1.5, 1.5, count), rng.uniform(3, 7, count)])
    world = np.array([pose.inverse() * p for p in camera_points])
    image = np.array([truth.img_from_cam(p) for p in camera_points])
    wrong = rng.random(count) < outliers
    image[wrong] = rng.uniform([0, 0], [1280, 960], (wrong.sum(), 2))
    return truth, pose, world, image


def test_solve_recovers_a_known_camera_despite_wrong_matches_and_a_wrong_focal_guess():
    truth, pose, world, image = scene(np.random.default_rng(1))
    guess = pycolmap.Camera(model='SIMPLE_RADIAL', width=1280, height=960, params=[900, 640, 480, 0])  # 10% off
    out = lp.solve(image, world, guess)
    assert out['located'] and out['inliers'] >= 120
    centre = -pose.rotation.matrix().T @ pose.translation
    assert np.linalg.norm(np.array(out['camera_center']) - centre) < 1e-3
    found = np.array(out['world_to_camera'])[:3, :3]
    assert np.degrees(np.arccos(np.clip((np.trace(found @ pose.rotation.matrix().T) - 1) / 2, -1, 1))) < .05
    assert abs(out['camera']['parameters'][0] - 1000) < 1  # the refined focal is reported, not the guess
    assert out['mean_reprojection_error_pixels'] < .1


def test_solve_refuses_rather_than_guessing_when_matches_disagree():
    rng = np.random.default_rng(2)
    camera = pycolmap.Camera(model='SIMPLE_RADIAL', width=1280, height=960, params=[1000, 640, 480, 0])
    out = lp.solve(rng.uniform([0, 0], [1280, 960], (200, 2)), rng.uniform(-3, 3, (200, 3)) + [0, 0, 6], camera)
    assert out['located'] is False and 'not placed' in out['reason'] and 'camera_center' not in out
    assert lp.solve(np.zeros((3, 2)), np.ones((3, 3)), camera)['located'] is False


@pytest.mark.parametrize('model,params,focal,centre', [('SIMPLE_RADIAL', [800, 400, 300, .01], [0], (1, 2)),
                                                       ('PINHOLE', [800, 810, 400, 300], [0, 1], (2, 3))])
def test_query_camera_rescales_the_scan_camera_to_the_photo(model, params, focal, centre):
    reconstruction = pycolmap.Reconstruction()
    reconstruction.add_camera(pycolmap.Camera(model=model, width=800, height=600, params=params, camera_id=1))
    camera = lp.query_camera(reconstruction, 1, 1280, 960)
    assert (camera.width, camera.height, camera.model_name) == (1280, 960, model)
    assert [camera.params[i] for i in focal] == pytest.approx([params[i] * 1.6 for i in focal])
    assert (camera.params[centre[0]], camera.params[centre[1]]) == (640, 480)


def test_a_photo_is_located_only_in_a_completed_reconstruction(tmp_path):
    photo = {'path': str(tmp_path / 'p.jpg'), 'name': 'p.jpg', 'kind': 'image'}
    base = {'schema': 'brainsnn.adapter.v1', 'inputs': [photo], 'output_dir': str(tmp_path / 'out')}
    with pytest.raises(ValueError, match='one photo'):
        lp.run({**base, 'inputs': [photo, photo]})
    with pytest.raises(ValueError, match='completed reconstruction'):
        lp.run(base)
    with pytest.raises(ValueError, match='completed reconstruction'):
        lp.run({**base, 'source': {'job': 'a' * 32, 'missing': True}})
    with pytest.raises(ValueError, match='completed reconstruction'):
        lp.run({**base, 'source': {'job': 'a' * 32, 'engine': 'scene-usd', 'path': str(tmp_path)}})
    with pytest.raises(ValueError, match='matching data'):
        lp.run({**base, 'source': {'job': 'a' * 32, 'engine': 'colmap-sparse', 'path': str(tmp_path)}})
    assert not (tmp_path / 'out').exists()
