"""HTTP IFC import -> linked review -> approved request -> real IFC write/readback.

All inputs are authored fixtures, not captures, surveys or Agent2BIM reproductions.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2];PUBLIC=ROOT/'brainsnn-r3f-app/public';FIXTURE=PUBLIC/'world/fixtures';OUTPUT=ROOT/'output/playwright/world'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass
def payload(data,name='reference.json'):
    return {'name':name,'mimeType':'application/json','buffer':json.dumps(data).encode()}

def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(PUBLIC)));threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as pw,tempfile.TemporaryDirectory(prefix='asbuilt-browser-') as temp:
            for engine in os.environ.get('WORLD_BROWSERS','chromium').split(','):
                opts={}
                if engine=='chromium':
                    opts['args']=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']
                    if os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'):opts['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_PATH']
                browser=getattr(pw,engine).launch(headless=True,**opts)
                try:
                    for width,software in [(1280,False),(390,True)]:
                        page=browser.new_page(viewport={'width':width,'height':900},accept_downloads=True);errors=[];posts=[]
                        page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:posts.append(r.url) if r.method!='GET' else None)
                        if software:page.route('**/twin-renderer.js',lambda route:route.abort())
                        page.goto(f'http://127.0.0.1:{server.server_port}/world/asbuilt.html')
                        expect(page.locator('.asbuilt-status')).to_contain_text('Prior IFC opened locally',timeout=30000)
                        expect(page.locator('.asbuilt-stage canvas,.asbuilt-stage svg')).to_have_count(4)
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Page overflow'
                        if software:assert page.locator('.asbuilt-stage svg').count()==4
                        chair=page.locator('tbody tr').filter(has=page.get_by_role('button',name='chair',exact=True))
                        cabinet=page.locator('tbody tr').filter(has=page.get_by_role('button',name='cabinet',exact=True))
                        expect(chair.locator('input[type=checkbox]')).to_be_disabled()
                        page.locator('.asbuilt-settings summary').click()
                        page.get_by_label('How was this frame alignment established?',exact=True).fill('Authored common frame, not a measured registration.')
                        page.locator('.asbuilt-aligned').check();page.get_by_role('button',name='Apply reviewed alignment',exact=True).click()
                        expect(chair.locator('input[type=checkbox]')).to_be_enabled();expect(cabinet.locator('input[type=checkbox]')).to_be_disabled()
                        expect(cabinet).to_contain_text('bounds differ');expect(chair).to_contain_text('70.0 cm')
                        expect(page.locator('.asbuilt-stage canvas,.asbuilt-stage svg')).to_have_count(4)
                        before_prior=page.locator('[data-asbuilt-view=prior]').screenshot();before_current=page.locator('[data-asbuilt-view=current]').screenshot()
                        page.locator('[data-asbuilt-view=current] canvas,[data-asbuilt-view=current] svg').press('ArrowRight')
                        expect(page.locator('.asbuilt-view-state')).to_contain_text('Linked views');page.wait_for_timeout(150)
                        assert before_prior!=page.locator('[data-asbuilt-view=prior]').screenshot(),'Prior camera not linked'
                        assert before_current!=page.locator('[data-asbuilt-view=current]').screenshot(),'Current camera did not move'
                        page.get_by_role('button',name='Reset linked views',exact=True).click()
                        before_proposal=page.locator('[data-asbuilt-view=proposal]').screenshot()
                        chair.locator('input[type=checkbox]').check();expect(page.locator('.asbuilt-export')).to_have_attribute('data-selected','1');page.wait_for_timeout(150)
                        assert before_proposal!=page.locator('[data-asbuilt-view=proposal]').screenshot(),'Proposal did not translate the selected item'
                        with page.expect_download() as ticket:page.get_by_role('button',name='Download reviewed update request',exact=True).click()
                        review_path=Path(temp)/f'review-{engine}-{width}.json';ticket.value.save_as(review_path);review=json.loads(review_path.read_text())
                        assert review['source']['priorIfcSha256']==hashlib.sha256((FIXTURE/'asbuilt-prior.ifc').read_bytes()).hexdigest()
                        assert review['source']['currentSceneSha256']==hashlib.sha256((FIXTURE/'asbuilt-current.scene.json').read_bytes()).hexdigest()
                        assert len(review['selectedTranslations'])==1 and review['metricVerified'] is False
                        out=Path(temp)/f'ifc-{engine}-{width}'
                        command=[sys.executable,'-m','robotics.scene_compiler.asbuilt_update','apply','--ifc',str(FIXTURE/'asbuilt-prior.ifc'),'--scene',str(FIXTURE/'asbuilt-current.scene.json'),'--review',str(review_path),'--output-dir',str(out)]
                        result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=45);assert result.returncode==0,result.stderr
                        update=json.loads((out/'asbuilt-update-report.json').read_text());assert update['updatedCount']==1
                        assert update['outputIfcSha256']==hashlib.sha256((out/'updated.ifc').read_bytes()).hexdigest()
                        assert update['metricVerified'] is False and update['physicalRobotValidated'] is False
                        page.get_by_label('Prior-to-capture X offset · m',exact=True).fill('.1')
                        expect(page.locator('.asbuilt-export')).to_have_attribute('data-selected','0')
                        page.get_by_role('button',name='Download reviewed update request',exact=True).click()
                        expect(page.locator('.asbuilt-status')).to_contain_text('Apply and review the current alignment settings')
                        page.get_by_label('Prior-to-capture X offset · m',exact=True).fill('0');page.get_by_role('button',name='Apply reviewed alignment',exact=True).click()
                        expect(chair.locator('input[type=checkbox]')).to_be_enabled()
                        bad_cloud=json.loads((FIXTURE/'asbuilt-source.cloud.json').read_text());bad_cloud['points'][0][0]+=.2
                        page.locator('.asbuilt-cloud').set_input_files(payload(bad_cloud,'wrong-cloud.json'))
                        expect(page.locator('.asbuilt-status')).to_contain_text('does not match the scene')
                        page.locator('#asbuilt-reference-file').set_input_files(str(FIXTURE/'asbuilt-reference.json'))
                        expect(page.locator('#asbuilt-benchmark-result')).to_contain_text('100.0%');expect(page.locator('#asbuilt-benchmark-result')).to_contain_text('80.0%')
                        expect(page.locator('#asbuilt-benchmark-status')).to_contain_text('Authored fixture regression only')
                        with page.expect_download() as ticket:page.get_by_role('button',name='Download benchmark report',exact=True).click()
                        benchmark=Path(temp)/f'bench-{engine}-{width}.json';ticket.value.save_as(benchmark);scored=json.loads(benchmark.read_text())
                        assert scored['detection']['recall']==1 and scored['position']['withinToleranceRecall']==.8
                        leaked=json.loads((FIXTURE/'asbuilt-reference.json').read_text());leaked['sourceSha256']=review['source']['priorIfcSha256']
                        page.locator('#asbuilt-reference-file').set_input_files(payload(leaked))
                        expect(page.locator('#asbuilt-benchmark-status')).to_contain_text('Reference leakage');expect(page.locator('#asbuilt-benchmark-save')).to_be_disabled()
                        page.locator('.asbuilt-views').screenshot(path=str(OUTPUT/f'asbuilt-{engine}-{width}.png'))
                        assert not errors,errors;assert not posts,posts
                        page.close();print(f'PASS {engine} {width}px: actual IFC units/geometry, four linked views, explicit request, updated IFC readback, stale approvals and prior leakage refused, 100% recognition vs 80% placement; authored data only')
                finally:browser.close()
    finally:server.shutdown()

if __name__=='__main__':main()
