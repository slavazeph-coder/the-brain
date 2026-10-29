"""HTTP browser -> private worker -> scene transport fixture -> Explore scene.glb in 3D, and the metric path:
synthetic reconstruction -> two tapped points + measured distance -> measured point-cloud upload -> metric scene.

The adapter writes an authored GLB and scene.json (tests/world/scene_fixture_adapter.py); no reconstruction or Blender
runs, and this test makes no claim about scene quality. Upload, job, short-lived tickets, SHA-256 checks, the mesh viewer
and the provenance shown from scene.json are real. Chromium runs at desktop size and WebKit as an iPhone 15.

  WORLD_SERVER_PYTHON=/path/to/python-with-fastapi-and-uvicorn python tests/world/scene_browser_smoke.py
  WORLD_BROWSERS=chromium WORLD_PHONE_VIEWPORT=1 python tests/world/scene_browser_smoke.py
"""
import csv
import hashlib
import io
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
from realtosim_browser_smoke import K, SCROLL_SETTLED, VISIBLE_POINT_TARGETS, calibrate as calibrate_source, fixture, wait_in_view

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world'
FACTS = ['Observed: 0 reconstructed points, a floor bounding extent and 1 wall.',
         'Detected: no objects placed, 1 left unplaced.',
         'Unknown: 1 floor cell no point reached, kept as a tagged volume, never free space.',
         'Units: arbitrary reconstruction units. No measured scale, so sizes are relative.']

CANVAS_GEOMETRY = """() => {
    const c = document.querySelector('#visual-canvas'), r = c.getBoundingClientRect();
    return {rect: [r.left, r.top, r.width, r.height], buffer: [c.width, c.height],
            viewport: [innerWidth, innerHeight], scroll: [scrollX, scrollY],
            status: document.querySelector('#status').textContent,
            pick: document.querySelector('[data-action=pick-dimension]')?.textContent};
}"""


def check_canvas_stability(page):
    """Additional sidebar controls must not resize or reproject the reconstruction."""
    page.locator('#visual-canvas').wait_for(state='visible')
    page.evaluate(SCROLL_SETTLED)
    before = page.evaluate(CANVAS_GEOMETRY)
    options = page.locator('.native-capture-options')
    options.locator('summary').click()
    page.evaluate(SCROLL_SETTLED)
    expanded = page.evaluate(CANVAS_GEOMETRY)
    assert before['rect'][2:] == expanded['rect'][2:], {'before': before, 'expanded': expanded}
    assert expanded['rect'][3] <= max(425, expanded['viewport'][1]), expanded
    options.locator('summary').click()


def calibrate(page, mobile, label):
    try:
        return calibrate_source(page, mobile, label)
    except Exception:
        print('Calibration UI status:', page.locator('#status').inner_text(), file=sys.stderr, flush=True)
        page.screenshot(path=str(OUTPUT / f'{label}-failure.png'), full_page=True)
        raise


def open_workspace(page, origin):
    # A file input can accept files before its module has attached its change
    # listener. Require an app-rendered control, not just network quietness.
    failed_modules = []
    def failed(request):
        if request.url.split('?')[0].endswith('.mjs'):
            failed_modules.append({'module': request.url.rsplit('/', 1)[-1], 'error': request.failure})
    page.on('requestfailed', failed)
    try:
        page.goto(origin + '/world/index.html', wait_until='networkidle')
        page.locator('#objects option').first.wait_for(state='attached')
    except Exception:
        print('Workspace startup failed:', {'modules': failed_modules,
              'document': page.evaluate('document.readyState'),
              'status': page.locator('#status').inner_text()}, file=sys.stderr, flush=True)
        page.screenshot(path=str(OUTPUT / 'scene-startup-failed.png'), full_page=True)
        raise
    finally:
        page.remove_listener('requestfailed', failed)


def wait_visual_source(page, label, errors):
    try:
        page.wait_for_function("/Visual asset loaded/.test(document.querySelector('#status').textContent)")
    except Exception:
        print('Visual import failed:', {'status': page.locator('#status').inner_text(), 'errors': errors}, file=sys.stderr, flush=True)
        page.screenshot(path=str(OUTPUT / f'{label}-source-failed.png'), full_page=True)
        raise


def check_browser(pw, name, origin, worker_url, token, photo, phone=False):
    executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
    browser = getattr(pw, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
    context = browser.new_context(**({**pw.devices['iPhone 15'], 'device_scale_factor': 1} if name == 'webkit'
                                     else {'viewport': {'width': 390, 'height': 844}, 'device_scale_factor': 1, 'has_touch': True, 'is_mobile': True} if phone
                                     else {'viewport': {'width': 1440, 'height': 1000}, 'device_scale_factor': 1}))
    view_name = name + ('-phone' if phone else '')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    try:
        open_workspace(page, origin)
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
        page.locator('#engine').select_option('scene-usd')
        page.locator('#consent').check()
        page.locator('[data-action=process]').click()
        # A job whose only visual output is a scene opens it directly, over Evidence where its artifacts are listed.
        page.wait_for_function("/SHA-256 checked|failed/.test(document.querySelector('#scene-status').textContent) || /scene-usd: (failed|cancelled)/.test(document.querySelector('#status').textContent)", timeout=60000)
        assert page.locator('[data-tab=evidence]').get_attribute('aria-selected') == 'true', page.locator('#status').inner_text()
        assert page.locator('[data-scene-artifact]').all_inner_texts() == ['Explore scene.glb in 3D']
        assert page.locator('#scene-status').inner_text() == 'scene.glb from scene-usd · 3 meshes · 72 vertices · SHA-256 checked', page.locator('#scene-status').inner_text()
        facts = page.locator('#scene-facts li').all_inner_texts()
        assert facts[:4] == FACTS and 'Export static OpenUSD' in facts[4], facts
        assert page.locator('#scene-plan').is_hidden(), 'a scene without metres offers no planning map'
        geometry = page.evaluate("""() => { const d = document.querySelector('#scene-dialog').getBoundingClientRect(),
            c = document.querySelector('#scene-stage canvas'), r = c?.getBoundingClientRect();
            return {open: document.querySelector('#scene-dialog').open, canvas: r ? [r.width, r.height] : null,
                    inside: d.left >= -1 && d.right <= innerWidth + 1, noPageScroll: document.documentElement.scrollWidth <= innerWidth}; }""")
        assert geometry['open'] and geometry['canvas'] and min(geometry['canvas']) > 150 and geometry['inside'] and geometry['noPageScroll'], geometry
        page.screenshot(path=str(OUTPUT / f'scene-{view_name}.png'))
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


def connect(page, worker_url, token):
    page.locator('[data-tab=capture]').click()
    processing_options(page)
    page.locator('[data-action=connection]').click()
    page.locator('#worker-url').fill(worker_url)
    page.locator('#worker-token').fill(token)
    page.locator('#connect').click()
    page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')")
    page.locator('#connection [aria-label=Close]').click()


def download_building_handoff(page, label):
    """Use actual private download buttons and reopen the authored fixture's PNG/CSV evidence."""
    folder = OUTPUT / 'building' / label
    folder.mkdir(parents=True, exist_ok=True)
    names = ('xactimate-underlay.png', 'building-schedule.csv', 'building-handoff.json',
             'BUILDING-IMPORT.txt', 'scene.json', 'scene.ifc')
    blobs = {}
    for name in names:
        button = page.locator('#scene-bim-files button').filter(has=page.get_by_text(name, exact=True))
        with page.expect_download() as download:
            button.click()
        assert download.value.suggested_filename == name
        blobs[name] = Path(download.value.path()).read_bytes()
        (folder / name).write_bytes(blobs[name])
    handoff = json.loads(blobs['building-handoff.json'])
    assert handoff['schema'] == 'brainsnn.building-handoff.v1'
    assert handoff['sourceFiles']['scene']['binding'] == 'exact-file-bytes'
    assert handoff['sourceFiles']['scene']['sha256'] == hashlib.sha256(blobs['scene.json']).hexdigest()
    assert handoff['destinations']['revit']['existingIfc']['sha256'] == hashlib.sha256(blobs['scene.ifc']).hexdigest()
    for name in ('xactimate-underlay.png', 'building-schedule.csv', 'BUILDING-IMPORT.txt'):
        assert handoff['files'][name]['sha256'] == hashlib.sha256(blobs[name]).hexdigest()
    with Image.open(io.BytesIO(blobs['xactimate-underlay.png'])) as image:
        assert image.format == 'PNG' and image.size == (1800, 1400)
        image.verify()
    rows = list(csv.DictReader(io.StringIO(blobs['building-schedule.csv'].decode())))
    assert rows and all(row['review_status'] == 'unverified' for row in rows)
    assert all(row['scene_sha256'] == handoff['canonicalSceneSha256'] for row in rows)
    assert all(row['revision'] == str(handoff['componentRevision']) for row in rows)
    assert all(not row['area_m2'] for row in rows if row['kind'] == 'floor')
    assert 'The PNG requires tracing.' in blobs['BUILDING-IMPORT.txt'].decode()
    assert handoff['metricVerified'] is False and handoff['physicalDimensionsVerified'] is False
    assert handoff['readiness']['roomQuantities'] is False
    assert handoff['readiness']['nativeRevitValidated'] is False
    assert handoff['readiness']['xactimateApplicationValidated'] is False
    assert 'Import Underlay Image' in page.locator('#scene-bim-files').inner_text()
    return handoff


def check_metric(pw, name, origin, worker_url, token, phone=False):
    """A measured multi-view reconstruction uploads as a point-cloud hand-off and comes back as a metric scene with USD."""
    executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
    browser = getattr(pw, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
    # Same contexts as the real-to-sim smoke, whose tapping calibration is proven in both engines.
    mobile = name == 'webkit' or phone
    view_name = name + ('-phone' if phone else '')
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000}, has_touch=mobile)
    page = context.new_page()
    errors, uploads = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    jobs = []
    page.on('request', lambda request: uploads.append(request.post_data_json) if request.method == 'POST' and request.url.endswith('/v1/uploads') else None)
    page.on('request', lambda request: jobs.append(request.post_data_json['engine']) if request.method == 'POST' and request.url.endswith('/v1/jobs') else None)
    try:
        ply, evidence = fixture()
        open_workspace(page, origin)
        page.locator('#files').set_input_files({'name': 'room.ply', 'mimeType': 'application/octet-stream', 'buffer': ply})
        wait_visual_source(page, f'scene-metric-{view_name}', errors)
        page.locator('#files').set_input_files({'name': 'reconstruction.json', 'mimeType': 'application/json', 'buffer': evidence})
        page.locator('[data-action=propose-map]').wait_for()
        connect(page, worker_url, token)
        metres_per_unit = calibrate(page, mobile, f'scene-metric-{view_name}')
        page.locator('[data-tab=capture]').click()
        build = page.locator('[data-action=metric-scene]')
        build.wait_for()
        assert page.locator('#scene-naming').count() == 0, 'naming needs a reconstruction from this worker, not a local file'
        # Nothing uploads until the person approves this specific upload.
        build.click()
        assert 'Approve uploading the measured point cloud' in page.locator('#status').inner_text()
        assert not uploads, uploads
        page.locator('#scene-consent').check()
        build.click()
        page.wait_for_function("/SHA-256 checked|failed/.test(document.querySelector('#scene-status')?.textContent || '') || /scene-usd: failed/.test(document.querySelector('#status').textContent)", timeout=60000)
        assert page.locator('#scene-status').inner_text().startswith('scene.glb from scene-usd'), 'the diagnostic PLY must not displace the model preview'
        assert page.locator('[data-artifact]').first.inner_text() == 'Download fit-heatmap.ply ↗', 'the fixture must exercise diagnostic-before-model ordering'
        assert [u['kind'] for u in uploads] == ['cloud'] and uploads[0]['name'] == 'brainsnn-point-cloud.json', uploads
        assert jobs == ['scene-usd'], jobs
        facts = page.locator('#scene-facts li').all_inner_texts()
        assert facts[3].startswith('Units: metres, from an entered distance (') and facts[3].endswith('m). Self-reported, not verified.'), facts
        assert facts[4] == 'scene.usda was written for Isaac Sim (metersPerUnit = 1).', facts
        assert facts[5].startswith('scene.ifc was written for BIM tools (IFC4, metres)'), facts
        page.screenshot(path=str(OUTPUT / f'scene-metric-{view_name}.png'))
        # The metric scene becomes an unreviewed planning map; the robot plans only after both reviews.
        page.locator('#scene-plan').click()
        page.wait_for_function("!document.querySelector('#scene-dialog').open")
        assert page.locator('#status').inner_text() == ('Map built from the simulation scene: 1 wall and 0 objects as obstacles, 1 unobserved area, '
                                                        '4 × 3 m floor bounding extent. Review scale and obstacles, then plan.'), page.locator('#status').inner_text()
        assert page.locator('#provenance').inner_text() == 'REVIEW REQUIRED'
        page.locator('#run').click()
        page.wait_for_timeout(200)
        assert 'Confirm independently measured scale' in page.locator('#status').inner_text()
        page.locator('#scale-reviewed').check()
        page.locator('#map-reviewed').check()
        page.locator('#run').click()
        page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')", timeout=15000)
        assert float(page.locator('#metric-distance').inner_text().split()[0]) > 3, page.locator('#metric-distance').inner_text()
        page.locator('[data-tab=evidence]').click()
        assert 'Download scene.usda' in page.locator('#panel').inner_text() and 'Download scene.ifc' in page.locator('#panel').inner_text()
        with page.expect_download() as download:
            page.locator('[data-action=proof]').click()
        proof = json.loads(Path(download.value.path()).read_text())
        requested = [e['detail'] for e in proof['events'] if e['type'] == 'metric_scene_requested'][-1]
        assert requested['selfReported'] is True and abs(requested['metresPerUnit'] - metres_per_unit) < 1e-9 and abs(requested['metresPerUnit'] * K - 1) < 2e-3, requested
        assert any(e['type'] == 'scene_opened' for e in proof['events'])
        mapped = [e['detail'] for e in proof['events'] if e['type'] == 'scene_map_proposed'][-1]
        assert {k: mapped[k] for k in ('walls', 'separated', 'detected', 'unknown', 'outside', 'scaleVerified')} == {
            'walls': 1, 'separated': 0, 'detected': 0, 'unknown': 1, 'outside': 0, 'scaleVerified': False}, mapped
        assert not errors, errors
    finally:
        browser.close()


def check_dimensional_bim_review(pw, name, origin, worker_url, token, phone=False):
    """Authored geometry over a real worker: a failing withheld span, explicit opening review and a fresh IFC.

    No captured room or physical measurement is involved. The intentionally wrong 100 m reading tests that a failed
    comparison stays visible and does not rescale the cloud. The fixture executes the actual report and IFC writers.
    """
    executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
    browser = getattr(pw, name).launch(headless=True, **({'executable_path': executable} if executable else {}))
    mobile = name == 'webkit' or phone
    view_name = name + ('-phone' if phone else '')
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000}, has_touch=mobile)
    page = context.new_page(); errors, jobs, picks = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: jobs.append(request.post_data_json) if request.method == 'POST' and request.url.endswith('/v1/jobs') else None)
    try:
        ply, evidence = fixture()
        open_workspace(page, origin)
        page.locator('#files').set_input_files({'name': 'synthetic-room.ply', 'mimeType': 'application/octet-stream', 'buffer': ply})
        wait_visual_source(page, f'bim-review-{view_name}', errors)
        page.locator('#files').set_input_files({'name': 'reconstruction.json', 'mimeType': 'application/json', 'buffer': evidence})
        connect(page, worker_url, token)
        calibrate(page, mobile, f'bim-review-{view_name}')
        page.locator('[data-tab=capture]').click()
        page.locator('[data-action=pick-dimension]').wait_for()
        check_canvas_stability(page)
        # Try points inside the visible core, distinct from the outer pair used by the calibration smoke.
        accepted = False
        for pick in (2, 3, 1):
            page.locator('[data-action=pick-dimension]').click()
            wait_in_view(page, '#visual-canvas', f'{view_name}-dimension-picking')
            assert 'Selected points turn cyan' in page.locator('#scene-help').inner_text()
            page.screenshot(path=str(OUTPUT / f'bim-picking-{view_name}.png'))
            for side in ('left', 'right'):
                # A control update can move the page on a phone. Pick the pixels currently drawn,
                # and verify the first pick before attempting the second one.
                page.evaluate(SCROLL_SETTLED)
                targets = page.evaluate(VISIBLE_POINT_TARGETS)
                assert targets[side], targets
                x, y = targets[side][pick]
                before = page.evaluate(CANVAS_GEOMETRY)
                if mobile: page.touchscreen.tap(x, y)
                else: page.mouse.click(x, y)
                page.evaluate(SCROLL_SETTLED)
                after = page.evaluate(CANVAS_GEOMETRY)
                picks.append({'side': side, 'target': [x, y], 'before': before, 'after': after})
                assert before['rect'][2:] == after['rect'][2:], picks[-1]
                if side == 'left':
                    assert before['rect'] == after['rect'], picks[-1]
                    assert '1 of 2 points' in after['pick'], picks[-1]
                else:
                    assert page.locator('#dimension-distance').count() == 1, picks[-1]
                    wait_in_view(page, '#dimension-distance', f'{view_name}-dimension-entry', focus=True)
            page.locator('#dimension-label').fill('Synthetic withheld span')
            page.locator('#dimension-distance').fill('100')
            page.locator('#dimension-uncertainty').fill('0.005')
            page.locator('#dimension-instrument').fill('Synthetic test reference, not a physical reading')
            page.locator('#dimension-date').fill('2026-10-24')
            page.locator('[data-action=add-dimension]').click()
            page.wait_for_timeout(300)
            if page.locator('.dimension-check-list li').count() == 1:
                accepted = True; break
        assert accepted, page.locator('#status').inner_text()
        page.locator('#scene-consent').check()
        page.locator('[data-action=metric-scene]').click()
        page.locator('#scene-measurement-report').get_by_text('A held-out span needs attention', exact=True).wait_for(timeout=60000)
        assert '100.000 m reference' in page.locator('#scene-measurement-report').inner_text()
        assert ' m reconstruction / ' in page.locator('#scene-measurement-report').inner_text()
        assert '0 of 1' in page.locator('#scene-measurement-report').inner_text()
        original_handoff = download_building_handoff(page, f'{view_name}-before-opening')
        assert original_handoff['openings'] == []
        host = page.locator('#bim-wall-locator [data-host-wall="0"]')
        assert host.get_by_text('wall_1', exact=True).count() == 1
        assert 'selected' in host.get_attribute('class')
        page.locator('#scene-measurement-report').scroll_into_view_if_needed()
        page.screenshot(path=str(OUTPUT / f'bim-report-{view_name}.png'))
        assert len(jobs) == 1, jobs
        # No reviewed opening is accepted merely by pressing Add.
        page.locator('[data-bim-action=add]').click()
        assert 'Confirm the opening' in page.locator('#scene-status').inner_text()
        assert page.locator('.bim-opening-list li').count() == 0
        page.locator('#bim-offset').fill('1')
        page.locator('#bim-width').fill('0.9')
        page.locator('#bim-height').fill('2')
        page.locator('#bim-sill').fill('0')
        page.locator('#bim-reviewed').check()
        page.locator('[data-bim-action=add]').click()
        assert page.locator('.bim-opening-list li').count() == 1
        page.locator('[data-bim-action=recompile]').click()
        page.wait_for_function("/Approve uploading/.test(document.querySelector('#scene-status').textContent)")
        assert len(jobs) == 1
        page.locator('#bim-recompile-consent').check()
        page.locator('[data-bim-action=recompile]').click()
        page.wait_for_function("document.querySelector('#scene-dialog').open && /SHA-256 checked/.test(document.querySelector('#scene-status').textContent)", timeout=60000)
        page.locator('#scene-measurement-report').get_by_text('A held-out span needs attention', exact=True).wait_for(timeout=60000)
        assert len(jobs) == 2, jobs
        with page.expect_download() as download:
            page.locator('#scene-bim-files button').filter(has_text='scene.ifc').click()
        ifc = Path(download.value.path()).read_text()
        assert 'IFCOPENINGELEMENT(' in ifc and 'IFCRELVOIDSELEMENT(' in ifc
        assert 'IFCDOOR(' not in ifc, 'an empty opening is not silently promoted to a door'
        reviewed_handoff = download_building_handoff(page, f'{view_name}-reviewed-opening')
        assert len(reviewed_handoff['openings']) == 1
        assert reviewed_handoff['sourceFiles']['scene']['sha256'] != original_handoff['sourceFiles']['scene']['sha256']
        assert reviewed_handoff['destinations']['revit']['existingIfc']['sha256'] != original_handoff['destinations']['revit']['existingIfc']['sha256']
        page.screenshot(path=str(OUTPUT / f'bim-review-{view_name}.png'), full_page=False)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.keyboard.press('Escape')
        page.locator('[data-tab=capture]').click()
        distance = page.locator('#measured-distance')
        previous = float(distance.input_value()); distance.fill(str(previous * 1.1)); distance.press('Tab')
        assert page.locator('.dimension-check-list li').count() == 0, 'changed scale invalidates the old reference selection'
        # Old artifacts retain their own evidence, but cannot lend reviews to a newly scaled active cloud.
        page.locator('[data-tab=evidence]').click()
        page.locator('[data-scene-artifact]').click()
        page.locator('.bim-opening-list li').wait_for()
        page.locator('#bim-recompile-consent').check()
        page.locator('[data-bim-action=recompile]').click()
        page.wait_for_function("/active reconstruction or scale differs/.test(document.querySelector('#scene-status').textContent)")
        assert len(jobs) == 2, 'a stale review must not start another worker job'
        assert not errors, errors
    except Exception:
        diagnostics = {'picks': picks, 'current': page.evaluate(CANVAS_GEOMETRY), 'errors': errors}
        print('Dimensional review UI diagnostics:', json.dumps(diagnostics), file=sys.stderr, flush=True)
        (OUTPUT / f'bim-review-{view_name}-failure.json').write_text(json.dumps(diagnostics, indent=2))
        page.screenshot(path=str(OUTPUT / f'bim-review-{view_name}-failure.png'), full_page=True)
        raise
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
        # A decoy that also takes clouds is listed first: the site must still pick the scene compiler by id.
        config.write_text(json.dumps([{'id': 'cloud-echo', 'label': 'Cloud transport fixture (not a scene compiler)',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['cloud'], 'max_inputs': 1, 'timeout_seconds': 60,
            'command': [sys.executable, str(ROOT / 'tests/world/scene_fixture_adapter.py'), '--input-manifest', '{input_manifest}']},
            {'id': 'scene-usd', 'label': 'Scene transport fixture (no reconstruction)',
            'enabled': True, 'license_reviewed': True, 'input_kinds': ['image', 'cloud'], 'max_inputs': 1, 'timeout_seconds': 60,
            'dimension_checks': True, 'bim_review': True,
            # Naming is advertised (its secret is set), but a cloud opened from a local file has no worker frames to crop.
            'source_job': True, 'secrets': ['FIXTURE_NAMING_KEY'], 'object_naming': {'provider': 'Fixture', 'model': 'fixture-model'},
            'command': [sys.executable, str(ROOT / 'tests/world/scene_fixture_adapter.py'), '--input-manifest', '{input_manifest}']}]))
        environment = {**os.environ, 'WORLD_WORKER_TOKEN': token, 'WORLD_WORKER_DIR': str(tmp / 'data'), 'FIXTURE_NAMING_KEY': 'fixture-only',
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
                    name = name.strip()
                    for phone in ([False, True] if name == 'chromium' and os.environ.get('WORLD_PHONE_VIEWPORT') == '1' else [False]):
                        label = name + (' phone viewport' if phone else '')
                        check_browser(pw, name, origin, worker_url, token, photo, phone)
                        print('scene preview passed in', label, flush=True)
                        check_metric(pw, name, origin, worker_url, token, phone)
                        print('metric scene from a measured cloud passed in', label, flush=True)
                        check_dimensional_bim_review(pw, name, origin, worker_url, token, phone)
                        print('dimensional checks and reviewed BIM opening passed in', label, flush=True)
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
