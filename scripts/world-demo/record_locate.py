"""Records the visual-positioning demo: walkthrough -> CPU reconstruction -> proposed map -> a new photo placed in the
scan -> a tap on the floor in it -> the simulated robot routes there; then a second photo from elsewhere lands in the
same map.

usage: WORKER_URL=... WORKER_TOKEN=... PHOTOS=first.jpg,second.jpg TAPS='0.62,0.71;0.55,0.8|0.4,0.75' [SHORT=1] \\
       record_locate.py <site-world-url> <walkthrough video> <output.mp4> [--dry-run]
SHORT=1 makes the feed cut (under a minute with one photo): shorter holds, a faster reconstruction, one closing card.
When the worker estimated the scan's metric scale, the video shows that step and says it is estimated, not measured.
TAPS lists candidate tap points per photo (fractions of the photo's width and height), photos separated by |. They are
tried in order; a tap the planner refuses is cut from the video, and the closing card says the points were chosen on
open floor. The worker URL and token are typed under a title card, so they never appear in the recording. Every number
on screen comes from the run.
"""
import base64, hashlib, html, json, os, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tests' / 'world'))
from realtosim_browser_smoke import SCROLL_SETTLED

URL, VIDEO, OUT = sys.argv[1], sys.argv[2], Path(sys.argv[3]).resolve()
RECORD = '--dry-run' not in sys.argv
WORKER, TOKEN = os.environ['WORKER_URL'], os.environ['WORKER_TOKEN']
HOST = WORKER.split('://', 1)[-1].split('/', 1)[0]
PHOTOS = [Path(p) for p in os.environ['PHOTOS'].split(',')]
TAPS = [[tuple(float(v) for v in point.split(',')) for point in group.split(';')] for group in os.environ.get('TAPS', '').split('|')] if os.environ.get('TAPS') else [[(.5, .8)]] * len(PHOTOS)
ROBOT = os.environ.get('ROBOT', 'vacuum')
CAPTURE_CREDIT = os.environ.get('CAPTURE_CREDIT', 'Mip-NeRF 360 “garden” photographs (Barron et al.), encoded as a test walkthrough; the located photos are other photographs from the same set, not frames of the video. Not a physical phone capture.').strip()
if not CAPTURE_CREDIT or len(CAPTURE_CREDIT) > 600 or len(TAPS) != len(PHOTOS):
    raise SystemExit('CAPTURE_CREDIT must be 1 to 600 characters, and TAPS needs one group per photo.')
SHORT = os.environ.get('SHORT') == '1'
SIZE, SCALE, VIDEO_SIZE = {'width': 1600, 'height': 900}, 1.2, (1920, 1080)
OVERLAY = (Path(__file__).parent / 'record_demo.py').read_text().split('OVERLAY = r"""', 1)[1].split('"""', 1)[0]
OVERLAY = OVERLAY.replace('#demo-card{position:fixed;', '#demo-card{pointer-events:none;position:fixed;').replace('#demo-caption{position:fixed;', '#demo-caption{pointer-events:none;user-select:none;position:fixed;')
SEGMENTS, PHASES, START = [], [], []


def file_sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(page):
    started, step = time.time(), [0]
    def n():
        step[0] += 1
        return step[0]
    pace = .7 if SHORT else 1
    def say(text):
        PHASES.append((round(time.time() - started, 1), text, time.time()))
        if RECORD: page.evaluate('h => window.__caption(h)', text)
    def speed(factor, note=''):
        SEGMENTS.append((time.time(), factor))
        if RECORD: page.evaluate('n => { const c = document.getElementById("demo-caption"); c.dataset.note = n; c.style.setProperty("--note", JSON.stringify(n)); }', note)
    card = (lambda text: page.evaluate('h => { window.__card(h); const c = document.getElementById("demo-cursor"); if (c) c.style.visibility = h ? "hidden" : ""; }', text)) if RECORD else (lambda text: None)
    hold = (lambda s: page.wait_for_timeout(int(s * pace * 1000))) if RECORD else (lambda s: None)
    settle = lambda: page.evaluate(SCROLL_SETTLED)
    def into_view(selector, block='center'):
        page.locator(selector).evaluate(f"el => el.scrollIntoView({{block: '{block}', behavior: 'instant'}})"); settle()
    def glide(target, click=True):
        target.wait_for(state='visible', timeout=120_000)
        target.evaluate("el => { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 110) el.scrollIntoView({block: 'center', behavior: 'instant'}); }")
        settle(); box = target.bounding_box(timeout=5000)
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=22 if RECORD else 1)
        if click: hold(.25); page.mouse.down(); hold(.08); page.mouse.up()
    def status():
        return page.locator('#status').inner_text()
    def wait_status(pattern, timeout):
        page.wait_for_function(f"/{pattern}/.test(document.querySelector('#status').textContent) || document.querySelector('#status').classList.contains('error')", timeout=timeout)
        return status()
    def onscreen_clean():
        assert not page.evaluate('h => document.body.innerText.includes(h)', HOST), 'worker host visible on screen'
    def locate(photo, first):
        button = page.locator('[data-action=locate-photo]')
        glide(button, click=False); hold(.5)
        page.locator('#locate-file').set_input_files(str(photo))  # the button opens this picker; headless sets it directly
        speed(6, 'sped up 6×')
        placed = wait_status('Placed in the scan|Not placed|failed|could not', 300_000); speed(1)
        if not placed.startswith('Placed in the scan'): raise SystemExit('photo not placed: ' + placed)
        agree = re.match(r'Placed in the scan: (\d+) of (\d+) matched points agree, ([\d.]+) px', placed)
        say(f'<b>{n()}</b> · Found where it was taken: <b>{agree.group(1)}</b> of {agree.group(2)} matched points agree')
        into_view('#world-canvas'); hold(3.2)
        return {'photo': photo.name, 'sha256': file_sha256(photo), 'agree': int(agree.group(1)), 'matched': int(agree.group(2)), 'reprojection_px': float(agree.group(3))}
    def tap(candidates, first):
        say(f'<b>{n()}</b> · Tap the floor in the photo: the robot routes there')
        into_view('#located-photo'); box = page.locator('#located-photo img').bounding_box()
        point = lambda fx, fy: (box['x'] + box['width'] * fx, box['y'] + box['height'] * fy)
        page.mouse.move(*point(*candidates[0]), steps=22 if RECORD else 1); hold(.6)
        for index, (fx, fy) in enumerate(candidates):
            if index: speed(1000)  # a refused tap is cut from the video
            page.mouse.move(*point(fx, fy)); page.mouse.down(); hold(.08); page.mouse.up(); hold(.3)
            routed = status()
            if routed.startswith('Route to the spot'):
                if index: speed(1)
                break
        else:
            raise SystemExit('no candidate tap reached open floor: ' + routed)
        hold(1.2); into_view('#world-canvas')
        if first:  # zoom the map in once, around its centre, so the route reads at video size
            box = page.locator('#world-canvas').bounding_box(); page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=12 if RECORD else 1)
            for _ in range(5): page.mouse.wheel(0, -90); hold(.06)
        speed(3, 'route replay · sped up 3×')
        page.wait_for_function("document.querySelector('#replay').textContent.trim()!=='Pause'", timeout=120_000); speed(1); hold(1.6)
        metres = re.match(r'Route to the spot you tapped: ([\d.]+) m, about (\d+) min', routed)
        return {'tap': [fx, fy], 'route_m': float(metres.group(1)), 'minutes': int(metres.group(2)), 'status': routed}

    page.goto(URL, wait_until='networkidle'); page.mouse.move(800, 450)
    START.append(time.time())  # frames before the title card (page load) are dropped
    card('<p>BRAINSNN · WORLD BUILDER</p><h1>Film a walkthrough.<br><em>Get a robot map in metres.</em></h1><p>Scale estimated by a depth model · any photo finds where it was taken · the robot routes there</p>' if SHORT else
         '<p>BRAINSNN · WORLD BUILDER · VISUAL POSITIONING</p><h1>Scan a place once.<br><em>Any photo finds where it was taken.</em></h1><p>Then tap the floor in it, and the robot routes there</p>'); hold(3.6)
    card('<p>CONNECTING AN OPERATOR CPU WORKER</p><h1>Private worker<br><em>token typed off screen</em></h1>')
    page.locator('#hero-capture').click(); page.locator('#files').set_input_files(VIDEO)
    panel = page.locator('.processing-options')
    def open_panel():  # the capture panel re-renders as the file and the site's processing status load, closing it
        page.wait_for_load_state('networkidle'); page.wait_for_timeout(500)
        if panel.get_attribute('open') is None: panel.locator('summary').click()
    open_panel()
    page.locator('[data-action=connection]').click()
    page.locator('#worker-url').fill(WORKER); page.locator('#worker-token').fill(TOKEN); page.locator('#connect').click()
    page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')", timeout=60_000)
    page.locator('#connection [aria-label=Close]').click(); hold(1.2); card('')
    say(f'<b>{n()}</b> · Upload a walkthrough of the place')
    open_panel()
    into_view('.processing-options'); hold(.6)
    page.locator('#engine').select_option('colmap-sparse'); hold(.6)
    glide(page.locator('#consent')); onscreen_clean(); hold(.4)
    glide(page.locator('[data-action=process]'))
    say(f'<b>{n()}</b> · The worker rebuilds it in 3D on CPU, and estimates its real scale'); into_view('#workspace', 'start')
    speed(60 if SHORT else 30, f'sped up {60 if SHORT else 30}×')
    loaded = wait_status('Reconstruction loaded|failed|contradicts', 1_800_000); speed(1)
    if 'Reconstruction loaded' not in loaded: raise SystemExit('reconstruction: ' + loaded)
    into_view('#visual-canvas'); hold(3.0)
    if not page.locator('[data-action=propose-map]').is_visible(): page.locator('[data-tab=capture]').click()
    chip = page.locator('.scale-chip')
    estimated = chip.count() > 0
    if estimated:
        unit = re.search(r'1 unit ≈ ([\d.]+) m', chip.inner_text()).group(1)
        say(f'<b>{n()}</b> · Real scale estimated by a depth model: 1 unit ≈ <b>{unit} m</b> · not measured')
        into_view('.proposal-card'); hold(3.2)
    say(f'<b>{n()}</b> · {"One click: the robot map. Review it." if estimated else "Propose a planning map from it, then review it"}')
    glide(page.locator('[data-action=propose-map]'))
    proposed = wait_status('Map proposed|could not', 30_000)
    into_view('#world-canvas'); hold(2.4)
    glide(page.locator('#scale-reviewed')); hold(.3); glide(page.locator('#map-reviewed')); hold(.6)
    say(f'<b>{n()}</b> · Take a new photo anywhere in the place')
    glide(page.locator('[data-tab=test]')); page.locator('#robot').select_option(ROBOT); hold(.6)
    runs = []
    for index, (photo, candidates) in enumerate(zip(PHOTOS, TAPS)):
        if index:
            say(f'<b>{n()}</b> · Another photo from somewhere else lands in the same map')
        runs.append({**locate(photo, not index), **tap(candidates, not index)})
    say('')
    scale_note = (f'Scale estimated by MoGe-2 metric depth (1 unit ≈ {unit} m), not measured: on three laser-measured ETH3D scenes it read 6–16% high.'
                  if estimated else 'Scale assumed from a 1.35 m camera height, not measured.')
    about = (f'{html.escape(CAPTURE_CREDIT)}<br>{scale_note} The robot is simulated on the reviewed map; nothing moved. '
             'Tap points were chosen on open floor.')
    if SHORT:
        card(f'<p>BRAINSNN · WORLD BUILDER · APP AND API</p><h1>Walkthrough in.<br><em>Robot map in metres out.</em></h1>'
             f'<p style="max-width:1100px;margin:18px auto 0;line-height:1.45">{about}</p>'); hold(9)
    else:
        card('<p>BRAINSNN · WORLD BUILDER</p><h1>Scan once.<br><em>Every photo finds its place.</em></h1><p>Visual positioning · robot routes · app and API</p>'); hold(3.6)
        card(f'<p>ABOUT THIS RUN</p><h1 style="font-size:28px;line-height:1.35">{about}</h1><p>Measured on ETH3D office: 6 of 14 new photos placed, '
             'median 1.3 cm from the true camera (worst 11.1 cm); the other 8 were refused, none misplaced · COLMAP SIFT and PnP on CPU</p>'); hold(6.5)
    return {'capture_credit': CAPTURE_CREDIT, 'source_video': {'name': Path(VIDEO).name, 'size': Path(VIDEO).stat().st_size, 'sha256': file_sha256(VIDEO)},
            'robot': ROBOT, 'proposed': proposed, 'scale': {'estimated': estimated, 'metres_per_unit_shown': unit if estimated else None}, 'photos': runs}


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw = OUT.parent / (OUT.stem + '-frames')
    if RECORD and (OUT.exists() or raw.exists()):
        raise SystemExit('Choose a fresh recording output and frame directory; existing media will not be overwritten.')
    with sync_playwright() as p:
        launch = dict(headless=True, args=['--enable-unsafe-swiftshader'])
        executable = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
        if executable: launch['executable_path'] = executable
        elif Path('/opt/pw-browsers/chromium').is_file(): launch['executable_path'] = '/opt/pw-browsers/chromium'
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(viewport=SIZE, device_scale_factor=SCALE)
        ctx.add_init_script(OVERLAY)
        ctx.add_init_script("addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html{scroll-behavior:auto!important}'; document.head.append(s); })")
        # Recording-only redaction: the consent text names the worker host (a product feature); blur that host on screen.
        if HOST: ctx.add_init_script("""(host => { const blur = root => { const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const hits = []; while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(host) && !walker.currentNode.parentElement?.classList.contains('demo-redact')) hits.push(walker.currentNode);
          for (const node of hits) { const parts = node.nodeValue.split(host), frag = document.createDocumentFragment();
            parts.forEach((part, i) => { frag.append(part); if (i < parts.length - 1) { const s = document.createElement('span'); s.className = 'demo-redact'; s.textContent = 'private-worker.example';
              s.style.cssText = 'filter:blur(5px);user-select:none'; frag.append(s); } }); node.replaceWith(frag); } };
          const start = () => { blur(document.body); new MutationObserver(() => blur(document.body)).observe(document.body, {subtree: true, childList: true, characterData: true}); };
          if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start); else start(); })(%s)""" % json.dumps(HOST))
        page = ctx.new_page(); errors = []; page.on('pageerror', lambda e: errors.append(str(e))); page.on('dialog', lambda d: d.accept())
        frames = []
        if RECORD:
            raw.mkdir(parents=True)
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
    (OUT.with_suffix('.proof.json')).write_text(json.dumps({**result, 'video': OUT.name, 'video_sha256': file_sha256(OUT)}, indent=1))
    print('wrote', OUT, f'{OUT.stat().st_size / 1e6:.1f} MB', flush=True)
