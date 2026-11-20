"""Edge cases for geometry.write_point_cloud, the hand-off from reconstruction to the map.

Ported from the GB10 branch's geometry hand-off tests. Only the cases that call
product code are kept; the originals' hand-written evidence dictionaries and
cancellation labels did not exercise the worker.
"""
import pytest

from robotics.world_worker import geometry


@pytest.mark.parametrize('frame', ['colmap', 'right-handed-y-up'])
def test_writes_visual_preview_metadata_and_bounds(tmp_path, frame):
    points = [[0, 0, 0], [10, 5, -3], [2, 8, 1]]
    colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
    result = geometry.write_point_cloud(tmp_path / 'cloud.ply', points, colours, coordinate_frame=frame)
    assert result['coordinate_frame'] == frame
    assert result['units'] == 'arbitrary'
    assert result['kind'] == 'visual'
    assert result['representation'] == 'point-cloud'
    assert result['point_count'] == 3
    assert result['bounds'] == {'min': [0.0, 0.0, -3.0], 'max': [10.0, 8.0, 1.0]}


def test_ascii_ply_header_states_scale_is_unverified(tmp_path):
    path = tmp_path / 'cloud.ply'
    geometry.write_point_cloud(path, [[0, 0, 0], [1, 1, 1]], [[255, 128, 64], [32, 96, 160]], coordinate_frame='colmap')
    content = path.read_text()
    assert content.startswith('ply\nformat ascii 1.0\n')
    for line in ['element vertex 2', 'property float x', 'property uchar red', 'end_header', 'BrainSNN visual preview', 'scale unverified']:
        assert line in content


def test_rejects_unknown_coordinate_frame(tmp_path):
    with pytest.raises(ValueError, match='Unknown point-cloud coordinate frame'):
        geometry.write_point_cloud(tmp_path / 'cloud.ply', [[0, 0, 0]], [[255, 0, 0]], coordinate_frame='unknown')


@pytest.mark.parametrize('points,colours', [
    ([[geometry.MAX_PREVIEW_COORDINATE + 1.0] * 3], [[255, 0, 0]]),
    ([[float('inf'), 0, 0]], [[255, 0, 0]]),
    ([[float('nan'), 0, 0]], [[255, 0, 0]]),
    ([[0, 0, 0]], [[-1, 0, 0]]),
    ([[0, 0, 0]], [[256, 0, 0]]),
], ids=['coordinate-too-large', 'infinite', 'nan', 'negative-colour', 'colour-over-255'])
def test_rejects_invalid_points_and_colours(tmp_path, points, colours):
    with pytest.raises(ValueError, match='Invalid or oversized'):
        geometry.write_point_cloud(tmp_path / 'cloud.ply', points, colours, coordinate_frame='colmap')
