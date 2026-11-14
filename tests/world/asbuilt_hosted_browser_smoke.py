"""Actual browser -> production proxy -> private worker -> IFC and retained rasters.
All geometry, poses and images are authored regression fixtures.
"""
from pathlib import Path
import hashlib,json,os,secrets,socket,subprocess,sys,tempfile,time,urllib.request,urllib.error
from playwright.sync_api import sync_playwright,expect
from asbuilt_capture_fixture import make_capture,dump
from test_asbuilt_jobs import adapters
from robotics.world_worker.deploy.railway.tenants import registry

ROOT=Path(__file__).resolve().parents[2];OUTPUT=ROOT/'output/playwright/world'
LOCAL=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def port():
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def call(url,method='GET',body=None,token=None,raw=False):
 data=body if raw else json.dumps(body).encode() if body is not None else None
 headers=({'Authorization':'Bearer '+token} if token else {})|({'Content-Type':'application/octet-stream' if raw else 'application/json'} if data is not None else {})
 with LOCAL.open(urllib.request.Request(url,data=data,method=method,headers=headers),timeout=20) as r:return json.load(r)
def ready(url,proc):
 for _ in range(100):
  if proc.poll() is not None:raise RuntimeError('Test server exited.')
  try:call(url);return
  except (OSError,json.JSONDecodeError):time.sleep(.1)
 raise RuntimeError('Test server did not become ready.')
def main():
 OUTPUT.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='hosted-asbuilt-') as temp:
  root=Path(temp);case=make_capture(root/'fixture');config=root/'adapters.json';adapters(config)
  entries=json.loads(config.read_text());entries.insert(0,{'id':'scene-usd','enabled':True,'license_reviewed':True,'input_kinds':['cloud'],'max_inputs':1,'timeout_seconds':30,'command':[sys.executable,str(ROOT/'tests/world/asbuilt_fixture_adapter.py'),'--fixture',str(root/'fixture'),'--input-manifest','{input_manifest}']});dump(config,entries)
  passcode='authored-test-'+secrets.token_hex(8);tenants=root/'tenants.json';dump(tenants,registry({'WORLD_SITE_PASSCODE':passcode},20*1024**3,[e['id'] for e in entries]))
  wp,sp=port(),port()
  while wp==sp:sp=port()
  site=f'http://127.0.0.1:{sp}';worker_env={**os.environ,'WORLD_WORKER_DIR':str(root/'worker'),'WORLD_WORKER_TOKEN':secrets.token_urlsafe(32),'WORLD_ADAPTERS_FILE':str(config),'WORLD_TENANTS_FILE':str(tenants)}
  site_env={**os.environ,'PORT':str(sp),'WORLD_WORKER_INTERNAL_URL':f'http://127.0.0.1:{wp}/','WORLD_SITE_PASSCODE':passcode,'WORLD_SITE_VISITORS':'1','ASBUILT_TEST_FIXTURE':str(root/'fixture')}
  processes=[];logs=[]
  try:
   for name,command,env in [('worker',[sys.executable,'-m','uvicorn','robotics.world_worker.app:create_app','--factory','--host','127.0.0.1','--port',str(wp),'--no-access-log'],worker_env),('site',[os.environ.get('NODE_PATH_EXECUTABLE','node'),'tests/world/asbuilt_proxy_fixture.mjs'],site_env)]:
    log=(root/(name+'.log')).open('wb');logs.append(log);processes.append(subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=log))
   ready(f'http://127.0.0.1:{wp}/healthz',processes[0]);ready(site+'/api/world/processing',processes[1])
   token=call(site+'/api/world/session','POST',{'passcode':passcode})['token'];base=site+'/api/world/worker'
   data=(case['sceneRoot']/'output/arena-cloud.json').read_bytes();upload=call(base+'/v1/uploads','POST',{'name':'cloud.json','kind':'cloud','size':len(data)},token)['id'];call(base+f'/v1/uploads/{upload}?offset=0','PUT',data,token,raw=True)
   source=call(base+'/v1/jobs','POST',{'engine':'scene-usd','upload_ids':[upload],'consent':True},token);call(base+f'/v1/jobs/{source["id"]}/start','POST',{},token)
   for _ in range(200):
    source=call(base+'/v1/jobs/'+source['id'],token=token)
    if source['status'] in ('complete','failed'):break
    time.sleep(.05)
   assert source['status']=='complete',source
   visitor=call(site+'/api/world/session','POST',{})['token']
   try:call(base+'/v1/uploads','POST',{'name':'private.ifc','kind':'ifc','size':100},visitor)
   except urllib.error.HTTPError as e:assert e.code==403
   else:raise AssertionError('Visitor was admitted to private IFC review.')
   with sync_playwright() as pw:
    for engine in os.environ.get('WORLD_BROWSERS','chromium').split(','):
     options={}
     if engine=='chromium':
      options['args']=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']
      if os.environ.get('PLAYWRIGHT_CHROMIUM_PATH'):options['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_PATH']
     browser=getattr(pw,engine).launch(headless=True,**options)
     try:
      for width,software in [(1280,False),(390,True)]:
       page=browser.new_page(viewport={'width':width,'height':1000},accept_downloads=True);errors=[];posts=[]
       page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:posts.append(r.url) if r.method=='POST' else None)
       if software:page.route('**/twin-renderer.js',lambda route:route.abort())
       page.goto(site+'/harness')
       page.evaluate('''async({token,source})=>{
        const {WorkerClient}=await import('/world/worker-client.mjs');const {sha256}=await import('/world/asbuilt-core.mjs');const {mountAsBuiltReview}=await import('/world/asbuilt-ui.mjs');
        const client=new WorkerClient(location.origin+'/api/world/worker',token);client.site=true;await client.capabilities();
        const si=source.artifacts.findIndex(a=>a.name==='scene.json'),ci=source.artifacts.findIndex(a=>a.name==='arena-cloud.json');
        const raw=await client.previewArtifact(source,si),cloud=JSON.parse(new TextDecoder().decode(await client.previewArtifact(source,ci)));
        window.ctx={scene:JSON.parse(new TextDecoder().decode(raw)),cloud,dirty:false,sourceClient:client,job:source.id,artifacts:source.artifacts};
        const prior=new Uint8Array(await(await fetch('/fixture/prior.ifc')).arrayBuffer());
        window.disposeReview=mountAsBuiltReview({host:document.getElementById('host'),context:ctx,sceneSha:await sha256(raw),open:true,initialPriorBytes:prior});
       }''',{'token':token,'source':source})
       expect(page.locator('.asbuilt-status')).to_contain_text('Prior IFC opened locally',timeout=30000)
       posts.clear();page.get_by_role('button',name='Create reviewed IFC copy',exact=True).click();expect(page.locator('.asbuilt-hosted [role=status]')).to_contain_text('Approve processing');assert not posts
       page.get_by_role('button',name='chair',exact=True).click()
       page.get_by_label('I approve sending the selected IFC/review, or retrieving retained source photos, through this connected processing session.',exact=True).check()
       page.get_by_role('button',name='Show selected component photos',exact=True).click()
       expect(page.locator('.asbuilt-hosted [role=status]')).to_contain_text('Retained capture frames loaded',timeout=45000)
       assert page.locator('.asbuilt-photos img').count() in (1,2);assert page.locator('.asbuilt-photo i').count()==page.locator('.asbuilt-photos img').count()
       with page.expect_download() as ticket:page.get_by_role('button',name='Download asbuilt-photo-evidence.json',exact=True).click()
       evidence_path=root/f'evidence-{engine}-{width}.json';ticket.value.save_as(evidence_path);report=json.loads(evidence_path.read_text());assert report['status']=='available' and report['metricVerified'] is False
       assert report['sourceJob']==source['id'] and report['componentId']==case['componentId']
       page.locator('.asbuilt-settings summary').click();page.get_by_label('How was this frame alignment established?',exact=True).fill('Authored common frame; not a physical measurement.');page.locator('.asbuilt-aligned').check()
       expect(page.locator('.asbuilt-photos img')).to_have_count(0)
       page.get_by_role('button',name='Apply reviewed alignment',exact=True).click()
       chair=page.locator('tbody tr').filter(has=page.get_by_role('button',name='chair',exact=True));chair.locator('input[type=checkbox]').check()
       page.get_by_role('button',name='Create reviewed IFC copy',exact=True).click()
       expect(page.locator('.asbuilt-hosted [role=status]')).to_contain_text('Updated IFC written and reopened',timeout=45000)
       with page.expect_download() as ticket:page.get_by_role('button',name='Download updated.ifc',exact=True).click()
       target=root/f'updated-{engine}-{width}.ifc';ticket.value.save_as(target)
       import ifcopenshell
       model=ifcopenshell.open(target);assert model.by_type('IfcFurniture')
       with page.expect_download() as ticket:page.get_by_role('button',name='Download asbuilt-update-report.json',exact=True).click()
       target_report=root/f'report-{engine}-{width}.json';ticket.value.save_as(target_report);result=json.loads(target_report.read_text())
       assert result['updatedCount']==1 and result['outputIfcSha256']==hashlib.sha256(target.read_bytes()).hexdigest()
       assert not result['physicalRobotValidated']
       page.locator('.asbuilt-hosted').screenshot(path=str(OUTPUT/f'asbuilt-hosted-{engine}-{width}.png'))
       assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
       stored=page.evaluate('JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)])');assert token not in stored and passcode not in stored
       page.evaluate('window.disposeReview()');expect(page.locator('.asbuilt-hosted')).to_have_count(0);assert not errors,errors
       page.close();print(f'PASS {engine} {width}px: actual proxy/tenant worker, retained rasters and projected bounds, IFC execution/readback, consent, integrity downloads, visitor denial and disposal; authored data only')
     finally:browser.close()
  except Exception:
   for name in ('worker','site'):
    print((root/(name+'.log')).read_text()[-6000:],file=sys.stderr)
   raise
  finally:
   for p in processes:p.terminate()
   for p in processes:
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:p.kill();p.wait()
   for log in logs:log.close()

if __name__=='__main__':main()
