"""Walk a simulated route through BrainSNN Walk in a real browser.

A fake camera and a moving emulated GPS stand in for the phone. Checks the whole loop: start a walk, drop
features (tap and keyboard), finish, read the honest accuracy figures, measure between features, export
GeoJSON and a ZIP bundle, reopen that bundle read-only, keep a copy, survive a reload mid-walk, walk with
GPS refused, hand the video to World Builder, and hold the layout at 320 and 390 px.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from functools import partial
import json
import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from threading import Thread
import zipfile

from playwright.sync_api import expect, sync_playwright

from stereo_depth_browser_smoke import PUBLIC, QuietHandler, StaticServer

M = 1 / 111195.08  # degrees of latitude per metre
START = {'latitude': 45.4215, 'longitude': -75.6972}


def at(metres_north: float, accuracy: float = 5.0):
    return {'latitude': START['latitude'] + metres_north * M, 'longitude': START['longitude'], 'accuracy': accuracy}


def check_geopackage(path: Path, *, features: int, photos: int):
    with closing(sqlite3.connect(path)) as db:
        assert db.execute('PRAGMA application_id').fetchone()[0] == 0x47504B47
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        layers = db.execute('SELECT table_name, geometry_type_name, srs_id FROM gpkg_geometry_columns ORDER BY table_name').fetchall()
        assert layers == [('features', 'POINT', 4326), ('track', 'LINESTRING', 4326)], layers
        assert db.execute('SELECT COUNT(*) FROM features').fetchone()[0] == features
        assert db.execute('SELECT COUNT(*) FROM features WHERE photo_jpeg IS NOT NULL').fetchone()[0] == photos
        assert db.execute('SELECT map_position_95_m FROM track').fetchone()[0] == 5
        blob = db.execute('SELECT geom FROM features WHERE geom IS NOT NULL LIMIT 1').fetchone()[0]
        assert blob[:2] == b'GP' and int.from_bytes(blob[4:8], 'little') == 4326


def no_overflow(page, label):
    width = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    assert width <= 0, f'{label}: page scrolls sideways by {width}px'


def walk_route(context, page, steps, drops):
    for step in range(steps):
        context.set_geolocation(at(step * 2.0))
        page.wait_for_timeout(220)
        if step in drops:
            action = drops[step]
            if action.startswith('key:'):
                page.keyboard.press(action[4:])
            else:
                page.locator(f'.drop[data-type="{action}"]').click()
            page.wait_for_timeout(120)


def verify_browser(browser_type, url, output: Path):
    name = browser_type.name
    args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] if name == 'chromium' else []
    browser = browser_type.launch(args=args)
    errors: list[str] = []
    try:
        context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, accept_downloads=True,
                                      permissions=['geolocation'] + (['camera'] if name == 'chromium' else []),
                                      geolocation=at(0))
        # No share sheet in a test browser: exports must take the download path everywhere.
        context.add_init_script('Object.defineProperty(Navigator.prototype, "canShare", {value: undefined, configurable: true});')
        if name != 'chromium':
            # Only Chromium has a dependable fake camera here; elsewhere exercise the camera-refused path on purpose.
            context.add_init_script('navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")));')
        page = context.new_page()
        page.on('pageerror', lambda error, page=page: errors.append(f'{page.url.split("#")[0]}: {error}'))
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(url)
        expect(page.locator('#list-title')).to_be_visible()
        expect(page.locator('#list-empty')).to_be_visible()
        no_overflow(page, f'{name} list 390')
        page.screenshot(path=str(output / f'walk-{name}-list.png'), full_page=True)

        # --- a walk with GPS and (where the browser has one) a camera ---
        page.locator('#new-walk').click()
        expect(page.locator('#screen-capture')).to_be_visible()
        expect(page.locator('#hud-gps')).to_contain_text('±', timeout=8000)
        # The camera either starts or says it is off; wait for one of the two.
        page.wait_for_function("document.getElementById('cam').videoWidth > 0 || !document.getElementById('cam-off').hidden", timeout=10000)
        camera = page.locator('#cam-off').is_hidden()
        heights = page.locator('.drop').evaluate_all('nodes => nodes.map(node => node.getBoundingClientRect().height)')
        assert len(heights) == 8 and min(heights) >= 56, f'drop targets are big enough for gloves: {heights}'
        no_overflow(page, f'{name} capture 390')
        walk_route(context, page, 30, {5: 'pole', 18: 'drain', 25: 'key:3'})
        expect(page.locator('#hud-count')).to_have_text('3')
        page.locator('.drop[data-type="sign"]').focus()
        page.keyboard.press('Enter')
        expect(page.locator('#drop-toast')).to_contain_text('Sign #4 dropped')
        expect(page.locator('#hud-count')).to_have_text('4')
        dist = float(page.locator('#hud-dist').inner_text().split()[0])
        assert 50 <= dist <= 58.5, f'walked about 58 m in 2 m steps, meter says {dist}'
        page.screenshot(path=str(output / f'walk-{name}-capture.png'))
        page.locator('#finish-walk').click()

        # --- results ---
        expect(page.locator('#screen-results')).to_be_visible(timeout=10000)
        expect(page.locator('#walk-title')).to_have_text('Walk 1')
        expect(page.locator('#map-value')).to_have_text('±5 m')
        expect(page.locator('#map-note')).to_contain_text('95% of')
        expect(page.locator('#shape-value')).to_have_text('Not measured')
        expect(page.locator('#stats')).to_contain_text('GPS fixes')
        expect(page.locator('#feature-list > li')).to_have_count(4)
        expect(page.locator('#feature-list')).to_contain_text('GPS ±5 m')
        expect(page.locator('#build-3d')).to_be_enabled() if camera else expect(page.locator('#build-3d')).to_be_disabled()
        # Zoom with the wheel, then fit the whole walk again.
        page.locator('#map').hover()
        page.mouse.wheel(0, -600)
        expect(page.locator('#map-fit')).to_be_visible()
        page.locator('#map-fit').click()
        expect(page.locator('#map-fit')).to_be_hidden()
        page.locator('[data-layer="showError"]').click()
        page.locator('[data-select]').first.click()
        if camera:
            page.wait_for_function("(() => { const img = document.querySelector('.feature-detail img'); return img && img.naturalWidth > 0; })()", timeout=8000)
        page.locator('.feature-edit input[name="label"]').fill('Light pole by the gate')
        page.locator('.feature-edit button[type="submit"]').click()
        expect(page.locator('#feature-list')).to_contain_text('Light pole by the gate')
        page.locator('#measure').click()
        page.locator('[data-select]').nth(0).click()
        page.locator('[data-select]').nth(1).click()
        expect(page.locator('#measure-out')).to_contain_text('±')
        measured = page.locator('#measure-out').inner_text()
        assert 'Light pole by the gate to Drain: 26' in measured, measured
        no_overflow(page, f'{name} results 390')
        page.screenshot(path=str(output / f'walk-{name}-results.png'), full_page=True)

        # --- exports ---
        page.locator('#export').click()
        with page.expect_download() as download:
            page.locator('[data-export="geojson"]').click()
        geo = json.loads(Path(download.value.path()).read_text())
        assert geo['type'] == 'FeatureCollection' and geo['features'][0]['geometry']['type'] == 'LineString'
        assert [f['properties']['type'] for f in geo['features'][1:]] == ['pole', 'drain', 'hazard', 'sign']
        assert geo['features'][0]['properties']['map_position_95_m'] == 5
        # GeoPackage: the walk's own SQLite file, the format QGIS and ArcGIS Pro open directly.
        page.locator('#export').click()
        with page.expect_download() as download:
            page.locator('[data-export="gpkg"]').click()
        gpkg = output / f'walk-{name}.gpkg'
        download.value.save_as(gpkg)
        check_geopackage(gpkg, features=4, photos=4 if camera else 0)
        page.locator('#export').click()
        if camera:
            page.locator('#include-video').check()
        with page.expect_download() as download:
            page.locator('[data-export="bundle"]').click()
        bundle = output / f'walk-{name}.zip'
        download.value.save_as(bundle)
        with zipfile.ZipFile(bundle) as archive:
            names = archive.namelist()
            assert archive.testzip() is None
        assert names[:6] == ['walk.json', 'walk.gpkg', 'walk.geojson', 'walk.gpx', 'features.csv', 'README.txt'], names
        if camera:
            assert sum(n.startswith('photos/') for n in names) == 4 and any(n.startswith('video.') for n in names), names

        # --- reopen the bundle read-only, then keep a copy ---
        page.locator('#back').click()
        expect(page.locator('#walk-list > li')).to_have_count(1)
        page.locator('#open-shared').set_input_files(str(bundle))
        expect(page.locator('#shared-badge')).to_be_visible()
        expect(page.locator('#delete-walk')).to_be_hidden()
        expect(page.locator('#rename')).to_be_hidden()
        expect(page.locator('#feature-list > li')).to_have_count(4)
        expect(page.locator('#map-value')).to_have_text('±5 m')
        page.locator('#keep-copy').click()
        expect(page.locator('#shared-badge')).to_be_hidden()
        page.locator('#back').click()
        expect(page.locator('#walk-list > li')).to_have_count(2)

        # A file that is not a walk is refused with a reason.
        junk = output / 'not-a-walk.zip'
        junk.write_bytes(b'PK nothing here')
        page.locator('#open-shared').set_input_files(str(junk))
        expect(page.locator('#list-status')).to_contain_text('Could not open it')

        # --- the page dies mid-walk: track and features survive ---
        page.locator('#new-walk').click()
        expect(page.locator('#hud-gps')).to_contain_text('±', timeout=8000)
        walk_route(context, page, 4, {2: 'door'})
        page.wait_for_timeout(5600)  # one autosave
        page.reload()
        expect(page.locator('#walk-list > li')).to_have_count(3)
        expect(page.locator('#walk-list')).to_contain_text('Interrupted · no video')

        # --- delete ---
        page.locator('#walk-list .walk-card').first.click()
        page.locator('#delete-walk').click()
        expect(page.locator('#walk-list > li')).to_have_count(2)

        # --- narrow phone ---
        page.set_viewport_size({'width': 320, 'height': 640})
        no_overflow(page, f'{name} list 320')
        page.locator('#walk-list .walk-card').first.click()
        no_overflow(page, f'{name} results 320')
        page.locator('#back').click()

        # --- hand the walk's video to World Builder, on this device ---
        if camera:
            page.locator('#walk-list .walk-card').last.click()
            page.locator('#build-3d').click()
            page.wait_for_url('**/world/index.html#handoff=*', timeout=10000)
            expect(page.locator('#status')).to_contain_text('Loaded 1 local capture file', timeout=20000)
        context.close()

        # --- GPS refused: nothing is invented ---
        blind = browser.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'] if name == 'chromium' else [])
        if name != 'chromium':
            blind.add_init_script('navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError")));')
        page = blind.new_page()
        page.on('pageerror', lambda error, page=page: errors.append(f'{page.url.split("#")[0]}: {error}'))
        page.goto(url)
        page.locator('#new-walk').click()
        expect(page.locator('#cap-status')).to_contain_text('Location is off', timeout=8000)
        page.locator('.drop[data-type="note"]').click()
        expect(page.locator('#drop-toast')).to_contain_text('waiting for GPS')
        page.locator('#finish-walk').click()
        expect(page.locator('#map-value')).to_have_text('Withheld')
        expect(page.locator('#map-note')).to_contain_text('No GPS fix')
        expect(page.locator('#feature-list')).to_contain_text('no GPS position')
        expect(page.locator('#map')).to_be_visible()
        blind.close()
        assert not errors, f'{name} page errors: {errors}'
        print(f'{name}: walk, drops, results, measure, exports, shared viewer, copy, interrupted walk, delete, '
              f'{"handoff, " if camera else "camera-off path, "}no-GPS walk and 320 px layout passed')
    finally:
        browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default=os.environ.get('WALK_URL'))
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    server = None
    try:
        if args.url:
            url = args.url
        else:
            server = StaticServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(PUBLIC)))
            Thread(target=server.serve_forever, daemon=True).start()
            url = f'http://127.0.0.1:{server.server_port}/walk/index.html?nosw=1'
        with TemporaryDirectory() as scratch, sync_playwright() as playwright:
            output = args.out or Path(scratch)
            output.mkdir(parents=True, exist_ok=True)
            for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                verify_browser(getattr(playwright, name), url, output)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
