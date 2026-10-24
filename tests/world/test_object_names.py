"""Naming separated objects without a model or COLMAP: python -m pytest tests/world/test_object_names.py

A measured room (a wall, a cabinet and a lamp) in the hand-off's metric frame, its reconstruction frame related by a
known similarity, and four pinhole cameras; one stands behind the wall. A fake client stands in for the Anthropic API."""
from pathlib import Path
import json
import math
import random
import sys
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import object_names as on  # noqa: E402
import scene_usd as su  # noqa: E402

W, H, F = 640, 480, 500.0
SCALE = 0.5  # metres per reconstruction unit
ANGLE = 0.7
R_SRC = np.array([[math.cos(ANGLE), 0, math.sin(ANGLE)], [0, -1, 0], [math.sin(ANGLE), 0, -math.cos(ANGLE)]]) @ \
    np.array([[1, 0, 0], [0, math.cos(.2), -math.sin(.2)], [0, math.sin(.2), math.cos(.2)]])
T_SRC = np.array([0.3, -0.1, 0.8])
FROM_SOURCE = np.hstack([SCALE * R_SRC, T_SRC[:, None]])  # cloud = A src + t


def room(seed=4):
    rng = random.Random(seed); pts = []
    for _ in range(4000): pts.append([rng.uniform(-2, 2), rng.gauss(0, .005), rng.uniform(-2, 2.5), 90, 80, 70])        # floor
    for _ in range(3000): pts.append([rng.uniform(-2, 2), rng.uniform(.05, 2.4), -2 + rng.gauss(0, .01), 200, 200, 200])  # wall

    def box(cx, cz, lx, lz, h, n):
        for _ in range(n):
            u, v, y = rng.uniform(-lx / 2, lx / 2), rng.uniform(-lz / 2, lz / 2), rng.uniform(0, h)
            face = rng.randrange(3)
            if face == 0: u = rng.choice((-lx / 2, lx / 2))
            elif face == 1: v = rng.choice((-lz / 2, lz / 2))
            else: y = h
            pts.append([cx + u, y, cz + v, 120, 60, 30])
    box(0.5, 0.0, 0.8, 0.6, 0.9, 900)    # cabinet
    box(-1.2, 1.2, 0.4, 0.4, 1.2, 700)   # lamp
    return pts


def cloud():
    return {'units': 'm', 'points': room(), 'floorEstimate': None, 'fromSource': FROM_SOURCE.tolist(),
            'scale': {'source': 'user-measured', 'metresPerUnit': SCALE}, 'nameObjects': True}


def camera(name, at, target, folder):
    """A pinhole view in reconstruction coordinates, placed and aimed in the metric frame (x right, y down, z forward)."""
    at, target = np.asarray(at, float), np.asarray(target, float)
    f = (target - at) / np.linalg.norm(target - at); r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r); d = np.cross(f, r)
    Rc = np.stack([r, d, f]); tc = -Rc @ at
    cam_from_src = np.hstack([Rc @ R_SRC, ((Rc @ T_SRC + tc) / SCALE)[:, None]])
    path = Path(folder) / f'{name}.png'; Image.new('RGB', (W, H), (40, 90, 120)).save(path)
    return {'name': f'{name}.png', 'path': path, 'width': W, 'height': H, 'cam_from_world': cam_from_src,
            'project': lambda cam: np.stack([F * cam[:, 0] / cam[:, 2] + W / 2, F * cam[:, 1] / cam[:, 2] + H / 2], 1)}


@pytest.fixture
def views(tmp_path):
    return [camera('front', (0.5, 1.4, 3.0), (0.5, 0.45, 0), tmp_path), camera('side', (2.6, 1.4, 1.8), (0.5, 0.45, 0), tmp_path),
            camera('behind-wall', (0.5, 1.2, -3.5), (0.5, 0.45, 0), tmp_path), camera('lamp', (-1.2, 1.5, 3.6), (-1.2, 0.6, 1.2), tmp_path)]


class FakeClient:
    def __init__(self, answer=None, stop_reason='end_turn', text=None):
        self.calls, self.answer, self.stop_reason, self.text = [], answer, stop_reason, text
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **request):
        self.calls.append(request)
        ids = [b['text'].split()[1].rstrip(':') for b in request['messages'][0]['content'] if b['type'] == 'text' and b['text'].startswith('Object ')]
        answer = self.answer(ids) if callable(self.answer) else self.answer
        return SimpleNamespace(stop_reason=self.stop_reason, model='claude-opus-5-5', stop_details=SimpleNamespace(category='test'),
                               content=[SimpleNamespace(type='text', text=self.text if self.text is not None else json.dumps(answer))],
                               usage=SimpleNamespace(input_tokens=1200, output_tokens=90))


def by_size(ids):
    return {'objects': [{'id': i, 'name': 'Cabinet' if n == 0 else 'floor lamp', 'category': 'furniture' if n == 0 else 'lighting',
                         'confidence': 'high', 'reason': 'visible'} for n, i in enumerate(ids)]}


def separated():
    import scene_compiler as sc
    c = cloud(); _, _, _, objects = sc.analyse(c['points'], sc.floor_plane(c['points'], None), True)
    return c, objects


def test_the_room_separates_into_the_two_objects():
    _, objects = separated()
    assert sorted(round(o['y1'] - o['y0'], 1) for o in objects) == [0.9, 1.2]


def test_views_see_each_object_whole_and_skip_a_frame_where_the_wall_hides_it(views):
    c, objects = separated()
    P, mpu = on.source_points(c['points'], c['fromSource'])
    assert mpu == pytest.approx(SCALE) and np.allclose(P @ FROM_SOURCE[:, :3].T + FROM_SOURCE[:, 3], np.asarray(c['points'])[:, :3])
    chosen = on.choose_views(objects, P, views, mpu)
    cabinet = next(n for n, o in enumerate(objects) if round(o['y1'] - o['y0'], 1) == 0.9)
    picked = [p['view']['name'] for p in chosen[cabinet]]
    assert picked and 'behind-wall.png' not in picked and set(picked) <= {'front.png', 'side.png', 'lamp.png'}
    assert len(picked) == 2, 'two views from cameras at least 0.3 m apart'
    for p in chosen[cabinet]:
        x0, y0, x1, y1 = p['box']; assert 0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H and min(x1 - x0, y1 - y0) >= on.MIN_BOX_PIXELS


def test_one_request_names_every_object_and_names_carry_where_they_apply(views):
    client = FakeClient(by_size)
    names, evidence = on.name_objects(cloud(), None, client=client, views=views)
    request = client.calls[0]
    assert request['model'] == 'claude-opus-5-5' and request['fallbacks'] == 'default' and 'server-side-fallback-2026-07-01' in request['betas']
    assert request['output_config']['format']['type'] == 'json_schema' and request['system'] == on.SYSTEM
    images = [b for b in request['messages'][0]['content'] if b['type'] == 'image']
    assert len(images) == evidence['crops_sent'] >= 3 and all(b['source']['media_type'] == 'image/jpeg' for b in images)
    assert evidence['objects_sent'] == 2 and evidence['answered'] == 2 and evidence['reviewed'] is False and evidence['usage']['input_tokens'] == 1200
    assert sorted(n['label'] for n in names['objects']) == ['cabinet', 'floor lamp']
    _, objects = separated()
    for entry in names['objects']:
        assert min(math.dist(entry['centre'], o['centre']) for o in objects) < 1e-9 and entry['views']


def test_refusals_truncation_and_answers_that_do_not_match_are_never_applied(views):
    for client, reason in [(FakeClient(by_size, stop_reason='refusal'), 'declined'), (FakeClient(by_size, stop_reason='max_tokens'), 'cut off'),
                           (FakeClient(text='not json'), 'valid JSON'), (FakeClient({'objects': [{'id': '99', 'name': 'x', 'category': 'other',
                                                                                                  'confidence': 'high', 'reason': ''}]}), 'none of the objects')]:
        with pytest.raises(on.NamingSkipped, match=reason):
            on.name_objects(cloud(), None, client=client, views=views)


def test_the_scene_step_says_why_it_did_not_name(views, tmp_path, monkeypatch):
    monkeypatch.delenv('ANTHROPIC_API_KEY', raising=False)
    request = {'source': {'job': 'a' * 32, 'path': str(tmp_path)}}
    assert su.name_step(cloud(), request, tmp_path, views=views) == (None, {'status': 'skipped', 'reason': 'This worker has no Anthropic API key configured.'})
    assert 'no longer on the worker' in su.name_step(cloud(), {'source': {'job': 'a' * 32, 'missing': True}}, tmp_path, client=FakeClient(by_size))[1]['reason']
    assert 'No reconstruction job' in su.name_step(cloud(), {}, tmp_path, client=FakeClient(by_size))[1]['reason']
    assert 'metric' in su.name_step({**cloud(), 'units': 'arbitrary'}, request, tmp_path, client=FakeClient(by_size))[1]['reason']
    assert 'transform' in su.name_step({k: v for k, v in cloud().items() if k != 'fromSource'}, request, tmp_path, client=FakeClient(by_size))[1]['reason']
    failing = FakeClient(by_size); failing.beta.messages.create = lambda **_: (_ for _ in ()).throw(ConnectionError('network down'))
    assert su.name_step(cloud(), request, tmp_path, client=failing, views=views)[1] == {'status': 'failed', 'reason': 'ConnectionError: network down'}
    path, evidence = su.name_step(cloud(), request, tmp_path, client=FakeClient(by_size), views=views)
    assert evidence['status'] == 'named' and json.loads(path.read_text())['schema'] == 'brainsnn.object-names.v1'


def test_frames_come_from_the_model_the_points_were_exported_from(tmp_path):
    sparse = tmp_path / 'sparse'
    with pytest.raises(on.NamingSkipped, match='no longer holds'):
        on.selected_model(sparse)
    (sparse / '0').mkdir(parents=True)
    assert on.selected_model(sparse) == sparse / '0', 'an older job with one model'
    (sparse / '1').mkdir()
    with pytest.raises(on.NamingSkipped, match='several models'):
        on.selected_model(sparse)
    (sparse / 'selected.txt').write_text('1')
    assert on.selected_model(sparse) == sparse / '1', 'the recorded model, not model 0'
    for bad in ('7', '../0', ''):
        (sparse / 'selected.txt').write_text(bad)
        with pytest.raises(on.NamingSkipped, match='not there'):
            on.selected_model(sparse)
