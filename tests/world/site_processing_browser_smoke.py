"""brainsnn.com's own processing: the production site server -> its /api/world proxy -> a real worker (tenants as the
Railway deploy writes them) -> a reconstruction transport fixture -> the cloud in the viewer.

Needs the production build (npm run build in brainsnn-r3f-app), FFmpeg and Playwright. The fixture writes a synthetic
room instead of running COLMAP: this checks the button, the passcode, the proxy and the hand-off, not a reconstruction.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker' / 'deploy' / 'railway'))
from tenants import registry  # noqa: E402  the registry the Railway worker starts with

OUTPUT = ROOT / 'output/playwright/world'


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def ready(url, process):
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError(f'{url} exited with {process.returncode}')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('Local test server did not start: ' + url)


def check(pw, name, site, passcode, video):
    executable = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH') if name == 'chromium' else None
    browser = getattr(pw, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
    try:
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(site + '/world/index.html', wait_until='domcontentloaded')
        page.wait_for_function("document.querySelectorAll('.system-card').length>0")
        page.locator('#files').set_input_files(str(video))
        page.wait_for_function("document.querySelectorAll('.source-row').length===1")
        open_options = "document.querySelector('.processing-options').open=true"
        page.evaluate(open_options)
        button = page.locator('[data-action=connection]')
        page.wait_for_function("document.querySelector('[data-action=connection]').textContent==='Process on BrainSNN'")
        button.click()
        assert page.locator('#site-processing').is_visible() and page.locator('#site-passcode').is_visible()
        page.locator('#site-passcode').fill('not-the-passcode')
        page.locator('#site-connect').click()
        page.wait_for_function("document.querySelector('#site-processing-status').textContent==='Wrong passcode.'")
        page.locator('#site-passcode').fill(passcode)
        page.locator('#site-connect').click()
        page.wait_for_function("!document.querySelector('#connection').open")
        assert 'BrainSNN processing connected' in page.locator('#status').inner_text()
        page.evaluate(open_options)
        assert page.locator('#engine').input_value() == 'colmap-sparse', 'the CPU reconstruction is preselected'
        page.locator('#consent').check()
        page.locator('[data-action=process]').click()
        page.wait_for_function("document.querySelector('#status').textContent.startsWith('Reconstruction loaded.')", timeout=120000)
        assert page.locator('#provenance').inner_text() == 'VISUAL / SCALE UNVERIFIED'
        stored = page.evaluate("JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")
        assert passcode not in stored, 'the passcode is never stored'
        page.locator('#viewport').screenshot(path=str(OUTPUT / f'site-processing-{name}.png'))
        assert not errors, errors
    finally:
        browser.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    dist = ROOT / 'brainsnn-r3f-app/dist/server.cjs'
    if not dist.exists():
        raise SystemExit('Build the site first: npm run build in brainsnn-r3f-app.')
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='brainsnn-site-processing-') as directory:
        tmp = Path(directory)
        video = tmp / 'walk.mp4'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10',
                        '-pix_fmt', 'yuv420p', str(video)], check=True)
        # As deployed: the passcode is the one shared secret, and both sides derive the worker credentials from it.
        passcode = 'site-passcode-' + secrets.token_hex(4)
        tenants = tmp / 'tenants.json'
        tenants.write_text(json.dumps(registry({'WORLD_SITE_PASSCODE': passcode}, 20 * 1024 ** 3, ['colmap-sparse'])))
        adapters = tmp / 'adapters.json'
        adapters.write_text(json.dumps([{'id': 'colmap-sparse', 'label': 'Reconstruction transport fixture (no COLMAP)',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['image', 'video'], 'max_inputs': 12, 'timeout_seconds': 60,
            'command': [sys.executable, str(ROOT / 'tests/world/reconstruction_fixture_adapter.py'), '--input-manifest', '{input_manifest}']}]))
        worker_port, site_port = port(), port()
        while site_port == worker_port:
            site_port = port()
        worker_env = {**os.environ, 'WORLD_WORKER_TOKEN': secrets.token_urlsafe(32), 'WORLD_WORKER_DIR': str(tmp / 'data'),
                      'WORLD_ADAPTERS_FILE': str(adapters), 'WORLD_TENANTS_FILE': str(tenants)}
        site_env = {**os.environ, 'NODE_ENV': 'production', 'PORT': str(site_port),
                    'WORLD_WORKER_INTERNAL_URL': f'http://127.0.0.1:{worker_port}/', 'WORLD_SITE_PASSCODE': passcode}
        try:
            for label, command, env, cwd in [
                ('worker', [sys.executable, '-m', 'uvicorn', 'robotics.world_worker.app:create_app', '--factory',
                            '--host', '127.0.0.1', '--port', str(worker_port), '--no-access-log'], worker_env, ROOT),
                ('site', ['node', 'dist/server.cjs'], site_env, ROOT / 'brainsnn-r3f-app'),
            ]:
                log = (tmp / (label + '.log')).open('wb'); logs.append(log)
                processes.append(subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log))
            ready(f'http://127.0.0.1:{worker_port}/healthz', processes[0]); ready(f'http://127.0.0.1:{site_port}/healthz', processes[1])
            site = f'http://127.0.0.1:{site_port}'
            with sync_playwright() as pw:
                for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                    check(pw, name.strip(), site, passcode, video)
                    print(f'{name.strip()}: Process on BrainSNN -> passcode -> site proxy -> worker -> cloud loaded', flush=True)
            # The owner's command-line check takes the same path: setup, upload, job, hashed downloads.
            checked = subprocess.run([sys.executable, str(ROOT / 'scripts/world-demo/site_processing_check.py'), '--site', site,
                                      '--video', str(video), '--out', str(tmp / 'check'), '--poll', '0.5'],
                                     env={**os.environ, 'BRAINSNN_PASSCODE': passcode}, capture_output=True, text=True, timeout=180)
            print(checked.stdout, flush=True)
            assert checked.returncode == 0, checked.stdout + checked.stderr
            assert passcode not in checked.stdout + checked.stderr, 'the passcode is never printed'
            wrong = subprocess.run([sys.executable, str(ROOT / 'scripts/world-demo/site_processing_check.py'), '--site', site],
                                   env={**os.environ, 'BRAINSNN_PASSCODE': 'not-the-passcode'}, capture_output=True, text=True, timeout=60)
            assert wrong.returncode == 1 and 'FAIL  passcode opens a session' in wrong.stdout
        except Exception:
            for path in [tmp / 'worker.log', tmp / 'site.log', *sorted((tmp / 'data/jobs').glob('*/operator.log'))]:
                if path.exists():
                    print(path.name + ':\n' + path.read_text(errors='replace')[-6000:], file=sys.stderr, flush=True)
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
