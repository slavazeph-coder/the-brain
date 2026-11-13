"""Exercise local movement review over the production server in desktop and phone layouts."""
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


BASE = os.getenv('WORLD_SITE_URL', 'http://127.0.0.1:4180').rstrip('/')
FORCE_CSV = b'time_s,vertical_force_n\n0.2,100\n0.8,400\n1.4,700\n'
MOTION = b"""name authored-knee-coordinates
nRows=2
nColumns=3
inDegrees=yes
endheader
time\tknee_angle_r\tknee_angle_l
0.0\t-10.0\t15.0
1.25\t-20.5\t30.0
"""


def download_json(page, selector):
    button = page.locator(selector)
    expect(button).to_be_enabled()
    with page.expect_download() as event:
        button.focus()
        button.press('Enter')
    download = event.value
    assert download.failure() is None
    return json.loads(download.path().read_text())


def annotate(page, points):
    canvas = page.locator('#overlay')
    expect(canvas).to_be_visible()
    bounds = canvas.bounding_box()
    for x, y in points:
        canvas.click(position={'x': round(x * bounds['width']), 'y': round(y * bounds['height'])})
    button = page.locator('#save-frame')
    expect(button).to_be_enabled()
    button.click()


def check(page, clip):
    errors, writes = [], []
    page.set_default_timeout(12000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda req: writes.append(req.url) if req.method not in {'GET', 'HEAD'} else None)
    response = page.goto(f'{BASE}/world/movement.html')
    assert response and response.ok
    page.locator('#demo').press('Enter')
    demo = download_json(page, '#export')
    assert demo['schema'] == 'brainsnn.movement-review.v1'
    assert demo['source']['kind'] == 'synthetic'
    assert len(demo['observations']) >= 2

    page.locator('#video-file').set_input_files(clip)
    page.wait_for_function("""() => {const v=document.querySelector('#video');
      return v.readyState >= 2 && v.videoWidth === 320 && v.paused}""")
    expect(page.locator('#frames [data-remove]')).to_have_count(0)
    # Exercise the keyboard annotation path before marking a known pose with the pointer.
    canvas = page.locator('#overlay')
    canvas.focus()
    canvas.press('ArrowRight')
    canvas.press('Enter')
    undo = page.locator('#undo')
    expect(undo).to_be_enabled()
    undo.press('Enter')
    expect(undo).to_be_disabled()
    annotate(page, [(0.3, 0.25), (0.3, 0.75), (0.7, 0.75)])
    seek = page.locator('#time')
    seek.focus()
    seek.press('ArrowRight')
    expect(seek).to_be_focused()
    page.wait_for_function("document.querySelector('#video').currentTime > 0")
    seek.evaluate("""el => { el.value = '1'; el.dispatchEvent(new Event('input', {bubbles: true})); }""")
    page.wait_for_function("""() => {const v=document.querySelector('#video');
      return !v.seeking && v.readyState >= 2 && document.querySelector('#stage').dataset.seeking === 'false'
        && Math.abs(v.currentTime - 1) < 0.02}""")
    annotate(page, [(0.45, 0.2), (0.45, 0.5), (0.45, 0.8)])
    expect(page.locator('#frames [data-remove]')).to_have_count(2)
    review = download_json(page, '#export')
    assert review['source']['kind'] == 'video' and review['forceTrace'] is None
    first, second = review['observations']
    assert first['timeSeconds'] == 0 and math.isclose(second['timeSeconds'], 1, abs_tol=0.02)
    assert math.isclose(first['kneeFlexionDegrees'], 90, abs_tol=1)
    assert math.isclose(second['kneeFlexionDegrees'], 0, abs_tol=1)
    assert all(obs['verticalForceN'] is None for obs in (first, second))

    page.locator('#force-file').set_input_files({'name': 'platform.csv', 'mimeType': 'text/csv', 'buffer': FORCE_CSV})
    page.locator('#force-kind').select_option('measured')
    page.locator('#force-label').fill('Authored force-platform fixture')
    page.locator('#force-offset').fill('0.2')
    page.locator('#apply-force').click()
    expect(page.locator('#force')).to_contain_text('400')
    synced = download_json(page, '#export')
    trace = synced['forceTrace']
    assert trace['kind'] == 'measured' and trace['label'] == 'Authored force-platform fixture'
    assert trace['offsetSeconds'] == 0.2
    assert trace['samples'][1] == {'timeSeconds': 0.8, 'verticalForceN': 400}
    assert synced['observations'][0]['verticalForceN'] is None
    assert math.isclose(synced['observations'][1]['verticalForceN'], 400, abs_tol=0.1)

    page.locator('#support-model summary').click()
    page.locator('#support-mass').fill('80')
    page.locator('#support-label').fill('Authored acceleration fixture')
    page.locator('#support-file').set_input_files({
        'name': 'acceleration.csv', 'mimeType': 'text/csv',
        'buffer': b'time_s,com_az_m_s2\n0,0\n1,-9.80665\n2,2\n'
    })
    page.locator('#support-apply').click()
    expect(page.locator('#force-provenance')).to_contain_text('Model estimate')
    modelled = download_json(page, '#export')
    model_trace = modelled['forceTrace']
    assert model_trace['kind'] == 'modelled' and model_trace['model']['massKg'] == 80
    assert model_trace['model']['sourceLabel'] == 'Authored acceleration fixture'
    assert model_trace['model']['acceleration'][1]['accelerationMps2'] == -9.80665
    assert modelled['observations'][1]['verticalForceN'] == 0
    assert page.locator('#force').inner_text().split()[0] in {'0', '0.0', '0.00'}

    page.locator('#mot-panel summary').click()
    page.locator('#mot-file').set_input_files({'name': 'authored.mot', 'mimeType': 'text/plain', 'buffer': MOTION})
    mot_seek = page.locator('#mot-frame')
    expect(mot_seek).to_be_visible()
    expect(mot_seek).to_be_enabled()
    mot_seek.press('End')
    expect(page.locator('#mot-readout')).to_contain_text('-20.5')
    mot = download_json(page, '#mot-save')
    assert mot['schema'] == 'brainsnn.model-knee-motion.v1' and mot['source']['name'] == 'authored.mot'
    assert mot['source']['sha256'] == sha256(MOTION).hexdigest()
    assert mot['frames'][-1] == {'time': 1.25, 'left': 30.0, 'right': -20.5}
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    assert not errors, errors
    assert not writes, writes


def main():
    with TemporaryDirectory() as directory:
        # Avoid depending on H.264 availability in the open Chromium distribution.
        inputs = ['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i',
                  'testsrc2=size=320x180:rate=10', '-t', '2', '-pix_fmt', 'yuv420p']
        mp4, webm = (Path(directory) / f'authored-movement.{ext}' for ext in ('mp4', 'webm'))
        subprocess.run([*inputs, '-c:v', 'libx264', '-movflags', '+faststart', str(mp4)], check=True)
        subprocess.run([*inputs, '-c:v', 'libvpx', '-b:v', '160k', str(webm)], check=True)
        with sync_playwright() as playwright:
            for name in os.getenv('WORLD_BROWSERS', 'chromium,webkit').split(','):
                name = name.strip()
                executable = os.getenv(f'PLAYWRIGHT_{name.upper()}_PATH')
                browser = getattr(playwright, name).launch(executable_path=executable)
                try:
                    for width, height in [(1240, 820), (390, 844)]:
                        page = browser.new_page(viewport={'width': width, 'height': height}, has_touch=width < 500)
                        check(page, webm if name == 'chromium' else mp4)
                        page.close()
                        print(f'{name} {width}x{height}: demo, annotated video, synchronized force, modelled support force, OpenSim and downloads passed', flush=True)
                finally:
                    browser.close()


if __name__ == '__main__':
    main()
