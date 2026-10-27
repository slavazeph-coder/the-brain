"""HTTP browser -> scoped private worker -> real observation CLI -> fixture VLM.

The loopback VLM response is an explicit transport fixture. No learned model
executes and this test makes no claim about recognition quality. Photo decode,
PNG artifacts, hashing, HTTP upload/download, validation and human review are real.

Run with Python containing Playwright and Pillow, with installed browser engines:
  WORLD_SERVER_PYTHON=/path/to/python-with-fastapi-and-uvicorn \
  WORLD_OBSERVATIONS_PYTHON=/path/to/python-with-pillow \
  python tests/world/observations_browser_smoke.py
Both Python overrides default to the interpreter running this file. WORLD_BROWSERS
defaults to chromium,webkit. Optional PLAYWRIGHT_CHROMIUM_PATH and
PLAYWRIGHT_WEBKIT_PATH override installed browser executables. No remote fixtures,
model downloads, production worker or configured inference endpoint are used.
An isolated HTTP proxy delays one real capability response to test cancellation.
"""
import base64
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
import urllib.request

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world'
FIXTURE_MODEL = 'fixture-http-observer-no-model-executed'
LITERAL_LABEL = '<img src=x onerror="window.observationInjected=true">'
FIXTURE_OBSERVATIONS = [
    {'frameId': 'frame-0', 'label': LITERAL_LABEL,
     'uncertainty': 'Fixture response only; no model inference occurred.'},
    {'frameId': 'frame-0', 'label': 'Fixture chair',
     'uncertainty': 'An authored transport fixture, not an inferred object.'},
    {'frameId': 'frame-0', 'label': 'Fixture doorway',
     'uncertainty': 'Unsupported fixture suggestion to reject.'},
]


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def ready(url, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Local test server exited before readiness: ' + url)
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('Local test server did not start: ' + url)


@contextmanager
def fixture_vlm():
    """The only substituted component: one fixed OpenAI-compatible completion."""
    calls, errors = [], []
    api_key = secrets.token_urlsafe(24)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            try:
                assert self.path == '/v1/chat/completions'
                assert self.headers.get('Authorization') == 'Bearer ' + api_key
                size = int(self.headers.get('Content-Length', '0'))
                assert 0 < size <= 2 * 1024 * 1024
                body = json.loads(self.rfile.read(size))
                assert body['model'] == FIXTURE_MODEL
                response_format = body['response_format']
                assert response_format['type'] == 'json_schema'
                assert response_format['json_schema']['strict'] is True
                schema = response_format['json_schema']['schema']
                assert schema['additionalProperties'] is False and schema['required'] == ['observations']
                entries = schema['properties']['observations']
                assert entries['maxItems'] == 6
                assert entries['items']['properties']['frameId']['enum'] == ['frame-0']
                assert entries['items']['properties']['label']['maxLength'] == 80
                assert entries['items']['properties']['uncertainty']['maxLength'] == 180
                assert set(entries['items']['properties']) == {'frameId', 'label', 'uncertainty'}
                assert entries['items']['additionalProperties'] is False
                assert body['temperature'] == 0 and body['max_tokens'] == 1024
                assert body['chat_template_kwargs'] == {'enable_thinking': False}
                assert 'tools' not in body
                assert len(body['messages']) == 2
                assert body['messages'][0]['role'] == 'system'
                content = body['messages'][1]['content']
                assert len(content) == 2 and content[0] == {'type': 'text', 'text': 'Frame ID: frame-0'}
                data_url = content[1]['image_url']['url']
                assert data_url.startswith('data:image/png;base64,')
                raw = base64.b64decode(data_url.split(',', 1)[1], validate=True)
                with Image.open(io.BytesIO(raw)) as derivative:
                    derivative.load()
                    assert derivative.format == 'PNG'
                    assert derivative.size == (512, 341)
                    assert not derivative.info and not derivative.getexif()
                calls.append({'model': body['model'], 'frameSHA256': hashlib.sha256(raw).hexdigest(),
                              'frameBytes': len(raw), 'frameWidth': 512, 'frameHeight': 341,
                              'promptSHA256': hashlib.sha256(body['messages'][0]['content'].encode()).hexdigest()})
                payload = json.dumps({'model': FIXTURE_MODEL, 'choices': [{'finish_reason': 'stop', 'message': {
                    'role': 'assistant', 'content': json.dumps({'observations': FIXTURE_OBSERVATIONS})}}]}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as error:
                errors.append(type(error).__name__ + ': ' + str(error))
                self.send_error(500, 'Fixture request contract failed')

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {'base': f'http://127.0.0.1:{server.server_port}/v1', 'key': api_key, 'calls': calls, 'errors': errors}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@contextmanager
def delayed_capabilities(worker_url, origin):
    """Delay a real worker response; never fabricate capabilities or identity."""
    requested, release, finished = threading.Event(), threading.Event(), threading.Event()
    errors = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def cors(self):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')

        def do_OPTIONS(self):
            self.send_response(204); self.cors(); self.end_headers()

        def do_GET(self):
            try:
                assert self.path == '/v1/capabilities'
                request = urllib.request.Request(worker_url + self.path, headers={
                    'Authorization': self.headers.get('Authorization', ''), 'Origin': origin})
                with urllib.request.urlopen(request, timeout=5) as response:
                    payload = response.read(1024 * 1024)
                    assert response.status == 200
                    assert json.loads(payload)['api_version'] == 'brainsnn.worker.v1'
                requested.set()
                assert release.wait(timeout=15), 'Delayed capability test did not release the response'
                self.send_response(200); self.cors()
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers(); self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Expected: the browser aborts this stale connection attempt.
            except Exception as error:
                errors.append(type(error).__name__ + ': ' + str(error))
            finally:
                finished.set()

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        yield {'url': f'http://127.0.0.1:{server.server_port}', 'requested': requested,
               'release': release, 'finished': finished, 'errors': errors}
    finally:
        release.set(); server.shutdown(); server.server_close(); thread.join(timeout=5)


def check_stale_connection(page, worker_url, origin, token):
    with delayed_capabilities(worker_url, origin) as gate:
        page.locator('[data-tab=capture]').click()
        processing_options(page)
        page.locator('[data-action=connection]').click()
        page.locator('#worker-url').fill(gate['url'])
        page.locator('#worker-token').fill(token)
        page.locator('#connect').click()
        assert gate['requested'].wait(timeout=5), gate['errors']
        with page.expect_event('requestfailed', predicate=lambda request: request.url == gate['url'] + '/v1/capabilities'):
            page.locator('#connection [aria-label=Close]').click()
        assert page.locator('#worker-token').input_value() == ''
        page.locator('[data-tab=evidence]').click()
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('[data-action=clear]').click()
        page.wait_for_function("document.querySelector('#worker-summary').textContent === 'Local planning available'")
        gate['release'].set()
        assert gate['finished'].wait(timeout=5), gate['errors']
        page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        assert page.locator('#worker-summary').inner_text() == 'Local planning available'
        assert page.locator('#connection-status').inner_text() == ''
        assert page.locator('#worker-token').input_value() == ''
        assert page.locator('#connect').is_enabled()
        page.locator('[data-tab=capture]').click()
        processing_options(page)
        assert page.locator('#engine').count() == 0, 'Stale reply restored the cleared worker connection'
        assert not gate['errors'], gate['errors']
        return gate['url']


def download_proof(page, path):
    page.locator('[data-tab=evidence]').click()
    with page.expect_download() as event:
        page.locator('[data-action=proof]').click()
    event.value.save_as(path)
    return json.loads(path.read_text())


def processing_options(page):
    panel = page.locator('.processing-options')
    if panel.get_attribute('open') is None:
        panel.locator('summary').click()


def check_browser(pw, name, origin, worker_url, token, photo, fixture):
    assert name in ('chromium', 'webkit'), 'Supported browsers: chromium,webkit'
    executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
    browser = getattr(pw, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
    context = browser.new_context(**(
        {**pw.devices['iPhone 15'], 'device_scale_factor': 1} if name == 'webkit'
        else {'viewport': {'width': 1440, 'height': 1000}, 'device_scale_factor': 1}))
    page = context.new_page()
    errors, requests, failed_requests = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append({'method': request.method, 'url': request.url}))
    page.on('requestfailed', lambda request: failed_requests.append({'url': request.url, 'error': request.failure}))
    page.on('response', lambda response: failed_requests.append({'url': response.url, 'status': response.status}) if response.status >= 400 else None)
    prefix = OUTPUT / ('observations-' + name)
    try:
        page.goto(origin + '/world/index.html', wait_until='networkidle')
        page.wait_for_function("document.querySelectorAll('.system-card').length === 23")
        stale_gate_url = check_stale_connection(page, worker_url, origin, token)
        # An authored test map makes geometry and mixed review flags observable.
        # It is intentionally not derived from the generated fixture photograph.
        test_map = {'schema': 'brainsnn.world.v1', 'name': 'Authored observation regression map',
                    'width': 8, 'depth': 6, 'start': {'x': 1, 'z': 1}, 'provenance': 'observed',
                    'scaleReviewed': False, 'mapReviewed': False,
                    'objects': [{'id': 'fixed-obstacle', 'name': 'Authored test obstacle', 'x': 3, 'z': 2,
                                 'w': 1, 'd': 1, 'h': 1, 'kind': 'obstacle', 'note': 'Fixed regression geometry.'}]}
        page.locator('#files').set_input_files({'name': 'authored-regression-map.json', 'mimeType': 'application/json',
                                               'buffer': json.dumps(test_map).encode()})
        page.locator('#scale-reviewed').check()
        assert not page.locator('#map-reviewed').is_checked()
        page.locator('#files').set_input_files(photo)
        page.wait_for_function("document.querySelectorAll('.source-row').length === 1")
        baseline = download_proof(page, Path(str(prefix) + '-before.json'))
        assert baseline['world']['scaleReviewed'] is True and baseline['world']['mapReviewed'] is False
        assert baseline['world']['objects'][0]['id'] == 'fixed-obstacle'
        assert baseline.get('observations', []) == []

        page.locator('[data-tab=capture]').click()
        processing_options(page)
        page.locator('[data-action=connection]').click()
        page.locator('#worker-url').fill(worker_url)
        page.locator('#worker-token').fill(token)
        page.locator('#connect').click()
        page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')")
        page.locator('#connection [aria-label=Close]').click()
        processing_options(page)
        page.locator('#engine').select_option('world-observations')
        calls_before = len(fixture['calls'])
        # Connecting and selecting an engine cannot upload a source or invoke VLM.
        page.locator('[data-action=process]').click()
        assert 'explicitly approve' in page.locator('#status').inner_text()
        assert len(fixture['calls']) == calls_before
        assert not any(request['method'] == 'POST' and request['url'].startswith(worker_url) for request in requests)
        page.locator('#consent').check()
        page.locator('[data-action=process]').click()
        page.wait_for_function("""() => document.querySelectorAll('.observation-card').length === 3 ||
            (document.querySelector('#status').classList.contains('error') &&
             !document.querySelector('#status').textContent.includes('explicitly approve')) ||
            document.querySelector('#job-status')?.textContent.includes(': failed')""", timeout=90000)
        assert page.locator('.observation-card').count() == 3, page.locator('#status').inner_text()
        assert page.locator('[data-tab=understand]').get_attribute('aria-selected') == 'true'
        assert len(fixture['calls']) == calls_before + 1 and not fixture['errors'], fixture['errors']
        frame = page.locator('.observation-frame img')
        assert frame.count() == 1
        assert frame.evaluate('(image) => image.complete && image.naturalWidth === 512 && image.naturalHeight === 341')
        # Verify the actual downloaded PNG bytes displayed in the source-bound UI.
        visible_hash = frame.evaluate("""async image => {
            const bytes = await (await fetch(image.src)).arrayBuffer();
            const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
            return Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
        }""")
        assert visible_hash == fixture['calls'][-1]['frameSHA256']
        cards = page.locator('.observation-card')
        assert cards.nth(0).locator('strong').inner_text() == LITERAL_LABEL
        assert cards.locator('img').count() == 0
        assert page.evaluate('window.observationInjected') is None
        assert cards.locator('.badge').all_inner_texts() == ['pending', 'pending', 'pending']
        # The v3 model contract supplies labels only. Imported legacy boxes have
        # separate module coverage; this transport fixture cannot invent boxes.
        assert all(cards.nth(i).get_by_role('button', name='Show proposed bounds', exact=True).is_disabled() for i in range(3))
        assert page.locator('.observation-frame-group > .micro').inner_text() == 'Photo frame'
        # Unsaved edits survive rerenders, but do not become human review evidence.
        cards.nth(1).get_by_label('Object label', exact=True).fill('Human reviewed stool')
        cards.nth(1).get_by_label('Uncertainty / limitations', exact=True).fill('Local reviewer correction; still not measured geometry.')
        pending = download_proof(page, Path(str(prefix) + '-pending.json'))
        pending_review = pending['observations'][0]
        assert pending_review['sidecar']['observations'] == [dict(id='observation-' + str(i), **entry) for i, entry in enumerate(FIXTURE_OBSERVATIONS)]
        assert [review['status'] for review in pending_review['reviews']] == ['pending', 'pending', 'pending']
        assert all(review['annotation'] is None and review['reviewedAt'] is None for review in pending_review['reviews'])
        assert 'Human reviewed stool' not in json.dumps(pending)
        assert 'Local reviewer correction' not in json.dumps(pending)
        assert 'drafts' not in pending_review
        page.locator('[data-tab=understand]').click()

        def assert_pending_draft():
            assert cards.nth(1).get_by_label('Object label', exact=True).input_value() == 'Human reviewed stool'
            assert cards.nth(1).get_by_label('Uncertainty / limitations', exact=True).input_value() == 'Local reviewer correction; still not measured geometry.'
            assert cards.nth(1).locator('.badge').inner_text() == 'pending'

        assert_pending_draft()
        cards.nth(0).get_by_role('button', name='Accept / save edit', exact=True).click()
        assert_pending_draft()
        page.locator('[data-tab=capture]').click()
        page.locator('[data-tab=understand]').click()
        assert_pending_draft()
        cards.nth(1).get_by_role('button', name='Accept / save edit', exact=True).click()
        cards.nth(2).get_by_role('button', name='Reject', exact=True).click()
        assert cards.locator('.badge').all_inner_texts() == ['accepted', 'edited', 'rejected']
        assert page.evaluate('window.observationInjected') is None
        page.locator('#observation-reviews').screenshot(path=str(prefix) + '-review.png')

        proof = download_proof(page, Path(str(prefix) + '-proof.json'))
        assert proof['world'] == baseline['world'], 'Review altered the world or its review flags'
        assert proof['result'] == baseline['result'] is None
        assert len(proof['observations']) == 1
        review_proof = proof['observations'][0]
        assert review_proof['schema'] == 'brainsnn.world.observation-proof.v1'
        assert review_proof['reviewAuthority'] == 'local-user-unverified'
        original = review_proof['sidecar']
        assert original['source'] == {'sha256': hashlib.sha256(photo.read_bytes()).hexdigest(), 'kind': 'photo'}
        assert original['frames'][0] == {'id': 'frame-0', 'sha256': visible_hash, 'width': 512, 'height': 341, 'timestamp': None}
        assert original['model']['id'] == FIXTURE_MODEL and original['model']['revision'] is None
        assert original['model']['promptSha256'] == fixture['calls'][-1]['promptSHA256']
        assert original['observations'] == [dict(id='observation-' + str(i), **entry) for i, entry in enumerate(FIXTURE_OBSERVATIONS)]
        reviews = review_proof['reviews']
        assert [review['status'] for review in reviews] == ['accepted', 'edited', 'rejected']
        assert reviews[0]['annotation']['label'] == LITERAL_LABEL
        assert reviews[1]['annotation'] == {'label': 'Human reviewed stool', 'uncertainty': 'Local reviewer correction; still not measured geometry.'}
        assert reviews[2]['annotation'] is None

        page.locator('[data-tab=capture]').click()
        page.locator('[data-remove="0"]').click()
        assert page.locator('.source-row').count() == 0
        page.locator('[data-tab=understand]').click()
        assert page.locator('.observation-card').count() == 0
        assert page.locator('.observation-frame img').count() == 0
        removed = download_proof(page, Path(str(prefix) + '-removed.json'))
        assert removed.get('observations', []) == [] and removed['sources'] == []
        assert removed['world'] == baseline['world']
        # A completed remote job cannot reattach suggestions without its original.
        page.locator('[data-review-artifact]').click()
        page.wait_for_function("document.querySelector('#status').classList.contains('error')")
        assert 'exact original source' in page.locator('#status').inner_text()
        page.locator('[data-tab=understand]').click()
        assert page.locator('.observation-card').count() == 0
        assert not errors, errors
        allowed = {urlsplit(origin).netloc, urlsplit(worker_url).netloc, urlsplit(stale_gate_url).netloc}
        assert all(urlsplit(request['url']).scheme == 'blob' or
                   (urlsplit(request['url']).scheme == 'http' and urlsplit(request['url']).netloc in allowed)
                   for request in requests), 'Browser made an unexpected external request'
        assert not any(urlsplit(request['url']).path.endswith('/x') for request in requests), 'HTML-like label executed'
        receipt = {'browser': name, 'transport': 'loopback HTTP fixture VLM; no model executed',
                   'frameSHA256': visible_hash, 'reviewStates': ['accepted', 'edited', 'rejected'],
                   'worldUnchanged': True, 'sourceRemovalClearsReviews': True, 'htmlLabelsInert': True,
                   'pendingDraftSurvivesRerender': True, 'pendingDraftExcludedFromProof': True,
                   'staleConnectionCancelled': True, 'freshConnectionAfterClearWorks': True,
                   'pageErrors': errors}
        Path(str(prefix) + '-receipt.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt), flush=True)
    except Exception:
        print(name + ' failed; page status: ' + page.locator('#status').inner_text(), file=sys.stderr, flush=True)
        print('Rendered system cards: ' + str(page.locator('.system-card').count()), file=sys.stderr, flush=True)
        print('Page errors: ' + json.dumps(errors), file=sys.stderr, flush=True)
        print('Failed HTTP requests: ' + json.dumps(failed_requests), file=sys.stderr, flush=True)
        page.screenshot(path=str(prefix) + '-failure.png', full_page=True)
        raise
    finally:
        context.close()
        browser.close()


def main():
    server_python = os.environ.get('WORLD_SERVER_PYTHON', sys.executable)
    observations_python = os.environ.get('WORLD_OBSERVATIONS_PYTHON', sys.executable)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='brainsnn-observation-browser-') as directory, fixture_vlm() as fixture:
        tmp = Path(directory)
        photo = tmp / 'authored-transport-fixture.png'
        image = Image.new('RGB', (960, 640), '#315566')
        drawing = ImageDraw.Draw(image)
        drawing.rectangle((90, 90, 350, 570), fill='#88ccee')
        drawing.ellipse((520, 150, 800, 450), fill='#aa77cc')
        image.save(photo, format='PNG')
        frontend, backend = port(), port()
        while frontend == backend:
            backend = port()
        origin, worker_url = f'http://127.0.0.1:{frontend}', f'http://127.0.0.1:{backend}'
        operator_token = secrets.token_urlsafe(48)
        browser_tokens = {name: secrets.token_urlsafe(48) for name in ['chromium', 'webkit']}
        tenants = tmp / 'tenants.json'
        tenants.write_text(json.dumps({'schema':'brainsnn.world.tenants.v1','tenants':[
            {'id':'browser-'+name, 'token_sha256':hashlib.sha256(value.encode()).hexdigest(),
             'engines':['world-observations']} for name,value in browser_tokens.items()
        ]}))
        tenants.chmod(0o600)
        config = tmp / 'adapters.json'
        config.write_text(json.dumps([{'id': 'world-observations', 'label': 'Observation transport fixture (no model)',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'max_inputs': 1,
            'timeout_seconds': 90, 'command': [observations_python, str(ROOT / 'robotics/world_worker/observations.py'),
                                             '--input-manifest', '{input_manifest}']}]))
        environment = {**os.environ, 'WORLD_WORKER_TOKEN': operator_token, 'WORLD_WORKER_DIR': str(tmp / 'data'),
                       'WORLD_TENANTS_FILE':str(tenants),
                       'WORLD_ADAPTERS_FILE': str(config), 'WORLD_ALLOWED_ORIGINS': origin,
                       'WORLD_VLM_ENABLED': '1', 'WORLD_VLM_MODEL': FIXTURE_MODEL,
                       'WORLD_VLM_BASE_URL': fixture['base'], 'WORLD_VLM_API_KEY': fixture['key']}
        environment.pop('WORLD_VLM_REVISION', None)
        try:
            for label, command, env in [
                ('frontend', [server_python, '-m', 'http.server', str(frontend), '--bind', '127.0.0.1',
                              '--directory', str(ROOT / 'brainsnn-r3f-app/public')], os.environ),
                ('worker', [server_python, '-m', 'uvicorn', 'robotics.world_worker.app:create_app', '--factory',
                            '--host', '127.0.0.1', '--port', str(backend), '--no-access-log'], environment),
            ]:
                log = (tmp / (label + '.log')).open('wb'); logs.append(log)
                processes.append(subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=log))
            ready(origin + '/world/index.html', processes[0]); ready(worker_url + '/healthz', processes[1])
            with sync_playwright() as pw:
                for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                    name=name.strip()
                    token=browser_tokens[name]
                    request=urllib.request.Request(worker_url+'/v1/capabilities',headers={'Authorization':'Bearer '+token})
                    with urllib.request.urlopen(request,timeout=5) as response:
                        capabilities=json.load(response)
                    assert capabilities['access_mode']=='tenant' and capabilities['owner_id']=='browser-'+name
                    assert [engine['id'] for engine in capabilities['engines']]==['world-observations']
                    check_browser(pw, name, origin, worker_url, token, photo, fixture)
            request=urllib.request.Request(worker_url+'/v1/jobs',headers={'Authorization':'Bearer '+operator_token})
            with urllib.request.urlopen(request,timeout=5) as response:
                assert json.load(response)['jobs']==[],'Operator HTTP access must not inherit tenant jobs'
            assert not fixture['errors'], fixture['errors']
        except Exception:
            for path in [tmp / 'worker.log', *sorted((tmp / 'data/jobs').glob('*/operator.log'))]:
                if path.exists():
                    print(path.name + ':\n' + path.read_text(errors='replace')[-8000:], file=sys.stderr, flush=True)
            raise
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)
            for log in logs:
                log.close()


if __name__ == '__main__':
    main()
