"""Real HTTP/browser jobs for CPU repair, measured map packaging and upstream SOMA.

All input geometry/motion is authored here. Localization browser telemetry is an
explicit authored transport fixture; real ROS registration is qualified separately.
Requires WORLD_SOMA_RUNTIME_DIR and WORLD_SOMA_TEST_PYTHON pointing to the pinned
installed CPU runtime. No private media, GPU workloads or physical robots used.
"""
from __future__ import annotations
import copy
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

from playwright.sync_api import expect, sync_playwright
from observations_browser_smoke import port, ready
from test_splat_repair import fixture_ply
from test_localization import scan
from robotics.localization import contracts as c
from robotics.localization.recording import Collector
from robotics.localization.telemetry import serve
from robotics.motion_retarget.authored_fixture import authored_sweep

OUTPUT=ROOT/'output/playwright/world'

def check(pw,name,origin,worker,token,tmp):
    browser=getattr(pw,name).launch(headless=True)
    context=browser.new_context(viewport={'width':1360,'height':1000},reduced_motion='reduce')
    page=context.new_page();page.set_default_timeout(20000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    stream=None;publisher=None;stop_publisher=threading.Event()
    try:
        print(f'{name}: opening workspace and connecting real worker',flush=True)
        page.goto(origin+'/world/index.html?nosw=1',wait_until='domcontentloaded')
        page.locator('#tab-world').click()
        page.locator('#object-name').fill('Keep my edited map');page.locator('#object-name').press('Tab')
        picker = page.locator('[data-layer-picker]')
        if picker.get_attribute('open') is None:
            picker.locator('summary').click()
        page.locator('[data-layer-connect]').click()
        page.locator('#worker-url').fill(worker);page.locator('#worker-token').fill(token);page.locator('#connect').click()
        expect(page.locator('#connection-status')).to_contain_text('Connected.')
        page.locator('#connection [aria-label=Close]').click()
        page.locator('[data-layer-tab=repair]').click()
        page.locator('[data-repair-file]').set_input_files(str(tmp/'authored.ply'))
        expect(page.locator('[data-repair-info]')).to_contain_text('6,400 original points')
        # Numeric rectangle exercises keyboard-accessible full-source selection.
        page.locator('summary').filter(has_text='Select with numbers').click()
        for edge,value in [('left','45'),('top','45'),('right','55'),('bottom','55')]:
            page.locator(f'[data-repair-{edge}]').fill(value)
        page.locator('[data-repair-rectangle]').click()
        selected=page.locator('[data-repair-info]').inner_text()
        assert '0 selected' not in selected,selected
        page.locator('[data-repair-consent]').check();page.locator('[data-repair-run]').click()
        print(f'{name}: submitted real repair job; selection={selected}',flush=True)
        expect(page.locator('[data-layer-status]')).to_contain_text('Repaired copy ready',timeout=90000)
        expect(page.locator('[data-repair-after]')).to_be_enabled()
        page.locator('[data-repair-before]').click();page.locator('[data-repair-after]').click()
        # The measured map still has the user's edit after a visual-only repair.
        expect(page.locator('#object-name')).to_have_value('Keep my edited map')
        page.locator('#world-layer-tools').screenshot(path=str(OUTPUT/f'three-layers-{name}-repair.png'))

        page.locator('[data-layer-tab=localization]').click()
        page.locator('[data-localization-file]').set_input_files(str(tmp/'measured.ply'))
        page.locator('[data-localization-consent]').check();page.locator('[data-localization-run]').click()
        print(f'{name}: submitted real map packaging job',flush=True)
        expect(page.locator('[data-layer-status]')).to_contain_text('Map files checked',timeout=60000)
        # Read exact actual worker artifacts for an authored transport recording.
        maps=list((tmp/'data/jobs').glob('*/output/localization-map.json'))
        assert maps
        path=max(maps,key=lambda p:p.stat().st_mtime)
        raw=path.read_bytes();manifest=c.decode(raw);binding=c.binding(manifest,raw)
        collector=Collector(binding,origin='authored-ros2-test');stamp=time.time_ns()-500_000_000;covariance=[0.]*36
        for i in (0,7,14,21,28,35):covariance[i]=.04
        for i in range(6):
            now=stamp+i*100_000_000
            collector.pose(now,'map',[.2+i*.1,.3,0.],[0.,0.,0.,1.],covariance,now_ns=now)
            collector.status(now,0,'healthy',now_ns=now);collector.flush(now_ns=now,force=True)
        recording=tmp/f'recording-{name}.json';recording.write_bytes(c.encode(collector.document()))
        page.locator('summary').filter(has_text='2. Open a saved').click()
        page.locator('[data-localization-recording]').set_input_files(str(recording))
        expect(page.locator('[data-layer-status]')).to_contain_text('Recording checked')
        page.locator('[data-localization-play]').click()
        expect(page.locator('[data-localization-seek]')).to_have_value('5',timeout=5000)
        # A modified binding is refused and does not replace the checked recording.
        bad=copy.deepcopy(collector.document());bad['binding']['mapSha256']='0'*64
        wrong=tmp/'wrong-recording.json';wrong.write_bytes(c.encode(bad))
        page.locator('[data-localization-recording]').set_input_files(str(wrong))
        expect(page.locator('[data-layer-status]')).to_contain_text('another map')
        expect(page.locator('[data-localization-seek]')).to_have_attribute('max','5')
        page.locator('[data-localization-seek]').fill('2')
        expect(page.locator('[data-localization-info]')).to_contain_text('0.20 seconds')
        live_token=secrets.token_urlsafe(40);secret=tmp/'telemetry-token';secret.write_text(live_token)
        # Fresh authored transport messages arrive while the browser connects,
        # then stop deliberately to exercise the real endpoint's stale response.
        live_collector=Collector(binding,origin='authored-ros2-test')
        def publish():
            while not stop_publisher.is_set():
                now=time.time_ns()
                live_collector.pose(now,'map',[.7,.3,0.],[0.,0.,0.,1.],covariance,now_ns=now)
                live_collector.status(now,0,'healthy',now_ns=now)
                live_collector.flush(now_ns=now,force=True)
                stop_publisher.wait(.1)
        publisher=threading.Thread(target=publish,daemon=True);publisher.start()
        stream_port=port();stream=serve(live_collector,secret,stream_port,origin)
        page.locator('summary').filter(has_text='Connect a live robot').click()
        page.locator('[data-live-url]').fill(f'http://127.0.0.1:{stream_port}/v1/localization')
        page.locator('[data-live-token]').fill(live_token);page.locator('[data-live-connect]').click()
        expect(page.locator('[data-localization-info]')).to_contain_text('Live position stream',timeout=10000)
        expect(page.locator('[data-live-token]')).to_have_value('')
        stop_publisher.set();publisher.join(timeout=2)
        expect(page.locator('[data-localization-info]')).to_contain_text('stale',timeout=10000)
        page.locator('[data-live-stop]').click()
        page.locator('#world-layer-tools').screenshot(path=str(OUTPUT/f'three-layers-{name}-localization.png'))

        page.locator('[data-layer-tab=motion]').click()
        page.locator('[data-motion-file]').set_input_files(str(tmp/'authored-sweep.bvh'))
        page.locator('[data-motion-consent]').check();page.locator('[data-motion-run]').click()
        print(f'{name}: submitted real SOMA CPU job',flush=True)
        expect(page.locator('[data-layer-status]')).to_contain_text('ready to compare',timeout=120000)
        page.locator('[data-motion-play]').click()
        expect(page.locator('[data-motion-seek]')).to_have_value('30',timeout=5000)
        page.locator('[data-motion-seek]').fill('15')
        expect(page.locator('[data-motion-info]')).to_contain_text('Frame 16 of 31 · 0.50 seconds')
        page.locator('[data-motion-canvas]').focus();page.keyboard.press('ArrowRight')
        page.locator('#world-layer-tools').screenshot(path=str(OUTPUT/f'three-layers-{name}-motion.png'))
        expect(page.locator('#object-name')).to_have_value('Keep my edited map')
        assert page.locator('.workspace-result-group').count()==3
        # Results reopen through their original client, not the geometry-to-map path.
        page.locator('#workspace-library > summary').click()
        motion_row=page.locator('.workspace-result-file').filter(has=page.locator('strong',has_text='motion-preview.json'))
        motion_row.get_by_role('button',name='Open',exact=True).click()
        expect(page.locator('#layer-panel-motion')).to_be_visible()
        expect(page.locator('#object-name')).to_have_value('Keep my edited map')
        layouts=[]
        page.evaluate("document.documentElement.dataset.readingSize='large'")
        for width in (390,320):
            page.set_viewport_size({'width':width,'height':900})
            for layer in ('repair','localization','motion'):
                page.locator(f'[data-layer-tab={layer}]').click()
                size=page.evaluate('({width:innerWidth,page:document.documentElement.scrollWidth})')
                assert size['page']<=width+1,(name,layer,size)
                layouts.append({'layer':layer,**size})
            page.locator('#world-layer-tools').screenshot(path=str(OUTPUT/f'three-layers-{name}-{width}.png'))
        page.locator('[data-layer-tab=repair]').focus();page.keyboard.press('ArrowRight')
        expect(page.locator('[data-layer-tab=localization]')).to_be_focused()
        expect(page.locator('[data-layer-tab=localization]')).to_have_attribute('aria-selected','true')
        assert not errors,errors
        (OUTPUT/f'three-layers-{name}.json').write_text(json.dumps({'passed':True,'realCPURepair':True,'realSOMARetarget':True,'localization':'real map packaging; authored transport positions; ROS separately qualified','layouts':layouts,'browserErrors':errors},indent=2))
        print(f'{name}: PASS real CPU jobs, source preservation, playback and mobile layouts',flush=True)
    except Exception:
        page.screenshot(path=str(OUTPUT/f'three-layers-{name}-failure.png'),full_page=True)
        print(f'{name}: browser errors={errors}; visible status='+page.locator('[data-layer-status]').inner_text(),file=sys.stderr,flush=True)
        raise
    finally:
        stop_publisher.set()
        if publisher:publisher.join(timeout=2)
        if stream:stream.shutdown();stream.server_close()
        context.close();browser.close()

def main():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    runtime=Path(os.environ['WORLD_SOMA_RUNTIME_DIR']);soma_python=os.environ['WORLD_SOMA_TEST_PYTHON']
    worker_python=os.environ.get('WORLD_SERVER_PYTHON',sys.executable)
    processes=[];logs=[]
    with tempfile.TemporaryDirectory(prefix='brainsnn-three-layers-') as directory:
        tmp=Path(directory);fixture_ply(tmp/'authored.ply');(tmp/'measured.ply').write_bytes(scan()[0])
        (tmp/'authored-sweep.bvh').write_bytes(authored_sweep(runtime,frames=31))
        front,back=port(),port();origin=f'http://127.0.0.1:{front}';worker=f'http://127.0.0.1:{back}';token=secrets.token_urlsafe(48)
        config=[]
        for engine,script,kinds,python in [('splat-repair','splat_repair',['splat','repair'],worker_python),('localization-map','localization_job',['survey','localization'],worker_python),('motion-retarget','motion_retarget',['motion','retarget'],soma_python)]:
            config.append({'id':engine,'label':engine,'enabled':True,'license_reviewed':True,'input_kinds':kinds,'max_inputs':2,'timeout_seconds':180,'source_job':engine=='localization-map','command':[python,str(ROOT/f'robotics/world_worker/{script}.py'),'--input-manifest','{input_manifest}']})
        (tmp/'adapters.json').write_text(json.dumps(config))
        env={**os.environ,'WORLD_WORKER_TOKEN':token,'WORLD_WORKER_DIR':str(tmp/'data'),'WORLD_ADAPTERS_FILE':str(tmp/'adapters.json'),'WORLD_ALLOWED_ORIGINS':origin,'WORLD_SOMA_RUNTIME_DIR':str(runtime),'WORLD_SOMA_DEVICE':'cpu','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2'}
        try:
            for label,command,e in [('frontend',[worker_python,'-m','http.server',str(front),'--bind','127.0.0.1','--directory',str(ROOT/'brainsnn-r3f-app/public')],os.environ),('worker',[worker_python,'-m','uvicorn','robotics.world_worker.app:create_app','--factory','--host','127.0.0.1','--port',str(back),'--no-access-log'],env)]:
                log=(tmp/f'{label}.log').open('wb');logs.append(log);processes.append(subprocess.Popen(command,cwd=ROOT,env=e,stdout=log,stderr=log))
            ready(origin+'/world/index.html',processes[0]);ready(worker+'/healthz',processes[1])
            with sync_playwright() as pw:
                for name in os.environ.get('WORLD_BROWSERS','chromium,webkit').split(','):check(pw,name.strip(),origin,worker,token,tmp)
        except Exception:
            for path in [tmp/'worker.log',*sorted((tmp/'data/jobs').glob('*/operator.log'))]:
                if path.exists():print(path.name+':\n'+path.read_text(errors='replace')[-8000:],file=sys.stderr)
            raise
        finally:
            for process in processes:process.terminate()
            for process in processes:
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            for log in logs:log.close()

if __name__=='__main__':main()
