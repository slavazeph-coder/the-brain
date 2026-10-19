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
    page.locator('#replay').click();page.wait_for_timeout(180)
    assert int(page.locator('#scrub').input_value())>0
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

if __name__=='__main__':
    with sync_playwright() as p:
        for name in os.environ.get('WORLD_BROWSERS','chromium').split(','):
            executable=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
            browser=getattr(p,name).launch(headless=True, **({'executable_path':executable} if name=='chromium' and executable else {}))
            check(browser,False);check(browser,True)
            if os.environ.get('WORLD_SITE_URL'):check_routes(browser,os.environ['WORLD_SITE_URL'].rstrip('/'))
            if os.environ.get('WORLD_PHOTO'):check_inference(browser,os.environ['WORLD_PHOTO'])
            browser.close()
            print(name+': desktop and mobile smoke checks passed')
