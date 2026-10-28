"""Real local HTTP/Chromium UI; synthetic room, no worker mock or robot run."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/playwright/footholds';OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'brainsnn-r3f-app/public')))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    with sync_playwright() as p:
        launch={'headless':True}
        if os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'):launch['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_PATH']
        browser=p.chromium.launch(**launch)
        for width in (1280,390):
            context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page();errors=[];writes=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:writes.append(r.url) if r.method!='GET' else None)
            page.route('**/fixture',lambda route:route.fulfill(content_type='text/html',body='<html><head><link rel="stylesheet" href="/world/world.css"></head><body><dialog open style="position:relative;max-width:900px;width:calc(100% - 24px)"><main id="host"></main></dialog></body></html>'))
            inline=os.environ.get('FOOTHOLD_INLINE_UI')=='1'
            if inline:
                import base64
                source=(ROOT/'brainsnn-r3f-app/public/world/foothold-focus.mjs').read_text()+'\n'+(ROOT/'brainsnn-r3f-app/public/world/foothold-ui.mjs').read_text().split('\n',1)[1]
                uri='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
                css=(ROOT/'brainsnn-r3f-app/public/world/world.css').read_text()
                page.set_content('<html><head><style>'+css+'</style></head><body><dialog open style="position:relative;max-width:900px;width:calc(100% - 24px)"><main id="host"></main></dialog></body></html>')
                page.evaluate('(uri)=>window.footholdModuleURL=uri',uri)
            else:
                page.goto(f'http://127.0.0.1:{server.server_port}/fixture')
            page.evaluate("""async()=>{
              const {mountFootholdReview}=await import(window.footholdModuleURL||'/world/foothold-ui.mjs');const points=[];
              for(let y=0;y<21;y++)for(let x=0;x<33;x++){const sx=-.8+x*.05,z=.5-y*.05,h=x>=19?.1:0;points.push([sx,h,z],[sx+.001,h,z-.001]);}
              const cloud={units:'m',coordinateFrame:'right-handed-y-up',points};
              window.dispose=mountFootholdReview({host:document.querySelector('#host'),context:{cloud,artifacts:[{name:'arena-cloud.json',sha256:'b'.repeat(64)}]},sceneSha:'a'.repeat(64),isCurrent:()=>true});
            }""")
            page.get_by_role('button',name='Inspect footstep patches',exact=True).click()
            assert '98/98' in page.locator('[role=status]').inner_text()
            assert page.locator('td').count()==98
            with page.expect_download() as download:
                page.get_by_role('button',name='Download footstep evidence',exact=True).click()
            path=OUT/f'evidence-{width}.json';download.value.save_as(path)
            r=json.loads(path.read_text());assert len(r['observation_raw'])==102 and not r['robot_control_enabled']
            page.get_by_label('Step 1 forward · m',exact=True).fill('.8')
            assert page.get_by_role('button',name='Download footstep evidence',exact=True).is_disabled()
            page.get_by_role('button',name='Inspect footstep patches',exact=True).click()
            assert 'withheld' in page.locator('[role=status]').inner_text()
            assert page.locator('td').filter(has_text='?').count()>0
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            page.screenshot(path=str(OUT/f'footholds-{width}.png'),full_page=True)
            page.evaluate("document.querySelector('dialog').close()")
            page.locator('#scene-foothold-focus').wait_for(state='detached',timeout=5000)
            assert not errors and not writes,(errors,writes)
            context.close()
        (OUT/'browser-receipt.json').write_text(json.dumps({'browser':'chromium','widths':[1280,390],'transport':'inline-module' if os.environ.get('FOOTHOLD_INLINE_UI')=='1' else 'local-http','uploads':0,'physics_executed':False,'status':'passed'},indent=2))
        browser.close()
finally:
    server.shutdown();server.server_close()
print('FOOTHOLD_BROWSER_OK: Chromium desktop/mobile-sized local inspection; zero uploads. Transport is marked in receipt.')
