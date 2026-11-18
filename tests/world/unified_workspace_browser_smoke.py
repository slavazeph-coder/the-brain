"""Real browser + loopback worker proof for the shared capture/model/drawing workspace.

The worker adapter below deliberately authors a tiny scene and cloud. It does not
reconstruct the two test photos or execute a model. Real HTTP uploads, private
artifact downloads, SHA checks, component binding, drawing export and browser
navigation are exercised. No production service or original demo footage is used.

Run with tests/world/requirements-ci.txt and Playwright Chromium/WebKit installed:
  python tests/world/unified_workspace_browser_smoke.py
WORLD_BROWSERS defaults to chromium,webkit; WORLD_SERVER_PYTHON optionally selects
the Python used for the real local worker. Screenshots and receipts go to
output/playwright/world. The adapter is used only by the temporary test worker.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

from PIL import Image
from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright

from observations_browser_smoke import port, processing_options, ready

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world'

# This explicitly authored adapter uses the production point hash and drawing
# writer. The published preview must bind the exact scene bytes, cloud and PDF.
ADAPTER = r'''
import argparse, copy, json, sys, time
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--root', required=True)
p.add_argument('--release', required=True)
p.add_argument('--input-manifest', required=True)
a = p.parse_args()
root, release = Path(a.root), Path(a.release)
sys.path[:0] = [str(root/'tests/world'), str(root/'robotics/scene_compiler'), str(root/'robotics/world_worker')]
from scene_fixture_adapter import SCENE, glb
from component_graph import ensure_component_ids
from measurement_check import points_sha256
from drawing_set import write_drawing_set
request = json.loads(Path(a.input_manifest).read_text())
out = Path(request['output_dir']); out.mkdir(parents=True, exist_ok=True)
release.with_suffix('.started').write_text(str(out))
deadline = time.monotonic() + 45
while not release.exists():
    if time.monotonic() >= deadline: raise RuntimeError('Fixture release was not granted by the test')
    time.sleep(.05)
title = 'Authored transport fixture / ' + str(len(request['inputs'])) + ' source photo(s)'
points = [[x/10, 0, z/10, 85, 110, 130] for x in range(41) for z in range(31)]
points += [[x/10, y/10, .05, 180, 180, 185] for x in range(41) for y in range(25)]
cloud = {'schema':'brainsnn.point-cloud.v1', 'source':title, 'units':'m',
    'coordinateFrame':'right-handed-y-up', 'points':points,
    'scale':{'source':'user-measured','metresPerUnit':1,'selfReported':True,'verified':False},
    'fromSource':[1,0,0,0,0,1,0,0,0,0,1,0],
    'provenance':{'totalPoints':len(points),'keptPoints':len(points),'outliersDropped':0,'thinned':False}}
scene = copy.deepcopy(SCENE)
scene.update(units='m', scale=cloud['scale'], source=title, cloudPointsSha256=points_sha256(cloud))
scene['counts']['points'] = len(points)
scene = ensure_component_ids(scene)
(out/'scene.json').write_text(json.dumps(scene))
(out/'scene.glb').write_bytes(glb())
(out/'arena-cloud.json').write_text(json.dumps(cloud))
reconstruction = {'schema':'brainsnn.reconstruction.v1','pipeline':'authored-transport-fixture',
    'coordinate_frame':'right-handed-y-up','metric_verified':False,
    'scale_estimate':{'status':'estimated','metres_per_unit':1,'frames_used':20,
                      'model':{'repo':'authored-fixture-no-model-executed'}},
    'cameras':[{'image':f'authored_{i:03}.png','camera_to_world_y_up':
        [[1,0,0,.5+i*.15],[0,1,0,1.35],[0,0,1,1.5],[0,0,0,1]]} for i in range(20)]}
(out/'reconstruction.json').write_text(json.dumps(reconstruction))
ply = 'ply\nformat ascii 1.0\nelement vertex '+str(len(points))+'\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'
(out/'authored-points.ply').write_text(ply+'\n'.join(' '.join(map(str,row)) for row in points)+'\n')
drawings = write_drawing_set(scene,out,name=title,scene_path=out/'scene.json')
assert drawings['written'] and drawings['preview']['written'], drawings
(out/'scene-usd.json').write_text(json.dumps({'fixture':True,'drawing_set':drawings}))
artifacts = [
    {'name':'scene.glb','kind':'visual','representation':'triangle-mesh','coordinate_frame':'right-handed-y-up','units':'m'},
    {'name':'authored-points.ply','kind':'visual','representation':'point-cloud','coordinate_frame':'right-handed-y-up','units':'m'},
    {'name':'scene.json','kind':'evidence'}, {'name':'arena-cloud.json','kind':'evidence'},
    {'name':'scene-usd.json','kind':'evidence'}, {'name':'reconstruction.json','kind':'evidence'}, *drawings['artifacts']]
(out/'manifest.json').write_text(json.dumps({'artifacts':artifacts}))
'''


def option_value(page, selector, text):
    options = page.locator(selector + ' option').evaluate_all(
        '(els) => els.map(el => ({value:el.value, text:el.textContent}))')
    matches = [row['value'] for row in options if text in row['text']]
    assert len(matches) == 1, (text, options)
    return matches[0]


def no_overflow(page, label):
    size = page.evaluate('''() => ({viewport:innerWidth,
      page:document.documentElement.scrollWidth, body:document.body.scrollWidth})''')
    assert max(size['page'], size['body']) <= size['viewport'] + 1, (label, size)
    return size


def wait_for_adapter(page, release):
    for _ in range(200):
        if release.with_suffix('.started').exists():
            return
        page.wait_for_timeout(50)
    raise AssertionError('Job never reached the real fixture adapter')


def preview_race(page, worker_url, first_source):
    """Delay real PLY bytes, never replace them, while the user opens a model."""
    held = []

    def delay_ply(route):
        response = route.fetch()
        if not held and 'authored-points.ply' in response.headers.get('content-disposition',''):
            held.append((route,response))
        else:
            route.fulfill(response=response)

    pattern = worker_url+'/v1/download/**'
    page.route(pattern,delay_ply)
    try:
        page.locator('#workspace-source-view').click()
        expect(page.locator('#workspace-source-select')).to_have_value(first_source)
        expect(page.locator('#scene-bim-files')).to_be_empty()
        page.locator('#workspace-points-view').click()
        for _ in range(200):
            if held:
                break
            page.wait_for_timeout(25)
        assert held, 'Expected the real worker PLY download to be held'
        page.locator('#workspace-model-view').click()
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
        route,response = held[0]
        try:
            route.fulfill(response=response)
        except PlaywrightError:
            # Cancelling the prior browser fetch may close its route. It must
            # be an actual request failure, not a substituted test response.
            assert route.request.failure, 'PLY route failed without browser cancellation'
        page.wait_for_timeout(300)
        expect(page.locator('#workspace')).to_have_attribute('data-primary-view','model')
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready')
        expect(page.locator('#workspace-source-select')).to_have_value(first_source)
    finally:
        page.unroute(pattern,delay_ply)


def opening_draft_retention(page, first_job, second_job):
    """Explicit authored review drafts survive navigation, never another job."""
    page.set_viewport_size({'width':1360,'height':1000})
    page.locator('#workspace-job-select').select_option(first_job)
    page.locator('#workspace-model-view').click()
    expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
    page.locator('#bim-offset').fill('0.4')
    page.locator('#bim-width').fill('0.8')
    page.locator('#bim-height').fill('2.0')
    page.locator('#bim-reviewed').check()
    page.locator('[data-bim-action=add]').click()
    expect(page.locator('.bim-opening-list li')).to_have_count(1)
    expect(page.locator('.bim-opening-list')).to_contain_text('0.80 × 2.00 m')
    expect(page.locator('#drawing-review')).to_have_attribute('data-state','stale')
    page.locator('#scene-workspace-heading').focus()
    page.keyboard.press('Escape')
    expect(page.locator('#scene-bim-files')).to_be_empty()
    page.locator('#workspace-model-view').click()
    expect(page.locator('.bim-opening-list li')).to_have_count(1, timeout=60000)
    expect(page.locator('.bim-opening-list')).to_contain_text('0.80 × 2.00 m')
    expect(page.locator('#drawing-review')).to_have_attribute('data-state','stale')
    expect(page.locator('#drawing-download-pdf')).to_be_disabled()

    page.locator('#workspace-job-select').select_option(second_job)
    page.locator('#workspace-model-view').click()
    expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
    expect(page.locator('.bim-opening-list li')).to_have_count(0)
    page.locator('#workspace-job-select').select_option(first_job)
    page.locator('#workspace-model-view').click()
    expect(page.locator('.bim-opening-list li')).to_have_count(1, timeout=60000)
    expect(page.locator('#drawing-review')).to_have_attribute('data-state','stale')

    page.locator('#workspace-step-save').click()
    page.locator('[data-action=clear]').click()
    expect(page.locator('#workspace-job-select option')).to_have_count(1)
    expect(page.locator('#workspace-source-select option')).to_have_count(1)
    expect(page.locator('#scene-dialog')).not_to_be_visible()
    expect(page.locator('#scene-bim-files')).to_be_empty()


def check_browser(pw, name, origin, worker_url, token, photos, release):
    executable = os.environ.get('PLAYWRIGHT_' + name.upper() + '_PATH')
    browser = getattr(pw, name).launch(headless=True,
        **({'executable_path': executable} if executable else {}))
    context = browser.new_context(viewport={'width':1360,'height':1000}, reduced_motion='reduce')
    page = context.new_page()
    page.set_default_timeout(20000)
    errors, layouts = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    try:
        response = page.goto(origin+'/world/index.html?nosw=1', wait_until='domcontentloaded')
        assert response and response.ok
        expect(page.locator('#workspace-source-select')).to_be_attached()
        expect(page.locator('#objects option').first).to_be_attached()

        # An actual edited map stays with the work while captures are added.
        page.locator('#tab-world').click()
        edit = 'Workspace continuity ' + name
        page.locator('#object-name').fill(edit)
        page.locator('#object-name').press('Tab')
        page.locator('#scale-reviewed').uncheck()
        expect(page.locator('#map-reviewed')).not_to_be_checked()
        page.locator('#files').set_input_files(str(photos[0]))
        library = page.locator('#workspace-library')
        if library.get_attribute('open') is None:
            library.locator('summary').click()
        first_source = option_value(page, '#workspace-source-select', photos[0].name)
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
        wait_for_adapter(page,release)

        # Switch the active source while the real job is still in its adapter.
        page.locator('#files').set_input_files(str(photos[1]))
        second_source = option_value(page, '#workspace-source-select', photos[1].name)
        expect(page.locator('#workspace-source-select')).to_have_value(second_source)
        release.write_text('The browser has selected source B; A may now finish.\n')
        page.wait_for_function("document.querySelectorAll('#workspace-job-select option').length === 2", timeout=60000)
        first_job = page.locator('#workspace-job-select option').nth(1).get_attribute('value')
        expect(page.locator('#workspace-source-select')).to_have_value(second_source)
        assert not page.locator('#scene-dialog').evaluate('el => el.open'), 'Late A result stole the current B view'
        expect(page.locator('#object-name')).to_have_value(edit)

        # Explicit selection opens the retained A result in the same workspace.
        page.locator('#workspace-source-select').select_option(first_source)
        page.locator('#workspace-job-select').select_option(first_job)
        page.locator('#workspace-model-view').click()
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
        expect(page.locator('#workspace')).to_have_attribute('data-primary-view','model')
        assert not page.locator('#scene-dialog').evaluate("el => el.matches(':modal')")
        assert page.locator('#scene-workspace-slot #scene-dialog').count() == 1
        assert 'SHA-256 checked' in page.locator('#scene-status').inner_text()
        assert page.locator('#drawing-sheet-select option').count() == 12
        assert 'A-101' in page.locator('#drawing-sheet-select option:checked').inner_text()
        page.locator('#drawing-sheet-select').select_option(option_value(page,'#drawing-sheet-select','A-201'))
        assert page.locator('#drawing-sheet-preview').locator('path,line,rect,polyline,text').count() > 0
        with page.expect_download() as first_pdf:
            page.locator('#drawing-download-pdf').click()
        original_pdf = Path(first_pdf.value.path()).read_bytes()
        assert original_pdf.startswith(b'%PDF-1.4') and b'/Count 12' in original_pdf
        assert 'review' in page.locator('#drawing-review').inner_text().lower()

        preview_race(page,worker_url,first_source)

        # The shared view controls are usable while model review is open.
        page.locator('#workspace-source-view').click()
        expect(page.locator('#scene-dialog')).not_to_be_visible()
        expect(page.locator('#workspace-source-select')).to_have_value(first_source)
        page.locator('#workspace-points-view').click()
        page.wait_for_function("document.querySelector('#workspace-source-select').selectedOptions[0].textContent.includes('authored-points.ply')")
        page.locator('#workspace-source-view').click()
        expect(page.locator('#workspace-source-select')).to_have_value(first_source)
        page.locator('#workspace-drawings-view').click()
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
        expect(page.locator('#panel')).to_have_attribute('aria-labelledby','tab-capture')
        # A library PLY open must close the inline model even when the existing
        # tab is already Capture; a tab-change-only cleanup misses this path.
        point_row = page.locator('.workspace-result-file').filter(has=page.get_by_text('authored-points.ply',exact=True))
        point_row.locator(f'[data-result-open="{first_job}"]').click()
        expect(page.locator('#scene-dialog')).not_to_be_visible()
        expect(page.locator('#scene-bim-files')).to_be_empty()
        page.wait_for_function("document.querySelector('#workspace-source-select').selectedOptions[0].textContent.includes('authored-points.ply')")
        page.locator('#workspace-map-view').click()
        expect(page.locator('#object-name')).to_have_value(edit)
        expect(page.locator('#map-reviewed')).not_to_be_checked()
        expect(page.locator('#scale-reviewed')).not_to_be_checked()
        for step, tab in [('robots','test'),('save','evidence'),('capture','capture')]:
            page.locator('#workspace-step-'+step).click()
            expect(page.locator('#tab-'+tab)).to_have_attribute('aria-selected','true')
            expect(page.locator('#object-name')).to_have_value(edit)

        # Second real job includes both original capture files (existing API
        # behavior), and must not replace the retained first job's authority.
        page.locator('#workspace-source-select').select_option(second_source)
        release.unlink()
        release.with_suffix('.started').unlink()
        processing_options(page)
        page.locator('#engine').select_option('scene-usd')
        page.locator('#consent').check()
        page.locator('[data-action=process]').click()
        wait_for_adapter(page,release)
        page.locator('#workspace-job-select').select_option(first_job)
        page.locator('#workspace-model-view').click()
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
        release.write_text('An explicit model view may not be replaced by job completion.\n')
        page.wait_for_function("document.querySelectorAll('#workspace-job-select option').length === 3", timeout=60000)
        expect(page.locator('#workspace')).to_have_attribute('data-primary-view','model')
        expect(page.locator('#workspace-job-select')).to_have_value(first_job)
        jobs = page.locator('#workspace-job-select option').evaluate_all('(els)=>els.map(el=>el.value).filter(Boolean)')
        second_job = next(key for key in jobs if key != first_job)
        page.locator('#workspace-job-select').select_option(second_job)
        page.locator('#workspace-model-view').click()
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
        with page.expect_download() as second_pdf:
            page.locator('#drawing-download-pdf').click()
        new_pdf = Path(second_pdf.value.path()).read_bytes()
        assert new_pdf != original_pdf, 'Distinct authored fixture inputs must produce distinguishable drawings'

        page.locator('#workspace-job-select').select_option(first_job)
        page.locator('#workspace-step-save').click()
        old_pdf_button = page.locator(f'[data-result-download="{first_job}"][aria-label="Download drawing-set.pdf"]')
        with page.expect_download() as retained_pdf:
            old_pdf_button.click()
        retained = Path(retained_pdf.value.path()).read_bytes()
        assert retained == original_pdf, 'Old result downloaded the latest job PDF instead of its retained original'
        groups = page.locator('.workspace-result-group').all_inner_texts()
        assert len(groups) == 2
        assert any(photos[0].name in group and photos[1].name not in group for group in groups), groups
        assert any(photos[0].name in group and photos[1].name in group for group in groups), groups

        # The explicitly chosen result takes precedence over a different active
        # source. Job1 belongs only to A; job2 intentionally contains A+B.
        page.locator('#workspace-source-select').select_option(second_source)
        page.locator('#workspace-job-select').select_option(first_job)
        page.locator('#workspace-source-view').click()
        expect(page.locator('#workspace-source-select')).to_have_value(first_source)
        page.locator('#workspace-source-select').select_option(second_source)
        page.locator('#workspace-job-select').select_option(first_job)
        page.locator('#workspace-points-view').click()
        page.wait_for_function("document.querySelector('#workspace-source-select').selectedOptions[0].textContent.includes('authored-points.ply')")
        page.locator('#workspace-source-view').click()
        expect(page.locator('#workspace-source-select')).to_have_value(first_source)

        # Native inline close, readable drawings and all workflow controls at
        # both narrow widths; no checkbox or route qualification is invented.
        page.locator('#workspace-model-view').click()
        expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
        page.locator('#scene-workspace-heading').focus()
        page.keyboard.press('Escape')
        expect(page.locator('#scene-dialog')).not_to_be_visible()
        page.locator('#playground-text-size').click()
        expect(page.locator('html')).to_have_attribute('data-reading-size','large')
        for width in (390,320):
            page.set_viewport_size({'width':width,'height':900})
            page.locator('#workspace-map-view').click()
            expect(page.locator('#object-name')).to_have_value(edit)
            assert page.locator('#object-name').evaluate('el=>parseFloat(getComputedStyle(el).fontSize)') >= 18
            expect(page.locator('#map-reviewed')).not_to_be_checked()
            layouts.append({'width':width,'view':'map',**no_overflow(page,f'{name} {width} map')})
            page.locator('#workspace-drawings-view').click()
            expect(page.locator('#drawing-review')).to_have_attribute('data-state','ready', timeout=60000)
            layouts.append({'width':width,'view':'drawings',**no_overflow(page,f'{name} {width} drawings')})
            for target in ('capture','explore','drawings','robots','save'):
                button = page.locator('#workspace-step-'+target)
                button.scroll_into_view_if_needed()
                box = button.bounding_box()
                assert box and box['x'] >= -1 and box['x'] + box['width'] <= width + 1, (target,box)
            page.locator('#drawing-review').scroll_into_view_if_needed()
            page.screenshot(path=str(OUTPUT/f'unified-workspace-{name}-{width}.png'))
            page.locator('#drawing-page-size').select_option('large')
            assert page.locator('.drawing-stage').evaluate('el=>el.scrollWidth > el.clientWidth'), 'Large page should scroll inside the drawing, not widen the workspace'
            layouts.append({'width':width,'view':'drawing-detail',**no_overflow(page,f'{name} {width} drawing detail')})
            page.locator('#drawing-page-size').select_option('fit')

        # Explicitly browsing an estimated-scale reconstruction must not create
        # a robot map as a side effect, even for an untouched authored example.
        # Job2's points have never been opened, so this exercises its first load.
        page.locator('#hero-sample').click()
        untouched_name = page.locator('#map-name').input_value()
        untouched_objects = page.locator('#objects option').count()
        page.locator('#workspace-job-select').select_option(second_job)
        page.locator('#workspace-points-view').click()
        page.wait_for_function("Array.from(document.querySelectorAll('#workspace-source-select option')).filter(el=>el.textContent.includes('authored-points.ply')).length === 2")
        page.wait_for_function("document.querySelector('#status').textContent.includes('estimated scale')")
        page.locator('#workspace-map-view').click()
        expect(page.locator('#map-name')).to_have_value(untouched_name)
        expect(page.locator('#objects option')).to_have_count(untouched_objects)

        opening_draft_retention(page,first_job,second_job)
        assert not errors, errors
        receipt = {'browser':name, 'fixture':'authored geometry; no reconstruction or inference',
            'pendingSourcePreserved':True, 'retainedJobDownload':True,
            'pendingPreviewDoesNotReplaceModel':True, 'pendingJobDoesNotReplaceModel':True,
            'selectedResultControlsSource':True, 'derivedPointsReturnToOriginal':True,
            'explicitEstimatedPreviewPreservesUntouchedMap':True,
            'openingDraftRetainedForExactJob':True, 'otherJobDoesNotBorrowOpeningDraft':True,
            'localSessionCleared':True,
            'originalPdfSha256':hashlib.sha256(original_pdf).hexdigest(),
            'secondPdfSha256':hashlib.sha256(new_pdf).hexdigest(),
            'drawingSheets':12, 'sourceGroups':2, 'mapEditPreserved':True,
            'reviewNotGranted':True, 'layouts':layouts}
        (OUTPUT/f'unified-workspace-{name}.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(name+': unified workspace source retention, bound drawings, original downloads and mobile layouts PASS',flush=True)
    except Exception:
        page.screenshot(path=str(OUTPUT/f'unified-workspace-{name}-failure.png'))
        print('Browser errors: '+json.dumps(errors),file=sys.stderr)
        print(page.locator('body').inner_text()[-14000:],file=sys.stderr)
        raise
    finally:
        context.close(); browser.close()


def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    server_python = os.environ.get('WORLD_SERVER_PYTHON',sys.executable)
    processes, logs = [], []
    with tempfile.TemporaryDirectory(prefix='brainsnn-unified-workspace-') as directory:
        tmp = Path(directory)
        photos = [tmp/'source-A-authored.png',tmp/'source-B-authored.png']
        for photo, colour in zip(photos,('#315566','#89564a')):
            Image.new('RGB',(320,240),colour).save(photo,format='PNG')
        adapter, release = tmp/'authored_adapter.py', tmp/'release'
        adapter.write_text(ADAPTER)
        frontend, backend = port(), port()
        while frontend == backend:
            backend = port()
        origin, worker_url = f'http://127.0.0.1:{frontend}', f'http://127.0.0.1:{backend}'
        token = secrets.token_urlsafe(48)
        config = tmp/'adapters.json'
        config.write_text(json.dumps([{'id':'scene-usd','label':'Authored workspace transport fixture; no reconstruction',
            'enabled':True,'license_reviewed':True,'input_kinds':['image','cloud'],'max_inputs':8,'timeout_seconds':60,
            'dimension_checks':True,'bim_review':True,
            'command':[server_python,str(adapter),'--root',str(ROOT),'--release',str(release),
                       '--input-manifest','{input_manifest}']}]))
        environment = {**os.environ,'WORLD_WORKER_TOKEN':token,'WORLD_WORKER_DIR':str(tmp/'data'),
            'WORLD_ADAPTERS_FILE':str(config),'WORLD_ALLOWED_ORIGINS':origin}
        try:
            for label, command, env in [
                ('frontend',[server_python,'-m','http.server',str(frontend),'--bind','127.0.0.1',
                    '--directory',str(ROOT/'brainsnn-r3f-app/public')],os.environ),
                ('worker',[server_python,'-m','uvicorn','robotics.world_worker.app:create_app','--factory',
                    '--host','127.0.0.1','--port',str(backend),'--no-access-log'],environment)]:
                log = (tmp/(label+'.log')).open('wb'); logs.append(log)
                processes.append(subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log))
            ready(origin+'/world/index.html',processes[0]); ready(worker_url+'/healthz',processes[1])
            with sync_playwright() as pw:
                for name in os.environ.get('WORLD_BROWSERS','chromium,webkit').split(','):
                    release.unlink(missing_ok=True)
                    release.with_suffix('.started').unlink(missing_ok=True)
                    check_browser(pw,name.strip(),origin,worker_url,token,photos,release)
        except Exception:
            for path in [tmp/'worker.log',*sorted((tmp/'data/jobs').glob('*/operator.log'))]:
                if path.exists():
                    print(path.name+':\n'+path.read_text(errors='replace')[-8000:],file=sys.stderr,flush=True)
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
