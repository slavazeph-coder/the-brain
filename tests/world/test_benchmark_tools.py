"""The benchmark tools' geometry: python -m pytest tests/world/test_benchmark_tools.py

The alignment fits must recover a known transform exactly, the fingerprint must follow #232's documented byte layout,
and the truth score must report exactly the errors planted in a compiled scene."""
from pathlib import Path
import hashlib
import math
import struct
import sys

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'world-demo' / 'benchmark'))
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import pick_references as pr  # noqa: E402
import score_against_truth as st  # noqa: E402


def turn(degrees):
    a = math.radians(degrees); return np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])


def test_the_fits_recover_a_known_transform():
    src = np.random.default_rng(1).normal(size=(40, 3))
    s, R, t = pr.similarity(src, 2.5 * src @ turn(40).T + [1, 2, 3])
    assert s == pytest.approx(2.5) and np.allclose(R, turn(40)) and np.allclose(t, [1, 2, 3])
    R, t = st.rigid(src, src @ turn(-75).T + [-4, 0, 9])
    assert np.allclose(R, turn(-75)) and np.allclose(t, [-4, 0, 9])


def test_the_fingerprint_is_232s_byte_layout():
    pts = [[1.5, -2.0, 0.25, 10, 20, 30], [0, 0, 0, 255, 0, 1]]
    h = hashlib.sha256(b'brainsnn.dimension-points.v1\0right-handed-y-up\0m\0')
    for p in pts: h.update(struct.pack('<6d', *map(float, p)))
    assert pr.fingerprint(pts) == h.hexdigest() and pr.fingerprint(pts[::-1]) != h.hexdigest(), 'order matters'


def truth():
    W, D, H, T = 6.0, 4.8, 2.7, 0.12
    walls = [{'name': 'wall_north', 'centre': [W / 2, H / 2, -T / 2], 'size': [W, H, T], 'yaw_degrees': 180},
             {'name': 'wall_west', 'centre': [-T / 2, H / 2, D / 2], 'size': [D, H, T], 'yaw_degrees': 90},
             {'name': 'wall_south', 'centre': [W / 2, H / 2, D + T / 2], 'size': [W, H, T], 'yaw_degrees': 0},
             {'name': 'wall_east', 'centre': [W + T / 2, H / 2, D / 2], 'size': [D, H, T], 'yaw_degrees': -90}]
    objects = [{'name': 'table', 'label': 'table', 'centre': [3, .37, 2.5], 'size': [2.4, .74, 1.1], 'yaw_degrees': 0},
               {'name': 'chair_0', 'label': 'chair', 'centre': [2, .53, 1.6], 'size': [.55, 1.055, .55], 'yaw_degrees': 0}]
    cams = [[1, 1.5, 1], [5, 1.5, 1], [5, 1.5, 3.8], [1, 1.5, 3.8], [3, 1.4, 2]]
    return {'room': {'width': W, 'depth': D, 'height': H, 'floorArea': W * D}, 'walls': walls, 'objects': objects}, cams


def test_the_truth_score_reports_exactly_the_planted_errors():
    t, cams = truth()
    # The compiled scene, in a hand-off frame turned 30 degrees and shifted: the west face 3 cm into the room, the east
    # face 2 cm out, the table 6 cm too long; the north and south walls exactly on their faces; no chair found.
    M = turn(30); b = np.array([10, 0, -5])
    to_cloud = lambda p: M @ np.asarray(p, float) + b
    def wall(name, centre, length, yaw):
        return {'name': name, 'centre': list(to_cloud(centre)), 'size': [length, 2.5, .1], 'yaw_degrees': yaw - 30}
    scene = {'walls': [wall('wall_1', [.03, 1.25, 2.4], 3.9, 90), wall('wall_2', [6.02, 1.25, 2.4], 4.1, 90),
                       wall('wall_3', [3, 1.25, 0], 5.0, 0), wall('wall_4', [3, 1.25, 4.8], 2.2, 0)],
             'objects': [{'name': 'object_1', 'label': 'table', 'kind': 'separated', 'centre': list(to_cloud([3.05, .37, 2.5])),
                          'size': [2.46, .74, 1.1], 'yaw_degrees': -30},
                         {'name': 'object_2', 'label': 'object', 'kind': 'separated', 'centre': list(to_cloud([5.5, .2, .5])),
                          'size': [.3, .4, .3], 'yaw_degrees': 0}]}
    cloud = {'fromSource': [list(M[i]) + [b[i]] for i in range(3)]}  # reconstruction frame = truth frame here
    references = {'alignment': {'pairs': [{'reconstruction': c, 'truth': c} for c in cams]}}
    r = st.score(t, references, scene, cloud)
    assert r['summary']['cameraFitRmsMeters'] == pytest.approx(0, abs=1e-9)
    assert r['room']['width']['measuredMeters'] == pytest.approx(6.0 - .03 + .02) and r['room']['depth']['errorMeters'] == pytest.approx(0, abs=1e-9)
    assert r['walls']['wall_west']['offsetMeters'] == pytest.approx(.03) and r['walls']['wall_east']['offsetMeters'] == pytest.approx(-.02)
    table = next(o for o in r['objects'] if o['true'] == 'table')
    assert table['sizeErrorMeters']['length'] == pytest.approx(.06) and table['planCentreErrorMeters'] == pytest.approx(.05)
    assert r['missedObjects'] == ['chair_0'] and r['summary']['spuriousObjects'] == 1 and r['summary']['wallsMatched'] == '4 of 4'
