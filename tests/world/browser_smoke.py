"""Local browser integration checks. No model output is substituted or mocked."""
from pathlib import Path
import json
import os
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
URL=os.environ.get('WORLD_URL','http://127.0.0.1:8765/world/index.html')
OUTPUT=ROOT/'output/playwright/world'
OUTPUT.mkdir(parents=True,exist_ok=True)

def check(browser, mobile=False):
    ctx=browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1440,'height':1000},device_scale_factor=1,has_touch=mobile)
    page=ctx.new_page();view=page;errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL,wait_until='networkidle')
    # The production root embeds the same real HTTP document in an iframe.
    if page.locator('iframe[src="/world/index.html"]').count():
        page=page.frame(url=re.compile(r'/world/index\.html$'))
        assert page is not None
    page.wait_for_function("document.querySelectorAll('.system-card').length===22")
    assert page.locator('.system-card').count()==22
    assert page.locator('#provenance').inner_text()=='AUTHORED SAMPLE'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    view.screenshot(path=str(OUTPUT/(browser.browser_type.name+('-mobile.png' if mobile else '-desktop.png'))),full_page=True)
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
    # Replay must advance; WebKit's software-rendered first frame can take longer than a fixed sleep.
    page.locator('#replay').click();page.wait_for_function("Number(document.querySelector('#scrub').value)>0",timeout=5000)
    page.locator('#replay').click()
    page.locator('[data-tab=evidence]').click()
    with view.expect_download() as event:page.locator('[data-action=proof]').click()
    downloaded=event.value;out=OUTPUT/(browser.browser_type.name+('-proof-mobile.json' if mobile else '-proof-desktop.json'));downloaded.save_as(out)
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
    assert 'Source preview' in page.locator('#media-preview').inner_text()
    # A walkthrough video has its own picker that accepts video only: phone galleries list videos for it whatever they
    # make of the mixed photo, video and 3D-file list.
    page.locator('[data-tab=capture]').click()
    with view.expect_file_chooser() as chooser:page.locator('[data-action=video]').click()
    assert chooser.value.element.get_attribute('accept')=='video/*' and not chooser.value.is_multiple()
    # A picker that returns nothing (on iPhone, a Photo Library conversion that failed) says so. Checked before a file
    # is added: an added video's preview reports later and replaces the status line.
    page.locator('#video-file').dispatch_event('cancel')
    assert 'No file came back' in page.locator('#status').inner_text()
    # A phone video handed over without its usual extension is taken by its media type.
    chooser.value.set_files({'name':'IMG_2222','mimeType':'video/quicktime','buffer':b'not a real movie'})
    page.wait_for_function("[...document.querySelectorAll('.source-row button[data-source]')].some(b=>b.textContent==='IMG_2222')",timeout=12000)
    # JSON imports explicitly marked generated remain non-plannable.
    w['provenance']='generated';w['scaleReviewed']=True;w['mapReviewed']=True
    page.locator('#files').set_input_files({'name':'generated.json','mimeType':'application/json','buffer':json.dumps(w).encode()})
    assert page.locator('#scale-reviewed').is_disabled()
    page.locator('#run').click();assert 'Generated' in page.locator('#status').inner_text()
    # A phone RoomPlan scan keeps its missing floor region, including in exports.
    floor=[[0,0],[8,0],[8,3],[3,3],[3,8],[0,8]]
    room={'name':'Phone scan / L floor','floors':[{'transform':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'polygonCorners':[[x,0,z] for x,z in floor]}],'objects':[],'walls':[]}
    page.locator('#files').set_input_files({'name':'roomplan.json','mimeType':'application/json','buffer':json.dumps(room).encode()})
    page.wait_for_function("document.querySelector('#world-title').textContent==='Phone scan / L floor'")
    assert page.locator('#provenance').inner_text()=='REVIEW REQUIRED'
    assert 'REVIEW REQUIRED' in page.locator('#scene-basis').inner_text()
    assert not page.locator('#scale-reviewed').is_checked()
    assert page.locator('#floor-width').is_disabled() and page.locator('#floor-depth').is_disabled()
    page.locator('#scale-reviewed').check();page.locator('#map-reviewed').check()
    page.locator('#run').click();page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')")
    page.locator('[data-tab=evidence]').click()
    with view.expect_download() as event:page.locator('[data-action=arena-export]').click()
    out=OUTPUT/(browser.browser_type.name+('-phone-room-mobile.json' if mobile else '-phone-room-desktop.json'));event.value.save_as(out)
    assert json.loads(out.read_text())['floor']==floor
    page.locator('[data-action=usd-export]').click();assert 'rectangular floors only' in page.locator('#status').inner_text()
    page.locator('#tab-capture').click();page.locator('#tab-capture').focus();page.locator('#tab-capture').press('ArrowRight')
    assert page.locator('#tab-world').get_attribute('aria-selected')=='true'
    page.locator('#scale-reviewed').uncheck()
    assert 'REVIEW REQUIRED' in page.locator('#scene-basis').inner_text()
    page.locator('#system-search').fill('Lyra');assert page.locator('.system-card').count()==1
    page.locator('#system-search').fill('');local_count=page.locator('.system-card[data-state=local]').count()
    assert local_count>0
    page.locator('[data-filter=local]').click();assert page.locator('.system-card').count()==local_count
    page.locator('[data-filter=all]').click();assert page.locator('.system-card').count()==22
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    assert errors==[],errors
    ctx.close()

def check_routes(browser, base):
    """Exercise actual built-site route boundaries and links out of the frame."""
    ctx=browser.new_context(viewport={'width':390,'height':844},has_touch=True)
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    for route in ['/', '/world', '/world/']:
        response=page.goto(base+route,wait_until='networkidle')
        assert response.status==200
        frame=page.frame(url=re.compile(r'/world/index\.html$'))
        assert frame is not None
        frame.locator('#hero-capture').click()
        assert frame.locator('[data-action=files]').is_visible()
        assert frame.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.set_viewport_size({'width':844,'height':390})
    assert page.evaluate('document.documentElement.scrollHeight <= innerHeight+1'),'Landscape must not add a second outer scrollbar'
    page.set_viewport_size({'width':390,'height':844})
    # target=_top is essential: otherwise old pages appear nested in World Builder.
    frame.locator('a[href="/?classic=1"]').last.click()
    page.wait_for_url(base+'/?classic=1')
    page.locator('#lobby-title').wait_for()
    assert page.locator('iframe[src="/world/index.html"]').count()==0
    page.set_viewport_size({'width':1440,'height':1000})
    page.goto(base+'/',wait_until='networkidle')
    frame=page.frame(url=re.compile(r'/world/index\.html$'))
    frame.locator('a[href="/lab"]').last.click()
    page.wait_for_url(base+'/lab')
    page.get_by_role('heading',name='Lab',exact=True).wait_for()
    assert page.locator('iframe[src="/world/index.html"]').count()==0
    page.goto(base+'/',wait_until='networkidle')
    frame=page.frame(url=re.compile(r'/world/index\.html$'))
    frame.locator('a[href="/arena/"]').last.click()
    page.wait_for_url(base+'/arena/')
    page.locator('#page-title').wait_for(state='attached')
    assert page.locator('iframe[src="/world/index.html"]').count()==0
    assert errors==[],errors
    ctx.close()

def check_measurements(browser):
    """Authored input fixture exercises self-reported evidence; no physical measurement is claimed."""
    ctx=browser.new_context(viewport={'width':390,'height':844},has_touch=True)
    view=ctx.new_page();errors=[];view.on('pageerror',lambda e:errors.append(str(e)))
    view.goto(URL,wait_until='networkidle')
    page=view.frame(url=re.compile(r'/world/index\.html$')) or view
    page.wait_for_function("document.querySelectorAll('.system-card').length===22")
    authored={'schema':'brainsnn.world.v1','name':'Measurement contract fixture','width':8,'depth':8,'provenance':'observed','scaleReviewed':True,'mapReviewed':True,'start':{'x':1,'z':1},'objects':[{'id':'unknown-corner','name':'Unobserved corner','kind':'unknown','x':4,'z':4,'w':1,'d':1,'h':1}]}
    def import_map(value):
        page.locator('#files').set_input_files({'name':'measurement-fixture.json','mimeType':'application/json','buffer':json.dumps(value).encode()})
        page.wait_for_function("document.querySelector('#world-title').textContent==='Measurement contract fixture'")
    def proof(tag):
        with view.expect_download() as event:page.locator('#export').click()
        path=OUTPUT/(browser.browser_type.name+'-measurement-'+tag+'.json');event.value.save_as(path)
        return json.loads(path.read_text())
    def replace_worksheet():
        view.once('dialog',lambda dialog:dialog.accept())
        page.locator('#measurement-start').click()
        page.wait_for_function("document.querySelector('#measurement-state').textContent.startsWith('Current map')")
    import_map(authored)
    page.locator('#scale-reviewed').check()
    original=proof('before')['world']
    assert original['scaleReviewed'] is True and original['mapReviewed'] is False
    page.locator('#measurement-worksheet summary').click();page.locator('#measurement-start').click()
    page.wait_for_function("document.querySelector('#measurement-state').textContent.startsWith('Current map')")
    literal='<img src=x onerror="window.measurementInjected=true">'
    page.locator('#measure-label').fill(literal)
    page.locator('#measure-reviewNote').fill('Fixture floor needs independent site review')
    page.locator('#measure-decision').select_option('needs-work');page.locator('#measurement-review').click()
    assert page.locator('#measure-label').input_value()==literal
    page.locator('[data-tab=understand]').click();page.locator('[data-tab=world]').click()
    assert page.locator('#measure-label').input_value()==literal
    pending=proof('draft')
    assert pending['world']==original and pending['geometryEvidence']['measurements']==[]
    assert literal not in json.dumps(pending['geometryEvidence'])
    for key,value in {'fromX':'0','fromZ':'0','toX':'3','toZ':'0','distance':'3.02','uncertainty':'0.02','instrument':'Authored browser fixture, not a real meter','measuredOn':'2026-10-19','note':'Explicit test evidence'}.items():
        page.locator('#measure-'+key).fill(value)
    page.locator('#measurement-save').click()
    assert page.locator('#measurement-records img').count()==0
    assert literal in page.locator('#measurement-records').inner_text()
    assert page.evaluate('window.measurementInjected') is None
    for target in ['start','object:unknown-corner']:
        page.locator('#measure-target').select_option(target);page.locator('#measure-decision').select_option('checked')
        page.locator('#measure-reviewNote').fill('Test reviewer decision only');page.locator('#measurement-review').click()
    current=proof('current');evidence=current['geometryEvidence']
    assert current['world']==original and evidence['binding']['status']=='current'
    assert evidence['authority']=='self-reported-unverified' and evidence['metricVerified'] is False and evidence['certified'] is False
    assert len(evidence['measurements'])==1 and len(evidence['reviews'])==3
    assert evidence['measurements'][0]['from']==[0,0] and evidence['measurements'][0]['to']==[3,0]
    assert evidence['measurements'][0]['distanceMeters']==3.02 and evidence['measurements'][0]['uncertaintyMeters']==0.02
    assert evidence['geometry']['sha256']==evidence['binding']['currentGeometrySha256']
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    page.evaluate("document.documentElement.style.scrollBehavior='auto'")
    page.locator('#measurement-worksheet summary').focus()
    page.evaluate("document.querySelector('#measurement-worksheet').scrollIntoView({block:'start',behavior:'instant'})")
    page.locator('#measurement-worksheet').screenshot(path=str(OUTPUT/(browser.browser_type.name+'-measurement-worksheet.png')))
    # An imported receipt cannot keep local review authority, even with identical geometry.
    with view.expect_download() as event:page.locator('#measurement-export').click()
    receipt=OUTPUT/(browser.browser_type.name+'-measurement-worksheet.json');event.value.save_as(receipt)
    view.once('dialog',lambda dialog:dialog.accept());page.locator('#measurement-import').set_input_files(receipt)
    page.wait_for_function("document.querySelector('#measurement-state').textContent.startsWith('Imported reference')")
    assert page.locator('#measurement-save').is_disabled()
    imported=proof('imported');assert imported['world']==original
    assert imported['geometryEvidence']['binding']['status']=='imported'
    assert imported['geometryEvidence']['measurements']==evidence['measurements']
    # An actual geometry edit retains the worksheet as stale and preserves unsaved form text.
    replace_worksheet();page.locator('#measure-label').fill('Unsubmitted draft survives map edit')
    page.locator('#objects').select_option('unknown-corner')
    page.locator('#object-x').fill('5');page.locator('#object-x').press('Tab')
    assert 'Stale worksheet' in page.locator('#measurement-state').inner_text()
    assert page.locator('#measure-label').input_value()=='Unsubmitted draft survives map edit'
    assert page.locator('#measurement-save').is_disabled()
    stale=proof('stale')['geometryEvidence'];assert stale['binding']['status']=='stale'
    assert stale['geometry']['sha256']!=stale['binding']['currentGeometrySha256']
    # Importing the same map invalidates local authority too; hashes alone cannot carry approval.
    replace_worksheet();same=proof('same-map')['world'];import_map(same)
    assert 'Stale worksheet' in page.locator('#measurement-state').inner_text()
    replaced=proof('map-reimport')['geometryEvidence']
    assert replaced['binding']['status']=='stale' and replaced['binding']['reason']=='map-replaced'
    assert replaced['geometry']['sha256']==replaced['binding']['currentGeometrySha256']
    assert not page.locator('#scale-reviewed').is_checked() and not page.locator('#map-reviewed').is_checked()
    page.locator('[data-tab=evidence]').click();view.once('dialog',lambda dialog:dialog.accept());page.locator('[data-action=clear]').click()
    assert 'geometryEvidence' not in proof('cleared')
    assert errors==[],errors
    ctx.close()
    print(browser.browser_type.name+': measured-evidence drafts, inert labels, proof, edit/import invalidation and clearing verified',flush=True)

def check_inference(browser, photo):
    """Opt-in real model download and inference; no substituted model responses."""
    ctx=browser.new_context(viewport={'width':390,'height':844},has_touch=True)
    requests=[];ctx.on('request',lambda request:requests.append({'method':request.method,'url':request.url,'body':request.post_data}))
    view=ctx.new_page();errors=[];view.on('pageerror',lambda error:errors.append(str(error)))
    view.goto(URL,wait_until='networkidle')
    page=view.frame(url=re.compile(r'/world/index\.html$')) or view
    page.locator('#files').set_input_files(photo)
    assert page.locator('#run').is_disabled()
    assert not any('huggingface.co' in item['url'] for item in requests),'No model fetch before consent'
    # Start and cancel an actual job, including the module worker cleanup path.
    page.locator('[data-action=depth]').click();page.locator('#depth-start').click()
    page.locator('[data-action=cancel-depth]').click()
    page.wait_for_function("document.querySelector('#depth-status').textContent.includes('cancelled')")
    assert page.locator('#visual-canvas').is_hidden()
    page.locator('[data-action=depth]').click();page.locator('#depth-start').click()
    page.wait_for_function("document.querySelector('#status').textContent.startsWith('3D preview ready') || document.querySelector('#depth-status').textContent.startsWith('Could not')",timeout=300000)
    assert page.locator('#status').inner_text().startswith('3D preview ready'),page.locator('#depth-status').inner_text()
    assert page.locator('#visual-canvas').is_visible()
    assert 'SCALE UNVERIFIED' in page.locator('#provenance').inner_text()
    assert page.locator('#run').is_disabled()
    page.locator('#show-source').click();page.locator('#media-preview img').wait_for(state='visible')
    page.locator('#show-visual').click();assert page.locator('#visual-canvas').is_visible()
    page.locator('#visual-canvas').focus();page.locator('#visual-canvas').press('ArrowRight')
    page.locator('#visual-canvas').screenshot(path=str(OUTPUT/(browser.browser_type.name+'-real-photo-depth.png')))
    page.locator('[data-tab=evidence]').click()
    with view.expect_download() as event:page.locator('[data-action=proof]').click()
    out=OUTPUT/(browser.browser_type.name+'-real-photo-proof.json');event.value.save_as(out)
    proof=json.loads(out.read_text());derived=proof['sources'][0]['derivation']
    assert proof['world'] is None and proof['result'] is None
    assert derived['pointCount']>1000
    assert derived['metricVerified'] is False
    assert derived['representation']=='relative-depth-point-cloud'
    assert derived['model']['id']=='onnx-community/depth-anything-v2-small'
    assert len(derived['inputSHA256'])==64
    assert any(derived['model']['revision'] in item['url'] for item in requests)
    assert all(item['method'] in ('GET','HEAD') and item['body'] is None for item in requests),requests
    assert errors==[],errors
    (OUTPUT/(browser.browser_type.name+'-real-photo-requests.json')).write_text(json.dumps(requests,indent=2))
    print(browser.browser_type.name+': real photo depth, cancellation, source comparison, unverified geometry and download-only network verified',flush=True)
    ctx.close()

def check_app_shell(browser):
    """Installable shell + share-sheet export: manifest and icons resolve, SW only on https, touch exports go to
    navigator.share with every file in one call and fall back to downloads when sharing is unavailable."""
    # The installed app starts at /world/; the production root embeds that same document in an iframe, so test it directly.
    url=URL if URL.endswith('/world/index.html') else URL.rstrip('/')+'/world/index.html'
    base=url.rsplit('/',1)[0]
    ctx=browser.new_context(viewport={'width':390,'height':844},has_touch=True,user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script("Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5})")
    page.goto(url,wait_until='networkidle');page.wait_for_function("document.querySelectorAll('.system-card').length===22")
    manifest=page.request.get(base+'/manifest.webmanifest');assert manifest.ok;data=manifest.json()
    assert data['scope']=='/world/' and data['display']=='standalone' and any(i.get('purpose')=='maskable' for i in data['icons'])
    # In production /world/ is the outer site shell; the installed app must start on the World document itself.
    assert data['start_url'].startswith('/world/index.html'),data['start_url']
    for icon in data['icons']:assert page.request.get(icon['src'] if icon['src'].startswith('http') else url.split('/world/')[0]+icon['src']).ok,icon
    assert page.request.get(base+'/icons/apple-touch-icon.png').ok and page.request.get(base+'/sw.js').ok
    assert page.locator('link[rel=manifest]').count()==1 and page.locator('meta[name=apple-mobile-web-app-capable]').count()==1
    # Shell worker: installs on this secure origin, precaches the shell, serves it offline, never caches API or cross-origin.
    sw=page.evaluate("""async()=>{const reg=await navigator.serviceWorker.ready;const sw=reg.active;const t0=Date.now();while(sw.state!=='activated'&&Date.now()-t0<15000)await new Promise(r=>setTimeout(r,100));
      const names=(await caches.keys()).filter(n=>n.startsWith('world-shell-'));
      const keys=(await Promise.all(names.map(n=>caches.open(n).then(c=>c.keys())))).flat().map(r=>new URL(r.url).pathname);
      return {state:sw.state,names,keys}}""")
    assert sw['state']=='activated' and len(sw['names'])==1 and '/world/app.mjs' in sw['keys'] and '/world/index.html' in sw['keys'],sw
    page.reload(wait_until='networkidle');assert page.evaluate('navigator.serviceWorker.controller!==null')
    ctx.set_offline(True);page.reload(wait_until='domcontentloaded');page.wait_for_function("document.querySelectorAll('.system-card').length===22",timeout=15000)
    # Launching the installed app offline opens its start URL from the cache.
    page.goto(url.split('/world/')[0]+data['start_url'],wait_until='domcontentloaded');page.wait_for_function("document.querySelectorAll('.system-card').length===22",timeout=15000)
    ctx.set_offline(False)
    page.evaluate("Promise.allSettled([fetch('/v1/site-scans/capabilities'),fetch('https://example.invalid/x')])")
    assert not any('/v1/' in k for k in page.evaluate("async()=>{const names=(await caches.keys()).filter(n=>n.startsWith('world-shell-'));return (await Promise.all(names.map(n=>caches.open(n).then(c=>c.keys())))).flat().map(r=>r.url)}"))
    page.locator('[data-tab=capture]').click()
    assert page.locator('[data-action=install]').count()==1,'iOS Safari gets the Add to Home Screen button'
    page.locator('[data-action=install]').click();assert 'Add to Home Screen' in page.locator('#status').inner_text()
    # Share path: a fake share sheet records the call; both proof files must arrive in one share.
    page.evaluate("""()=>{window.__shared=[];navigator.canShare=d=>Boolean(d?.files?.length);navigator.share=async d=>{window.__shared.push(d.files.map(f=>[f.name,f.type,f.size]));};}""")
    page.locator('[data-tab=evidence]').click();page.locator('[data-action=proof]').click();page.wait_for_function('window.__shared.length===1')
    shared=page.evaluate('window.__shared');assert shared[0][0][0]=='brainsnn-proof.json' and shared[0][0][2]>0,shared
    # Fallback: sharing rejects (no sheet) -> classic downloads, one per file.
    page.evaluate("()=>{navigator.share=async()=>{throw new TypeError('no share sheet');};}")
    with page.expect_download() as event:page.locator('[data-action=proof]').click()
    assert event.value.suggested_filename=='brainsnn-proof.json'
    # Dismissal is not an error and does not download.
    page.evaluate("()=>{window.__dl=0;document.addEventListener('click',e=>{if(e.target.download)window.__dl++;},true);navigator.share=async()=>{const e=new Error('cancel');e.name='AbortError';throw e;};}")
    page.locator('[data-action=proof]').click();page.wait_for_timeout(300);assert page.evaluate('window.__dl')==0
    # On the homepage the app is framed: Install opens the standalone World document at the top level, where it applies.
    page.goto(url.split('/world/')[0]+'/',wait_until='networkidle')
    if page.locator('iframe[src="/world/index.html"]').count():
        frame=page.frame(url=re.compile(r'/world/index\.html$'));frame.wait_for_function("document.querySelectorAll('.system-card').length===22")
        frame.locator('[data-tab=capture]').click();frame.locator('[data-action=install]').click()
        page.wait_for_url(re.compile(r'/world/index\.html\?install=1$'));page.wait_for_function("/Add to Home Screen/.test(document.querySelector('#status').textContent)")
    assert not errors,errors;ctx.close()

def check_capture_keeps_user_map(browser):
    """Adding a capture replaces only the untouched sample; an edited or imported authored map is the user's work."""
    from PIL import Image
    import io
    url=URL if URL.endswith('/world/index.html') else URL.rstrip('/')+'/world/index.html'
    ctx=browser.new_context();page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url,wait_until='networkidle');page.wait_for_function("document.querySelectorAll('.system-card').length===22")
    page.locator('[data-tab=world]').click();page.locator('#map-name').fill('My measured gym');page.locator('#map-name').press('Enter')
    b=io.BytesIO();Image.new('RGB',(20,20)).save(b,format='PNG')
    page.locator('#files').set_input_files({'name':'camera.png','mimeType':'image/png','buffer':b.getvalue()})
    page.locator('[data-tab=world]').click()
    assert page.locator('#map-name').input_value()=='My measured gym','edited authored map was discarded'
    page.locator('#hero-sample').click()
    page.locator('#files').set_input_files({'name':'camera-2.png','mimeType':'image/png','buffer':b.getvalue()})
    assert page.locator('#provenance').inner_text()=='LOCAL SOURCE','the untouched sample is still replaced by a capture'
    assert not errors,errors;ctx.close()

if __name__=='__main__':
    with sync_playwright() as p:
        for name in os.environ.get('WORLD_BROWSERS','chromium').split(','):
            executable=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
            browser=getattr(p,name).launch(headless=True, **({'executable_path':executable} if name=='chromium' and executable else {}))
            check(browser,False);check(browser,True);check_measurements(browser);check_app_shell(browser);check_capture_keeps_user_map(browser)
            if os.environ.get('WORLD_SITE_URL'):check_routes(browser,os.environ['WORLD_SITE_URL'].rstrip('/'))
            if os.environ.get('WORLD_PHOTO'):check_inference(browser,os.environ['WORLD_PHOTO'])
            browser.close()
            print(name+': desktop and mobile smoke checks passed')
