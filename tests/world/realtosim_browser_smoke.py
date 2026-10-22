"""Real-to-sim handoff in real browsers: reconstruction points + camera poses -> proposed map -> review gate -> plan.

The reconstruction is a synthetic measured room expressed in an arbitrary COLMAP-like frame (rotated, scaled
and shifted), so no captured media is committed. Actual reconstructions are checked in the validation report.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import functools
import json
import math
import os
import struct
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world/realtosim'
K, SHIFT = .37, (4, -2, 7)


def rotation(ax, ay, az):
    ca, sa, cb, sb, cc, sc = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    return [[cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc], [cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc], [-sb, sa * cb, ca * cb]]


R = rotation(.9, -.4, 2.1)


def apply(m, v):
    return [sum(m[r][c] * v[c] for c in range(3)) for r in range(3)]


def to_colmap(p):
    return [v * K + SHIFT[i] for i, v in enumerate(apply(R, p))]


def fixture():
    """An 8 x 6 m room with a 1 m box, an unobserved corner and a walk around the box at 1.35 m."""
    points = []
    def frange(a, b, s):
        x = a
        while x < b:
            yield x
            x += s
    for x in frange(.05, 8, .15):
        for z in frange(.05, 6, .15):
            if not (x > 6.4 and z > 5) and not (3 < x < 4 and 2 < z < 3):
                points.append(([x, 0, z], (150, 140, 120)))
    for x in frange(3, 4.01, .1):
        for z in frange(2, 3.01, .1):
            points.append(([x, .8, z], (200, 80, 60)))
    for s in frange(0, 8, .2):
        for y in frange(.2, 2.5, .2):
            points.append(([s, y, 0], (220, 220, 220)))
            if s < 6.4:
                points.append(([s, y, 6], (220, 220, 220)))
    for s in frange(0, 6, .2):
        for y in frange(.2, 2.5, .2):
            points.append(([0, y, s], (220, 220, 220)))
            if s < 5:
                points.append(([8, y, s], (220, 220, 220)))
    path = [[4 + 2.4 * math.cos(t * math.pi / 20), 1.35, 2.8 + 1.7 * math.sin(t * math.pi / 20)] for t in range(40)]
    cameras = []
    for i, c in enumerate(path):
        n = path[(i + 1) % len(path)]
        f = [n[0] - c[0], 0, n[2] - c[2]]
        length = math.hypot(*f)
        forward = [v / length for v in f]
        down = [0, -1, 0]
        right = [forward[1] * down[2] - forward[2] * down[1], forward[2] * down[0] - forward[0] * down[2], forward[0] * down[1] - forward[1] * down[0]]
        rows = [apply(R, r) for r in (right, down, forward)]
        cameras.append({'image': f'image_{i:04d}.jpg', 'camera_center': to_colmap(c), 'world_to_camera': [row + [0] for row in rows]})
    header = (f'ply\nformat binary_little_endian 1.0\nelement vertex {len(points)}\n'
              'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode('ascii')
    body = b''.join(struct.pack('<fffBBB', *to_colmap(p), *rgb) for p, rgb in points)
    evidence = {'schema': 'brainsnn.reconstruction.v1', 'pipeline': 'synthetic-fixture', 'coordinate_frame': 'colmap', 'units': 'arbitrary',
                'metric_verified': False, 'cameras': cameras}
    return header + body, json.dumps(evidence).encode()


def check(browser, url, ply, evidence, mobile=False):
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000}, has_touch=mobile)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='networkidle')
    label = f'{browser.browser_type.name}-{"mobile" if mobile else "desktop"}'
    page.locator('#files').set_input_files({'name': 'room.ply', 'mimeType': 'application/octet-stream', 'buffer': ply})
    page.wait_for_function("/Visual asset loaded/.test(document.querySelector('#status').textContent)")
    # Points alone cannot become a map: the camera poses are required.
    assert page.locator('[data-action=propose-map]').count() == 0
    assert 'reconstruction.json' in page.locator('#panel').inner_text()
    page.locator('#files').set_input_files({'name': 'reconstruction.json', 'mimeType': 'application/json', 'buffer': evidence})
    page.locator('[data-action=propose-map]').wait_for()
    page.locator('#camera-height').fill('1.35')
    page.locator('[data-action=propose-map]').click()
    page.wait_for_function("/Map proposed from 40 camera poses/.test(document.querySelector('#status').textContent)")
    assert page.locator('#provenance').inner_text() == 'REVIEW REQUIRED'
    assert 'reconstruction-proposal' in page.locator('#panel').inner_text()
    assert not page.locator('#scale-reviewed').is_checked() and not page.locator('#map-reviewed').is_checked()
    page.locator('#run').click()
    page.wait_for_timeout(200)
    assert 'Confirm independently measured scale' in page.locator('#status').inner_text()
    assert page.locator('#metric-distance').inner_text() == '—'
    page.locator('#scale-reviewed').check()
    page.locator('#map-reviewed').check()
    page.locator('#run').click()
    page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')", timeout=15000)
    distance = float(page.locator('#metric-distance').inner_text().split()[0])
    assert distance > 3, distance
    page.locator('[data-tab=evidence]').click()
    with page.expect_download() as download:
        page.locator('[data-action=proof]').click()
    proof = json.loads(Path(download.value.path()).read_text())
    assert proof['world']['geometrySource']['kind'] == 'reconstruction-proposal'
    proposed = [e for e in proof['events'] if e['type'] == 'map_proposed']
    assert proposed and proposed[-1]['detail']['scaleVerified'] is False and proposed[-1]['detail']['cameras'] == 40
    assert abs(proposed[-1]['detail']['metresPerUnit'] - 1 / K) / (1 / K) < .05
    assert proof['result']['policyExecuted'] is False
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.locator('#viewport').scroll_into_view_if_needed()
    page.screenshot(path=str(OUTPUT / f'{label}.png'), full_page=mobile)
    measured = calibrate(page, mobile, label)
    assert not errors, errors
    context.close()
    print(f'{label}: proposed, gated, reviewed and planned {distance} m; measured scale {measured:.4f} m/unit', flush=True)


SCROLL_SETTLED = """() => new Promise(resolve => {
  let last = -1, still = 0;
  const tick = () => { still = scrollY === last ? still + 1 : 0; last = scrollY; if (still >= 6) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})"""

# Client coordinates of lit (drawn) pixels on the 3D view, inside the visible viewport: candidates from the left and right.
VISIBLE_POINT_TARGETS = """() => {
  const canvas = document.querySelector('#visual-canvas'), rect = canvas.getBoundingClientRect(), w = canvas.width, h = canvas.height;
  const copy = document.createElement('canvas'); copy.width = w; copy.height = h;
  const context = copy.getContext('2d'); context.drawImage(canvas, 0, 0);
  const data = context.getImageData(0, 0, w, h).data, lit = [];
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const i = (y * w + x) * 4, cx = rect.left + (x + .5) / w * rect.width, cy = rect.top + (y + .5) / h * rect.height;
    if (data[i] + data[i + 1] + data[i + 2] > 300 && cx > 4 && cy > 4 && cx < innerWidth - 4 && cy < innerHeight - 4) lit.push([cx, cy]);
  }
  lit.sort((a, b) => a[0] - b[0]);
  const at = q => lit[Math.min(lit.length - 1, Math.floor(q * lit.length))];
  return {lit: lit.length, canvas: [w, h], rect: [rect.left, rect.top, rect.width, rect.height],
    left: lit.length ? [.1, .15, .2, .25].map(at) : [], right: lit.length ? [.9, .85, .8, .75].map(at) : []};
}"""


def calibrate(page, mobile, label):
    """Tap two reconstruction points, enter their true distance and re-propose at that exact scale."""
    page.on('dialog', lambda dialog: dialog.accept())
    page.locator('[data-tab=capture]').click()
    page.locator('[data-action=pick-scale]').click()
    assert page.locator('[data-action=pick-scale]').get_attribute('aria-pressed') == 'true'
    # The page scrolls smoothly; an animating scroll would move the canvas under the taps. Jump, then wait until still.
    page.locator('#visual-canvas').evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})")
    page.evaluate(SCROLL_SETTLED)
    trail = []
    # Tap where points are actually drawn, as a person would: lit pixels of the rendered cloud (the WebGL canvas
    # preserves its drawing buffer). One end on the left of the cloud, then the other on the right.
    for side, done in (('left', "/other end/.test(document.querySelector('#status').textContent)"),
                       ('right', "!!document.querySelector('#picked-span')")):
        targets = page.evaluate(VISIBLE_POINT_TARGETS)
        assert targets[side], targets
        for x, y in targets[side]:
            if mobile:
                page.touchscreen.tap(x, y)
            else:
                page.mouse.click(x, y)
            page.wait_for_timeout(250)
            trail.append(page.locator('#status').inner_text())
            if page.evaluate(done):
                break
        if not page.evaluate(done):
            page.screenshot(path=str(OUTPUT / f'{label}-calibration-failed.png'), full_page=True)
        assert page.evaluate(done), {'side': side, 'statuses': trail, 'targets': targets, 'zoom': page.evaluate('visualViewport.scale')}
    assert 'Enter the distance you measured' in page.locator('#status').inner_text()
    page.screenshot(path=str(OUTPUT / f'{label}-calibration.png'))
    span = float(page.locator('#picked-span').inner_text().split(':')[1].split()[0])
    # The fixture's true metric distance between any two of its points is the COLMAP span divided by K.
    page.locator('#measured-distance').fill(f'{span / K:.4f}')
    page.locator('[data-action=propose-measured]').click()
    page.wait_for_function("/at your measured .* m scale/.test(document.querySelector('#status').textContent)")
    assert page.locator('#provenance').inner_text() == 'REVIEW REQUIRED'
    assert 'self-reported' in page.locator('#panel').inner_text()
    assert not page.locator('#scale-reviewed').is_checked()
    page.locator('[data-tab=evidence]').click()
    with page.expect_download() as download:
        page.locator('[data-action=proof]').click()
    proof = json.loads(Path(download.value.path()).read_text())
    event = [e for e in proof['events'] if e['type'] == 'map_proposed'][-1]['detail']
    assert event['scaleSource'] == 'measured-pair' and event['assumedCameraHeight'] is None and event['scaleVerified'] is False
    assert event['measurement']['selfReported'] is True and len(event['measurement']['a']) == 3
    assert abs(event['metresPerUnit'] * K - 1) < 2e-3, event['metresPerUnit']
    assert abs(event['impliedCameraHeight'] - 1.35) < .1, event['impliedCameraHeight']
    return event['metresPerUnit']


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ply, evidence = fixture()
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / 'brainsnn-r3f-app/public')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
                browser = getattr(playwright, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
                for mobile in (False, True):
                    check(browser, f'http://127.0.0.1:{server.server_port}/world/index.html', ply, evidence, mobile)
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
