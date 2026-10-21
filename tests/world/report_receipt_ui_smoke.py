"""Real local HTTP worker signs an inspect-job receipt; native browsers verify it.

The photo and map are explicit authored fixtures. No model or physical robot runs.
Private signing keys exist only inside a temporary directory. Set
WORLD_SERVER_PYTHON to an interpreter with FastAPI, Uvicorn and cryptography.
"""
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'output/playwright/world/report-receipt'


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));return sock.getsockname()[1]


def ready(url):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url,timeout=1) as response:
                if response.status==200:return
        except OSError:time.sleep(.1)
    raise RuntimeError('Local signing worker did not start')


def check(browser,origin,worker_url,token,photo,key):
    context=browser.new_context(viewport={'width':390,'height':844},has_touch=True)
    page=context.new_page();errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:requests.append({'url':request.url,'method':request.method,'body':request.post_data}))
    def download(selector,name):
        with page.expect_download() as event:page.locator(selector).click()
        path=OUTPUT/(browser.browser_type.name+'-ui-'+name);event.value.save_as(path);return path
    def signing_posts():return [r for r in requests if r['method']=='POST' and r['url'].endswith('/report-receipt')]
    try:
        page.goto(origin+'/world/index.html',wait_until='networkidle')
        page.wait_for_function("document.querySelectorAll('.system-card').length===22")
        page.locator('#files').set_input_files(photo)
        page.locator('.processing-options summary').click();page.locator('[data-action=connection]').click()
        page.locator('#worker-url').fill(worker_url);page.locator('#worker-token').fill(token);page.locator('#connect').click()
        page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')")
        page.locator('#connection [aria-label=Close]').click();page.locator('.processing-options summary').click()
        page.locator('#engine').select_option('inspect');page.locator('#consent').check();page.locator('[data-action=process]').click()
        page.wait_for_function("document.querySelector('#status').textContent==='inspect: complete'",timeout=30000)
        authored={'schema':'brainsnn.world.v1','name':'Explicit report test map','width':8,'depth':8,'provenance':'observed','scaleReviewed':False,'mapReviewed':False,'start':{'x':1,'z':1},'objects':[]}
        page.locator('#files').set_input_files({'name':'authored-test-map.json','mimeType':'application/json','buffer':json.dumps(authored).encode()})
        page.locator('#scale-reviewed').check()
        before=json.loads(download('#export','before.json').read_text())
        page.locator('[data-tab=evidence]').click();page.locator('#signed-report-review summary').click()
        assert not page.locator('#report-request').is_disabled()
        page.locator('#report-request').click()
        assert 'Approve sending only' in page.locator('#report-status').inner_text() and not signing_posts()
        page.locator('#report-trust').fill('0'*64);page.locator('#report-consent').check();page.locator('#report-request').click()
        page.wait_for_function("document.querySelector('#report-status').textContent.startsWith('Receipt not verified:')")
        assert 'trusted fingerprint' in page.locator('#report-status').inner_text() and not signing_posts()
        page.locator('#report-trust').fill(key['keyId']);page.locator('#report-request').click()
        page.wait_for_function("/^(Signature verified|Receipt not verified:)/.test(document.querySelector('#report-status').textContent)",timeout=30000)
        assert page.locator('#report-status').inner_text().startswith('Signature verified'),page.locator('#report-status').inner_text()
        bundle_path=download('#report-export','signed-report.json');bundle=json.loads(bundle_path.read_text())
        scenario_path=download('#report-scenario-export','exact-proof.json');scenario_bytes=scenario_path.read_bytes()
        assert scenario_bytes==bundle['scenarioText'].encode('utf-8')
        scenario=json.loads(bundle['scenarioText']);payload=json.loads(bundle['receipt']['payloadText'])
        assert scenario['world']==before['world'] and scenario['result']==before['result']
        assert scenario['world']['scaleReviewed'] is True and scenario['world']['mapReviewed'] is False
        assert payload['scenario']['sha256']==hashlib.sha256(scenario_bytes).hexdigest()
        assert payload['evidence']['sources'][0]['sha256']==hashlib.sha256(photo.read_bytes()).hexdigest()
        assert all(payload[field] is False for field in ['metricVerified','policyExecuted','safetyCertified','independentHostAttestation'])
        assert len(signing_posts())==1
        sent=json.loads(signing_posts()[0]['body'])
        assert set(sent)=={'scenarioSha256','geometrySha256','artifactRefs'}
        assert sent['scenarioSha256']==payload['scenario']['sha256']
        assert sent['artifactRefs']==[{'name':a['name'],'sha256':a['sha256']} for a in payload['evidence']['artifacts']]
        page.evaluate("document.documentElement.style.scrollBehavior='auto';document.querySelector('#signed-report-review').scrollIntoView({block:'start',behavior:'instant'})")
        page.locator('#signed-report-review summary').focus()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.locator('#signed-report-review').screenshot(path=str(OUTPUT/(browser.browser_type.name+'-ui-signed-receipt.png')))
        page.locator('[data-tab=world]').click();page.locator('#map-name').fill('Edited after receipt');page.locator('#map-name').press('Tab')
        page.locator('[data-tab=evidence]').click()
        assert page.locator('#report-verification').count()==0 and page.locator('#report-export').is_disabled()
        assert 'Scenario changed' in page.locator('#report-status').inner_text()
        page.once('dialog',lambda dialog:dialog.accept());page.locator('[data-action=clear]').click()
        page.locator('[data-tab=evidence]').click();page.locator('#signed-report-review summary').click()
        assert page.locator('#report-trust').input_value()=='' and page.locator('#report-request').is_disabled()
        assert page.locator('#report-verification').count()==0
        network_count=len(requests)
        page.locator('#report-import').set_input_files(bundle_path)
        page.wait_for_function("document.querySelector('#report-status').textContent.startsWith('File loaded locally')")
        page.locator('#report-verify').click()
        page.wait_for_function("document.querySelector('#report-status').textContent.startsWith('Receipt not verified:')")
        assert 'independently' in page.locator('#report-status').inner_text()
        page.locator('#report-trust').fill(key['keyId']);page.locator('#report-verify').click()
        page.wait_for_function("document.querySelector('#report-status').textContent.startsWith('Signature verified')")
        assert len(requests)==network_count,'Offline verification must not send requests'
        tampered={**bundle,'scenarioText':bundle['scenarioText']+'\n'}
        page.locator('#report-import').set_input_files({'name':'tampered-bundle.json','mimeType':'application/json','buffer':json.dumps(tampered).encode()})
        page.wait_for_function("document.querySelector('#report-status').textContent.startsWith('File loaded locally')")
        page.locator('#report-verify').click()
        page.wait_for_function("document.querySelector('#report-status').textContent.startsWith('Receipt not verified:')")
        assert 'Exact scenario file bytes' in page.locator('#report-status').inner_text()
        assert page.locator('#report-export').is_disabled() and page.locator('#report-verification').count()==0
        assert not errors,errors
        result={'browser':browser.browser_type.name,'realPrivateWorker':True,'realEd25519':True,'engine':'inspect','modelExecuted':False,'physicalCapture':False,'consentGate':True,'separateKeyTrustRequired':True,'hashesOnlyRequest':True,'exactScenarioBytes':True,'offlineNetworkRequests':0,'tamperRejected':True,'mapReviewFlagsUnchanged':True,'pageErrors':errors}
        (OUTPUT/(browser.browser_type.name+'-ui-receipt.json')).write_text(json.dumps(result,indent=2))
        print(json.dumps(result),flush=True)
    finally:context.close()


def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self,*_args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'brainsnn-r3f-app/public')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    python=os.environ.get('WORLD_SERVER_PYTHON',sys.executable)
    try:
        with tempfile.TemporaryDirectory(prefix='world-report-ui-') as directory:
            tmp=Path(directory);keyfile=tmp/'fixture-signing.key';public=tmp/'fixture-public.json'
            subprocess.run([python,'-c','from pathlib import Path;import sys;from robotics.world_worker.report_receipts import init_key;init_key(Path(sys.argv[1]),Path(sys.argv[2]))',str(keyfile),str(public)],cwd=ROOT,check=True,capture_output=True)
            key=json.loads(public.read_text());photo=tmp/'explicit-authored-fixture.png';Image.new('RGB',(32,24),(30,150,220)).save(photo)
            adapters=tmp/'adapters.json';adapters.write_text('[]')
            token=secrets.token_urlsafe(48);worker_url=f'http://127.0.0.1:{free_port()}'
            environment={**os.environ,'WORLD_WORKER_TOKEN':token,'WORLD_WORKER_DIR':str(tmp/'data'),'WORLD_ADAPTERS_FILE':str(adapters),'WORLD_ALLOWED_ORIGINS':origin,'WORLD_REPORT_SIGNING_KEY':str(keyfile)}
            environment.pop('WORLD_TENANTS_FILE',None)
            worker=subprocess.Popen([python,'-m','uvicorn','robotics.world_worker.app:create_app','--factory','--host','127.0.0.1','--port',worker_url.rsplit(':',1)[1],'--no-access-log'],cwd=ROOT,env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                ready(worker_url+'/healthz')
                with sync_playwright() as p:
                    for name in os.environ.get('WORLD_BROWSERS','chromium,webkit').split(','):
                        executable=os.environ.get('PLAYWRIGHT_'+name.upper()+'_PATH')
                        browser=getattr(p,name).launch(headless=True,**({'executable_path':executable} if executable else {}))
                        try:check(browser,origin,worker_url,token,photo,key)
                        finally:browser.close()
            finally:
                worker.terminate()
                try:worker.wait(timeout=10)
                except subprocess.TimeoutExpired:worker.kill();worker.wait(timeout=5)
    finally:server.shutdown();server.server_close()


if __name__=='__main__':main()
