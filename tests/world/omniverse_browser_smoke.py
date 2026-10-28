"""Actual browser UI test with an explicit mock transport; no reconstruction claim."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os, threading
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]

class Quiet(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/v1/download/fixture':
            self.send_response(200);self.send_header('Content-Type','application/zip');self.send_header('Content-Disposition','attachment; filename=fixture.zip');self.end_headers();self.wfile.write(b'PK'+b'0'*40)
        else:super().do_GET()
    def log_message(self, *args):pass

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as pw:
            exe=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
            browser=pw.chromium.launch(headless=True,**({'executable_path':exe} if exe else {}))
            try:
                for width in (1280,390):
                    page=browser.new_page(viewport={'width':width,'height':900});errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='domcontentloaded')
                    page.evaluate('''async()=>{
                      document.body.replaceChildren();const host=document.createElement('main');document.body.append(host);
                      const {mountOmniverse}=await import('/brainsnn-r3f-app/public/world/omniverse-ui.mjs');
                      window.calls=[];window.downloadCount=0;window.hold=false;window.lastUpload=null;
                      const asset={asset:'IV_pole_a01',available:true,package_sha256:'c'.repeat(64),bytes:1024,
                        author:'Synthetic transport fixture',license:'CC-BY-4.0',upstream_failed_features:['fixture-warning']};
                      const client={site:true,caps:{owner_id:'site-owner',engines:[{id:'omniverse-pack',available:true}],simready_assets:[asset]},
                        upload:async(file)=>{window.calls.push('upload');window.lastUpload=JSON.parse(await file.text());return 'd'.repeat(32);},
                        request:async(path,options={})=>{window.calls.push({path,method:options.method||'GET'});window.lastBody=options.body||window.lastBody;
                          if(path==='/v1/jobs')return {id:'e'.repeat(32),status:'queued'};
                          if(path.endsWith('/start')||options.method==='DELETE')return {};
                          return {id:'e'.repeat(32),status:window.hold?'running':'complete',artifacts:[{name:'scene-omniverse.zip',sha256:'f'.repeat(64),size:42}]};},
                        download:async()=>{window.downloadCount++;return location.origin+'/v1/download/fixture';}};
                      window.ctx={sourceClient:client,cloud:{source:'explicit synthetic browser fixture'},job:'a'.repeat(32),dirty:false,
                        artifacts:[{name:'arena-cloud.json',sha256:'b'.repeat(64)}]};
                      window.remount=()=>mountOmniverse({host,context:window.ctx,sceneSha:'a'.repeat(64),isCurrent:()=>true,status:()=>{},event:()=>{}});window.dispose=window.remount();
                    }''')
                    button=page.get_by_role('button',name='Build Omniverse pack',exact=True)
                    button.click();page.wait_for_timeout(80)
                    assert not page.evaluate('window.calls'),'Unreviewed request uploaded'
                    page.get_by_label('NVIDIA library asset').select_option('IV_pole_a01')
                    boxes=page.locator('#scene-omniverse input[type=checkbox]')
                    boxes.nth(2).check();button.click();page.wait_for_timeout(80)
                    assert not page.evaluate('window.calls'),'License/physics approvals bypassed'
                    boxes.nth(0).check();boxes.nth(1).check();page.get_by_label('X · m',exact=True).fill('1.25');button.click()
                    dl=page.get_by_role('button',name='Download scene-omniverse.zip');dl.wait_for(timeout=10000)
                    assert page.evaluate('window.downloadCount')==0,'Ticket issued before click'
                    with page.expect_download() as ticket:dl.click()
                    ticket.value.cancel();assert page.evaluate('window.downloadCount')==1
                    data=page.evaluate('window.lastUpload');assert data['omniversePack']['placements'][0]['translation_m']==[1.25,0,0]
                    assert data['omniversePack']['scene_sha256']=='a'*64
                    assert 'Physics has not been tested' in page.locator('#scene-omniverse [role=status]').inner_text()
                    page.evaluate('window.ctx.dirty=true;window.calls=[]');button.click();page.wait_for_timeout(80)
                    assert not page.evaluate('window.calls'),'Unsaved edits accepted'
                    page.evaluate('window.ctx.dirty=false;window.hold=true;window.calls=[]');button.click()
                    page.wait_for_function("window.calls.some(x=>x.path?.endsWith('/start'))")
                    page.get_by_role('button',name='Cancel package job',exact=True).click()
                    page.wait_for_function("window.calls.some(x=>x.method==='DELETE'&&x.path==='/v1/jobs/'+'e'.repeat(32))")
                    page.evaluate('window.dispose()');assert page.locator('#scene-omniverse').count()==0
                    page.evaluate("window.ctx.sourceClient.caps.owner_id='site-visitors';window.remount()")
                    assert page.locator('#scene-omniverse').count()==0,'Unauthorized visitor panel'
                    assert not errors,errors
                    page.close();print(f'PASS Chromium {width}px: approvals, hashes, placement, fresh tickets, dirty edits, DELETE cancellation and visitor authorization')
            finally:browser.close()
    finally:server.shutdown();server.server_close()
if __name__=='__main__':main()
