"""Records a captioned World Builder demo (1280x720) with a warm model cache, then converts it to MP4.

usage: record_demo.py <site-world-url> <room-photo> <output.mp4> [--no-warmup]
"""
import base64, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

# Absolute, so the ffmpeg concat manifest (resolved against its own folder) finds the frames for any output path.
URL, PHOTO, OUT = sys.argv[1], sys.argv[2], Path(sys.argv[3]).resolve()
WARMUP = '--no-warmup' not in sys.argv
PROFILE = Path(OUT.parent / 'chromium-profile')
SIZE = {'width': 1280, 'height': 720}

OVERLAY = r"""
(() => {
  const css = `#demo-caption{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;max-width:86%;
    padding:14px 26px;border-radius:14px;background:rgba(6,6,10,.86);border:1px solid rgba(0,245,255,.55);color:#f1f1f6;
    font:600 24px/1.3 Inter,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;box-shadow:0 12px 40px #000a;transition:opacity .35s}
    #demo-caption b{color:#00f5ff;font-weight:700}
    #demo-caption[data-note]:not([data-note=""])::after{content:var(--note);display:block;margin-top:6px;font:500 13px/1 'JetBrains Mono',ui-monospace,monospace;color:#9aa0b4;letter-spacing:.06em}
    #demo-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;pointer-events:none;
    background:rgba(0,245,255,.35);border:2px solid #00f5ff;box-shadow:0 0 18px #00f5ff99;transition:transform .12s}
    #demo-cursor.down{transform:scale(.7);background:rgba(0,245,255,.7)}
    #demo-card{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
    background:radial-gradient(ellipse at 50% 55%,#101222,#06060a 72%);color:#f1f1f6;font-family:Inter,system-ui,sans-serif;text-align:center}
    #demo-card h1{font-size:54px;line-height:1.08;letter-spacing:-.045em;margin:0;font-weight:600}#demo-card h1 em{font-style:normal;color:#00f5ff}
    #demo-card p{font:500 20px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#9aa0b4;margin:0;letter-spacing:.06em}`;
  const install = () => {
    if (document.getElementById('demo-caption')) return;
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const caption = document.createElement('div'); caption.id = 'demo-caption'; caption.style.opacity = 0; document.body.append(caption);
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; document.body.append(cursor);
    addEventListener('mousemove', e => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => cursor.classList.add('down'), true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);
    window.__caption = html => { caption.innerHTML = html; caption.style.opacity = html ? 1 : 0; };
    window.__card = html => { let c = document.getElementById('demo-card'); if (!html) { c?.remove(); return; }
      if (!c) { c = document.createElement('div'); c.id = 'demo-card'; document.body.append(c); } c.innerHTML = html; };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
})();
"""


def launch(playwright, record):
    options = dict(headless=True, executable_path='/opt/pw-browsers/chromium', viewport=SIZE, device_scale_factor=1,
                   accept_downloads=True, args=['--autoplay-policy=no-user-gesture-required'])
    if os.environ.get('HTTPS_PROXY'):
        options['proxy'] = {'server': os.environ['HTTPS_PROXY'], 'bypass': '127.0.0.1,localhost'}
    return playwright.chromium.launch_persistent_context(str(PROFILE), **options)


SEGMENTS = []  # (wall time, speed factor)
PHASES = []


def run(page, record):
    started = time.time()
    def say(html):
        PHASES.append((round(time.time() - started, 1), html))
        if record: page.evaluate('h => window.__caption(h)', html)
    def speed(factor, note=''):
        SEGMENTS.append((time.time(), factor))
        if record: page.evaluate('n => { const c = document.getElementById("demo-caption"); c.dataset.note = n; c.style.setProperty("--note", JSON.stringify(n)); }', note)
    card = (lambda html: page.evaluate('h => window.__card(h)', html)) if record else (lambda html: None)
    hold = (lambda seconds: page.wait_for_timeout(int(seconds * 1000))) if record else (lambda seconds: None)
    position = [640, 360]

    def settle():
        page.evaluate("""() => new Promise(resolve => { let last = -1, still = 0;
          const tick = () => { still = scrollY === last ? still + 1 : 0; last = scrollY; if (still >= 6) resolve(); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick); })""")

    def glide(target, click=True, steps=22):
        target.wait_for(state='visible', timeout=60_000)
        target.evaluate("el => { const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 110) el.scrollIntoView({block: 'center', behavior: record ? 'smooth' : 'instant'}); }".replace('record', 'true' if record else 'false'))
        settle()
        box = target.bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.mouse.move(x, y, steps=steps if record else 1); position[:] = [x, y]
        if click:
            hold(.25); page.mouse.down(); hold(.08); page.mouse.up()

    page.goto(URL, wait_until='networkidle')
    page.wait_for_function("document.querySelectorAll('.system-card').length===23")
    page.mouse.move(*position)
    card('<p>BRAINSNN · WORLD BUILDER</p><h1>Turn any photo into a world.<br><em>Turn any world into a robot simulation.</em></h1><p>brainsnn.com</p>')
    hold(3.2); card('')
    say('Live on <b>brainsnn.com</b> — no app install, nothing uploaded'); hold(2.6)

    # 1. One photo -> explorable 3D preview, on the device.
    glide(page.locator('#hero-capture')); hold(1.2)
    say('<b>1</b> · Start with one photo of a real space'); hold(.6)
    page.locator('#files').set_input_files(PHOTO); hold(1.8)
    say('<b>2</b> · On-device AI turns it into an explorable 3D world')
    glide(page.locator('[data-action=depth]')); hold(.6)
    glide(page.locator('#depth-start'))
    page.wait_for_function("document.querySelector('#scene-basis').textContent.includes('GENERATIVE VISUAL PREVIEW')", timeout=300_000)
    hold(1.0)
    canvas = page.locator('#visual-canvas').bounding_box()
    cx, cy = canvas['x'] + canvas['width'] / 2, canvas['y'] + canvas['height'] / 2
    speed(8, 'sped up 8×')
    page.mouse.move(cx - 120, cy, steps=4 if record else 1); page.mouse.down()
    for dx in range(-120, 200, 32):
        page.mouse.move(cx + dx, cy + dx * .12, steps=1)
    page.mouse.up(); hold(.5); speed(1)
    hold(1.2)
    say('Relative depth preview — labelled as such, never passed off as measured'); hold(2.2)

    # 2. Identify objects, reviewed by a person.
    say('<b>3</b> · Identify objects — every label waits for your review')
    glide(page.locator('[data-tab=capture]')); hold(.4)
    glide(page.locator('[data-action=detect]')); hold(.6)
    glide(page.locator('#detect-start'))
    page.wait_for_function("/proposed on this device/.test(document.querySelector('#status').textContent)", timeout=300_000)
    hold(.6)
    first = page.locator('.observation-card').first
    page.locator('.observation-group').first.scroll_into_view_if_needed(); hold(1.4)
    glide(first.get_by_role('button', name='Show proposed bounds')); hold(1.8)
    glide(first.get_by_role('button', name='Accept / save edit')); hold(1.6)

    # 3. World -> robot simulation.
    page.evaluate('scrollTo({top: 0, behavior: "instant"})'); hold(.4)
    say('<b>4</b> · Turn the world into a robot simulation')
    page.on('dialog', lambda dialog: dialog.accept())
    glide(page.locator('#hero-sample')); hold(2.4)
    world = page.locator('#world-canvas').bounding_box()
    wx, wy = world['x'] + world['width'] / 2, world['y'] + world['height'] / 2
    speed(4, 'sped up 4×')
    page.mouse.move(wx - 100, wy, steps=4 if record else 1); page.mouse.down()
    for dx in range(-100, 140, 30):
        page.mouse.move(wx + dx, wy, steps=1)
    page.mouse.up(); hold(.5); speed(1)
    hold(.6)
    say('<b>5</b> · Choose a robot, simulate the route, estimate time and cost')
    glide(page.locator('[data-tab=test]')); hold(.6)
    page.locator('#robot').select_option(index=1); hold(.8)
    glide(page.locator('#run'))
    page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')", timeout=30_000)
    glide(page.locator('[data-tab=test]'), click=True); hold(.4)
    page.locator('#robotRate').fill('40'); page.locator('#robotRate').press('Tab'); hold(.3)
    page.locator('#labourRate').fill('28'); page.locator('#labourRate').press('Tab')
    page.wait_for_function("document.querySelector('#metric-cost').textContent.startsWith('C$')", timeout=10_000)
    page.locator('#replay').scroll_into_view_if_needed()
    speed(3, 'route replay · sped up 3×')
    glide(page.locator('#replay')); page.wait_for_function("document.querySelector('#replay').textContent.trim()!=='Pause'", timeout=120_000); speed(1)
    hold(1.5)

    # 4. Evidence.
    say('<b>6</b> · Export a proof pack — reviews, assumptions and route, hashed')
    glide(page.locator('[data-tab=evidence]')); hold(.6)
    with page.expect_download():
        glide(page.locator('[data-action=proof]'))
    hold(2.4); say('')
    card('<p>BRAINSNN · WORLD BUILDER</p><h1>Scan it. Understand it.<br><em>Simulate the robot.</em></h1><p>App and API · brainsnn.com</p>')
    hold(3.6)


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        if WARMUP:  # Downloads and caches both models without recording.
            ctx = launch(playwright, record=False); page = ctx.pages[0] if ctx.pages else ctx.new_page()
            started = time.time(); run(page, record=False); ctx.close()
            print(f'warm-up done in {time.time() - started:.0f}s', flush=True)
        raw = OUT.parent / 'frames'
        shutil.rmtree(raw, ignore_errors=True); raw.mkdir(parents=True)
        ctx = launch(playwright, record=True)
        ctx.add_init_script(OVERLAY)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
        # DevTools screencast: a timestamped JPEG whenever the screen changes; acknowledged so frames keep flowing.
        cdp = ctx.new_cdp_session(page); frames = []
        def on_frame(event):
            path = raw / f'f{len(frames):06d}.jpg'; path.write_bytes(base64.b64decode(event['data']))
            frames.append((path, event['metadata']['timestamp']))
            cdp.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})
        cdp.on('Page.screencastFrame', on_frame)
        cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 88, 'maxWidth': SIZE['width'], 'maxHeight': SIZE['height'], 'everyNthFrame': 1})
        started = time.time(); run(page, record=True)
        cdp.send('Page.stopScreencast'); ctx.close()
        print(f'recorded in {time.time() - started:.0f}s, {len(frames)} frames; page errors: {errors}', flush=True)
        for at, html in PHASES: print(f'  {at:6.1f}s  {html[:70]}', flush=True)
    # Rebuild real timing: each frame lasts until the next one arrives.
    listing = raw / 'frames.txt'
    def factor(t):
        current = 1
        for when, f in SEGMENTS:
            if when <= t: current = f
        return current
    with listing.open('w') as out:
        for (path, t), (_, t_next) in zip(frames, frames[1:] + [(None, frames[-1][1] + 1 / 30)]):
            out.write(f"file '{path}'\nduration {max((t_next - t) / factor(t), 1 / 120):.4f}\n")
        out.write(f"file '{frames[-1][0]}'\n")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing),
                    '-vf', f"scale={SIZE['width']}:{SIZE['height']}:force_original_aspect_ratio=decrease,pad={SIZE['width']}:{SIZE['height']}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', str(OUT)], check=True)
    print('wrote', OUT, f'{OUT.stat().st_size / 1e6:.1f} MB', flush=True)
