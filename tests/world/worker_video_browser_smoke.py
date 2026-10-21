"""Opt-in real browser -> upload API -> PyCOLMAP video reconstruction -> artifact viewer.

The video-to-sim demo path: one walkthrough MP4 goes through the actual World
Studio UI, the private worker API and the CPU COLMAP adapter, then renders in
the first-party point viewer. Nothing is substituted or mocked.

WORLD_VIDEO_TEST_CLIP=/path/to/walkthrough.mp4 WORLD_COLMAP_PYTHON=/path/to/venv/bin/python
WORLD_SERVER_PYTHON=/path/to/python-with-fastapi-and-uvicorn
python tests/world/worker_video_browser_smoke.py
"""
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
    clip = os.environ.get('WORLD_VIDEO_TEST_CLIP')
    if not clip or not Path(clip).is_file():
        raise SystemExit('Set WORLD_VIDEO_TEST_CLIP to one real 2–120 second walkthrough MP4/MOV/WebM.')
    clip = Path(clip).resolve()
    python = os.environ.get('WORLD_SERVER_PYTHON', 'python3')
    colmap = os.environ['WORLD_COLMAP_PYTHON']
    processes = []
    output = ROOT / 'output/playwright/world'
    output.mkdir(parents=True, exist_ok=True)
    timings = {'clip': clip.name, 'clip_bytes': clip.stat().st_size}
    with tempfile.TemporaryDirectory(prefix='brainsnn-browser-video-') as directory:
        tmp = Path(directory)
        frontend, backend = port(), port()
        origin = f'http://127.0.0.1:{frontend}'
        worker_url = f'http://127.0.0.1:{backend}'
        token = secrets.token_urlsafe(48)
        config = tmp / 'adapters.json'
        config.write_text(json.dumps([{'id': 'colmap-sparse', 'label': 'Real CPU video reconstruction',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['image', 'video'], 'max_inputs': 12,
            'timeout_seconds': 600, 'command': [colmap, str(ROOT / 'robotics/world_worker/sparse_colmap.py'),
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
                page.wait_for_function("document.querySelectorAll('.system-card').length===22")
                page.locator('#files').set_input_files([str(clip)])
                page.wait_for_function("document.querySelectorAll('.source-row').length===1")
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
                started = time.monotonic()
                page.locator('[data-action=process]').click()
                page.wait_for_function("document.querySelector('#status').textContent.startsWith('Reconstruction loaded.')", timeout=600000)
                timings['upload_to_viewer_seconds'] = round(time.monotonic() - started, 2)
                assert page.locator('#visual-canvas').is_visible()
                assert page.locator('#run').is_disabled()
                assert page.locator('#provenance').inner_text() == 'VISUAL / SCALE UNVERIFIED'
                page.locator('#viewport').screenshot(path=str(output / 'browser-video-reconstruction.png'))
                with page.expect_download() as event:
                    page.locator('[data-action=visual-export]').click()
                event.value.save_as(output / 'browser-video-points.ply')
                ply = (output / 'browser-video-points.ply').read_bytes()
                assert ply.startswith(b'ply\n')
                timings['ply_bytes'] = len(ply)
                page.locator('[data-tab=evidence]').click()
                with page.expect_download() as event:
                    page.locator('[data-action=proof]').click()
                event.value.save_as(output / 'browser-video-proof.json')
                proof = json.loads((output / 'browser-video-proof.json').read_text())
                assert proof['world'] is None and proof['result'] is None
                source = proof['sources'][-1]
                derived = source['derivation']
                assert derived['engine'] == 'colmap-sparse' and derived['metricVerified'] is False
                assert len(derived['sha256']) == 64
                assert proof['sources'][0]['kind'] == 'video'
                # Video -> sim: hand the reconstruction to the Arena workspace in the same browser.
                with page.expect_download() as event, page.expect_popup() as popup:
                    page.locator('[data-tab=capture]').click()
                    page.locator('[data-action=arena-cloud]').click()
                event.value.save_as(output / 'browser-video-arena-cloud.json')
                cloud = json.loads((output / 'browser-video-arena-cloud.json').read_text())
                assert cloud['kind'] == 'colmap-sparse-point-cloud' and 1 <= len(cloud['points']) <= 50000 and cloud['units'] == 'arbitrary'
                timings['arena_cloud_points'] = len(cloud['points'])
                arena = popup.value; arena.on('pageerror', lambda error: errors.append('arena: ' + str(error)))
                arena.wait_for_selector('[data-site-step=capture]', timeout=30000)
                arena.locator('[data-site-step=capture]').click()
                arena.locator('#site-asset-input').set_input_files(str(output / 'browser-video-arena-cloud.json'))
                arena.wait_for_function("document.querySelector('#site-status')?.textContent.includes('visual reference')", timeout=30000)
                site = arena.locator('#site-workspace-root').inner_text()
                assert 'visual only' in site.lower(), arena.locator('#site-status').inner_text()
                arena.locator('#site-workspace-root canvas').first.screenshot(path=str(output / 'browser-video-arena-sim.png'))
                assert not errors, errors
                timings['proof_sources'] = len(proof['sources'])
                browser.close()
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                process.wait(timeout=10)
    (output / 'browser-video-timings.json').write_text(json.dumps(timings, indent=2))
    print('video browser->API->COLMAP->viewer journey passed', json.dumps(timings))


if __name__ == '__main__':
    main()
