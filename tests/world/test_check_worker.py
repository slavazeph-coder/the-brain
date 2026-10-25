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
        return 200, {'Access-Control-Allow-Origin': '*'}, {'engines': [{'id': 'inspect', 'available': True, 'input_kinds': ['image']}]}
    failed = [r['check'] for r in cw.run_checks(BASE, TOKEN, call=permissive) if not r['ok']]
    assert failed == ['refuses requests without the token', 'lets https://www.brainsnn.com read the response',
                      'allows browser calls from https://www.brainsnn.com', 'does not allow other origins']


def test_requirements_parse_and_the_probe_image_is_a_valid_png():
    assert cw.parse_requirements(['scene-usd:video, cloud', 'mapanything-apache']) == {'scene-usd': {'video', 'cloud'}, 'mapanything-apache': set()}
    from PIL import Image
    import io
    image = Image.open(io.BytesIO(cw.tiny_png())); image.verify()
    assert image.size == (8, 8)


def test_a_preflight_without_put_or_authorization_fails():
    def partial(url, method='GET', token=None, headers=None, body=None, timeout=20):
        if url.endswith('/healthz'): return 200, {}, {'status': 'ok'}
        if method == 'OPTIONS':  # the origin is allowed, but '*' never covers Authorization
            if headers['Origin'] != cw.SITE_ORIGINS[0]: return 400, {}, None
            return 200, {'Access-Control-Allow-Origin': headers['Origin'], 'Access-Control-Allow-Methods': 'GET, POST',
                         'Access-Control-Allow-Headers': '*'}, None
        if not token: return 401, {}, None
        return 200, {'Access-Control-Allow-Origin': headers['Origin']}, {'engines': [{'id': 'inspect', 'available': True, 'input_kinds': ['image']}]}
    failed = {r['check']: r['detail'] for r in cw.run_checks(BASE, TOKEN, call=partial) if not r['ok']}
    assert failed == {'allows browser calls from https://www.brainsnn.com': "HTTP 200, allow-origin 'https://www.brainsnn.com', not allowed: PUT, Authorization"}


def test_redirects_are_reported_not_followed():
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    hits = []
    class Target(BaseHTTPRequestHandler):
        def do_GET(self): hits.append(self.headers.get('Authorization')); self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
        def log_message(self, *a): pass
    target = ThreadingHTTPServer(('127.0.0.1', 0), Target)
    class Redirect(BaseHTTPRequestHandler):
        def do_GET(self): self.send_response(302); self.send_header('Location', f'http://127.0.0.1:{target.server_port}/healthz'); self.end_headers()
        def log_message(self, *a): pass
    proxy = ThreadingHTTPServer(('127.0.0.1', 0), Redirect)
    for server in (target, proxy): threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        status, _, _ = cw.request(f'http://127.0.0.1:{proxy.server_port}/v1/capabilities', token=TOKEN)
        assert status == 302 and hits == []  # not followed, so the token never reached the other server
        results = cw.run_checks(f'http://127.0.0.1:{proxy.server_port}', TOKEN, allow_http=True)
        assert results[2] == {'check': '/healthz answers', 'ok': False, 'detail': 'HTTP 302 (a redirect: the site does not follow redirects)'}
    finally:
        proxy.shutdown(); target.shutdown()


def test_a_proxy_that_drops_cors_on_real_responses_fails(call):
    """The preflight passes, but the authenticated answer carries no allow-origin, so a browser could not read it."""
    def stripped(url, method='GET', token=None, headers=None, body=None, timeout=20):
        status, got, data = call(url, method, token, headers, body, timeout)
        return (status, got, data) if method == 'OPTIONS' else (status, {}, data)
    failed = {r['check']: r['detail'] for r in cw.run_checks(BASE, TOKEN, call=stripped) if not r['ok']}
    assert failed == {'lets https://www.brainsnn.com read the response': 'allow-origin None'}
