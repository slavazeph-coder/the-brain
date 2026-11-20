"""Exercise rectified photos through the real public stereo tool in both browsers."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'brainsnn-r3f-app/public'
EXAMPLE = PUBLIC / 'world/examples/stereo'
PROBES = [(117, 87, '1.00'), (237, 111, '1.50'), (303, 87, '2.40')]


class StaticServer(ThreadingHTTPServer):
    request_queue_size = 128


class QuietHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass


def verify_browser(engine, origin, output):
    flags = {'args':['--use-angle=swiftshader', '--enable-unsafe-swiftshader']} if engine.name == 'chromium' else {}
    browser = engine.launch(headless=True, **flags)
    page = browser.new_page(viewport={'width':1360, 'height':1000}, reduced_motion='reduce', accept_downloads=True, locale='en-US')
    errors, writes = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def read_only(route):
        if route.request.method not in ('GET', 'HEAD', 'OPTIONS'):
            writes.append(route.request.url)
            route.abort()
        else:
            route.continue_()

    page.route('**/*', read_only)
    page.goto(origin + '/world/index.html?nosw=1#layer-tab-stereo', wait_until='domcontentloaded')
    tab = page.locator('[data-layer-tab=stereo]')
    expect(tab).to_have_attribute('aria-selected', 'true')
    panel = page.locator('#layer-panel-stereo')
    expect(panel).to_be_visible()
    status = page.locator('[data-stereo-status]')
    example = page.locator('[data-stereo-example]')
    example.click()
    expect(status).to_contain_text('Authored example', timeout=15_000)
    match = re.search(r'([\d,]+) of ([\d,]+) sampled areas matched', status.inner_text())
    assert match is not None, status.inner_text()
    accepted, tested = (int(v.replace(',', '')) for v in match.groups())
    assert 1000 < accepted < tested, status.inner_text()
    depth = page.locator('[data-stereo-depth]')
    expect(depth).to_have_js_property('width', 320)
    expect(depth).to_have_js_property('height', 192)
    for x, y, metres in PROBES:
        bounds = depth.bounding_box()
        depth.click(position={'x':(x+.5)*bounds['width']/320, 'y':(y+.5)*bounds['height']/192})
        expect(page.locator('[data-stereo-probe]')).to_have_text(f'Estimated depth {metres} m.')
    marker = page.locator('[data-stereo-marker]')
    expect(marker).to_be_visible()
    before = marker.get_attribute('style')
    depth.press('ArrowLeft')
    assert before != marker.get_attribute('style')
    depth.click(position={'x': 12, 'y': 12})
    expect(page.locator('[data-stereo-probe]')).to_contain_text('No reliable depth')

    page.get_by_text('Look at the matching points in 3D', exact=True).click()
    canvas = page.locator('[data-stereo-points]')
    assert canvas.is_visible()
    if page.locator('[data-stereo-turn=left]').is_visible():
        picture = canvas.screenshot()
        page.locator('[data-stereo-turn=left]').click()
        assert picture != canvas.screenshot(), 'The 3D orbit should change the drawn view.'
    with page.expect_download() as saved:
        page.locator('[data-stereo-download]').click()
    ply = output / f'{engine.name}-matching-points.ply'
    saved.value.save_as(ply)
    text = ply.read_text()
    assert text.startswith('ply\nformat ascii 1.0\n')
    assert f'element vertex {accepted}\n' in text
    assert len(text.split('end_header\n', 1)[1].splitlines()) == accepted

    page.locator('[data-stereo-own] summary').first.click()
    page.locator('[data-stereo-left]').set_input_files(str(EXAMPLE/'left.png'))
    page.locator('[data-stereo-right]').set_input_files(str(EXAMPLE/'right.png'))
    rig = json.loads((EXAMPLE/'calibration.json').read_text())
    for key, value in rig.items():
        if key != 'schema':
            page.locator(f'[data-stereo-rig={key}]').fill(str(value))
    page.locator('[data-stereo-rig=width]').fill('321')
    page.locator('[data-stereo-confirm]').check()
    page.locator('[data-stereo-run]').click()
    expect(status).to_contain_text('same original size')
    expect(page.locator('[data-stereo-result]')).to_be_hidden()
    page.locator('[data-stereo-rig=width]').fill('320')
    expect(page.locator('[data-stereo-confirm]')).not_to_be_checked()
    page.locator('[data-stereo-confirm]').check()
    page.locator('[data-stereo-run]').click()
    expect(status).to_contain_text(f'Depth estimate ready. {accepted:,}')
    page.locator('[data-stereo-cal-mode]').select_option('file')
    page.locator('[data-stereo-cal-file]').set_input_files(str(EXAMPLE/'calibration.json'))
    page.locator('[data-stereo-confirm]').check()
    page.locator('[data-stereo-run]').click()
    expect(status).to_contain_text(f'Depth estimate ready. {accepted:,}')
    page.get_by_text('Photos and calibration used', exact=True).click()
    expect(page.locator('[data-stereo-source]')).to_contain_text('baseline 0.1 m')
    page.get_by_role('button', name='Larger text', exact=True).click()
    for width in [390, 320]:
        page.set_viewport_size({'width':width, 'height':850})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert panel.evaluate('e=>e.scrollWidth<=Math.ceil(e.getBoundingClientRect().width)+1')
        panel.screenshot(path=str(output/f'{engine.name}-{width}.png'))
    page.locator('[data-stereo-clear]').click()
    expect(page.locator('[data-stereo-result]')).to_be_hidden()
    expect(example).to_be_focused()
    assert not errors and not writes, (errors,writes)
    browser.close()
    print(f'{engine.name}: matched 1.00/1.50/2.40 m, {accepted} PLY points, rig form and JSON, 390/320 enlarged text, no writes.', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    server = None
    try:
        if args.origin:
            origin = args.origin.rstrip('/')
        else:
            server = StaticServer(('127.0.0.1', 0), partial(QuietHandler, directory=PUBLIC))
            Thread(target=server.serve_forever, daemon=True).start()
            origin = f'http://127.0.0.1:{server.server_port}'
        with TemporaryDirectory() as case, sync_playwright() as playwright:
            output = args.out or Path(case)
            output.mkdir(parents=True, exist_ok=True)
            for name in ['chromium', 'webkit']:
                verify_browser(getattr(playwright, name), origin, output)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
