"""Check recorder/parent lifecycle agreement without repeating native-physics tests."""
from functools import partial
import json
import os
from threading import Thread

from playwright.sync_api import sync_playwright
from stereo_depth_browser_smoke import PUBLIC, QuietHandler, StaticServer


def run():
    server = StaticServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(PUBLIC)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            options = dict(headless=True, args=['--no-sandbox'])
            if os.environ.get('BROWSER_EXECUTABLE'):
                options['executable_path'] = os.environ['BROWSER_EXECUTABLE']
            browser = pw.chromium.launch(**options)
            page = browser.new_page()
            page.route('**/lifecycle.html', lambda route: route.fulfill(content_type='text/html', body='<!doctype html><html><body></body></html>'))
            page.goto(f'http://127.0.0.1:{server.server_port}/lifecycle.html')
            result = page.evaluate("""async () => {
              const {mountShowroomRun}=await import('/world/showroom-run-ui.mjs');
              const {buildShowroomEpisodeScene}=await import('/world/showroom-episode-physics.mjs');
              const scene=buildShowroomEpisodeScene({title:'Lifecycle test',provenance:'Authored test',bounds:[0,0,6,5],objects:[],unknown:[],routes:{objectId:null,before:{points:[[1,2],[4,2]]}}});
              const host=document.createElement('details');host.open=true;document.body.append(host);
              let parentEpisode=null,resets=0,completions=0;const workers=[];
              const run=mountShowroomRun(host,null,{initialScene:scene,project:(x,z)=>[x*40,z*40],
                onReset(){resets++;parentEpisode=null;},onComplete(value){completions++;parentEpisode=value;},
                createRunWorker(){const worker={postMessage(message){this.request=message;},terminate(){this.terminated=true;}};workers.push(worker);return worker;}});
              const button=host.querySelector('[data-run-start]'),driver=host.querySelector('[data-run-driver]');
              const finish=()=>{const worker=workers.at(-1),episode={scene,sceneSha256:'a'.repeat(64),sampleIntervalSeconds:.05,modelXML:'<mujoco/>',
                frames:[{time:0,position:[1,2],velocity:[0,0],action:[.1,0]},{time:.05,position:[1.005,2],velocity:[.1,0],action:null}],
                score:{reason:'timeout',distanceMeters:.005,finalErrorMeters:2.995,contactNames:[]},engine:{version:'test'},provenance:{controllerKind:'waypoint'}};
                worker.onmessage({data:{type:'result',id:worker.request.id,episode}});};
              const check=(condition,message)=>{if(!condition)throw Error(message);};
              check(resets===1,'mount clears parent state');
              button.click();check(parentEpisode===null&&resets===2,'record start clears parent');finish();
              check(parentEpisode===run.getEpisode()&&completions===1,'completion shares current episode');
              driver.value='imitation';driver.dispatchEvent(new Event('change'));
              check(parentEpisode===null&&run.getEpisode()===null&&resets===3,'driver change clears both owners');
              check(!host.querySelector('[data-run-json]').hasAttribute('href'),'reset removes stale download');
              button.click();finish();check(parentEpisode!==null,'second recording completes');
              button.click();check(parentEpisode===null&&run.getEpisode()===null,'restart clears completed recording');
              const pending=workers.at(-1);button.click();check(pending.terminated&&parentEpisode===null,'cancel leaves parent clear');
              button.click();const failed=workers.at(-1);failed.onmessage({data:{type:'error',id:failed.request.id,message:'Test engine failure'}});
              check(parentEpisode===null&&run.getEpisode()===null,'worker failure leaves parent clear');
              const beforeDispose=resets;run.dispose();check(resets===beforeDispose,'dispose must not reset a replacement parent');
              return {resets,completions,checks:'mount, completion, driver reset, restart, cancellation, error and disposal'};
            }""")
            browser.close()
            print(json.dumps(result))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
