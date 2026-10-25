"""CPU-only checks of documented camera output arrays, without model execution.

Run with: python -m pytest tests/world/test_mapanything_cameras.py
These fixtures validate camera representation and frame conversion, not learned
pose accuracy, reconstruction quality or physical measurements.
"""
from pathlib import Path
import math
import sys

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker.mapanything_apache import camera_metadata


def camera():
    angle = 0.37
    c, s = math.cos(angle), math.sin(angle)
    pose = np.array([[c, 0, s, 2], [0, 1, 0, 3], [-s, 0, c, 4], [0, 0, 0, 1]], dtype=np.float32)
    intrinsics = np.array([[510, 0, 259], [0, 512, 194], [0, 0, 1]], dtype=np.float32)
    return {'camera_poses': pose[None], 'intrinsics': intrinsics[None]}


def test_rigid_camera_conversion_preserves_pose_calibration_and_view_order():
    first, second = camera(), camera()
    second['camera_poses'][0, :3, 3] = [-2, -3, -4]
    original = first['camera_poses'].copy()
    result = camera_metadata([first, second])
    frame = np.diag([1., -1., -1., 1.])
    assert [item['view'] for item in result] == [0, 1]
    for source, item in zip([first, second], result):
        actual = np.asarray(item['camera_to_world_y_up'])
        assert np.allclose(actual, frame @ source['camera_poses'][0] @ frame)
        assert np.allclose(actual[:3, :3].T @ actual[:3, :3], np.eye(3), atol=1e-6)
        assert np.array_equal(item['intrinsics_opencv'], source['intrinsics'][0])
    assert np.array_equal(result[0]['camera_to_world_y_up'][0], [original[0, 0, 0], 0, -original[0, 0, 2], 2])
    assert np.array_equal(first['camera_poses'], original), 'metadata export does not repair or mutate model predictions'


def test_small_float32_rotation_error_is_tolerated_without_repairing_it():
    view = camera()
    view['camera_poses'][0, 0, 0] += 1e-5
    result = camera_metadata([view])
    assert result[0]['camera_to_world_y_up'][0][0] == float(view['camera_poses'][0, 0, 0])


@pytest.mark.parametrize('rotation', [
    np.diag([2., 1., 1.]),
    np.array([[1., .1, 0], [0, 1, 0], [0, 0, 1]]),
    np.zeros((3, 3)),
    np.diag([-1., 1., 1.]),
])
def test_scale_shear_singular_and_reflected_camera_rotations_are_rejected(rotation):
    view = camera()
    view['camera_poses'][0, :3, :3] = rotation
    with pytest.raises(ValueError, match='camera rotation'):
        camera_metadata([view])


@pytest.mark.parametrize('axis,value', [(0, 0), (0, -1), (1, 0), (1, -1)])
def test_nonpositive_camera_focal_lengths_are_rejected(axis, value):
    view = camera()
    view['intrinsics'][0, axis, axis] = value
    with pytest.raises(ValueError, match='camera intrinsics'):
        camera_metadata([view])


@pytest.mark.parametrize('row', [[0, 0, 0], [0, 0, 2], [.01, 0, 1], [0, -.01, 1]])
def test_noncanonical_intrinsic_last_row_is_rejected(row):
    view = camera()
    view['intrinsics'][0, 2] = row
    with pytest.raises(ValueError, match='camera intrinsics'):
        camera_metadata([view])


@pytest.mark.parametrize('field', ['camera_poses', 'intrinsics'])
@pytest.mark.parametrize('value', [np.nan, np.inf])
def test_nonfinite_camera_values_are_rejected(field, value):
    view = camera()
    view[field][0, 0, 0] = value
    with pytest.raises(ValueError, match='camera geometry'):
        camera_metadata([view])


def test_projective_pose_last_row_is_rejected():
    view = camera()
    view['camera_poses'][0, 3, 0] = .01
    with pytest.raises(ValueError, match='camera geometry'):
        camera_metadata([view])
