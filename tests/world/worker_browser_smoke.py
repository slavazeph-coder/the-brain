"""Opt-in real browser -> upload API -> PyCOLMAP -> artifact viewer regression.

WORLD_COLMAP_TEST_CAPTURE=/path/to/photos WORLD_COLMAP_PYTHON=/path/to/venv/bin/python
WORLD_SERVER_PYTHON=/path/to/python-with-fastapi-and-uvicorn
python tests/world/worker_browser_smoke.py
No fixture, model, worker response or reconstruction is substituted.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def ready(url):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('Local test server did not start: ' + url)


def main():
    capture = os.environ.get('WORLD_COLMAP_TEST_CAPTURE')
    if not capture:
        raise SystemExit('Set WORLD_COLMAP_TEST_CAPTURE to 3–12 real overlapping photographs.')
    photos = sorted(path for path in Path(capture).iterdir() if path.suffix.lower() in ['.jpg', '.jpeg', '.png'])[:12]
    assert len(photos) >= 3
    python = os.environ.get('WORLD_SERVER_PYTHON', 'python3')
    colmap = os.environ['WORLD_COLMAP_PYTHON']
    processes = []
    output = ROOT / 'output/playwright/world'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brainsnn-browser-worker-') as directory:
        tmp = Path(directory)
        frontend, backend = port(), port()
        origin = f'http://127.0.0.1:{frontend}'
        worker_url = f'http://127.0.0.1:{backend}'
        token = secrets.token_urlsafe(48)
        config = tmp / 'adapters.json'
        config.write_text(json.dumps([{'id': 'colmap-sparse', 'label': 'Real CPU reconstruction',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'max_inputs': 12,
            'timeout_seconds': 180, 'command': [colmap, str(ROOT / 'robotics/world_worker/sparse_colmap.py'),
                                              '--input-manifest', '{input_manifest}']}]))
        environment = {**os.environ, 'WORLD_WORKER_TOKEN': token, 'WORLD_WORKER_DIR': str(tmp / 'data'),
                       'WORLD_ADAPTERS_FILE': str(config), 'WORLD_ALLOWED_ORIGINS': origin}
        try:
            for command, env in [([python, '-m', 'http.server', str(frontend), '--bind', '127.0.0.1',
                                  '--directory', str(ROOT / 'brainsnn-r3f-app/public')], os.environ),
                                 ([python, '-m', 'uvicorn', 'robotics.world_worker.app:create_app', '--factory',
                                   '--host', '127.0.0.1', '--port', str(backend), '--no-access-log'], environment)]:
                processes.append(subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            ready(origin + '/world/index.html'); ready(worker_url + '/healthz')
            with sync_playwright() as pw:
                executable = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
                browser = pw.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/world/index.html', wait_until='networkidle')
                page.wait_for_function("document.querySelectorAll('.system-card').length===23")
                page.locator('#files').set_input_files(photos)
                page.wait_for_function("count => document.querySelectorAll('.source-row').length===count", arg=len(photos))
                page.locator('.processing-options summary').click()
                page.locator('[data-action=connection]').click()
                page.locator('#worker-url').fill(worker_url)
                page.locator('#worker-token').fill(token)
                page.locator('#connect').click()
                page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')")
                page.locator('#connection [aria-label=Close]').click()
                page.locator('.processing-options summary').click()
                page.locator('#engine').select_option('colmap-sparse')
                page.locator('#consent').check()
                page.locator('[data-action=process]').click()
                page.wait_for_function("document.querySelector('#status').textContent.startsWith('Reconstruction loaded.')", timeout=240000)
                assert page.locator('#visual-canvas').is_visible()
                assert page.locator('#run').is_disabled()
                assert page.locator('#provenance').inner_text() == 'VISUAL / SCALE UNVERIFIED'
                page.locator('#viewport').screenshot(path=str(output / 'browser-api-reconstruction.png'))
                # Verify the actual binary download, not merely a download event.
                with page.expect_download() as event:
                    page.locator('[data-action=visual-export]').click()
                event.value.save_as(output / 'browser-api-points.ply')
                assert (output / 'browser-api-points.ply').read_bytes().startswith(b'ply\n')
                page.locator('[data-tab=evidence]').click()
                with page.expect_download() as event:
                    page.locator('[data-action=proof]').click()
                event.value.save_as(output / 'browser-api-proof.json')
                proof = json.loads((output / 'browser-api-proof.json').read_text())
                assert proof['world'] is None and proof['result'] is None
                derived = proof['sources'][-1]['derivation']
                assert derived['engine'] == 'colmap-sparse' and derived['metricVerified'] is False
                assert len(derived['sha256']) == 64
                # Real -> sim: the worker's own camera poses turn the reconstruction into a proposed, unreviewed map.
                page.locator('[data-tab=capture]').click()
                page.locator('[data-action=propose-map]').click()
                page.wait_for_function("/Map proposed from \\d+ camera poses/.test(document.querySelector('#status').textContent)")
                proposal_status = page.locator('#status').inner_text()
                assert page.locator('#provenance').inner_text() == 'REVIEW REQUIRED'
                page.locator('#run').click()
                page.wait_for_timeout(200)
                assert 'Confirm independently measured scale' in page.locator('#status').inner_text()
                page.locator('[data-tab=evidence]').click()
                with page.expect_download() as event:
                    page.locator('[data-action=proof]').click()
                event.value.save_as(output / 'browser-api-proposal-proof.json')
                proposal = json.loads((output / 'browser-api-proposal-proof.json').read_text())
                assert proposal['world']['geometrySource']['kind'] == 'reconstruction-proposal'
                assert proposal['world']['scaleReviewed'] is False and proposal['world']['mapReviewed'] is False
                proposed = [e['detail'] for e in proposal['events'] if e['type'] == 'map_proposed'][-1]
                assert proposed['job'] == derived['job'] and len(proposed['evidenceSha256']) == 64 and proposed['scaleVerified'] is False
                page.locator('#viewport').screenshot(path=str(output / 'browser-api-proposed-map.png'))
                assert not errors, errors
                print(json.dumps({'browser': 'chromium', 'captures': len(photos), 'job': derived['job'],
                                  'proposal': {'cameras': proposed['cameras'], 'points': proposed['points'], 'area': proposed['area'], 'status': proposal_status},
                                  'artifactSHA256': derived['sha256'], 'binaryExportSHA256': hashlib.sha256((output / 'browser-api-points.ply').read_bytes()).hexdigest(),
                                  'metricVerified': False, 'claim': 'Real browser upload, CPU sparse reconstruction and visual artifact loading passed.'}))
                browser.close()
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)


if __name__ == '__main__':
    main()
