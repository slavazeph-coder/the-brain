"""Records the metric photo preview: one photo -> the worker's photo-metric engine -> a 3D point preview in estimated
metres, orbited in the browser, with an honest closing card.

usage: WORKER_URL=... WORKER_TOKEN=... [PHOTO_CREDIT=...] record_photo_metric.py <site-world-url> <photo> <output.mp4> [--dry-run]
The worker URL and token are typed under a title card and the worker host is blurred, so neither appears in the video.
Every number on screen comes from the run (the depth range is read from the site's own status line).
"""
import base64, hashlib, html, json, os, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL, PHOTO, OUT = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]).resolve()
RECORD = '--dry-run' not in sys.argv
WORKER, TOKEN = os.environ['WORKER_URL'], os.environ['WORKER_TOKEN']
HOST = WORKER.split('://', 1)[-1].split('/', 1)[0]
PHOTO_CREDIT = os.environ.get('PHOTO_CREDIT', 'Photo from the Mip-NeRF 360 “room” set (Barron et al.), not a phone capture.').strip()
if not PHOTO_CREDIT or len(PHOTO_CREDIT) > 400:
    raise SystemExit('PHOTO_CREDIT must be 1 to 400 characters.')
SIZE, SCALE, VIDEO_SIZE = {'width': 1600, 'height': 900}, 1.2, (1920, 1080)
OVERLAY = (Path(__file__).parent / 'record_demo.py').read_text().split('OVERLAY = r"""', 1)[1].split('"""', 1)[0]
OVERLAY = OVERLAY.replace('#demo-card{position:fixed;', '#demo-card{pointer-events:none;position:fixed;').replace('#demo-caption{position:fixed;', '#demo-caption{pointer-events:none;user-select:none;position:fixed;')
SEGMENTS, START = [], []


def file_sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(page):
    say = (lambda text: page.evaluate('h => window.__caption(h)', text)) if RECORD else (lambda text: None)
    def speed(factor, note=''):
        SEGMENTS.append((time.time(), factor))
        if RECORD: page.evaluate('n => { const c = document.getElementById("demo-caption"); c.dataset.note = n; c.style.setProperty("--note", JSON.stringify(n)); }', note)
    card = (lambda text: page.evaluate('h => { window.__card(h); const c = document.getElementById("demo-cursor"); if (c) c.style.visibility = h ? "hidden" : ""; }', text)) if RECORD else (lambda text: None)
    hold = (lambda s: page.wait_for_timeout(int(s * 1000))) if RECORD else (lambda s: None)
    def glide(target, click=True):
        target.wait_for(state='visible', timeout=60_000)
        target.evaluate("el => { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 110) el.scrollIntoView({block: 'center', behavior: 'instant'}); }")
        box = target.bounding_box(timeout=5000)
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=22 if RECORD else 1)
        if click: hold(.25); page.mouse.down(); hold(.08); page.mouse.up()
    def timelapse(action, seconds):
        """Software WebGL in a headless browser draws a 120,000-point frame in about a second and a half, so a hand orbit
        takes minutes. It is played back in `seconds` and the caption says it is sped up; the factor goes in the proof."""
        start = time.time(); index = len(SEGMENTS); SEGMENTS.append((start, 1))
        if RECORD: page.evaluate('n => { const c = document.getElementById("demo-caption"); c.dataset.note = n; c.style.setProperty("--note", JSON.stringify(n)); }', 'sped up · software rendering in a headless browser')
        action(); factor = max(1.0, (time.time() - start) / seconds); SEGMENTS[index] = (start, factor); speed(1)
        return round(factor, 1)
    def open_options():  # the capture panel re-renders as files and the worker connection load, closing it
        page.wait_for_load_state('networkidle'); page.wait_for_timeout(400)
        page.evaluate("document.querySelector('.processing-options').open=true")

    page.goto(URL, wait_until='networkidle'); page.mouse.move(800, 450)
    START.append(time.time())
    card('<p>BRAINSNN · WORLD BUILDER</p><h1>One photo.<br><em>A 3D preview in metres.</em></h1><p>Estimated by a depth model · not measured · nothing invented behind the photo</p>'); hold(3.4)
    card('<p>CONNECTING AN OPERATOR CPU WORKER</p><h1>Private worker<br><em>token typed off screen</em></h1>')
    page.locator('#hero-capture').click(); page.locator('#files').set_input_files(str(PHOTO))
    page.wait_for_function("document.querySelectorAll('.source-row').length===1")
    open_options(); page.locator('[data-action=connection]').click()
    page.locator('#worker-url').fill(WORKER); page.locator('#worker-token').fill(TOKEN); page.locator('#connect').click()
    page.wait_for_function("document.querySelector('#connection-status').textContent.startsWith('Connected.')", timeout=60_000)
    page.locator('#connection [aria-label=Close]').click(); open_options()
    engine = page.locator('#engine').input_value()
    if engine != 'photo-metric': raise SystemExit('the metric photo preview was not preselected: ' + engine)
    page.locator('#workspace').evaluate("el => el.scrollIntoView({block: 'start', behavior: 'instant'})"); hold(.6); card('')
    page.locator('#viewport').evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})"); hold(.4)
    say('<b>1</b> · Add one photo of a place'); hold(2.6)
    say('<b>2</b> · Send it to the worker: the metric preview is already selected')
    page.locator('#engine').evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})"); hold(1.4)
    assert not page.evaluate('h => document.body.innerText.includes(h)', HOST), 'worker host visible on screen'
    glide(page.locator('#consent')); hold(.3); glide(page.locator('[data-action=process]'))
    page.locator('#viewport').evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})")
    started = time.time(); speed(4, 'sped up 4×')
    page.wait_for_function("/3D preview of your photo in estimated metres|failed|could not/.test(document.querySelector('#status').textContent)", timeout=300_000)
    speed(1); seconds = round(time.time() - started)
    status = page.locator('#status').inner_text()
    found = re.search(r'most of it ([\d.]+)–([\d.]+) m from the camera', status)
    if not found: raise SystemExit('preview did not open: ' + status)
    near, far = (round(float(v), 1) for v in found.groups())
    canvas = page.locator('#visual-canvas'); canvas.evaluate("el => el.scrollIntoView({block: 'center', behavior: 'instant'})")
    box = canvas.bounding_box(); cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(cx, cy, steps=1)
    def zoom():
        for _ in range(5): page.mouse.wheel(0, -100); page.wait_for_timeout(120)
    factors = [timelapse(zoom, 1.2)]
    say(f'<b>3</b> · In {seconds} s: a 3D preview in estimated metres, most of it <b>{near}–{far} m</b> from the camera'); hold(3)
    def orbit(path):
        page.mouse.down()
        for x, y in path: page.mouse.move(x, y, steps=1)
        page.mouse.up()
    factors.append(timelapse(lambda: orbit([(cx - 4 * k, cy + .8 * k) for k in range(50)]), 3.5))
    say('<b>4</b> · Look around it. Only what the photo shows: hidden surfaces stay empty')
    factors.append(timelapse(lambda: orbit([(cx - 200 + 7 * k, cy + 40 - 1.2 * k) for k in range(60)]), 4.5))
    hold(2.4)
    say('<b>5</b> · For a robot map, walk the space: the worker reconstructs it and estimates its scale'); hold(3.2)
    say('')
    card(f'<p>BRAINSNN · WORLD BUILDER · APP AND API</p><h1>One photo in.<br><em>3D in metres out.</em></h1>'
         f'<p style="max-width:1150px;margin:18px auto 0;line-height:1.45">{html.escape(PHOTO_CREDIT)} Depth by MoGe-2 (MIT), estimated, not measured: '
         'over 18 ETH3D photos with laser-measured truth it was off by a median 7.9% (worst 27%). Not generative: nothing is invented behind the photo. '
         'A preview, not a collision map.</p>'); hold(8)
    return {'photo': {'name': PHOTO.name, 'size': PHOTO.stat().st_size, 'sha256': file_sha256(PHOTO), 'credit': PHOTO_CREDIT},
            'engine': engine, 'seconds_to_preview': seconds, 'depth_shown_m': [near, far], 'status': status,
            'orbit_speedups': factors}


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
            out.write(f"file '{path}'\nduration {max((t_next - t) / factor(t), 1 / 120):.4f}\n")
        out.write(f"file '{frames[-1][0]}'\n")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing),
                    '-vf', f"scale={VIDEO_SIZE[0]}:{VIDEO_SIZE[1]}:force_original_aspect_ratio=decrease,pad={VIDEO_SIZE[0]}:{VIDEO_SIZE[1]}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', str(OUT)], check=True)
    (OUT.with_suffix('.proof.json')).write_text(json.dumps({**result, 'video': OUT.name, 'video_sha256': file_sha256(OUT)}, indent=1))
    print('wrote', OUT, f'{OUT.stat().st_size / 1e6:.1f} MB', flush=True)
