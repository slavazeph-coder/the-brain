"""Records the scan-to-model demo: phone walkthrough -> dense CPU reconstruction -> every object separated and measured ->
robot route in the compiled scene -> IFC opened in a BIM parser.

usage: WORKER_URL=... WORKER_TOKEN=... ENGINE=colmap-dense-cpu record_scan2model.py <site-world-url> <walkthrough video> <ifc-viewer-url> <output.mp4> [--dry-run]
The worker URL and token are typed under a title card, so they never appear in the recording. Every number shown comes
from the real run; the distance typed in is illustrative and the closing card says so.
"""
import base64, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tests' / 'world'))
from realtosim_browser_smoke import SCROLL_SETTLED, VISIBLE_POINT_TARGETS

URL, VIDEO, VIEWER, OUT = sys.argv[1], sys.argv[2], sys.argv[3], Path(sys.argv[4])
RECORD = '--dry-run' not in sys.argv
LIVE = 'brainsnn.com' in URL
ROBOT = os.environ.get('ROBOT', 'vacuum')
METRES_PER_UNIT = .66  # illustrative: about a 4 x 8 m room for the Mip-NeRF 360 "room" walkthrough; not measured
WORKER, TOKEN = os.environ['WORKER_URL'], os.environ['WORKER_TOKEN']
HOST = WORKER.split('://', 1)[-1].split('/', 1)[0]
SIZE = {'width': 1600, 'height': 900}  # CSS pixels; at 1.2x this records 1920 x 1080
SCALE, VIDEO_SIZE = 1.2, (1920, 1080)
OVERLAY = (Path(__file__).parent / 'record_demo.py').read_text().split('OVERLAY = r"""', 1)[1].split('"""', 1)[0]
OVERLAY = OVERLAY.replace('#demo-card{position:fixed;', '#demo-card{pointer-events:none;position:fixed;').replace('#demo-caption{position:fixed;', '#demo-caption{pointer-events:none;user-select:none;position:fixed;')
assert 'pointer-events:none;position:fixed;inset:0' in OVERLAY and '#demo-caption{pointer-events:none' in OVERLAY
SEGMENTS, PHASES, START = [], [], []


def run(page):
    started = time.time()
    def say(html):
        PHASES.append((round(time.time() - started, 1), html))
        if RECORD: page.evaluate('h => window.__caption(h)', html)
    def speed(factor, note=''):
        SEGMENTS.append((time.time(), factor))
        if RECORD: page.evaluate('n => { const c = document.getElementById("demo-caption"); c.dataset.note = n; c.style.setProperty("--note", JSON.stringify(n)); }', note)
    # The demo cursor hides while a title card is up.
    card = (lambda html: page.evaluate('h => { window.__card(h); const c = document.getElementById("demo-cursor"); if (c) c.style.visibility = h ? "hidden" : ""; }', html)) if RECORD else (lambda html: None)
    hold = (lambda s: page.wait_for_timeout(int(s * 1000))) if RECORD else (lambda s: None)
    settle = lambda: page.evaluate(SCROLL_SETTLED)
    def glide(target, click=True):
        target.wait_for(state='visible', timeout=120_000)
        target.evaluate(f"el => {{ const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 110) el.scrollIntoView({{block: 'center', behavior: 'instant'}}); }}")
        settle(); box = None
        for _ in range(3):
            try: box = target.bounding_box(timeout=3000); break
            except Exception: hold(.3)
        if box: page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=22 if RECORD else 1)
        if click:
            hold(.25)
            if box: page.mouse.down(); hold(.08); page.mouse.up()
            else: target.click()
    def centre(selector):
        box = page.locator(selector).bounding_box(); top, bottom = max(box['y'], 0), min(box['y'] + box['height'], SIZE['height'] - 130)
        return box['x'] + box['width'] / 2, (top + bottom) / 2
    def orbit(selector, factor, sweep=220):
        cx, cy = centre(selector)
        speed(factor, f'sped up {factor}×'); page.mouse.move(cx - 140, cy, steps=4 if RECORD else 1); page.mouse.down()
        for dx in range(-140, sweep, 24): page.mouse.move(cx + dx, cy + dx * .06, steps=1)
        page.mouse.up(); hold(.4); speed(1)
    def zoom(selector, delta):
        cx, cy = centre(selector); page.mouse.move(cx, cy, steps=8 if RECORD else 1)
        for _ in range(6): page.mouse.wheel(0, delta / 6); hold(.07)
        hold(.5)
    def panel_open():
        panel = page.locator('.processing-options')
        if panel.get_attribute('open') is None: panel.locator('summary').click()
    def onscreen_clean():
        assert not page.evaluate('h => document.body.innerText.includes(h)', HOST), 'worker host visible on screen'

    page.goto(URL, wait_until='networkidle'); page.mouse.move(800, 450)
    START.append(time.time())  # frames before the title card (page load) are dropped
    card('<p>BRAINSNN · WORLD BUILDER · SCAN TO MODEL</p><h1>One phone walkthrough.<br><em>Every object separated and measured.</em></h1><p>Robot simulation · GLB, OpenUSD and IFC</p>'); hold(3.8); card('')
    say(('Live on <b>brainsnn.com</b>' if LIVE else 'World Builder') + ' · real reconstruction, nothing faked'); hold(2.4)

    say('<b>1</b> · Walk through the space with a phone, then upload the video')
    glide(page.locator('#hero-capture')); hold(.8)
    page.locator('#files').set_input_files(VIDEO); hold(2.6)

    card('<p>CONNECTING A PRIVATE PROCESSING WORKER</p><h1>Your capture goes only<br><em>where you approve it.</em></h1><p>operator credential · held in page memory</p>')
    page.evaluate("document.getElementById('connection').style.opacity = '0'")
    panel_open(); page.locator('[data-action=connection]').click()
    page.locator('#worker-url').fill(WORKER); page.locator('#worker-token').fill(TOKEN); page.locator('#connect').click()
    page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')", timeout=60_000)
    page.locator('#connection [aria-label=Close]').click(); page.evaluate("document.getElementById('connection').style.opacity = ''"); hold(2.2); card('')

    say('<b>2</b> · Dense 3D reconstruction on a CPU worker, only after explicit consent')
    panel_open(); page.locator('.processing-options').scroll_into_view_if_needed(); hold(.6)
    page.locator('#engine').select_option(os.environ.get('ENGINE', 'colmap-sparse')); hold(.8)
    glide(page.locator('#consent')); hold(.5); onscreen_clean()
    glide(page.locator('[data-action=process]')); hold(.5)
    # Wait on the workspace itself: the panel grows ~1000 px when the reconstruction loads, and under full CPU load Chrome
    # keeps compositing stale tiles of whatever was on screen at those coordinates (otherwise the section below).
    speed(1000); page.locator('#workspace').evaluate("el => el.scrollIntoView({block: 'start', behavior: 'instant'})"); settle(); hold(2.0)
    speed(60, 'upload + CPU reconstruction and depth · sped up 60×')
    page.wait_for_function("/Reconstruction loaded|failed/.test(document.querySelector('#status').textContent)", timeout=1_800_000)
    # Cut, not sped up: while the CPU reconstruction saturates the machine, Chrome composites stale tiles for a moment
    # as the panel re-renders, so the frames until the 3D view has settled are dropped.
    speed(1000)
    if 'Reconstruction loaded' not in page.locator('#status').inner_text(): raise SystemExit('reconstruction: ' + page.locator('#status').inner_text())
    page.locator('#visual-canvas').evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})"); settle(); hold(2.5)
    speed(1); say('<b>3</b> · Dense points: a depth model per frame, kept only where neighbouring frames agree'); hold(.8)
    zoom('#visual-canvas', -360); orbit('#visual-canvas', 3); hold(1.4)

    say('<b>4</b> · Measure one real distance, then tap both ends in 3D')
    if not page.locator('[data-action=pick-scale]').is_visible(): page.locator('[data-tab=capture]').click()
    glide(page.locator('[data-action=pick-scale]')); hold(.6)
    page.locator('#visual-canvas').evaluate(f"el => el.scrollIntoView({{block: 'center', behavior: 'instant'}})"); settle(); hold(.4)
    for side, done in (('left', "/other end/.test(document.querySelector('#status').textContent)"), ('right', "!!document.querySelector('#picked-span')")):
        for x, y in page.evaluate(VISIBLE_POINT_TARGETS)[side]:
            page.mouse.move(x, y, steps=18 if RECORD else 1); hold(.25); page.mouse.down(); hold(.08); page.mouse.up(); hold(.5)
            if page.evaluate(done): break
        assert page.evaluate(done), side
    span = float(page.locator('#picked-span').inner_text().split(':')[1].split()[0]); distance = f'{span * METRES_PER_UNIT:.2f}'
    field = page.locator('#measured-distance'); glide(field); field.fill('')
    if RECORD: field.press_sequentially(distance, delay=140)
    else: field.fill(distance)
    field.press('Tab'); hold(1.0)

    say('<b>5</b> · Compile the scene: walls, floor, and every object separated')
    glide(page.locator('#scene-consent')); hold(.4); onscreen_clean()
    if page.locator('#scene-naming').count():
        say('<b>5</b> · And, with a second approval, Claude names each object from the walkthrough frames')
        glide(page.locator('#scene-naming')); hold(1.2)
    glide(page.locator('[data-action=metric-scene]'))
    page.locator('#scene-dialog').wait_for(state='visible', timeout=60_000)
    # The scene dialog is modal (browser top layer), so the caption and cursor move inside it while it is open.
    page.evaluate("() => document.getElementById('scene-dialog').append(document.getElementById('demo-caption'), document.getElementById('demo-cursor'))")
    speed(25, 'Blender scene compile on the worker · sped up 25×')
    page.wait_for_function("/SHA-256 checked|failed/.test(document.querySelector('#scene-status')?.textContent || '') || /scene-usd: failed/.test(document.querySelector('#status').textContent)", timeout=1_200_000)
    speed(1)
    if 'SHA-256 checked' not in page.locator('#scene-status').inner_text(): raise SystemExit('scene: ' + page.locator('#scene-status').inner_text() + ' / ' + page.locator('#status').inner_text())
    say('<b>5</b> · Each object is its own element, measured in metres and named'); hold(1.2)
    zoom('#scene-stage', -420); orbit('#scene-stage', 2, sweep=260); hold(1.6)
    say(''); page.locator('#scene-facts').evaluate(f"el => el.scrollIntoView({{block: 'center', behavior: 'instant'}})"); hold(5.0)
    facts = page.locator('#scene-facts li').all_inner_texts()
    say('<b>6</b> · The compiled scene becomes the robot map: walls and objects are obstacles')
    plan = page.locator('#scene-plan'); glide(plan, click=False); hold(.8)
    page.evaluate("() => document.body.append(document.getElementById('demo-caption'), document.getElementById('demo-cursor'))")
    plan.click(); page.wait_for_function("/Map built from the simulation scene/.test(document.querySelector('#status').textContent)", timeout=60_000)
    mapped = page.locator('#status').inner_text()
    page.locator('#world-canvas').evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})"); settle(); hold(1.2)
    orbit('#world-canvas', 3); hold(1.0)
    say('<b>6</b> · A person reviews scale and obstacles before anything is simulated')
    glide(page.locator('#run')); hold(1.8)
    glide(page.locator('#scale-reviewed')); hold(.4); glide(page.locator('#map-reviewed')); hold(.8)
    say('<b>7</b> · Drop a robot into the real room and simulate its route')
    glide(page.locator('[data-tab=test]')); hold(.6)
    page.locator('#robot').select_option(ROBOT); hold(.8)
    glide(page.locator('#run'))
    page.wait_for_function("""() => { const s = document.querySelector('#status');
      return /Planning preview complete/.test(s.textContent) || (s.classList.contains('error') && !/Confirm independently/.test(s.textContent)); }""", timeout=60_000)
    route = page.locator('#status').inner_text()
    advice = re.search(r'fits is X ([\d.]+) m, Z ([\d.]+) m', route)
    if 'Planning preview complete' not in route and advice:
        # The planner names where this robot fits; a person moves the start there and reviews again.
        say('<b>7</b> · Blocked where the walk began, so the start moves to where the planner says it fits'); hold(2.4)
        if not page.locator('#start-x').is_visible(): page.locator('[data-tab=world]').click(); hold(.4)
        for field, value in (('#start-x', advice.group(1)), ('#start-z', advice.group(2))):
            box = page.locator(field); glide(box); box.fill('')
            if RECORD: box.press_sequentially(value, delay=110)
            else: box.fill(value)
            box.press('Tab'); hold(.4)
        for tick in ('#scale-reviewed', '#map-reviewed'):
            if not page.locator(tick).is_checked(): glide(page.locator(tick)); hold(.3)
        say('<b>7</b> · Drop a robot into the real room and simulate its route')
        glide(page.locator('[data-tab=test]')); hold(.4); glide(page.locator('#run'))
        page.wait_for_function("""() => { const s = document.querySelector('#status');
          return /Planning preview complete/.test(s.textContent) || s.classList.contains('error'); }""", timeout=60_000)
        route = page.locator('#status').inner_text()
    if 'Planning preview complete' not in route: print('ROUTE NOT PLANNED:', route[:300], flush=True)
    else:
        page.locator('#replay').scroll_into_view_if_needed(); hold(.6)
        speed(4, 'route replay · sped up 4×')
        glide(page.locator('#replay')); page.wait_for_function("document.querySelector('#replay').textContent.trim()!=='Pause'", timeout=180_000); speed(1)
        hold(1.4)
    metrics = {k: page.locator('#metric-' + k).inner_text() for k in ('area', 'distance', 'time')}

    say('<b>8</b> · Every file is downloadable, with its SHA-256 checked')
    glide(page.locator('[data-tab=evidence]')); hold(.8)
    ifc_button = page.locator('[data-artifact]', has_text='scene.ifc')
    page.locator('[data-artifact]', has_text='scene.glb').evaluate(f"el => el.scrollIntoView({{block: 'center', behavior: 'instant'}})"); settle(); hold(1.4)
    with page.expect_download() as download: glide(ifc_button)
    ifc = OUT.parent / 'scene.ifc'; download.value.save_as(ifc); hold(1.2); onscreen_clean()
    artifacts = page.locator('[data-artifact]').all_inner_texts()

    page.goto(VIEWER, wait_until='networkidle'); page.mouse.move(800, 450)
    say('<b>9</b> · Open scene.ifc in BIM tooling: here, the open-source web-ifc parser')
    page.locator('#file').set_input_files(str(ifc))
    page.wait_for_function('window.__ifc', timeout=60_000)
    if 'error' in page.evaluate('window.__ifc'): raise SystemExit('viewer: ' + json.dumps(page.evaluate('window.__ifc')))
    hold(1.6); orbit('#stage', 2, sweep=200); hold(.8)
    say('<b>9</b> · Every separated object is its own IFC element, with its name and dimensions')
    els = page.locator('.el')
    for i in [i for i in range(els.count()) if not re.search(r'wall|slab|unknown|floor', els.nth(i).inner_text(), re.I)][:3]:
        glide(els.nth(i)); hold(2.0)
    walls = page.locator('.el', has_text='wall')
    if walls.count(): glide(walls.first); hold(1.6)
    say('<b>9</b> · Metres, but self-reported: <b>MetricVerified false</b> until checked'); hold(3.0)
    viewer = page.evaluate('window.__ifc')
    say('')
    card('<p>BRAINSNN · WORLD BUILDER</p><h1>Scan it. Separate it.<br><em>Simulate it. Hand it to BIM.</em></h1><p>App and API · brainsnn.com</p>'); hold(3.6)
    card(f'<p>ABOUT THIS RUN</p><h1 style="font-size:30px;line-height:1.3">Test walkthrough: Mip-NeRF 360 “room” images <em>(Barron et al.)</em><br>'
         f'The {distance} m distance was typed for the demo; this room was not measured.<br>Names are Claude suggestions from the frames, not reviewed; touching objects stay one.</h1>'
         '<p>Dense points: a depth model on CPU, checked across frames (3.1 cm median error on ETH3D)<br>Scale self-reported, not verified · IFC viewer: web-ifc, not part of brainsnn.com</p>'); hold(6.0)
    return {'distance_m': distance, 'span_units': span, 'facts': facts, 'mapped': mapped, 'artifacts': artifacts, 'viewer': viewer, 'route': metrics}


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        launch = dict(headless=True, executable_path='/opt/pw-browsers/chromium', args=['--enable-unsafe-swiftshader'])
        if os.environ.get('HTTPS_PROXY'): launch['proxy'] = {'server': os.environ['HTTPS_PROXY'], 'bypass': '127.0.0.1,localhost'}
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(viewport=SIZE, device_scale_factor=SCALE, accept_downloads=True)
        ctx.add_init_script(OVERLAY)
        # Recording only: the site scrolls smoothly, and mid-scroll screencast frames composite stale tiles, so scroll instantly.
        ctx.add_init_script("addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html{scroll-behavior:auto!important}'; document.head.append(s); })")
        # Recording-only redaction: the consent text names the worker host (a product feature); blur that host on screen.
        ctx.add_init_script("""(host => { const blur = root => { const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const hits = []; while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(host) && !walker.currentNode.parentElement?.classList.contains('demo-redact')) hits.push(walker.currentNode);
          for (const node of hits) { const parts = node.nodeValue.split(host), frag = document.createDocumentFragment();
            parts.forEach((part, i) => { frag.append(part); if (i < parts.length - 1) { const s = document.createElement('span'); s.className = 'demo-redact'; s.textContent = 'private-worker.example';
              s.style.cssText = 'filter:blur(5px);user-select:none'; frag.append(s); } }); node.replaceWith(frag); } };
          const start = () => { blur(document.body); new MutationObserver(() => blur(document.body)).observe(document.body, {subtree: true, childList: true, characterData: true}); };
          if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start); else start(); })(%s)""" % json.dumps(HOST))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        raw = OUT.parent / 'frames'; shutil.rmtree(raw, ignore_errors=True); raw.mkdir(parents=True); frames = []
        if RECORD:
            cdp = ctx.new_cdp_session(page)
            def on_frame(event):
                path = raw / f'f{len(frames):06d}.jpg'; path.write_bytes(base64.b64decode(event['data']))
                frames.append((path, event['metadata']['timestamp'])); cdp.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})
            cdp.on('Page.screencastFrame', on_frame)
            cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 88, 'maxWidth': VIDEO_SIZE[0], 'maxHeight': VIDEO_SIZE[1], 'everyNthFrame': 1})
        started = time.time(); result = run(page); stopped = time.time()
        if RECORD: cdp.send('Page.stopScreencast')
        print(f'{"recorded" if RECORD else "dry run"} in {stopped - started:.0f}s, {len(frames)} frames; page errors: {errors}', flush=True)
        print(json.dumps(result, indent=1), flush=True)
        for at, html in PHASES: print(f'  {at:6.1f}s  {html[:90]}', flush=True)
        browser.close()
    if not RECORD: sys.exit(0)
    frames = [f for f in frames if f[1] >= START[0]] or frames[-1:]
    listing = raw / 'frames.txt'
    def factor(t):
        current = 1
        for when, f in SEGMENTS:
            if when <= t: current = f
        return current
    with listing.open('w') as out:
        for (path, t), (_, t_next) in zip(frames, frames[1:] + [(None, max(stopped, frames[-1][1] + 1 / 30))]):
            if factor(t) >= 1000: continue  # a cut segment
            out.write(f"file '{path}'\nduration {max((t_next - t) / factor(t), 1 / 120):.4f}\n")
        out.write(f"file '{frames[-1][0]}'\n")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing),
                    '-vf', f"scale={VIDEO_SIZE[0]}:{VIDEO_SIZE[1]}:force_original_aspect_ratio=decrease,pad={VIDEO_SIZE[0]}:{VIDEO_SIZE[1]}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', str(OUT)], check=True)
    print('wrote', OUT, f'{OUT.stat().st_size / 1e6:.1f} MB', flush=True)
