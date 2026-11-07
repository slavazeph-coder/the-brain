"""Real browser/module -> private HTTP worker -> H.264, on authored rasters.

This isolates the production export panel. It does not claim physical capture or
model accuracy. Existing World Builder browser flows exercise the app shell.
"""
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from playwright.sync_api import sync_playwright
from observations_browser_smoke import port,ready
from test_demo_replay import authored_job,dump


def main():
    with tempfile.TemporaryDirectory() as temporary:
        root=Path(temporary);http_port,worker_port=port(),port();origin=f'http://127.0.0.1:{http_port}'
        worker=f'http://127.0.0.1:{worker_port}';token=secrets.token_urlsafe(36);source_id='a'*32
        source=root/'worker/jobs'/source_id;options=authored_job(source)
        adapter=root/'adapter.py'
        adapter.write_text('import sys\nsys.path.insert(0,'+repr(str(ROOT))+')\nfrom robotics.world_worker import demo_replay as d\nr=d.read_json(sys.argv[1]);s=r["source"];o=d.read_json(r["inputs"][0]["path"]);d.render(s["path"],s["reconstruction"]["path"],r["output_dir"],o,formats={"landscape":(640,480,1)},fps=2)\n')
        config=root/'adapters.json';dump(config,[{'id':'demo-replay','enabled':True,'license_reviewed':True,'input_kinds':['replay'],
            'max_inputs':1,'source_job':True,'timeout_seconds':30,'command':[sys.executable,str(adapter),'{input_manifest}']}])
        module=root/'worker_fixture.py'
        module.write_text('import sys,time\nfrom pathlib import Path\nsys.path.insert(0,'+repr(str(ROOT))+')\nfrom robotics.world_worker.app import create_app\ndef app():\n a=create_app(root=Path('+repr(str(root/'worker'))+'),token='+repr(token)+',adapters='+repr(str(config))+')\n s=a.state.store\n s.db.execute("INSERT OR IGNORE INTO jobs(id,engine,status,uploads,created,error,artifacts,owner_id) VALUES(?,?,?,?,?,?,?,?)",('+repr(source_id)+',"colmap-sparse","complete","[]",time.time(),None,"[]","operator"));s.db.commit()\n return a\n')
        env={**os.environ,'PYTHONPATH':str(root),'WORLD_ALLOWED_ORIGINS':origin}
        log=(root/'worker.log').open('wb')
        process=subprocess.Popen([sys.executable,'-m','uvicorn','worker_fixture:app','--factory','--host','127.0.0.1','--port',str(worker_port)],env=env,stdout=log,stderr=log)
        server=ThreadingHTTPServer(('127.0.0.1',http_port),functools.partial(SimpleHTTPRequestHandler,directory=str(ROOT/'brainsnn-r3f-app/public')))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            ready(worker+'/healthz',process)
            with sync_playwright() as playwright:
                for name in os.environ.get('WORLD_BROWSERS','chromium,webkit').split(','):
                    browser_type=getattr(playwright,name)
                    override=os.environ.get('PLAYWRIGHT_'+name.upper()+'_PATH')
                    browser=browser_type.launch(**({'executable_path':override} if override else {}))
                    for width,height in ((1440,1000),(390,844)):
                        context=browser.new_context(viewport={'width':width,'height':height},accept_downloads=True)
                        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                        page.goto(origin+'/world/api.html')
                        page.evaluate('''async ({worker,token,job,hash})=>{
                          document.body.replaceChildren();const host=document.createElement('main');document.body.append(host);
                          const style=document.createElement('link');style.rel='stylesheet';style.href='/world/world.css';document.head.append(style);
                          const {WorkerClient}=await import('/world/worker-client.mjs');const client=new WorkerClient(worker,token);await client.capabilities();
                          const {mountDemoReplay}=await import('/world/demo-replay-ui.mjs');
                          window.disposeDemo=mountDemoReplay({host,context:{job,sourceClient:client,artifacts:[{name:'reconstruction.json',sha256:hash}]},isCurrent:()=>true});
                        }''',{'worker':worker,'token':token,'job':source_id,'hash':options['source_sha256']})
                        page.get_by_label('Source credit').fill('Authored browser fixture; no physical capture')
                        page.get_by_label('Capture type').select_option('authored-fixture')
                        page.get_by_role('checkbox').check()
                        page.get_by_role('button',name='Create demo videos').click()
                        download_button=page.get_by_role('button',name='Download demo-landscape.mp4')
                        download_button.wait_for(timeout=45000)
                        with page.expect_download() as downloaded:download_button.click()
                        file=root/f'{name}-{width}.mp4';downloaded.value.save_as(file)
                        assert file.stat().st_size>1000
                        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(file)]))
                        assert probe['streams'][0]['codec_name']=='h264'
                        assert not errors,errors
                        page.evaluate('window.disposeDemo()');assert page.locator('.demo-replay').count()==0
                        print(f'{name} {width}: source-bound panel, real HTTP/H.264 download and disposal passed',flush=True)
                        context.close()
                    browser.close()
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            log.close();server.shutdown();server.server_close()


if __name__=='__main__':main()
