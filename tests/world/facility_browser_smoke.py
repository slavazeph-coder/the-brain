"""Actual local workbench and shared renderer, using explicitly authored fixtures.

No reconstruction, survey measurement, GPU qualification or physical robot runs here.
Build the app first. WORLD_BROWSERS=chromium,webkit python tests/world/facility_browser_smoke.py
PLAYWRIGHT_CHROMIUM_PATH can select an installed Chromium executable.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import math
import os
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'brainsnn-r3f-app/public'
FIXTURES = PUBLIC / 'world/fixtures'
OUTPUT = ROOT / 'output/playwright/world'
SCENE_PATH = FIXTURES / 'asbuilt-current.scene.json'
CLOUD_PATH = FIXTURES / 'asbuilt-source.cloud.json'
SCENE = json.loads(SCENE_PATH.read_text())
CLOUD = json.loads(CLOUD_PATH.read_text())
SCENE_SHA = hashlib.sha256(SCENE_PATH.read_bytes()).hexdigest()
CHAIR = next(p for p in SCENE['objects'] if p['name'] == 'chair_1')


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def payload(value, name):
    return {'name': name, 'mimeType': 'application/json', 'buffer': json.dumps(value).encode()}


def paint(page):
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def range_value(page, selector, value):
    page.locator(selector).evaluate("(node, value) => {node.value = value; node.dispatchEvent(new Event('input', {bubbles:true}));}", str(value))
    paint(page)


def export_review(page, directory, label):
    with page.expect_download() as ticket:
        page.locator('[data-facility-action="export"]').click()
    path = directory / f'facility-{label}.json'
    ticket.value.save_as(path)
    return json.loads(path.read_text())


def assert_receipt(receipt):
    assert receipt['schema'] == 'brainsnn.facility-review.v1'
    assert receipt['source']['sceneSha256'] == SCENE_SHA
    assert receipt['source']['sourceSha256'] == SCENE['cloudPointsSha256']
    assert receipt['source']['revision'] == SCENE['componentGraph']['revision']
    assert receipt['pointCount'] == len(CLOUD['points'])
    assert receipt['componentCount'] == 6
    assert receipt['scale'] == SCENE['scale']
    assert all(value is False for value in receipt['validation'].values())
    assert receipt['assembly']['executionTimingAvailable'] is False
    assert receipt['displayFrame']['sourceCoordinatesPreserved'] is True
    assert 'internal fit, not survey accuracy' in receipt['scope']
    assert 'cloudPoints' not in receipt and 'parts' not in receipt


def mount_guard_fixture(page, *, wrong_cloud=False):
    """Mount the production component directly to inspect dirty/stale source guards."""
    page.evaluate('''async ({wrongCloud}) => {
      window.__facilityDispose?.();
      document.getElementById('facility-host').replaceChildren();
      document.getElementById('facility-host').hidden=false;
      const sceneBytes=await(await fetch('/world/fixtures/asbuilt-current.scene.json')).arrayBuffer();
      const scene=JSON.parse(new TextDecoder().decode(sceneBytes));
      const cloud=await(await fetch('/world/fixtures/asbuilt-source.cloud.json')).json();
      if(wrongCloud)cloud.points[0][0]+=.2;
      const {sha256}=await import('/world/operational-twin.mjs');
      const {mountFacilityReview}=await import('/world/facility-review-ui.mjs');
      window.__facilityContext={scene,cloud,dirty:false};
      window.__facilityOriginal=JSON.stringify({scene,cloud});
      window.__facilityCurrent=true;window.__facilityExports=[];
      window.__facilityDispose=mountFacilityReview({host:document.getElementById('facility-host'),
        context:window.__facilityContext,sceneSha:await sha256(sceneBytes),isCurrent:()=>window.__facilityCurrent,
        open:true,download:(...args)=>window.__facilityExports.push(args)});
    }''', {'wrongCloud': wrong_cloud})


def shared_renderer_compatibility(page):
    """Exercise existing callers without the new setPresentation/focus controls."""
    page.evaluate('''async () => {
      window.__facilityDispose?.();
      for(const name of ['operational-twin','asbuilt']){
        const link=document.createElement('link');link.rel='stylesheet';link.href='/world/'+name+'.css';document.head.append(link);
      }
      const host=document.getElementById('facility-host');host.replaceChildren();host.hidden=false;
      const bytes=await(await fetch('/world/fixtures/asbuilt-current.scene.json')).arrayBuffer();
      const scene=JSON.parse(new TextDecoder().decode(bytes));
      const {sha256}=await import('/world/operational-twin.mjs');window.__legacySha=await sha256(bytes);
      const {mountOperationalTwin}=await import('/world/operational-twin-ui.mjs');
      window.__legacyDispose=mountOperationalTwin({host,context:{scene,dirty:false},sceneSha:window.__legacySha,open:true});
    }''')
    expect(page.locator('.twin-count')).to_have_text('6 components · 0 sources · 0 authored joints')
    page.locator('.twin-stage canvas,.twin-stage svg').wait_for()
    paint(page)
    before = page.locator('.twin-stage').screenshot()
    page.locator(f'[data-twin-component="{CHAIR["componentId"]}"]').click()
    page.locator('.twin-isolate').check()
    paint(page)
    assert before != page.locator('.twin-stage').screenshot(), 'Legacy selection/isolation lost its render update'
    page.evaluate('''async () => {
      window.__legacyDispose();
      const scene=await(await fetch('/world/fixtures/asbuilt-current.scene.json')).json();
      const cloud=await(await fetch('/world/fixtures/asbuilt-source.cloud.json')).json();
      const prior=new Uint8Array(await(await fetch('/world/fixtures/asbuilt-prior.ifc')).arrayBuffer());
      const {mountAsBuiltReview}=await import('/world/asbuilt-ui.mjs');
      window.__legacyDispose=mountAsBuiltReview({host:document.getElementById('facility-host'),
        context:{scene,cloud,dirty:false},sceneSha:window.__legacySha,initialPriorBytes:prior,open:true});
    }''')
    expect(page.locator('.asbuilt-status')).to_contain_text('Prior IFC opened locally', timeout=30000)
    expect(page.locator('.asbuilt-stage canvas,.asbuilt-stage svg')).to_have_count(4)
    paint(page)
    prior = page.locator('[data-asbuilt-view="prior"]').screenshot()
    page.locator('[data-asbuilt-view="current"] canvas,[data-asbuilt-view="current"] svg').press('ArrowRight')
    paint(page)
    assert prior != page.locator('[data-asbuilt-view="prior"]').screenshot(), 'Legacy linked camera stopped updating'
    page.evaluate('window.__legacyDispose()')


def direct_renderer_checks(page):
    """Authored numeric stress case: clipping/picking and centimetres at a large offset."""
    page.evaluate('''() => {
      const host=document.getElementById('facility-host');host.replaceChildren();host.hidden=false;
      const stage=document.createElement('div');stage.id='facility-direct-stage';stage.className='facility-stage';host.append(stage);
      window.__directPicks=[];
      window.__mountDirect=(base=0)=>{
        window.__direct?.dispose();
        const parts=[{componentId:'numeric-stress-box',centre:[base,1,base],size:[1,1,1],yaw:0,floor:false}];
        const points=[[base-.01,1,base,255,0,0],[base+.01,1,base,0,255,255]];
        window.__directInputs={parts,points};window.__directOriginal=JSON.stringify({parts,points});
        window.__direct=window.BrainSNNTwinRenderer.create(stage,{parts,pointCloud:points,frame:{centre:[base,1,base],span:2},onSelect:id=>window.__directPicks.push(id)});
        window.__direct.setView({yaw:0,pitch:0,zoom:5,target:[base,1,base]});
      };
      window.__mountDirect();
    }''')
    stage = page.locator('#facility-direct-stage')
    shots = {}
    for mode in ('scan', 'model'):
        page.evaluate('(mode)=>window.__direct.setPresentation({mode,opacity:1,visibleIds:null,clip:null})', mode)
        paint(page)
        shots[mode] = stage.screenshot()
        page.evaluate('()=>window.__direct.setPresentation({clip:{min:[-2,3,-2],max:[2,4,2]}})')
        paint(page)
        shots['clipped-' + mode] = stage.screenshot()
        assert shots[mode] != shots['clipped-' + mode], f'Clipping did not remove {mode} pixels'
    assert shots['clipped-scan'] == shots['clipped-model'], 'Source points and proxies disagree on the empty section'
    page.evaluate("()=>{window.__direct.setPresentation({mode:'model',clip:null});window.__direct.focus('numeric-stress-box');}")
    paint(page)
    page.locator('#facility-direct-stage canvas').click()
    assert page.evaluate('window.__directPicks.length') == 1, 'Visible centre proxy was not selectable'
    page.evaluate('()=>window.__direct.setPresentation({visibleIds:[]})')
    page.locator('#facility-direct-stage canvas').click()
    assert page.evaluate('window.__directPicks.length') == 1, 'Hidden proxy remained selectable'
    page.evaluate("()=>window.__direct.setPresentation({visibleIds:null,clip:{min:[-2,3,-2],max:[2,4,2]}})")
    page.locator('#facility-direct-stage canvas').click()
    assert page.evaluate('window.__directPicks.length') == 1, 'Clipped proxy remained selectable'
    assert page.evaluate("window.__direct.focus('numeric-stress-box')") is False
    page.evaluate("()=>{window.__mountDirect(0);window.__direct.setPresentation({mode:'scan'});}")
    paint(page)
    nearby = stage.screenshot()
    page.evaluate("()=>{window.__mountDirect(9000000);window.__direct.setPresentation({mode:'scan'});}")
    paint(page)
    assert nearby == stage.screenshot(), 'Centimetre source-point separation changed at a 9,000 km coordinate offset'
    assert page.evaluate('window.__direct.getView().target') == [9000000, 1, 9000000]
    assert page.evaluate('JSON.stringify(__directInputs)===__directOriginal'), 'Rendering changed source coordinates'
    page.evaluate('window.__direct.dispose()')


def check(browser, origin, engine, width, software, directory):
    page = browser.new_page(viewport={'width': width, 'height': 900}, accept_downloads=True)
    errors, transmissions = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: transmissions.append(request.url) if request.method != 'GET' else None)
    if software:
        page.add_init_script("window.BrainSNNTwinRenderer={create(){throw new Error('Explicit smoke-test GPU refusal');}};")
    try:
        page.goto(origin + '/world/facility.html')
        expect(page.locator('#facility-entry-empty')).to_be_visible()
        expect(page.locator('#scene-facility-review')).to_have_count(0)
        page.locator('#facility-example').click()
        review = page.locator('#scene-facility-review')
        expect(review).to_have_attribute('data-state', 'ready', timeout=30000)
        expect(review).to_have_attribute('data-renderer', 'software' if software else 'gpu', timeout=30000)
        expect(page.locator('#facility-page-status')).to_contain_text('AUTHORED SOFTWARE FIXTURE')
        expect(page.locator('.facility-count')).to_have_text('6 of 6 components')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'
        screenshots = {}
        for mode in ('scan', 'model', 'overlay'):
            page.locator(f'[data-facility-mode="{mode}"]').click()
            expect(review).to_have_attribute('data-mode', mode)
            paint(page)
            screenshots[mode] = page.locator('.facility-stage').screenshot()
        assert len(set(screenshots.values())) == 3, 'Scan/model/overlay did not produce distinct pixels'
        if software:
            expect(page.locator('.facility-opacity')).to_be_disabled()
        else:
            range_value(page, '.facility-opacity', '.65')
            expect(page.locator('.facility-opacity-value')).to_have_text('65%')
        page.locator(f'[data-facility-component="{CHAIR["componentId"]}"]').click()
        expect(page.locator('.facility-selected h4')).to_have_text('chair')
        before_focus = page.locator('.facility-stage').screenshot()
        page.locator('[data-facility-action="focus"]').click()
        paint(page)
        focused = page.locator('.facility-stage').screenshot()
        assert before_focus != focused, 'Focus did not change actual view pixels'
        page.locator('.facility-bookmarks > summary').click()
        page.locator('.facility-bookmark-name').fill('Chair inspection')
        page.locator('[data-facility-action="save-bookmark"]').click()
        page.locator('.facility-stage canvas,.facility-stage svg').press('ArrowRight')
        paint(page)
        orbited = page.locator('.facility-stage').screenshot()
        assert focused != orbited, 'Keyboard orbit did not change actual view'
        page.locator('[data-facility-action="bookmark-0"]').click()
        paint(page)
        assert orbited != page.locator('.facility-stage').screenshot(), 'Saved camera did not update view pixels'
        page.locator('.facility-isolate').check()
        isolated = export_review(page, directory, f'{engine}-{width}-isolated')
        assert_receipt(isolated)
        assert isolated['visibleComponentIds'] == [CHAIR['componentId']]
        assert all(math.isclose(a, b, abs_tol=1e-9) for a, b in zip(isolated['view']['target'], CHAIR['centre']))
        assert isolated['bookmarks'][0]['name'] == 'Chair inspection'
        saved = isolated['bookmarks'][0]['view']
        assert all(math.isclose(isolated['view'][key], saved[key], abs_tol=1e-9) for key in ('yaw', 'pitch', 'zoom'))
        page.locator('.facility-isolate').uncheck()
        page.locator('.facility-search').fill('cabinet')
        expect(page.locator('.facility-count')).to_have_text('1 of 6 components')
        expect(page.locator('.facility-parts')).to_contain_text('cabinet_1')
        page.locator('.facility-search').fill('')
        page.locator('.facility-kind').select_option('wall')
        expect(page.locator('.facility-count')).to_have_text('2 of 6 components')
        page.locator('[data-facility-action="reset"]').click()
        expect(page.locator('.facility-count')).to_have_text('6 of 6 components')
        range_value(page, '.facility-assembly', 2)
        expect(review).to_have_attribute('data-replay-count', '2')
        expect(page.locator('.facility-replay-label')).to_be_visible()
        expect(page.locator('.facility-replay')).to_contain_text('not AI execution or processing time')
        page.locator('[data-facility-action="show-all"]').click()
        expect(review).to_have_attribute('data-replay-count', '6')
        if software:
            expect(page.locator('.facility-section-enabled')).to_be_disabled()
            expect(page.locator('.facility-renderer-note')).to_contain_text('section clipping unavailable')
            expect(page.locator('.facility-renderer-note')).to_contain_text('model transparency unavailable')
        else:
            paint(page)
            before_section = page.locator('.facility-stage').screenshot()
            page.locator('.facility-section-enabled').check()
            range_value(page, '.facility-section-min', .5)
            range_value(page, '.facility-section-max', 1.2)
            assert before_section != page.locator('.facility-stage').screenshot(), 'Section did not alter actual geometry pixels'
        receipt = export_review(page, directory, f'{engine}-{width}')
        assert_receipt(receipt)
        assert receipt['controls']['opacity'] == (.35 if software else .65)
        assert receipt['controls']['section']['enabled'] is (not software)
        if not software:
            assert receipt['clip']['min'][1] == .5 and receipt['clip']['max'][1] == 1.2
        page.locator('.facility-stage').screenshot(path=str(OUTPUT / f'facility-{engine}-{width}.png'))

        # Actual file entry uses exact scene bytes, then refuses replacement mismatches without retaining the old view.
        page.locator('#facility-clear').click()
        expect(review).to_have_count(0)
        page.locator('#facility-scene-file').set_input_files(str(SCENE_PATH))
        expect(review).to_have_count(0)
        page.locator('#facility-cloud-file').set_input_files(str(CLOUD_PATH))
        expect(review).to_have_attribute('data-state', 'ready', timeout=30000)
        wrong = json.loads(json.dumps(CLOUD))
        wrong['points'][0][0] += .2
        page.locator('#facility-cloud-file').set_input_files(payload(wrong, 'wrong-cloud.json'))
        expect(page.locator('#facility-page-status')).to_contain_text('Files refused: Source point hash')
        expect(review).to_have_count(0)
        page.locator('#facility-cloud-file').set_input_files(str(CLOUD_PATH))
        expect(review).to_have_attribute('data-state', 'ready', timeout=30000)
        page.locator('#facility-scene-file').set_input_files({'name': 'bad-scene.json', 'mimeType': 'application/json', 'buffer': b'{broken'})
        expect(page.locator('#facility-page-status')).to_contain_text('Scene must be valid UTF-8 JSON')
        expect(review).to_have_count(0)

        # Direct mount exercises guards owned by the embedded production scene workflow.
        mount_guard_fixture(page)
        expect(review).to_have_attribute('data-renderer', 'software' if software else 'gpu', timeout=30000)
        page.locator('[data-facility-action="export"]').click()
        assert page.evaluate('window.__facilityExports.length') == 1
        assert_receipt(json.loads(page.evaluate('window.__facilityExports[0][1]')))
        page.evaluate('window.__facilityContext.dirty=true')
        page.locator('[data-facility-action="export"]').click()
        expect(page.locator('.facility-message')).to_contain_text('Compile pending BIM edits')
        assert page.evaluate('window.__facilityExports.length') == 1
        page.evaluate('window.__facilityContext.dirty=false;window.__facilityCurrent=false')
        page.locator('[data-facility-action="export"]').click()
        assert page.evaluate('window.__facilityExports.length') == 1
        assert page.evaluate('JSON.stringify({scene:__facilityContext.scene,cloud:__facilityContext.cloud})===__facilityOriginal'), 'Viewing mutated source evidence'
        page.evaluate('window.__facilityDispose()')
        expect(review).to_have_count(0)
        mount_guard_fixture(page, wrong_cloud=True)
        expect(review).to_have_attribute('data-state', 'refused', timeout=30000)
        expect(page.locator('.facility-message')).to_contain_text('Source point hash does not match')
        assert page.locator('[data-facility-action="export"]').count() == 0
        shared_renderer_compatibility(page)
        if not software:
            direct_renderer_checks(page)
        assert not errors, errors
        assert not transmissions, f'Unexpected source transmission: {transmissions}'
        display_checks = 'mode/focus pixels; section and transparency explicitly disabled' if software else 'mode/focus/section pixels; clipping, picking and large-coordinate checks'
        print(f'PASS {engine} {width}px: {"software fallback" if software else "software-WebGL"}, authored source binding, {display_checks}, saved views, review export, file replacement and dirty/stale guards; legacy twin and four linked IFC views; no metric or physical qualification')
    finally:
        page.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(PUBLIC)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix='facility-browser-') as temp:
            for engine in os.environ.get('WORLD_BROWSERS', 'chromium').split(','):
                options = {'headless': True}
                if engine == 'chromium':
                    options['args'] = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
                    if os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'):
                        options['executable_path'] = os.environ['PLAYWRIGHT_CHROMIUM_PATH']
                browser = getattr(playwright, engine).launch(**options)
                try:
                    for width, software in ((1280, False), (390, True)):
                        check(browser, f'http://127.0.0.1:{server.server_port}', engine, width, software, Path(temp))
                finally:
                    browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
