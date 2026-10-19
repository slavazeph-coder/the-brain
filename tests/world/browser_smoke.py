"""Local browser integration checks. No model output is substituted or mocked."""
from pathlib import Path
import json
import os
import shutil
import base64
import hashlib
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
URL='http://127.0.0.1:8765/world/index.html'

def check(browser, mobile=False):
    ctx=browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':1000},device_scale_factor=1,has_touch=mobile)
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    if os.environ.get('WORLD_OFFLINE')=='1':
        public=ROOT/'brainsnn-r3f-app/public/world'
        page.set_content((public/'index.html').read_text().replace('<link rel="stylesheet" href="./world.css">','<style>'+ (public/'world.css').read_text()+'</style>').replace('<script type="module" src="./app.mjs"></script>','').replace('<link rel="icon" href="/favicon.svg">',''))
        page.expose_function('__hash',lambda data:list(hashlib.sha256(bytes(data)).digest()))
        page.evaluate("""() => {
          Object.defineProperty(crypto,'subtle',{value:{digest:async (algorithm,data)=>new Uint8Array(await window.__hash(Array.from(new Uint8Array(data)))).buffer}});
          crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
        }""")
        def uri(text):return 'data:text/javascript;base64,'+base64.b64encode(text.encode()).decode()
        core=uri((public/'core.mjs').read_text())
        modules={'./core.mjs':core,'./renderer.mjs':uri((public/'renderer.mjs').read_text()),'./catalog.mjs':uri((public/'catalog.mjs').read_text()),'./worker-client.mjs':uri((public/'worker-client.mjs').read_text().replace('./core.mjs',core))}
        worker=re.sub(r'^export ', '', (public/'core.mjs').read_text(), flags=re.M)+'\n'+(public/'planner-worker.mjs').read_text().split('\n',1)[1]
        page.evaluate("code=>window.__plannerUrl=URL.createObjectURL(new Blob([code],{type:'text/javascript'}))",worker)
        app=(public/'app.mjs').read_text().replace("new Worker('./planner-worker.mjs'","new Worker(window.__plannerUrl")
        app=app.replace("new Worker(window.__plannerUrl,{type:'module'})","new Worker(window.__plannerUrl,{type:'classic'})")
        for key,value in modules.items():app=app.replace(key,value)
        page.add_script_tag(type='module',content=app)
        page.wait_for_function("document.querySelectorAll('.system-card').length===22")
    else:
        page.goto(URL,wait_until='networkidle')
    assert page.locator('.system-card').count()==22
    assert page.locator('#provenance').inner_text()=='AUTHORED SAMPLE'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.screenshot(path=str(ROOT/('world-mobile.png' if mobile else 'world-desktop.png')),full_page=True)
    page.locator('#run').click();page.wait_for_timeout(300);print('RUN STATUS',page.locator('#status').inner_text(),errors,flush=True);page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')",timeout=5000)
    assert page.locator('#metric-cost').inner_text()=='Enter rates'
    page.locator('#robotRate').fill('12');page.locator('#robotRate').press('Tab')
    page.locator('#labourRate').fill('30');page.locator('#labourRate').press('Tab')
    assert page.locator('#metric-cost').inner_text().startswith('C$')
    page.locator('#fork').click()
    page.locator('#objects').select_option('storage')
    page.locator('#object-x').fill('14');page.locator('#object-x').press('Tab')
    assert page.locator('#metric-distance').inner_text()=='—'
    page.locator('#run').click()
    assert 'Review' in page.locator('#status').inner_text()
    page.locator('#map-reviewed').check();page.locator('#run').click();page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')",timeout=5000)
    assert 'Baseline saved' in page.locator('#panel').inner_text()
    page.locator('#replay').click();page.wait_for_timeout(180)
    assert int(page.locator('#scrub').input_value())>0
    page.locator('#replay').click()
    page.locator('[data-tab=evidence]').click()
    with page.expect_download() as event:page.locator('[data-action=proof]').click()
    downloaded=event.value;out=ROOT/('proof-mobile.json' if mobile else 'proof-desktop.json');downloaded.save_as(out)
    proof=json.loads(out.read_text());assert proof['result']['policyExecuted'] is False;assert proof['integrity']['authenticatesAuthor'] is False
    # Crafted labels remain text, never executable HTML.
    w=proof['world'];w['name']='<img src=x onerror="window.injected=true">';w['objects'][0]['name']='<svg onload="window.injected=true">'
    page.locator('#files').set_input_files({'name':'safe-map.json','mimeType':'application/json','buffer':json.dumps(w).encode()})
    assert page.locator('#provenance').inner_text()=='AUTHORED SAMPLE'
    assert not page.locator('#scale-reviewed').is_checked()
    assert page.evaluate('window.injected') is None
    # A fresh capture must never inherit the sample's geometry or metrics.
    page.locator('#hero-sample').click()
    from PIL import Image
    import io
    b=io.BytesIO();Image.new('RGB',(20,20)).save(b,format='PNG')
    page.locator('#files').set_input_files({'name':'camera.png','mimeType':'image/png','buffer':b.getvalue()})
    assert page.locator('#provenance').inner_text()=='LOCAL SOURCE'
    assert page.locator('#run').is_disabled()
    assert page.locator('#media-preview img').count()==1
    assert 'No 3D geometry' in page.locator('#media-preview').inner_text()
    # JSON imports explicitly marked generated remain non-plannable.
    w['provenance']='generated';w['scaleReviewed']=True;w['mapReviewed']=True
    page.locator('#files').set_input_files({'name':'generated.json','mimeType':'application/json','buffer':json.dumps(w).encode()})
    assert page.locator('#scale-reviewed').is_disabled()
    page.locator('#run').click();assert 'Generated' in page.locator('#status').inner_text()
    page.locator('#system-search').fill('Lyra');assert page.locator('.system-card').count()==1
    page.locator('#system-search').fill('');page.locator('[data-filter=local]').click();assert page.locator('.system-card').count()==6
    page.locator('[data-filter=all]').click();assert page.locator('.system-card').count()==22
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    assert errors==[],errors
    ctx.close()

if __name__=='__main__':
    with sync_playwright() as p:
        for name in os.environ.get('WORLD_BROWSERS','chromium').split(','):
            browser=getattr(p,name).launch(headless=True, **({'executable_path':shutil.which('chromium'),'args':['--no-sandbox']} if name=='chromium' and shutil.which('chromium') else {}))
            check(browser,False);check(browser,True);browser.close()
            print(name+': desktop and mobile smoke checks passed')
