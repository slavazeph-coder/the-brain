"""The fit check of a compiled scene against its own points: python -m pytest tests/world/test_fit_check.py

A 4 x 3 m floor, a wall along x and a cabinet turned 30 degrees, in scene.json's own form (y up). Points are sampled on
their surfaces with 1 cm of noise, plus a ceiling the model does not hold, so every number has a known answer."""
from pathlib import Path
import json
import math
import random
import struct
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import fit_check as fc  # noqa: E402

YAW = 30


def scene(cabinet_centre=(2.0, 0.5, 1.5)):
    return {'schema': 'brainsnn.scene.v1', 'units': 'm', 'floor_y': 0.0,
            'objects': [{'name': 'floor_observed', 'label': 'floor', 'centre': [2, -.01, 1.5], 'size': [4, .02, 3]},
                        {'name': 'object_1', 'label': 'cabinet', 'centre': list(cabinet_centre), 'size': [1.0, 1.0, .5], 'yaw_degrees': YAW}],
            'walls': [{'name': 'wall_1', 'label': 'wall', 'centre': [2, 1.25, 0], 'size': [4, 2.5, .1], 'yaw_degrees': 0}]}


def points(seed=3):
    rng = random.Random(seed); n = lambda: rng.gauss(0, .01); pts = []
    pts += [[rng.uniform(0, 4), n(), rng.uniform(0, 3)] for _ in range(1200)]                    # floor top
    pts += [[rng.uniform(0, 4), rng.uniform(0, 2.5), .05 + n()] for _ in range(800)]             # wall face
    t = math.radians(YAW); d, s = (math.cos(t), math.sin(t)), (-math.sin(t), math.cos(t))
    for _ in range(400):                                                                         # cabinet front face
        a = rng.uniform(-.5, .5); pts.append([2 + a * d[0] + (.25 + n()) * s[0], rng.uniform(0, 1), 1.5 + a * d[1] + (.25 + n()) * s[1]])
    pts += [[rng.uniform(0, 4), 2.7, rng.uniform(0, 3)] for _ in range(200)]                    # ceiling: not modelled
    return [p + [100, 100, 100] for p in pts]


def test_a_model_on_its_points_fits_to_the_noise_and_the_ceiling_is_not_modelled():
    q = fc.check(scene(), points())
    assert q['basis'] == 'model-to-points' and q['points'] == 2600
    assert q['unmodelled']['points'] == 200 and q['unmodelled']['above_ceiling_band'] == 200, 'the ceiling is not in the model'
    for kind in ('floor', 'wall', 'object'):
        assert q['by_kind'][kind]['median_cm'] == pytest.approx(0.67, abs=.25), f'{kind}: 1 cm of noise has a 0.67 cm median'
    assert q['misfits'] == [] and q['within']['5cm'] == pytest.approx(2400 / 2600, abs=.01)
    cabinet = next(e for e in q['elements'] if e['name'] == 'object_1')
    # Its 400 face points, and the floor points under its footprint, which are as near its base as the floor.
    assert 400 <= cabinet['points'] <= 440 and cabinet['label'] == 'cabinet', 'the turned box gets its own face points'


def test_a_box_placed_off_its_points_is_flagged_as_a_misfit():
    q = fc.check(scene(cabinet_centre=(2.0, 0.5, 1.58)), points())  # 8 cm off along z: about 7 cm off its own front face
    cabinet = next(e for e in q['elements'] if e['name'] == 'object_1')
    assert q['misfits'] == ['object_1'] and cabinet['median_cm'] > fc.MISFIT_MEDIAN * 100


def test_the_heatmap_is_a_binary_ply_in_the_scene_frame_coloured_by_distance(tmp_path):
    pts = points(); evidence = fc.export(scene(), pts, tmp_path)
    assert evidence['written'] and evidence['misfits'] == [] and json.loads((tmp_path / 'fit-check.json').read_text())['points'] == 2600
    raw = (tmp_path / 'fit-heatmap.ply').read_bytes(); head, body = raw.split(b'end_header\n', 1)
    assert b'format binary_little_endian 1.0' in head and b'element vertex 2600' in head and len(body) == 2600 * 15
    first = struct.unpack('<fffBBB', body[:15]); last = struct.unpack('<fffBBB', body[-15:])
    assert first[:3] == pytest.approx(pts[0][:3], abs=1e-5) and first[3:] != fc.UNMODELLED, 'a floor point is on the model'
    assert last[3:] == fc.UNMODELLED, 'a ceiling point is grey'
    assert fc.colour(0) == (0, 200, 140) and fc.colour(fc.ON) == (240, 220, 60) and fc.colour(fc.MODELLED) == (240, 60, 60)


def test_nothing_is_written_without_metres_points_or_surfaces(tmp_path):
    assert fc.export({**scene(), 'units': 'arbitrary'}, points(), tmp_path) == {'skipped': 'The fit check needs a metric scene.'}
    assert 'skipped' in fc.export(scene(), [], tmp_path) and 'skipped' in fc.export({'units': 'm', 'objects': [], 'walls': []}, points(), tmp_path)
    assert not list(tmp_path.iterdir())
