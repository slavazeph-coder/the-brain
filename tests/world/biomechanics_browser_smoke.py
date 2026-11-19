"""Actual HTTP/OpenSim/browser checks on an original authored mechanical example.

Requires only Playwright in this interpreter and the worker's normal dependencies
in WORLD_SERVER_PYTHON (defaults to this interpreter). The isolated native runtime
is WORLD_BIOMECHANICS_TEST_PYTHON. No solver or worker response is mocked, no
production endpoint is contacted, and no human/clinical validity is implied.
"""
from __future__ import annotations

import hashlib
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

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world'


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def ready(url, process):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Local browser test server exited before readiness.')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(.1)
    raise RuntimeError('Local browser test server did not become ready.')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def check(pw, name, origin, worker, token, tmp):
    browser = getattr(pw, name).launch(headless=True)
    context = browser.new_context(viewport={'width': 1360, 'height': 1000}, reduced_motion='reduce', accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(20000)
    errors, uploads, layouts, downloads, network_failures = [], [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.on('requestfailed', lambda request: network_failures.append({
        'url': '[local worker request]' if request.url.startswith(worker) else request.url.split('?')[0],
        'error': request.failure}))
    page.on('request', lambda request: uploads.append(request.url)
            if request.url.startswith(worker + '/v1/uploads') and request.method == 'POST' else None)
    results = page.locator('[data-biomech-results]')
    try:
        print(f'{name}: connect actual native OpenSim worker', flush=True)
        page.goto(origin + '/world/index.html?nosw=1', wait_until='domcontentloaded')
        page.locator('#tab-world').click()
        page.locator('#object-name').fill('Preserve my building edit')
        page.locator('#object-name').press('Tab')
        page.locator('[data-layer-connect]').click()
        page.locator('#worker-url').fill(worker)
        page.locator('#worker-token').fill(token)
        page.locator('#connect').click()
        expect(page.locator('#connection-status')).to_contain_text('Connected.')
        page.locator('#connection [aria-label=Close]').click()
        # All three existing tools remain available without starting extra jobs.
        for layer, selector in [('repair', '[data-repair-file]'), ('localization', '[data-localization-file]'), ('motion', '[data-motion-file]')]:
            page.locator(f'[data-layer-tab={layer}]').click()
            expect(page.locator(selector)).to_be_visible()
        page.locator('[data-layer-tab=biomechanics]').click()
        page.locator('[data-biomech-example]').click()
        expect(page.locator('[data-biomech-input-info]')).to_contain_text('authored-pendulum.osim')
        assert not uploads, 'Trying the local example must not upload its inputs.'
        assert page.locator('.workspace-result-group').count() == 0

        def run(expected_jobs):
            page.locator('[data-biomech-consent]').check()
            page.locator('[data-biomech-run]').click()
            expect(page.locator('.workspace-result-group')).to_have_count(expected_jobs, timeout=120000)
            expect(results).to_be_visible()
            expect(page.locator('[data-biomech-seek]')).to_have_attribute('max', '30')
            expect(page.locator('#object-name')).to_have_value('Preserve my building edit')
            paths = list((tmp / 'data/jobs').glob('*/output/biomechanics-preview.json'))
            assert len(paths) >= expected_jobs
            path = max(paths, key=lambda item: item.stat().st_mtime_ns)
            return path, json.loads(path.read_bytes())

        # Consent is required before submitting any of the example's files.
        run_button = page.locator('[data-biomech-run]')
        if run_button.is_enabled():
            run_button.click()
            page.wait_for_timeout(150)
        assert not uploads, 'An unapproved example must remain local.'
        first_path, first_preview = run(1)
        print(f'{name}: real example kinematics completed', flush=True)
        page.locator('[data-biomech-play]').click()
        expect(page.locator('[data-biomech-seek]')).to_have_value('30', timeout=6000)
        page.locator('[data-biomech-pause]').click()
        page.locator('[data-biomech-seek]').fill('15')
        expect(page.locator('[data-biomech-info]')).to_contain_text('0.50')
        assert page.locator('[data-biomech-chart]').evaluate('(c)=>c.width>0 && c.height>0')
        assert page.locator('[data-biomech-canvas]').evaluate('(c)=>c.width>0 && c.height>0')
        # An invalid import cannot replace the already checked result or frame.
        bad = tmp / f'invalid-preview-{name}.json'
        bad.write_text(json.dumps({**first_preview, 'schema': 'not-a-biomechanics-preview'}))
        old_status = page.locator('[data-layer-status]').inner_text()
        page.locator('[data-biomech-preview]').set_input_files(str(bad))
        expect(page.locator('[data-layer-status]')).not_to_have_text(old_status)
        expect(results).to_be_visible()
        expect(page.locator('[data-biomech-seek]')).to_have_value('15')
        # Download the actual signed worker artifact and compare every byte.
        with page.expect_download() as pending:
            page.locator('button[title="biomechanics-preview.json"]').click()
        transfer = pending.value
        downloaded = Path(transfer.path()).read_bytes()
        assert downloaded == first_path.read_bytes()
        downloads.append({'name': transfer.suggested_filename, 'sha256': sha(downloaded)})
        page.locator('#world-layer-tools').screenshot(path=str(OUTPUT / f'biomechanics-{name}-kinematics.png'))

        # New inputs invalidate displayed analysis until a matching result runs.
        page.locator('[data-biomech-motion]').set_input_files(str(tmp / 'example/authored-motion.mot'))
        expect(results).to_be_hidden()
        expect(page.locator('[data-biomech-consent]')).not_to_be_checked()
        page.locator('summary').filter(has_text='Analysis settings and forces').click()
        page.locator('[data-biomech-analysis]').select_option('inverse-dynamics')
        page.locator('[data-biomech-load-mode]').select_option('none-declared')
        page.locator('[data-biomech-reason]').fill('Authored anchored pendulum; no contacts or external applied forces. Gravity is included.')
        approved_uploads = len(uploads)
        page.locator('[data-biomech-consent]').check()
        if run_button.is_enabled():
            run_button.click()
            page.wait_for_timeout(150)
        assert len(uploads) == approved_uploads, 'No-contact dynamics requires its explicit declaration.'
        page.locator('[data-biomech-no-loads-confirm]').check()
        unloaded_path, unloaded_preview = run(2)
        print(f'{name}: real declared no-contact inverse dynamics completed', flush=True)

        page.locator('[data-biomech-load-mode]').select_option('supplied')
        page.locator('[data-biomech-loads]').set_input_files(str(tmp / 'example/authored-loads.json'))
        expect(results).to_be_hidden()
        loaded_path, loaded_preview = run(3)
        print(f'{name}: real supplied-load inverse dynamics completed', flush=True)
        assert unloaded_preview != loaded_preview and unloaded_path != loaded_path
        # Exercise every offered numeric channel/metric without assuming labels.
        metric = page.locator('[data-biomech-metric]')
        for value in metric.locator('option').evaluate_all('(items)=>items.map(item=>item.value)'):
            metric.select_option(value)
            channel = page.locator('[data-biomech-channel]')
            if channel.locator('option').count():
                channel.select_option(index=0)
            page.locator('[data-biomech-seek]').fill('15')
            assert page.locator('[data-biomech-value]').inner_text().strip()
        page.locator('#world-layer-tools').screenshot(path=str(OUTPUT / f'biomechanics-{name}-dynamics.png'))

        # Reopen from retained results with the same originating private client.
        page.locator('#workspace-library > summary').click()
        row = page.locator('.workspace-result-file').filter(has=page.locator('strong', has_text='biomechanics-preview.json')).first
        row.get_by_role('button', name='Open', exact=True).click()
        expect(results).to_be_visible()
        expect(page.locator('[data-layer-tab=biomechanics]')).to_have_attribute('aria-selected', 'true')
        expect(page.locator('#object-name')).to_have_value('Preserve my building edit')
        page.evaluate("document.documentElement.dataset.readingSize='large'")
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 900})
            size = page.evaluate('({width:innerWidth,page:document.documentElement.scrollWidth})')
            assert size['page'] <= width + 1, (name, size)
            layouts.append(size)
            page.locator('#world-layer-tools').screenshot(path=str(OUTPUT / f'biomechanics-{name}-{width}.png'))
        page.locator('[data-layer-tab=motion]').focus()
        page.keyboard.press('ArrowRight')
        expect(page.locator('[data-layer-tab=biomechanics]')).to_be_focused()
        page.keyboard.press('ArrowRight')
        expect(page.locator('[data-layer-tab=open4dgs]')).to_be_focused()
        page.keyboard.press('ArrowRight')
        expect(page.locator('[data-layer-tab=stereo]')).to_be_focused()
        page.keyboard.press('ArrowRight')
        expect(page.locator('[data-layer-tab=repair]')).to_be_focused()
        assert not errors, errors
        receipt = {'passed': True, 'nativeOpenSimExecuted': True, 'analyses': ['kinematics', 'inverse-dynamics-none-declared', 'inverse-dynamics-supplied'],
                   'clinicalValidation': False, 'physicalValidation': False, 'originalMapPreserved': True,
                   'downloads': downloads, 'layouts': layouts, 'browserErrors': errors}
        (OUTPUT / f'biomechanics-{name}.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(f'{name}: PASS native analysis, consent, charts, playback, downloads, reopening and mobile', flush=True)
    except Exception:
        page.screenshot(path=str(OUTPUT / f'biomechanics-{name}-failure.png'), full_page=True)
        status = page.locator('[data-layer-status]').inner_text() if page.locator('[data-layer-status]').count() else 'no layer UI'
        print(f'{name}: browser errors={errors}; network failures={network_failures}; status={status}', file=sys.stderr, flush=True)
        raise
    finally:
        context.close()
        browser.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    native_python = os.environ['WORLD_BIOMECHANICS_TEST_PYTHON']
    server_python = os.environ.get('WORLD_SERVER_PYTHON', sys.executable)
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='brainsnn-biomechanics-browser-') as directory:
        tmp = Path(directory)
        subprocess.run([native_python, str(ROOT / 'robotics/biomechanics/authored_fixture.py'), '--out', str(tmp / 'example')],
                       cwd=tmp, check=True, timeout=60, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        front, back = port(), port()
        origin, worker = f'http://127.0.0.1:{front}', f'http://127.0.0.1:{back}'
        token = secrets.token_urlsafe(48)
        config = [{'id': 'biomechanics', 'label': 'Native biomechanics', 'enabled': True, 'license_reviewed': True,
                   'input_kinds': ['biomech-model', 'biomech-motion', 'biomech-options', 'biomech-loads'],
                   'max_inputs': 4, 'timeout_seconds': 180,
                   'command': [native_python, str(ROOT / 'robotics/world_worker/biomechanics.py'), '--input-manifest', '{input_manifest}']}]
        (tmp / 'adapters.json').write_text(json.dumps(config))
        env = {**os.environ, 'WORLD_WORKER_TOKEN': token, 'WORLD_WORKER_DIR': str(tmp / 'data'),
               'WORLD_ADAPTERS_FILE': str(tmp / 'adapters.json'), 'WORLD_ALLOWED_ORIGINS': origin,
               'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2', 'MKL_NUM_THREADS': '2'}
        try:
            for label, command, environment in [
                ('frontend', [server_python, '-c', 'import socketserver, runpy; socketserver.TCPServer.request_queue_size=128; runpy.run_module("http.server", run_name="__main__")', str(front), '--bind', '127.0.0.1', '--directory', str(ROOT / 'brainsnn-r3f-app/public')], os.environ),
                ('worker', [server_python, '-m', 'uvicorn', 'robotics.world_worker.app:create_app', '--factory', '--host', '127.0.0.1', '--port', str(back), '--no-access-log'], env),
            ]:
                log = (tmp / f'{label}.log').open('wb')
                logs.append(log)
                processes.append(subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=log))
            ready(origin + '/world/index.html', processes[0])
            ready(worker + '/healthz', processes[1])
            with sync_playwright() as pw:
                for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                    check(pw, name.strip(), origin, worker, token, tmp)
        except Exception:
            for path in [tmp / 'frontend.log', tmp / 'worker.log', *sorted((tmp / 'data/jobs').glob('*/operator.log'))]:
                if path.exists():
                    print(path.name + ':\n' + path.read_text(errors='replace')[-8000:], file=sys.stderr)
            raise
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            for log in logs:
                log.close()


if __name__ == '__main__':
    main()
