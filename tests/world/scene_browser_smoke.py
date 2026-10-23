"""HTTP browser -> private worker -> scene transport fixture -> Explore scene.glb in 3D.

The adapter writes an authored GLB and scene.json (tests/world/scene_fixture_adapter.py); no reconstruction or Blender
runs, and this test makes no claim about scene quality. Upload, job, short-lived tickets, SHA-256 checks, the mesh viewer
and the provenance shown from scene.json are real. Chromium runs at desktop size and WebKit as an iPhone 15.

  WORLD_SERVER_PYTHON=/path/to/python-with-fastapi-and-uvicorn python tests/world/scene_browser_smoke.py
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

from PIL import Image
from playwright.sync_api import sync_playwright

from observations_browser_smoke import port, processing_options, ready

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world'
FACTS = ['Observed: 0 reconstructed points, the floor and 1 wall.',
         'Detected: no objects placed, 1 left unplaced.',
         'Unknown: 1 floor cell no point reached, kept as a tagged volume, never free space.',
         'Units: arbitrary reconstruction units. No measured scale, so sizes are relative.']


def check_browser(pw, name, origin, worker_url, token, photo):
    executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
    browser = getattr(pw, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
    context = browser.new_context(**({**pw.devices['iPhone 15'], 'device_scale_factor': 1} if name == 'webkit'
                                     else {'viewport': {'width': 1440, 'height': 1000}, 'device_scale_factor': 1}))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    try:
        page.goto(origin + '/world/index.html', wait_until='networkidle')
        page.locator('#files').set_input_files(photo)
        page.locator('[data-tab=capture]').click()
        processing_options(page)
        page.locator('[data-action=connection]').click()
        page.locator('#worker-url').fill(worker_url)
        page.locator('#worker-token').fill(token)
        page.locator('#connect').click()
        page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')")
        page.locator('#connection [aria-label=Close]').click()
        processing_options(page)
        page.locator('#engine').select_option('scene-fixture')
        page.locator('#consent').check()
        page.locator('[data-action=process]').click()
        # A completed job opens Evidence, where its worker artifacts are listed.
        page.wait_for_function("document.querySelector('[data-scene-artifact]') || /scene-fixture: (failed|cancelled)/.test(document.querySelector('#status').textContent)", timeout=60000)
        assert page.locator('[data-tab=evidence]').get_attribute('aria-selected') == 'true', page.locator('#status').inner_text()
        assert page.locator('[data-scene-artifact]').all_inner_texts() == ['Explore scene.glb in 3D']
        page.locator('[data-scene-artifact]').click()
        page.wait_for_function("/SHA-256 checked|failed/.test(document.querySelector('#scene-status').textContent)", timeout=60000)
        assert page.locator('#scene-status').inner_text() == 'scene.glb from scene-fixture · 3 meshes · 72 vertices · SHA-256 checked', page.locator('#scene-status').inner_text()
        facts = page.locator('#scene-facts li').all_inner_texts()
        assert facts[:4] == FACTS and 'Export static OpenUSD' in facts[4], facts
        geometry = page.evaluate("""() => { const d = document.querySelector('#scene-dialog').getBoundingClientRect(),
            c = document.querySelector('#scene-stage canvas'), r = c?.getBoundingClientRect();
            return {open: document.querySelector('#scene-dialog').open, canvas: r ? [r.width, r.height] : null,
                    inside: d.left >= -1 && d.right <= innerWidth + 1, noPageScroll: document.documentElement.scrollWidth <= innerWidth}; }""")
        assert geometry['open'] and geometry['canvas'] and min(geometry['canvas']) > 150 and geometry['inside'] and geometry['noPageScroll'], geometry
        page.screenshot(path=str(OUTPUT / f'scene-{name}.png'))
        page.keyboard.press('Escape')
        page.wait_for_function("!document.querySelector('#scene-dialog').open")
        # Reopening reuses the viewer, and clearing the session removes it with the job.
        page.locator('[data-scene-artifact]').click()
        # The click opens the dialog at once with a fresh status, so this waits for the reloaded scene, not the old one.
        assert page.evaluate("document.querySelector('#scene-dialog').open && !/SHA-256 checked/.test(document.querySelector('#scene-status').textContent)")
        page.wait_for_function("/SHA-256 checked/.test(document.querySelector('#scene-status').textContent)", timeout=60000)
        assert page.locator('#scene-stage canvas').count() == 1
        page.keyboard.press('Escape')
        page.wait_for_function("!document.querySelector('#scene-dialog').open")
        page.locator('[data-action=clear]').click()
        page.wait_for_function("document.querySelector('#scene-stage canvas') === null && !document.querySelector('#scene-dialog').open")
        assert page.locator('[data-scene-artifact]').count() == 0
        assert not errors, errors
    finally:
        browser.close()


def main():
    server_python = os.environ.get('WORLD_SERVER_PYTHON', sys.executable)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='brainsnn-scene-browser-') as directory:
        tmp = Path(directory)
        photo = tmp / 'authored-scene-fixture.png'
        Image.new('RGB', (320, 240), '#315566').save(photo, format='PNG')
        frontend, backend = port(), port()
        while frontend == backend:
            backend = port()
        origin, worker_url, token = f'http://127.0.0.1:{frontend}', f'http://127.0.0.1:{backend}', secrets.token_urlsafe(48)
        config = tmp / 'adapters.json'
        config.write_text(json.dumps([{'id': 'scene-fixture', 'label': 'Scene transport fixture (no reconstruction)',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['image'], 'max_inputs': 1, 'timeout_seconds': 60,
            'command': [sys.executable, str(ROOT / 'tests/world/scene_fixture_adapter.py'), '--input-manifest', '{input_manifest}']}]))
        environment = {**os.environ, 'WORLD_WORKER_TOKEN': token, 'WORLD_WORKER_DIR': str(tmp / 'data'),
                       'WORLD_ADAPTERS_FILE': str(config), 'WORLD_ALLOWED_ORIGINS': origin}
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
                    check_browser(pw, name.strip(), origin, worker_url, token, photo)
                    print('scene preview passed in', name.strip(), flush=True)
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
