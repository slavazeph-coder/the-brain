"""Authored operational-twin UI over real HTTP. No scan or machine validation.

WORLD_BROWSERS=chromium PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium python tests/world/operational_twin_browser_smoke.py
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import os
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'brainsnn-r3f-app/public'
SCENE = PUBLIC / 'world/fixtures/operational-crane.scene.json'
OUTPUT = ROOT / 'output/playwright/world'

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

def payload(value, name='operational-twin.json'):
    return {'name': name, 'mimeType': 'application/json', 'buffer': json.dumps(value).encode()}

def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(PUBLIC)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as pw, tempfile.TemporaryDirectory(prefix='twin-browser-') as temp:
            for engine in os.environ.get('WORLD_BROWSERS', 'chromium').split(','):
                options = {}
                if engine == 'chromium':
                    options['args'] = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
                    if os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'):
                        options['executable_path'] = os.environ['PLAYWRIGHT_CHROMIUM_PATH']
                browser = getattr(pw, engine).launch(headless=True, **options)
                try:
                    for width, software in ((1280, False), (390, True)):
                        page = browser.new_page(viewport={'width': width, 'height': 900}, accept_downloads=True)
                        errors, transmissions = [], []
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        page.on('request', lambda r: transmissions.append(r.url) if r.method != 'GET' else None)
                        if software:
                            page.route('**/twin-renderer.js', lambda route: route.abort())
                        page.goto(f'http://127.0.0.1:{server.server_port}/world/twin.html')
                        expect(page.locator('.twin-count')).to_have_text('8 components · 1 source · 3 authored joints')
                        page.locator('.twin-stage canvas, .twin-stage svg').wait_for()
                        if software:
                            assert page.locator('.twin-stage svg').count() == 1
                        gpu = page.locator('.twin-stage canvas').count() == 1
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'

                        page.locator('[data-twin-component]').filter(has_text='Slew bearing').click()
                        page.get_by_label('Display name', exact=True).fill('Bearing reviewed')
                        page.get_by_role('button', name='Save equipment record', exact=True).click()
                        expect(page.locator('.twin-selected h4')).to_have_text('Bearing reviewed')
                        page.get_by_role('button', name='Sources & answers', exact=True).click()
                        page.get_by_label('Question', exact=True).fill('Slew bearing inspection')
                        page.get_by_role('button', name='Find source-backed passages').click()
                        expect(page.locator('.twin-answer')).to_contain_text('Fixture revision 1 · lines 1–4')
                        expect(page.locator('.twin-citation')).to_contain_text('not an orderable manufacturer part')
                        page.get_by_label('Question', exact=True).fill('What is its certified lifting capacity?')
                        page.get_by_role('button', name='Find source-backed passages').click()
                        expect(page.locator('.twin-answer')).to_contain_text('No supported answer')

                        page.locator('.twin-add-source > summary').click()
                        page.get_by_label('Document title', exact=True).fill('<img src=x onerror=alert(1)>')
                        page.get_by_label('Revision / date', exact=True).fill('Training 2')
                        page.get_by_label('Paste source text', exact=True).fill('Training bearing inspection is authored software evidence only.')
                        page.get_by_role('button', name='Add and link source', exact=True).click()
                        expect(page.locator('.twin-count')).to_have_text('8 components · 2 sources · 3 authored joints')
                        assert page.locator('.twin-doc-list img').count() == 0, 'Unsafe document title rendered markup'

                        page.get_by_role('button', name='Parts & issues', exact=True).click()
                        expect(page.locator('.twin-record-list').first).to_contain_text('TRAIN-BRG-01')
                        page.get_by_label('Observed symptom', exact=True).fill('Authored browser test observation')
                        page.get_by_role('button', name='Record observation', exact=True).click()
                        expect(page.locator('.twin-detail')).to_contain_text('Authored browser test observation')
                        page.get_by_role('button', name='Mark resolved', exact=True).click()
                        expect(page.get_by_role('button', name='Reopen', exact=True)).to_be_visible()

                        page.get_by_role('button', name='Motion', exact=True).click()
                        before = page.locator('.twin-stage').screenshot()
                        page.locator('[data-twin-joint="training-slew"]').press('End')
                        expect(page.locator('.twin-motion-note')).to_contain_text('AUTHORED MOTION PREVIEW')
                        page.wait_for_timeout(150)  # Paint the requestAnimationFrame, then compare actual proxy pixels.
                        assert before != page.locator('.twin-stage').screenshot(), 'Authored joint did not move rendered proxies'
                        page.get_by_role('button', name='Return all joints to rest', exact=True).click()
                        expect(page.locator('.twin-motion-note')).to_contain_text('Rest geometry')

                        with page.expect_download() as ticket:
                            page.get_by_role('button', name='Export overlay JSON', exact=True).click()
                        file = Path(temp) / f'{engine}-{width}.json'
                        ticket.value.save_as(file)
                        exported = json.loads(file.read_text())
                        assert exported['source']['sceneSha256'] == hashlib.sha256(SCENE.read_bytes()).hexdigest()
                        assert all(v is False for v in exported['validation'].values())
                        assert next(a for a in exported['assets'] if a['label'] == 'Bearing reviewed')['spares'][0]['partNumber'] == 'TRAIN-BRG-01'
                        assert exported['issues'][-1]['status'] == 'resolved'
                        with page.expect_download() as ticket:
                            page.get_by_role('button', name='Asset register CSV', exact=True).click()
                        csv = Path(temp) / 'register.csv'
                        ticket.value.save_as(csv)
                        assert 'TRAIN-BRG-01' in csv.read_text() and 'sourceSceneSha256' in csv.read_text()

                        changed = json.loads(json.dumps(exported))
                        changed['source']['revision'] += 1
                        page.locator('.twin-import').set_input_files(payload(changed, 'wrong-revision.json'))
                        expect(page.locator('.twin-message')).to_contain_text('Import refused: Overlay belongs to different scene bytes')
                        page.locator('.twin-import').set_input_files(payload(exported))
                        expect(page.locator('.twin-message')).to_contain_text('Overlay imported for this exact scene revision')
                        page.get_by_role('button', name='Equipment', exact=True).click()
                        expect(page.get_by_label('Display name', exact=True)).to_have_value('Bearing reviewed')
                        page.locator('#twin-scene-file').set_input_files(payload({'schema': 'unrelated'}, 'invalid-scene.json'))
                        expect(page.locator('#twin-page-status')).to_contain_text('Scene refused:')
                        # A failed replacement must not invalidate or discard the working overlay.
                        with page.expect_download() as ticket:
                            page.get_by_role('button', name='Export overlay JSON', exact=True).click()
                        ticket.value.cancel()
                        assert not transmissions, f'Unexpected data transmission: {transmissions}'
                        assert not errors, errors
                        page.locator('.twin-grid').screenshot(path=str(OUTPUT / f'operational-twin-{engine}-{width}.png'))

                        # Mount through the real compiled-scene workflow and test source invalidation/disposal.
                        page.evaluate('''async()=>{
                          const raw=await (await fetch('/world/fixtures/operational-crane.scene.json')).arrayBuffer();
                          const scene=JSON.parse(new TextDecoder().decode(raw));
                          const {sha256}=await import('/world/operational-twin.mjs');
                          const {createBimWorkflow}=await import('/world/bim-workflow-ui.mjs');
                          document.body.innerHTML='<main><section id="scene-measurement-report"></section><section id="scene-bim-review"></section><section id="scene-bim-files"></section></main>';
                          window.exported=[];window.workflow=createBimWorkflow({status(){},event(){},getContext:()=>({entry:{bim_review:true}}),download:(...args)=>window.exported.push(args)});
                          await window.workflow.showScene({scene,sceneSha:await sha256(raw),cloud:{units:'m',coordinateFrame:'right-handed-y-up',points:[[0,0,0,0,0,0]],source:'authored fixture'},job:'authored',artifacts:[],sourceClient:{}});
                        }''')
                        expect(page.locator('#scene-operational-twin')).to_have_count(1)
                        page.locator('#scene-operational-twin > summary').click()
                        # The existing opening editor marks its context dirty only after a valid edit.
                        # Observe the same object passed to the mounted layer for a focused guard test.
                        page.evaluate('''async()=>{
                          window.workflow.clearScene();
                          const {mountOperationalTwin}=await import('/world/operational-twin-ui.mjs');
                          const {sha256}=await import('/world/operational-twin.mjs');const raw=await(await fetch('/world/fixtures/operational-crane.scene.json')).arrayBuffer();
                          window.ctx={scene:JSON.parse(new TextDecoder().decode(raw)),dirty:true};
                          window.dispose=mountOperationalTwin({host:document.getElementById('scene-bim-files'),context:ctx,sceneSha:await sha256(raw),isCurrent:()=>true,open:true,download:(...a)=>window.exported.push(a)});
                        }''')
                        page.get_by_role('button', name='Export overlay JSON', exact=True).click()
                        expect(page.locator('.twin-message')).to_contain_text('Pending BIM edits')
                        assert page.evaluate('window.exported.length') == 0
                        page.evaluate('window.dispose()')
                        expect(page.locator('#scene-operational-twin')).to_have_count(0)
                        assert not errors, errors
                        page.close()
                        print(f'PASS {engine} {width}px: {"WebGL" if gpu else "software"} proxies, edits, sources, abstention, spares, issues, motion pixels, JSON/CSV, stale import, source guard, disposal; authored data only')
                finally:
                    browser.close()
    finally:
        server.shutdown()

if __name__ == '__main__':
    main()
