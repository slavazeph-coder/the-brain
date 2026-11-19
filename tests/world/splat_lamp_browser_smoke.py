"""Verify the preview-only lamp using the public editor and a real WebGL2 framebuffer."""
import argparse
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import expect, sync_playwright

PUBLIC = Path(__file__).resolve().parents[2] / 'brainsnn-r3f-app/public'
LAMP = '#splat-appearance-lamp'


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


def framebuffer_checks(page):
    result = page.evaluate("""async () => {
      const { createVisualViewer } = await import('./visual-viewer.mjs');
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px';
      document.body.append(canvas);
      const viewer = createVisualViewer(canvas);
      try {
        const gl = canvas.getContext('webgl2');
        const gaussian = x => [x,0,0, .14,.14,.14, .16,.21,.26,.95, 0,0,0,1];
        const source = new Float32Array([...gaussian(-1), ...gaussian(1)]);
        const originalSource = source.slice();
        viewer.setPoints(source, {kind:'gaussian-splat'});
        const view = {eye:[0,0,4],target:[0,0,0],fov:60};
        viewer.setView(view);
        const pixels = () => {
          const data = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
          return data;
        };
        const changedHalves = (before, after) => {
          const counts = [0,0];
          for (let i = 0; i < before.length; i += 4) {
            if (before[i] !== after[i] || before[i+1] !== after[i+1] || before[i+2] !== after[i+2]) {
              counts[Number((i/4) % canvas.width >= canvas.width / 2)]++;
            }
          }
          return counts;
        };
        const baseline = pixels();
        const lamp = x => ({position:[x,0,0], radius:.42, strength:1, tint:[1,1,1]});
        viewer.setAppearanceLamp(lamp(-1));
        const blocksUnrenderedCapture = viewer.getCaptureCanvas() === null;
        viewer.setView(view);
        const left = changedHalves(baseline, pixels());
        let blocksSnapshot = false;
        try { viewer.snapshot(); } catch (error) { blocksSnapshot = /preview lamp/.test(error.message); }
        const preservesSelectionCanvas = viewer.getCanvas() === canvas;
        viewer.setAppearanceLamp(lamp(1));
        viewer.setView(view);
        const right = changedHalves(baseline, pixels());
        viewer.setAppearanceLamp(null);
        return {left, right, reset:changedHalves(baseline, pixels()), blocksSnapshot,
          cameraUnchanged:JSON.stringify(viewer.getView()) === JSON.stringify(view),
          sourceUnchanged:originalSource.every((value, index) => value === source[index]),
          blocksUnrenderedCapture, preservesSelectionCanvas, captureRestored:viewer.getCaptureCanvas() === canvas};
      } finally {
        viewer.destroy();
        canvas.remove();
      }
    }""")
    assert result['left'][0] > 100 and result['left'][1] == 0, result
    assert result['right'][0] == 0 and result['right'][1] > 100, result
    assert result['reset'] == [0, 0], result
    for key in ('blocksSnapshot', 'sourceUnchanged', 'cameraUnchanged', 'blocksUnrenderedCapture',
                'preservesSelectionCanvas', 'captureRestored'):
        assert result[key], (key, result)
    return result


def download_bytes(page, button, output):
    with page.expect_download() as download:
        button.click()
    download.value.save_as(output)
    return output.read_bytes()


def path_bytes(page, output):
    return download_bytes(page, page.locator('[data-tour-export]'), output)


def verify_standalone(page, origin, output, engine):
    page.goto(origin + '/world/splat.html?nosw=1', wait_until='domcontentloaded')
    lamp = page.locator(LAMP)
    expect(lamp).to_be_hidden()
    pixels = framebuffer_checks(page)
    page.locator('[data-scan-example=reading]').click()
    expect(page.locator('#viewer-status')).to_contain_text('Reading room ready')
    expect(lamp).to_be_visible()
    lamp.locator('summary').click()
    toggle = lamp.locator('[data-lamp-enabled]')
    expect(toggle).not_to_be_checked()
    add = page.locator('[data-tour-add]')
    add.click()
    page.locator('#asset-canvas').press('ArrowRight')
    add.click()
    expect(page.locator('[data-tour-play]')).to_be_enabled()
    video_was_enabled = page.locator('[data-tour-video]').is_enabled()
    old_path = path_bytes(page, output / f'{engine}-original-path.json')
    canvas = page.locator('#asset-canvas')
    reading_baseline = canvas.screenshot()
    toggle.press('Space')
    expect(toggle).to_be_checked()
    assert canvas.screenshot() != reading_baseline, 'The lamp should brighten the authored reading room.'
    expect(page.locator('[data-tour-play]')).to_be_disabled()
    expect(page.locator('[data-tour-video]')).to_be_disabled()
    axis = lamp.locator('[data-lamp-slider=x]')
    axis.press('ArrowRight')
    expect(axis).to_have_attribute('aria-valuetext', '1 percent')
    lamp.locator('[data-lamp-tint]').select_option('warm')
    place = lamp.locator('[data-lamp-place]')
    place.click()
    expect(place).to_have_attribute('aria-pressed', 'true')
    expect(canvas).to_be_focused()
    canvas.press('Escape')
    expect(place).to_have_attribute('aria-pressed', 'false')
    expect(place).to_be_focused()
    assert path_bytes(page, output / f'{engine}-lit-path.json') == old_path
    toggle.uncheck()
    expect(page.locator('[data-tour-play]')).to_be_enabled()
    assert page.locator('[data-tour-video]').is_enabled() == video_was_enabled
    assert canvas.screenshot() == reading_baseline, 'Turning off the lamp should restore the reading room.'
    toggle.check()
    page.locator('[data-scan-example=studio]').click()
    expect(page.locator('#viewer-status')).to_contain_text('Empty studio ready')
    expect(toggle).not_to_be_checked()
    studio_baseline = canvas.screenshot()
    toggle.check()
    expect(lamp.locator('[data-lamp-status]')).to_contain_text('Lamp on.')
    assert canvas.screenshot() != studio_baseline, 'The lamp should brighten the authored studio.'
    page.locator('#flip').click()
    expect(toggle).not_to_be_checked()
    page.locator('#asset').set_input_files({
        'name': 'plain-cloud.ply', 'mimeType': 'application/octet-stream',
        'buffer': b'ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n',
    })
    expect(page.locator('#viewer-status')).to_contain_text('plain-cloud.ply')
    expect(lamp).to_be_hidden()
    print(f'{engine}: local Gaussian pixels {pixels["left"]} / {pixels["right"]}, exact off restore and path equality.', flush=True)


def verify_suspended_tour(page, frame, scan_tab, output, engine):
    add = frame.locator('[data-tour-add]')
    frame.locator('[data-tour-interval]').fill('2')
    add.click()
    frame.locator('#asset-canvas').press('ArrowRight')
    add.click()
    record = frame.locator('[data-tour-video]')
    video = frame.locator('[data-tour-save-video]')
    receipt = frame.locator('[data-tour-save-receipt]')
    status = frame.locator('[data-tour-status]')
    play = frame.locator('[data-tour-play]')
    stop = frame.locator('[data-tour-stop]')
    path = frame.locator('[data-tour-export]')
    stereo = page.locator('#layer-tab-stereo')
    controls = frame.locator('#camera-tour')
    supported = controls.evaluate("""async () => {
      const { pickMime } = await import('./share-video.mjs');
      return typeof MediaRecorder === 'function' && typeof document.createElement('canvas').captureStream === 'function'
        && Boolean(pickMime(type => MediaRecorder.isTypeSupported(type)));
    }""")
    if supported:
        record.tap()
        expect(status).to_contain_text('Recording ready.', timeout=15_000)
        expect(video).to_be_enabled()
        expect(receipt).to_be_enabled()

    stereo.tap()
    scan_tab.tap()
    expect(path).to_be_enabled()
    if not supported:
        print(f'{engine}: retained the camera path; this browser has no advertised recorder.', flush=True)
        return

    # The first download occurs after switching workshop tools with the unsaved clip.
    expect(status).to_contain_text('Recording ready.')
    expect(video).to_be_enabled()
    expect(receipt).to_be_enabled()
    video_before = download_bytes(page, video, output / f'{engine}-video-before')
    receipt_before = download_bytes(page, receipt, output / f'{engine}-receipt-before.json')
    path_before = download_bytes(page, path, output / f'{engine}-tour-before.json')
    clip = json.loads(receipt_before)
    assert clip['video']['sha256'] == sha256(video_before).hexdigest()
    assert clip['video']['bytes'] == len(video_before) > 2000
    assert clip['source']['sha256'] == json.loads(path_before)['source']['sha256']

    # Start another preview and leave via the real workspace tab handler.
    play.tap()
    expect(stop).to_be_enabled()
    stereo.evaluate('tab => tab.click()')
    scan_tab.tap()
    expect(stop).to_be_disabled()
    expect(status).to_contain_text('Tour stopped.')
    expect(video).to_be_enabled()
    expect(receipt).to_be_enabled()

    # Simulate a hidden browser document while an attempted retake is active.
    record.tap()
    expect(stop).to_be_enabled()
    controls.evaluate("""() => {
      Object.defineProperty(document, 'hidden', {value:true, configurable:true});
      try { document.dispatchEvent(new Event('visibilitychange')); }
      finally { delete document.hidden; }
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    expect(stop).to_be_disabled()
    expect(status).to_contain_text('Tour stopped.')

    lamp = frame.locator(LAMP)
    lamp.locator('summary').tap()
    toggle = lamp.locator('[data-lamp-enabled]')
    toggle.tap()
    expect(play).to_be_disabled()
    expect(record).to_be_disabled()
    expect(video).to_be_enabled()
    expect(receipt).to_be_enabled()
    assert download_bytes(page, video, output / f'{engine}-video-after') == video_before
    assert download_bytes(page, receipt, output / f'{engine}-receipt-after.json') == receipt_before
    assert download_bytes(page, path, output / f'{engine}-tour-after.json') == path_before
    toggle.tap()
    expect(record).to_be_enabled()
    lamp.locator('summary').tap()
    print(f'{engine}: retained completed video SHA-256 {clip["video"]["sha256"]}, receipt and path across suspension and lamp use.', flush=True)


def verify_embedded(page, origin, output, engine):
    page.goto(origin + '/world/index.html?nosw=1#layer-tab-scanedit', wait_until='domcontentloaded')
    scan_tab = page.locator('#layer-tab-scanedit')
    expect(scan_tab).to_have_attribute('aria-selected', 'true')
    frame = page.frame_locator('#scan-workshop-frame')
    lamp = frame.locator(LAMP)
    expect(frame.locator('#viewer-status')).to_contain_text('Reading room ready')
    verify_suspended_tour(page, frame, scan_tab, output, engine)
    lamp.locator('summary').tap()
    toggle = lamp.locator('[data-lamp-enabled]')
    toggle.tap()
    expect(toggle).to_be_checked()
    place = lamp.locator('[data-lamp-place]')
    place.tap()
    expect(place).to_have_attribute('aria-pressed', 'true')
    frame.locator('#asset-canvas').tap()
    expect(lamp.locator('[data-lamp-status]')).to_have_text('Lamp moved to the selected spot.')
    expect(place).to_have_attribute('aria-pressed', 'false')
    draw = frame.locator('[data-objectify-select]')
    suggest = frame.locator('[data-objectify-suggest]')
    canvas = frame.locator('#asset-canvas')
    draw.tap()
    expect(draw).to_have_attribute('aria-pressed', 'true')
    place.tap()
    expect(draw).to_have_attribute('aria-pressed', 'false')
    expect(place).to_have_attribute('aria-pressed', 'true')
    suggest.tap()
    expect(place).to_have_attribute('aria-pressed', 'false')
    expect(suggest).to_have_attribute('aria-pressed', 'true')
    canvas.press('Escape')
    expect(suggest).to_have_attribute('aria-pressed', 'false')
    expect(suggest).to_be_focused()
    draw.tap()
    expect(draw).to_have_attribute('aria-pressed', 'true')
    draw.press('Escape')
    expect(draw).to_have_attribute('aria-pressed', 'false')
    place.tap()
    page.locator('#layer-tab-stereo').tap()
    scan_tab.tap()
    expect(place).to_have_attribute('aria-pressed', 'false')
    if not toggle.is_checked():
        toggle.tap()
    frame.locator('[data-scan-example=studio]').tap()
    expect(frame.locator('#viewer-status')).to_contain_text('Empty studio ready')
    expect(toggle).not_to_be_checked()
    toggle.tap()
    expect(toggle).to_be_checked()
    expect(lamp.locator('[data-lamp-reset]')).to_be_enabled()
    page.get_by_role('button', name='Larger text', exact=True).tap()
    for width in (390, 320):
        page.set_viewport_size({'width': width, 'height': 850})
        assert lamp.evaluate('el => el.scrollWidth <= Math.ceil(el.getBoundingClientRect().width) + 1')
        if width == 390:
            lamp.screenshot(path=output / f'{engine}-embedded-lamp.png')
    print(f'{engine}: touch placement, exclusive canvas modes and Escape, suspension, both authored rooms and 390/320 layout.', flush=True)


def verify_browser(engine, origin, output):
    flags = {'args': ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']} if engine.name == 'chromium' else {}
    browser = engine.launch(headless=True, **flags)
    errors, writes = [], []
    try:
        desktop = browser.new_page(viewport={'width': 1360, 'height': 1000}, accept_downloads=True, reduced_motion='reduce')
        mobile = browser.new_page(viewport={'width': 390, 'height': 850}, has_touch=True, accept_downloads=True, reduced_motion='reduce')

        def read_only(route):
            if route.request.method in ('GET', 'HEAD', 'OPTIONS'):
                route.continue_()
            else:
                writes.append(route.request.url)
                route.abort()

        for page in (desktop, mobile):
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', read_only)
        verify_standalone(desktop, origin, output, engine.name)
        verify_embedded(mobile, origin, output, engine.name)
        assert not errors and not writes, (errors, writes)
    finally:
        browser.close()


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
            for name in ('chromium', 'webkit'):
                verify_browser(getattr(playwright, name), origin, output)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
