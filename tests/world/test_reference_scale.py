"""Scale from standard-size references: python -m pytest tests/world/test_reference_scale.py

The corners Claude gives only say where to look; the image must give them back to a fraction of a pixel, the face's
plane and the camera rays must give exact corners, the proportions must reject a wrong reference, and agreement
between references (never a single one) is what earns "cross-checked"."""
from pathlib import Path
import json
import math
import sys
import types

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import reference_scale as rs  # noqa: E402


def rectangle_image(corners, size=(720, 1280), inside=230.0, outside=60.0, blur=1.2):
    """A grey image with a bright quad (anti-aliased by supersampling, then a slight blur)."""
    H, W = size; s = 4; yy, xx = np.mgrid[0:H * s, 0:W * s] / s + .5 / s - .5
    Q = np.asarray(corners); side = [(Q[(k + 1) % 4, 0] - Q[k, 0]) * (yy - Q[k, 1]) - (Q[(k + 1) % 4, 1] - Q[k, 1]) * (xx - Q[k, 0]) for k in range(4)]
    mask = (np.asarray(side) >= 0).all(0) | (np.asarray(side) <= 0).all(0)
    img = np.where(mask, inside, outside).reshape(H, s, W, s).mean((1, 3))
    from PIL import Image, ImageFilter
    return np.asarray(Image.fromarray(img.astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), float)


def test_corners_come_back_from_the_image_to_a_fraction_of_a_pixel():
    true = np.array([[400.3, 200.7], [702.1, 228.4], [680.6, 640.2], [380.9, 610.5]])
    rough = true + np.random.default_rng(3).normal(0, 6, true.shape)  # model-grade corners, several pixels off
    corners, support = rs.refine(rectangle_image(true), rough)
    assert corners is not None, support
    assert np.abs(corners - true).max() < .3, np.abs(corners - true).max()


def test_a_face_too_small_or_without_edges_is_refused():
    small = np.array([[100, 100], [130, 100], [130, 120], [100, 120]], float)
    assert rs.refine(rectangle_image(small), small)[0] is None
    flat = np.full((720, 1280), 120.0); quad = np.array([[400, 200], [700, 200], [700, 600], [400, 600]], float)
    assert 'edge' in rs.refine(flat, quad)[1]


def pinhole_view(R, C, f=900.0, cx=640.0, cy=360.0):
    t = -R @ C; M = np.hstack([R, t[:, None]])
    return {'name': 'f', 'cam_from_world': M,
            'project': lambda cam: np.stack([f * cam[:, 0] / cam[:, 2] + cx, f * cam[:, 1] / cam[:, 2] + cy], 1),
            'unproject': lambda uv: (np.asarray(uv, float).reshape(-1, 2) - [cx, cy]) / f}


def look_at(C, target):
    z = np.asarray(target, float) - C; z /= np.linalg.norm(z); x = np.cross([0, -1, 0], z); x /= np.linalg.norm(x); y = np.cross(z, x)
    return np.array([x, y, z])


def test_a_sheet_on_a_wall_is_measured_through_the_walls_plane():
    # An A4 sheet on the wall z = 0, 0.5 units per metre (the reconstruction's scale is arbitrary), seen at an angle.
    k = .5; corners_m = np.array([[1.0, 1.6, 0], [1.21, 1.6, 0], [1.21, 1.303, 0], [1.0, 1.303, 0]])
    rng = np.random.default_rng(1); wall = np.c_[rng.uniform(.2, 2, 400), rng.uniform(.8, 2.2, 400), np.zeros(400)] / k
    C = np.array([2.2, 1.5, 2.4]) / k; view = pinhole_view(look_at(C, corners_m.mean(0) / k), C)
    uv = view['project']((corners_m / k) @ view['cam_from_world'][:, :3].T + view['cam_from_world'][:, 3])
    P3, used = rs.measure(view, uv, wall)
    assert P3 is not None, used
    assert np.allclose(P3, corners_m / k, atol=1e-6)
    e = rs.estimate(rs.REFERENCES['iso-a4-sheet'], P3)
    assert e['metresPerUnit'] == pytest.approx(k) and abs(e['shapeError']) < 1e-9


def test_proportions_reject_the_wrong_reference():
    P3 = np.array([[0, 0, 0], [.2159, 0, 0], [.2159, .2794, 0], [0, .2794, 0]])  # a US Letter sheet, called A4
    assert abs(rs.estimate(rs.REFERENCES['iso-a4-sheet'], P3)['shapeError']) > rs.SHAPE_TOLERANCE


def test_only_independent_agreement_is_cross_checked():
    one = [{'id': 'iso-a4-sheet', 'centre': np.zeros(3), 'metresPerUnit': .5}, {'id': 'iso-a4-sheet', 'centre': np.full(3, .01), 'metresPerUnit': .52}]
    k, status, spread, instances = rs.combine(one, extent=10)
    assert status == 'single-reference' and len(instances) == 1 and instances[0]['detections'] == 2, 'one sheet seen twice is one reference'
    two = one + [{'id': 'iso-a3-sheet', 'centre': np.full(3, 3.0), 'metresPerUnit': .505}]
    assert rs.combine(two, extent=10)[1] == 'cross-checked'
    off = one + [{'id': 'eur-pallet', 'centre': np.full(3, 3.0), 'metresPerUnit': .56}]
    assert rs.combine(off, extent=10)[1] == 'conflicting'


def test_claudes_answer_is_parsed_and_mapped_back_to_the_frames_pixels(tmp_path):
    from PIL import Image
    big = tmp_path / 'frame.jpg'; Image.new('RGB', (2560, 1440), (90, 90, 90)).save(big)  # sent at 1280: factor 2
    answer = {'references': [{'id': 'iso-a4-sheet', 'frame': 0, 'corners': [[10, 20], [30, 20], [30, 50], [10, 50]], 'confidence': 'high', 'reason': 'sheet on a board'},
                             {'id': 'pillow', 'frame': 0, 'corners': [[0, 0], [1, 0], [1, 1], [0, 1]], 'confidence': 'high', 'reason': 'not on the list'},
                             {'id': 'eur-pallet', 'frame': 7, 'corners': [[0, 0], [1, 0], [1, 1], [0, 1]], 'confidence': 'high', 'reason': 'no such frame'}]}
    sent = {}
    class Messages:
        def create(self, **kw):
            sent.update(kw)
            return types.SimpleNamespace(stop_reason='end_turn', model='claude-test', usage=types.SimpleNamespace(input_tokens=1, output_tokens=2),
                                         content=[types.SimpleNamespace(type='text', text=json.dumps(answer))])
    client = types.SimpleNamespace(beta=types.SimpleNamespace(messages=Messages()))
    found, model, usage = rs.ask(client, [{'name': 'image_0001.jpg', 'path': big}])
    assert [f['id'] for f in found] == ['iso-a4-sheet'] and found[0]['frame'] == 'image_0001.jpg'
    assert found[0]['corners'][0] == [20.0, 40.0], 'coordinates come back in the frame\'s own pixels'
    assert sent['output_config']['format']['schema']['properties']['references']['items']['properties']['id']['enum'] == sorted(rs.REFERENCES) + sorted(rs.UNMEASURED)
    assert 'pillow' not in json.dumps(sent['output_config']), 'objects without a standard size are not on the list'


def test_the_reference_scale_is_compared_with_a_typed_one():
    # A metric hand-off whose typed span made 0.52 m per reconstruction unit (fromSource scales by 0.52), and a
    # reference estimate of 0.51 m per unit: the typed scale is 2% high, within the cross-check's 2% (just).
    turn = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float) * .52
    cloud = {'units': 'm', 'scale': {'metresPerUnit': .52}, 'fromSource': np.hstack([turn, np.ones((3, 1))]).tolist()}
    out = rs.against_handoff({'metresPerUnit': .51}, cloud)
    assert out['metresPerHandoffUnit'] == pytest.approx(.51 / .52) and out['typedScaleRelativeDifference'] == pytest.approx(.51 / .52 - 1, abs=1e-5)
    assert out['agreesWithTypedScale'] is True
    assert rs.against_handoff({'metresPerUnit': .49}, cloud)['agreesWithTypedScale'] is False


def test_the_engine_reports_none_rather_than_guessing(tmp_path):
    out = tmp_path / 'out'; out.mkdir(); source = tmp_path / 'reconstruction'; source.mkdir()
    manifest = tmp_path / 'input.json'
    manifest.write_text(json.dumps({'schema': 'brainsnn.adapter.v1', 'inputs': [], 'output_dir': str(out), 'source': {'job': 'x' * 32, 'path': str(source)}}))
    rs.adapter(manifest)
    report = json.loads((out / 'reference-scale.json').read_text())
    assert report['status'] == 'none' and report['metresPerUnit'] is None and 'frames' in report['reason'] and report['verified'] is False
    assert json.loads((out / 'manifest.json').read_text())['artifacts'][0]['name'] == 'reference-scale.json'
    manifest.write_text(json.dumps({'inputs': [], 'output_dir': str(out)}))
    with pytest.raises(SystemExit):
        rs.adapter(manifest)
