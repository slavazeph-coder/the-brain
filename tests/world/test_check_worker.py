"""check_worker against a real worker app (in process) and against misconfigured fakes: python -m pytest tests/world/test_check_worker.py"""
from pathlib import Path
import sys
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker.app import create_app
from robotics.world_worker import check_worker as cw

TOKEN = 'test-operator-token-not-production-' + 'x' * 32
BASE = 'https://worker.test'


@pytest.fixture
def call(tmp_path):
    """check_worker's request(), routed to an in-process worker instead of the network."""
    with TestClient(create_app(root=tmp_path, token=TOKEN), base_url=BASE) as client:
        def request(url, method='GET', token=None, headers=None, body=None, timeout=20):
            headers = dict(headers or {})
            if token: headers['Authorization'] = 'Bearer ' + token
            kwargs = {'json': body} if isinstance(body, (dict, list)) else {'content': body}
            res = client.request(method, url, headers=headers, **kwargs)
            try: data = res.json()
            except ValueError: data = None
            return res.status_code, res.headers, data
        yield request


def test_a_correct_worker_passes_every_check_and_the_probe_cleans_up(call):
    results = cw.run_checks(BASE, TOKEN, requirements=cw.parse_requirements(['inspect:image,video']), upload_probe=True, call=call)
    assert all(r['ok'] for r in results), [r for r in results if not r['ok']]
    names = [r['check'] for r in results]
    assert 'refuses requests without the token' in names and 'does not allow other origins' in names
    assert 'deletes the probe upload' in names
    assert TOKEN not in repr(results)


def test_missing_engines_and_kinds_fail_by_name(call):
    results = cw.run_checks(BASE, TOKEN, requirements=cw.parse_requirements(['scene-usd:video,cloud', 'inspect:cloud']), call=call)
    failed = {r['check']: r['detail'] for r in results if not r['ok']}
    assert failed == {'offers scene-usd for cloud, video': 'not advertised', 'offers inspect for cloud': 'missing cloud'}


def test_an_http_worker_stops_at_the_first_check_unless_allowed(call):
    results = cw.run_checks('http://worker.test', TOKEN, call=call)
    assert results == [{'check': 'served over HTTPS', 'ok': False, 'detail': 'brainsnn.com is HTTPS, so browsers block an http:// worker'}]
    assert all(r['ok'] for r in cw.run_checks('http://worker.test', TOKEN, allow_http=True, call=call))


def test_open_cors_and_an_unprotected_worker_fail():
    def permissive(url, method='GET', token=None, headers=None, body=None, timeout=20):
        if url.endswith('/healthz'): return 200, {}, {'status': 'ok'}
        if method == 'OPTIONS': return 200, {'Access-Control-Allow-Origin': '*'}, None
        return 200, {}, {'engines': [{'id': 'inspect', 'available': True, 'input_kinds': ['image']}]}
    failed = [r['check'] for r in cw.run_checks(BASE, TOKEN, call=permissive) if not r['ok']]
    assert failed == ['refuses requests without the token', 'allows browser calls from https://www.brainsnn.com', 'does not allow other origins']


def test_requirements_parse_and_the_probe_image_is_a_valid_png():
    assert cw.parse_requirements(['scene-usd:video, cloud', 'mapanything-apache']) == {'scene-usd': {'video', 'cloud'}, 'mapanything-apache': set()}
    from PIL import Image
    import io
    image = Image.open(io.BytesIO(cw.tiny_png())); image.verify()
    assert image.size == (8, 8)
