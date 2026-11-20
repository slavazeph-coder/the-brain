"""Exercise the room editor from the playground through repair, reuse and export."""
from functools import partial
from hashlib import sha256
from io import BytesIO
import json
from threading import Thread

from PIL import Image
from playwright.sync_api import expect, sync_playwright
from stereo_depth_browser_smoke import PUBLIC, QuietHandler, StaticServer


def download(page, button):
    with page.expect_download() as result:
        button.click()
    return result.value.path().read_bytes()


def chair_target(canvas):
    pixels = Image.open(BytesIO(canvas.screenshot())).convert('RGB')
    # Identify a visible part of the authored coral chair in the WebGL output.
    red = []
    for y in range(0, pixels.height, 2):
        for x in range(0, pixels.width, 2):
            r, g, b = pixels.getpixel((x, y))
            if r > 115 and r > 1.55 * g and r > 1.9 * b:
                red.append((x, y))
    assert len(red) > 20, 'The coral chair should be visible'
    x, y = red[len(red) // 2]
    return {'x':x, 'y':y}


def verify(engine, origin):
    flags = {'args':['--use-angle=swiftshader', '--enable-unsafe-swiftshader']} if engine.name == 'chromium' else {}
    browser = engine.launch(**flags)
    width = 1280 if engine.name == 'chromium' else 390
    page = browser.new_page(viewport={'width':width, 'height':900}, reduced_motion='reduce', locale='en-US')
    page.set_default_timeout(20_000)
    errors, writes = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: writes.append(request.url) if request.method not in ('GET','HEAD','OPTIONS') else None)
    page.goto(origin + '/world/index.html?nosw=1#layer-tab-scanedit', wait_until='domcontentloaded')
    tab = page.get_by_role('tab', name='Arrange a room')
    expect(tab).to_have_attribute('aria-selected', 'true')
    room = page.frame_locator('#scan-workshop-frame')
    expect(room.locator('#viewer-status')).to_contain_text('Reading room ready')
    expect(room.locator('[data-tour-provenance]')).to_have_value('authored')
    # The parent reading preference propagates into the open editor.
    page.locator('#playground-text-size').click()
    expect(room.locator('html')).to_have_attribute('data-reading-size','large')
    assert room.locator('html').evaluate('el => el.scrollWidth <= innerWidth + 1')
    canvas = room.locator('#asset-canvas')
    target = chair_target(canvas)
    room.locator('[data-objectify-suggest]').click()
    canvas.click(position=target)
    expect(room.locator('[data-objectify-selection]')).to_contain_text('1,952')
    room.locator('[data-objectify-name]').fill('My coral chair')
    room.locator('[data-objectify-reviewed]').check()
    room.locator('[data-objectify-create]').click()
    edits = json.loads(download(page, room.locator('[data-objectify-export]')))
    assert edits['objects'][0]['indices'] == list(range(6704, 8656))
    room.locator('[data-objectify-repair]').click()
    expect(page.locator('#layer-tab-repair')).to_have_attribute('aria-selected','true')
    expect(page.locator('[data-repair-info]')).to_contain_text('8,656 original points · 1,952 selected')
    expect(page.locator('[data-repair-consent]')).not_to_be_checked()
    # Returning to the tab preserves the review and the playground's local scan.
    tab.click()
    saved = download(page, room.locator('[data-objectify-portable]'))
    room.locator('[data-objectify-keep-portable]').click()
    room.locator('[data-scan-example=studio]').click()
    expect(room.locator('#viewer-status')).to_contain_text('Empty studio ready')
    panel = room.locator('#portable-object-panel')
    if panel.get_attribute('open') is None:
        panel.locator('summary').click()
    room.locator('[data-portable-place]').click()
    expect(room.locator('[data-portable-status]')).to_contain_text('Placed My coral chair')
    ply = download(page, room.locator('[data-portable-ply]'))
    receipt = json.loads(download(page, room.locator('[data-portable-receipt]')))
    assert receipt['artifact']['sha256'] == sha256(ply).hexdigest()
    assert receipt['portableObject']['sha256'] == sha256(saved).hexdigest()
    assert receipt['artifact']['count'] == 6704 + 1952
    assert receipt['destination']['used'] == 6704
    expect(room.locator('[data-tour-provenance]')).to_have_value('authored')
    room.locator('[data-portable-restore]').click()
    expect(room.locator('[data-portable-status]')).to_contain_text('restored')
    room.locator('[data-portable-clear]').click()
    room.locator('[data-portable-file]').set_input_files({'name':'chair.brainobject','mimeType':'application/octet-stream','buffer':saved})
    expect(room.locator('[data-portable-place]')).to_be_enabled()
    room.locator('[data-portable-place]').click()
    expect(room.locator('[data-portable-status]')).to_contain_text('Placed My coral chair')
    assert sha256(download(page, room.locator('[data-portable-ply]'))).digest() == sha256(ply).digest()
    assert not errors and not writes, (errors, writes)
    browser.close()
    print(f'{engine.name} at {width}px: selected exact chair, handed off to repair, reused via shelf and saved file, verified PLY and receipt.')


if __name__ == '__main__':
    with StaticServer(('127.0.0.1',0), partial(QuietHandler,directory=str(PUBLIC))) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as playwright:
                for engine in (playwright.chromium, playwright.webkit):
                    verify(engine, f'http://127.0.0.1:{server.server_port}')
        finally:
            server.shutdown()
