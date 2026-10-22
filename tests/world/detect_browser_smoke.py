"""On-device object identification in a real browser: actual detector download and inference, review, proof.

Opt-in because it downloads the pinned detector (~45 MB) and runtime; CI does not download model weights.
  WORLD_DETECT_PHOTO=/absolute/path/to/room-photo.jpg python tests/world/detect_browser_smoke.py
Outbound model downloads use HTTPS_PROXY when it is set. The photo itself must never leave the page.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import functools
import json
import os
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world/detect'


def check(browser, url, photo):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors, remote = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    # Every request leaving the page origin: only GETs for the pinned runtime and model files are allowed.
    page.context.on('request', lambda r: remote.append((r.method, r.url)) if not r.url.startswith(url.split('/world/')[0]) and not r.url.startswith(('blob:', 'data:')) else None)
    page.goto(url, wait_until='networkidle')
    page.locator('#files').set_input_files(str(photo))
    page.locator('[data-tab=capture]').click()
    page.locator('[data-action=detect]').click()
    assert 'not uploaded' in page.locator('#detect-consent').inner_text()
    page.locator('#detect-start').click()
    page.wait_for_function("/proposed on this device/.test(document.querySelector('#status').textContent)", timeout=300_000)
    status = page.locator('#status').inner_text()
    panel = page.locator('#panel')
    assert 'Xenova/detr-resnet-50' in panel.inner_text()
    cards = page.locator('.observation-card')
    count = cards.count()
    assert count >= 1, status
    labels = [cards.nth(i).locator('strong').inner_text() for i in range(count)]
    cards.nth(0).get_by_role('button', name='Show proposed bounds').click()
    assert page.locator('.observation-box').first.is_visible()
    assert 'On-device object detection completed' in page.locator('#worker-summary').inner_text()
    page.locator('#panel').scroll_into_view_if_needed()
    page.screenshot(path=str(OUTPUT / 'chromium-review.png'), full_page=False)
    cards.nth(0).get_by_role('button', name='Accept / save edit').click()
    page.locator('[data-tab=evidence]').click()
    with page.expect_download() as download:
        page.locator('[data-action=proof]').click()
    proof = json.loads(Path(download.value.path()).read_text())
    observed = proof['observations'][0]
    assert observed['sidecar']['model']['id'] == 'Xenova/detr-resnet-50' and observed['sidecar']['source']['kind'] == 'photo'
    assert observed['reviews'][0]['status'] == 'accepted'
    # Adding the photo already replaced the untouched sample; detection must not create or edit any map.
    assert proof['world'] is None, 'detections never create or edit a map'
    assert not any(e['type'] in ('geometry_edit', 'map_import', 'map_proposed') for e in proof['events']), proof['events']
    assert any(e['type'] == 'local_detection_completed' for e in proof['events'])
    assert all(method == 'GET' and ('huggingface.co' in u or 'hf.co' in u or 'cdn.jsdelivr.net' in u or 'xethub' in u) for method, u in remote), remote
    page.screenshot(path=str(OUTPUT / 'chromium-detections.png'), full_page=False)
    assert not errors, errors
    page.close()
    return {'status': status, 'labels': labels, 'remote_hosts': sorted({u.split('/')[2] for _, u in remote})}


if __name__ == '__main__':
    photo = os.environ.get('WORLD_DETECT_PHOTO')
    if not photo:
        raise SystemExit('Set WORLD_DETECT_PHOTO to a local room photo to run this opt-in inference test.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / 'brainsnn-r3f-app/public')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            executable = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
            proxy = {'server': os.environ['HTTPS_PROXY'], 'bypass': '127.0.0.1,localhost'} if os.environ.get('HTTPS_PROXY') else None
            browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}), **({'proxy': proxy} if proxy else {}))
            print(json.dumps(check(browser, f'http://127.0.0.1:{server.server_port}/world/index.html', photo)), flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
