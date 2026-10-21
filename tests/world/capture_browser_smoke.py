"""Real HTTP capture UI races with explicit permission fixtures; native canvas MP4.

No physical camera, phone or model is used. The separate canvas check exercises
the browser's native MediaRecorder when MP4 capture is supported.
"""
import base64
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/playwright/world/capture'
FIXTURE = """(() => {
  window.captureFixture={requests:[],recorders:0,stops:0};
  const fixture=window.captureFixture;
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>fixture.requests.push(resolve))},configurable:true});
  window.MediaRecorder=class {
    static isTypeSupported(type){return type.startsWith('video/mp4');}
    constructor(){fixture.recorders++;throw new Error('Stale permission must not create a recorder');}
  };
  fixture.resolve=()=>fixture.requests.shift()({getTracks:()=>[{removeEventListener(){},stop(){fixture.stops++;}}]});
})();"""


def check(browser, url):
    for reason in ['cancel', 'clear', 'pagehide', 'hidden']:
        context = browser.new_context(viewport={'width':390,'height':844},has_touch=True)
        context.add_init_script(FIXTURE)
        page = context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('dialog',lambda dialog:dialog.accept())
        page.goto(url,wait_until='networkidle')
        assert not errors, errors
        page.wait_for_function("document.querySelectorAll('.system-card').length===22", timeout=5000)
        page.locator('#hero-capture').click()
        page.locator('[data-action=record]').click()
        assert page.locator('[data-action=record]').inner_text() == 'Cancel camera request'
        if reason == 'cancel':
            page.locator('[data-action=record]').click()
        elif reason == 'clear':
            page.locator('#tab-evidence').click()
            page.locator('[data-action=clear]').click()
            page.wait_for_function("document.querySelector('#status').textContent.includes('Local session cleared')")
        elif reason == 'pagehide':
            page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        else:
            page.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))")
        page.evaluate('captureFixture.resolve()')
        page.wait_for_function('captureFixture.stops===1')
        assert page.evaluate('captureFixture.recorders') == 0
        assert page.locator('.source-row').count() == 0
        assert errors == [], errors
        context.close()

    # Exercise the actual upload fallback without opening any physical camera.
    context=browser.new_context()
    context.add_init_script(FIXTURE.replace("return type.startsWith('video/mp4');", 'return false;'))
    page=context.new_page()
    page.goto(url,wait_until='networkidle')
    page.wait_for_function("document.querySelectorAll('.system-card').length===22")
    page.locator('#hero-capture').click()
    with page.expect_file_chooser() as chooser:
        page.locator('[data-action=record]').click()
    assert chooser.value.element.get_attribute('id')=='phone-camera'
    chooser.value.set_files([])
    assert page.evaluate('captureFixture.requests.length')==0
    assert page.evaluate('captureFixture.recorders')==0
    assert 'cannot record a supported MP4' in page.locator('#status').inner_text()
    context.close()

    context=browser.new_context()
    page=context.new_page()
    page.goto(url,wait_until='networkidle')
    receipt=page.evaluate("""async () => {
      const {createCaptureClient}=await import('./capture-client.mjs');
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;
      const painter=canvas.getContext('2d');let frames=0;
      if(!canvas.captureStream)return {supported:false,reason:'Canvas stream unavailable'};
      const source=canvas.captureStream(10);
      const draw=setInterval(()=>{painter.fillStyle=++frames%2?'#29d9ef':'#26123f';painter.fillRect(0,0,128,96);},90);
      const result=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{client.stop({discard:true});reject(new Error('Native recorder did not finish'));},10000);
        const client=createCaptureClient({mediaDevices:{getUserMedia:async()=>source},durationMs:650,
          onError:error=>{clearTimeout(timeout);reject(error);},
          onFile:async file=>{clearTimeout(timeout);const bytes=new Uint8Array(await file.arrayBuffer());resolve({supported:true,bytes:file.size,mime:file.type,frames,trackState:source.getTracks()[0].readyState,base64:btoa(String.fromCharCode(...bytes))});},
        });
        if(!client.supported){clearTimeout(timeout);resolve({supported:false,reason:'Native MP4 recording unavailable'});return;}
        void client.start();
      }).finally(()=>{clearInterval(draw);source.getTracks().forEach(track=>track.stop());});
      return result;
    }""")
    if receipt['supported']:
        data=base64.b64decode(receipt.pop('base64'))
        assert len(data)==receipt['bytes'] and len(data)>128
        assert b'ftyp' in data[:32]
        assert receipt['mime'].startswith('video/mp4') and receipt['trackState']=='ended'
        (OUTPUT/f'{browser.browser_type.name}-canvas.mp4').write_bytes(data)
    receipt['permission_fixture_cases']=['cancel','clear','pagehide','hidden']
    receipt['unsupported_mp4_upload_fallback']=True
    receipt['physical_camera_used']=False
    (OUTPUT/f'{browser.browser_type.name}-receipt.json').write_text(json.dumps(receipt,indent=2))
    context.close()
    print(browser.browser_type.name+': '+json.dumps(receipt),flush=True)


if __name__=='__main__':
    OUTPUT.mkdir(parents=True,exist_ok=True)
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT/'brainsnn-r3f-app/public')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as playwright:
            for name in os.environ.get('WORLD_BROWSERS','chromium,webkit').split(','):
                executable=os.environ.get('PLAYWRIGHT_'+name.upper()+'_PATH')
                browser=getattr(playwright,name).launch(headless=True,**({'executable_path':executable} if executable else {}))
                check(browser,f'http://127.0.0.1:{server.server_port}/world/index.html')
                browser.close()
    finally:
        server.shutdown();server.server_close()
