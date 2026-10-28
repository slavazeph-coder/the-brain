"""Browser native-capture flow against a real authenticated CPU worker.

Uses the independently authored synthetic-room renderer from test_native_capture.
It checks UI/auth/source integrity and real COLMAP, not physical phone accuracy.
"""
import hashlib
import json
import os
from pathlib import Path
import runpy
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
OUTPUT = ROOT / 'output/playwright/world/native-capture'


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def ready(url):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200: return
        except OSError: time.sleep(.1)
    raise RuntimeError('Local test server did not start: ' + url)


def check(browser, origin, worker, token, files, root):
    page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True)
    errors, uploads = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: uploads.append(request) if request.method == 'POST' and request.url.endswith('/v1/uploads') else None)
    page.goto(origin + '/world/index.html', wait_until='networkidle')
    page.wait_for_function("document.querySelectorAll('.system-card').length>0")
    page.locator('#hero-capture').click()
    page.locator('.native-capture-options summary').click()
    assert page.locator('[data-action=native-capture]').is_visible()
    # Reject an oversized sidecar before parsing its body or changing the source list.
    page.locator('#native-capture-files').set_input_files({'name': 'oversized.json', 'mimeType': 'application/json', 'buffer': b'x' * (1024**2 + 1)})
    page.wait_for_function("document.querySelector('#status').textContent.includes('Capture JSON must be no larger than 1 MiB')")
    assert page.locator('.source-row').count() == 0 and not uploads
    # Metadata is importable on its own; missing images must be explained before sending any source bytes.
    page.locator('#native-capture-files').set_input_files(str(files[0]))
    page.wait_for_function("document.querySelectorAll('.source-row').length===1")
    assert 'calibration for 5 photos' in page.locator('.source-row').inner_text()
    open_options = "document.querySelector('.processing-options').open=true"
    page.evaluate(open_options)
    page.locator('[data-action=connection]').click()
    page.locator('#worker-url').fill(worker)
    page.locator('#worker-token').fill(token)
    page.locator('#connect').click()
    page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')")
    page.locator('#connection [aria-label=Close]').click()
    page.evaluate(open_options)
    assert page.locator('#engine').input_value() == 'colmap-sparse'
    page.locator('[data-action=process]').click()
    assert 'explicitly approve' in page.locator('#status').inner_text()
    assert not uploads
    page.locator('#consent').check()
    page.locator('[data-action=process]').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('Add the original capture photos:')")
    assert not uploads
    # A replacement with the right filename but changed bytes cannot borrow the original calibration.
    changed = root / files[1].name
    changed.write_bytes(files[2].read_bytes())
    page.locator('#native-capture-files').set_input_files([str(changed), *map(str, files[2:])])
    page.wait_for_function("document.querySelectorAll('.source-row').length===6")
    page.evaluate(open_options)
    page.locator('#consent').check()
    page.locator('[data-action=process]').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('differs from the original capture')")
    assert not uploads
    page.locator('[data-remove="1"]').click()
    page.locator('#native-capture-files').set_input_files(str(files[1]))
    page.wait_for_function("document.querySelectorAll('.source-row').length===6")
    page.evaluate(open_options)
    page.locator('#consent').check()
    page.locator('[data-action=process]').click()
    page.wait_for_function("document.querySelector('#status').textContent.startsWith('Reconstruction loaded.')", timeout=180000)
    assert len(uploads) == 6
    assert page.locator('#provenance').inner_text() == 'VISUAL / SCALE UNVERIFIED'
    assert page.locator('#run').is_disabled()
    assert page.locator('#visual-canvas').is_visible()
    page.screenshot(path=str(OUTPUT / f'{browser.browser_type.name}-mobile.png'), full_page=True)
    page.locator('#panel').screenshot(path=str(OUTPUT / f'{browser.browser_type.name}-capture-panel.png'))
    page.locator('#tab-evidence').click()
    with page.expect_download() as event:
        page.get_by_role('button', name='Download native-capture.json ↗', exact=True).click()
    destination = OUTPUT / f'{browser.browser_type.name}-native-capture.json'
    event.value.save_as(destination)
    evidence = json.loads(destination.read_text())
    assert evidence['reconstruction_executed'] and evidence['alignment']['applied']
    assert evidence['metric_verified'] is False
    assert len(evidence['frames']) == 5
    assert not errors, errors
    print(json.dumps({'browser': browser.browser_type.name, 'uploads': len(uploads), 'frames': len(evidence['frames']),
                      'metric_verified': False, 'artifact_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                      'checks': ['consent', 'missing-photo', 'changed-source', 'real-colmap', 'evidence-download'],
                      'fixture': 'independently authored synthetic room; no physical phone'}))
    page.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    renderer = runpy.run_path(str(ROOT / 'tests/world/test_native_capture.py'))['rendered_capture']
    with tempfile.TemporaryDirectory(prefix='brainsnn-native-browser-') as directory:
        root = Path(directory); request = renderer(root / 'capture')
        files = [Path(item['path']) for item in request['inputs']]
        frontend, backend = port(), port()
        origin, worker = f'http://127.0.0.1:{frontend}', f'http://127.0.0.1:{backend}'
        token = secrets.token_urlsafe(48)
        config = root / 'adapters.json'
        config.write_text(json.dumps([{'id': 'colmap-sparse', 'label': 'Calibrated CPU reconstruction', 'enabled': True,
            'license_reviewed': True, 'input_kinds': ['capture', 'image', 'video'], 'max_inputs': 12, 'timeout_seconds': 180,
            'command': [sys.executable, str(ROOT / 'robotics/world_worker/sparse_colmap.py'), '--input-manifest', '{input_manifest}']}]))
        env = {**os.environ, 'WORLD_WORKER_TOKEN': token, 'WORLD_WORKER_DIR': str(root / 'data'),
               'WORLD_ADAPTERS_FILE': str(config), 'WORLD_ALLOWED_ORIGINS': origin}
        processes = []
        try:
            for command, environment in [([sys.executable, '-m', 'http.server', str(frontend), '--bind', '127.0.0.1', '--directory', str(ROOT/'brainsnn-r3f-app/public')], os.environ),
                                         ([sys.executable, '-m', 'uvicorn', 'robotics.world_worker.app:create_app', '--factory', '--host', '127.0.0.1', '--port', str(backend), '--no-access-log'], env)]:
                processes.append(subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            ready(origin+'/world/index.html');ready(worker+'/healthz')
            with sync_playwright() as pw:
                for name in os.environ.get('WORLD_BROWSERS','chromium,webkit').split(','):
                    executable=os.environ.get('PLAYWRIGHT_'+name.upper()+'_PATH')
                    browser=getattr(pw,name).launch(headless=True,**({'executable_path':executable} if executable else {}))
                    try: check(browser,origin,worker,token,files,root)
                    finally: browser.close()
        finally:
            for process in processes: process.terminate()
            for process in processes:
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5)


if __name__ == '__main__': main()
