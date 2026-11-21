"""Exercise the showcase through the real World Builder without submitting jobs."""
from __future__ import annotations

import argparse
from functools import partial
import json
import os
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urldefrag, urljoin, urlsplit

from playwright.sync_api import expect, sync_playwright

from stereo_depth_browser_smoke import PUBLIC, QuietHandler, StaticServer

CHAPTERS = ('robot', 'capture', 'scan', 'building', 'motion', 'share')
MINIMUM_FEATURES = dict(zip(CHAPTERS, (12, 9, 6, 5, 6, 11)))
REQUIRED_TOOLS = {
    'tab:capture', 'tab:world', 'tab:test', 'tab:understand', 'tab:evidence',
    'layer:repair', 'layer:localization', 'layer:motion', 'layer:biomechanics',
    'layer:open4dgs', 'layer:stereo', 'layer:scanedit', 'layer:robottask',
    'section:robot-setup', 'section:unified-workspace', 'section:systems',
    'project:review', 'studio:processing', '#showroom',
}
REQUIRED_STANDALONE = {
    '/arena/index.html',
    '/world/autonomy.html', '/world/fleet-learning.html', '/world/fleet-evaluation.html',
    '/world/splat.html', '/world/movement.html', '/world/facility.html',
    '/world/asbuilt.html', '/world/twin.html', '/world/api.html',
    '/world/sense-trial.html', '/world/projects.html',
}
FOCUS_CHECKS = {
    'Build 3D from overlapping views': '.processing-options [data-action="connection"]',
    'Make a robot task': '[data-robot-task-run]',
    'See depth with two photos': '[data-stereo-example]',
    'Open a StereoSplat export': '[data-stereosplat-import] details > summary',
    'Watch a moving 3D scene': '[data-open4dgs-example]',
    'Check a camera setup': '[data-camera-review] > summary',
    'Pick and move objects': '[data-objectify-suggest]',
    'Reuse an object in another room': '#portable-object-panel > summary',
    'Try a preview lamp': '#splat-appearance-lamp > summary',
}


class ShowcaseHandler(QuietHandler):
    def do_GET(self):
        # Match express.static's byte range support for actual WebKit MP4 playback.
        file = Path(self.translate_path(self.path))
        window = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
        if file.suffix.lower() != '.mp4' or not file.is_file() or not window or not any(window.groups()):
            super().do_GET()
            return
        size = file.stat().st_size
        first, last = window.groups()
        start = int(first) if first else max(0, size - int(last))
        end = min(int(last), size - 1) if first and last else size - 1
        if not 0 <= start <= end:
            self.send_error(416, 'Requested media bytes are unavailable')
            return
        self.send_response(206)
        self.send_header('Content-Type', 'video/mp4')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with file.open('rb') as handle:
            handle.seek(start)
            self.wfile.write(handle.read(end - start + 1))


def no_overflow(panel):
    size = panel.evaluate("""el => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
      content: document.body.scrollWidth,
      panel: Math.ceil(el.getBoundingClientRect().width),
      panelContent: el.scrollWidth,
    })""")
    assert max(size['page'], size['content']) <= size['viewport'] + 1, size
    assert size['panelContent'] <= size['panel'] + 1, size


def make_map_edit(page):
    tab = page.locator('#tab-world')
    tab.click()
    expect(tab).to_have_attribute('aria-selected', 'true')
    name = page.locator('#object-name')
    draft = 'Showcase retains this authored map edit'
    name.fill(draft)
    name.press('Tab')
    expect(page.locator('#map-reviewed')).not_to_be_checked()
    return {'name': draft, 'object': page.locator('#objects').input_value()}


def verify_map_edit(page, draft):
    page.locator('#tab-world').click()
    expect(page.locator('#objects')).to_have_value(draft['object'])
    expect(page.locator('#object-name')).to_have_value(draft['name'])
    expect(page.locator('#map-reviewed')).not_to_be_checked()


def set_chapter(page, key):
    tab = page.locator(f'[data-showcase-chapter="{key}"]')
    tab.click()
    assert_chapter(page, key)
    return tab


def assert_chapter(page, key):
    tab = page.locator(f'[data-showcase-chapter="{key}"]')
    expect(tab).to_have_attribute('aria-selected', 'true')
    expect(tab).to_have_attribute('tabindex', '0')
    expect(page.locator('#showcase-panel')).to_have_attribute('aria-labelledby', f'showcase-{key}')
    expect(page.locator('#showcase-panel')).to_be_visible()
    expect(page.locator('[data-showcase-chapter][aria-selected="true"]')).to_have_count(1)
    expect(page.locator('[data-showcase-chapter][tabindex="-1"]')).to_have_count(len(CHAPTERS) - 1)


def verify_keyboard(page):
    for key in CHAPTERS:
        tab = page.locator(f'[data-showcase-chapter="{key}"]')
        expect(tab).to_have_attribute('role', 'tab')
        expect(tab).to_have_attribute('aria-controls', 'showcase-panel')
        assert tab.inner_text().strip()
    expect(page.locator('#showcase-panel')).to_have_attribute('role', 'tabpanel')
    first = set_chapter(page, 'robot')
    first.focus()
    first.press('ArrowRight')
    assert_chapter(page, 'capture')
    capture = page.locator('#showcase-capture')
    expect(capture).to_be_focused()
    capture.press('End')
    assert_chapter(page, 'share')
    share = page.locator('#showcase-share')
    expect(share).to_be_focused()
    share.press('ArrowRight')
    assert_chapter(page, 'robot')
    expect(first).to_be_focused()
    first.press('ArrowLeft')
    assert_chapter(page, 'share')
    share.press('Home')
    assert_chapter(page, 'robot')
    expect(first).to_be_focused()


def verify_media(page):
    video = page.locator('#showcase-video')
    expect(video).to_be_visible()
    expect(video).to_have_attribute('controls', '')
    expect(video).to_have_attribute('playsinline', '')
    assert video.get_attribute('autoplay') is None
    assert video.get_attribute('poster'), 'The demo needs a poster before playback.'
    track = video.locator('track[kind=captions]')
    expect(track).to_have_count(1)
    assert track.get_attribute('srclang')
    assert track.get_attribute('label')
    video.scroll_into_view_if_needed()
    media = video.evaluate("""async el => {
      const captions = el.querySelector('track');
      const previousCaptionMode = captions.track.mode;
      captions.track.mode = 'hidden';
      const poster = new Image();
      poster.src = el.poster;
      const ready = (condition, node, event) => condition() ? Promise.resolve() :
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error(`Missing ${event}`)), 10_000);
          node.addEventListener(event, () => {clearTimeout(timer);resolve();}, {once:true});
          node.addEventListener('error', () => {clearTimeout(timer);reject(Error(`Loading ${event} failed`));}, {once:true});
        });
      el.load();
      await Promise.all([ready(() => el.readyState >= 1, el, 'loadedmetadata'),
        ready(() => captions.readyState === 2, captions, 'load'), poster.decode()]);
      const options = {duration:el.duration, width:el.videoWidth, height:el.videoHeight,
        posterWidth:poster.naturalWidth, posterHeight:poster.naturalHeight,
        initiallyPaused:el.paused && el.currentTime === 0, file:el.currentSrc,
        captions:[...captions.track.cues].map(cue => [cue.startTime,cue.endTime,cue.text])};
      el.currentTime = Math.min(2, el.duration / 2);
      await ready(() => !el.seeking, el, 'seeked');
      captions.track.mode = previousCaptionMode;
      return {...options, seeked:el.currentTime};
    }""")
    assert media['initiallyPaused'] and media['width'] and media['height'], media
    assert media['posterWidth'] and media['posterHeight'], media
    assert media['duration'] > 2 and media['seeked'] > 0, media
    assert '.mp4' in media['file'].lower() and len(media['captions']) > 2, media
    previous = -1
    for start, end, caption in media['captions']:
        assert 0 <= start < end <= media['duration'] + .1, (start, end, media['duration'])
        assert start >= previous and caption.strip(), (start, end, caption)
        previous = start

    # Use the native playhead to open the currently demonstrated tool.
    video.evaluate('el => { el.currentTime = 16.5; }')
    related = page.locator('#showcase-related')
    expect(related).to_be_visible()
    expect(related).to_contain_text('See depth with two photos')
    related.focus()
    related.press('Enter')
    verify_in_page_destination(page, 'layer:stereo')
    expect(page.locator('[data-stereo-example]')).to_be_focused()
    page.locator('#showcase-return').click()
    expect(related).to_be_focused()

    transcript = page.locator('#showcase-transcript')
    transcript.locator('summary').click()
    expect(transcript).to_have_attribute('open', '')
    assert len(transcript.inner_text().split()) > 30
    cues = transcript.locator('[data-showcase-seek]')
    expect(cues).to_have_count(11)
    starts = [float(value) for value in cues.evaluate_all(
        "buttons => buttons.map(button => button.getAttribute('data-showcase-seek'))")]
    assert starts == sorted(set(starts)) and starts[0] >= 0 and starts[-1] < media['duration'], starts
    transcript.locator('[data-showcase-seek="22"]').click()
    expect(related).to_contain_text('Pick and move objects')
    cue_time = video.evaluate('el => { el.pause(); return el.currentTime; }')
    assert 22 <= cue_time < 23, cue_time
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    expect(page.locator('[data-film-status]')).to_be_hidden()
    transcript.locator('summary').click()
    with page.expect_download() as started:
        page.locator('#showcase a[download]').click()
    download = started.value
    assert download.suggested_filename.lower().endswith('.mp4')
    with download.path().open('rb') as handle:
        assert b'ftyp' in handle.read(32), 'The showcase download must contain an MP4 container.'
    return {k: v for k, v in media.items() if k != 'captions'} | {
        'cues': len(media['captions']), 'transcriptCues': starts, 'seekFromTranscript': cue_time,
        'actionAt16_5Seconds': 'layer:stereo', 'download': download.suggested_filename,
    }


def verify_showroom_walk(page, showroom):
    walk = showroom.locator('[data-el="walk"]')
    def field(name):
        return walk.locator(f'[data-walk-{name}]')
    def picture():
        return field('canvas').evaluate('canvas => canvas.toDataURL()')
    def snapshot():
        return [showroom.locator(f'[data-el="{key}"]').input_value() for key in ('timeline', 'picker', 'scrub')]

    original = snapshot()
    walk.locator('summary').press('Enter')
    expect(field('method-note')).to_contain_text('projected color')
    expect(field('progress')).to_have_value('0')
    field('progress').press('ArrowRight')
    expect(field('progress')).to_have_value('1')
    field('play').click()
    expect(field('play')).to_have_text('Pause walk')
    page.wait_for_function("Number(document.querySelector('[data-walk-progress]').value) > 30")
    field('play').click()
    expect(field('play')).to_have_text('Play walk')
    field('from').select_option('2')
    expect(field('play')).to_be_disabled()
    field('to').select_option('0')
    expect(field('play')).to_be_enabled()
    field('progress').press('End')
    expect(field('reference')).to_have_attribute('data-index', '0')
    field('mode').select_option('compare')
    expect(field('target')).to_have_value('1')
    expect(field('reference')).to_have_attribute('data-index', '1')
    assert field('alternative').get_attribute('data-index') in ('0', '2')
    expect(field('play')).to_be_hidden()
    expect(field('method-note')).to_contain_text('projected color')
    expect(field('fill')).not_to_be_checked()
    sparse = picture()
    method_note = field('method-note').inner_text()
    field('fill').check()
    expect(field('camera-note')).to_contain_text('Gaps use the picture from view')
    assert picture() != sparse and field('method-note').inner_text() == method_note
    field('fill').uncheck()
    assert picture() == sparse
    field('method').select_option('points')
    expect(field('method-note')).to_contain_text('Room points')
    expect(field('fill')).to_be_hidden()
    assert picture() != sparse
    field('method').select_option('appearance')
    expect(field('fill')).to_be_visible()
    assert snapshot() == original

    viewport = page.viewport_size
    for width in (390, 320):
        page.set_viewport_size({'width': width, 'height': 850})
        no_overflow(walk)
        expect(field('reference').locator('img')).to_be_visible()
        expect(field('alternative').locator('img')).to_be_visible()
    reading_controls = [showroom.locator('[data-close-showroom]'), showroom.locator('[data-el="picker"]'),
                        walk.locator('summary'), field('target'), field('reference-note')]
    def font_sizes():
        return [control.evaluate('el => parseFloat(getComputedStyle(el).fontSize)') for control in reading_controls]
    standard = font_sizes()
    toggle_text = page.locator('#playground-text-size')
    toggle_text.tap()
    expect(toggle_text).to_have_attribute('aria-pressed', 'true')
    assert all(large > small for large, small in zip(font_sizes(), standard))
    no_overflow(showroom)
    no_overflow(walk)
    toggle_text.tap()
    expect(toggle_text).to_have_attribute('aria-pressed', 'false')
    assert font_sizes() == standard
    page.set_viewport_size(viewport)

    # Replace the room while the next endpoint pair's real decoded images are pending.
    # Releasing the previous decoder must never draw into the replacement.
    legacy = page.evaluate("""async () => {
      const {createShowroomExample} = await import('./showroom-model.mjs');
      const room = createShowroomExample();
      room.title = 'Room with older camera records';
      for (const f of room.frames) { delete f.pose; delete f.depth; }
      return JSON.stringify(room);
    }""")
    page.evaluate("""() => {
      const decode = HTMLImageElement.prototype.decode;
      let release;
      const gate = new Promise(resolve => {release = resolve;});
      window.walkDecodeCount = 0;
      window.releaseWalkDecode = () => {HTMLImageElement.prototype.decode = decode; release();};
      HTMLImageElement.prototype.decode = function() {
        window.walkDecodeCount++;
        return Promise.all([gate, decode.call(this)]);
      };
    }""")
    try:
        field('mode').select_option('walk')
        page.wait_for_function('window.walkDecodeCount > 0')
        showroom.locator('[data-room-file]').set_input_files({
            'name':'legacy.json', 'mimeType':'application/json', 'buffer':legacy.encode(),
        })
        expect(showroom.locator('[data-el="title"]')).to_have_text('Room with older camera records')
        walk.locator('summary').click()
        expect(field('camera-note')).to_contain_text('estimated')
        expect(field('method-note')).to_contain_text('Room points')
    finally:
        page.evaluate('window.releaseWalkDecode()')
    expect(field('fill')).to_be_hidden()
    showroom.locator('[data-demo-room]').click()
    expect(showroom.locator('[data-el="title"]')).to_have_text('Practice showroom')


def verify_in_page_destination(page, target):
    kind, key = target.split(':', 1)
    if kind == 'tab':
        expect(page.locator(f'#tab-{key}')).to_have_attribute('aria-selected', 'true')
        expect(page.locator('#panel')).to_have_attribute('aria-labelledby', f'tab-{key}')
        expect(page.locator('#panel')).to_be_visible()
    elif kind == 'layer':
        expect(page.locator(f'#layer-tab-{key}')).to_have_attribute('aria-selected', 'true')
        expect(page.locator(f'#layer-panel-{key}')).to_be_visible()
    elif kind == 'section':
        expect(page.locator(f'#{key}')).to_be_in_viewport()
    elif target == 'project:review':
        dialog = page.locator('#project-review-dialog')
        expect(dialog).to_be_visible()
        assert dialog.evaluate("el => el.matches(':modal')")
        page.locator('#project-review-close').click()
        expect(dialog).to_be_hidden()
    elif target == 'studio:processing':
        expect(page.locator('#tab-capture')).to_have_attribute('aria-selected', 'true')
        expect(page.locator('.processing-options')).to_have_attribute('open', '')
    else:
        raise AssertionError(f'Unexpected in-page destination {target}')


def verify_tool_actions(page):
    tools = set()
    standalone = set()
    feature_counts = {}
    return_button = page.locator('#showcase-return')
    room_draft_open = False
    for key in CHAPTERS:
        set_chapter(page, key)
        actions = page.locator('#showcase-panel [data-showcase-target]')
        cards = actions.all()
        assert len(cards) >= MINIMUM_FEATURES[key], (key, len(cards))
        feature_counts[key] = len(cards)
        for card in cards:
            target = card.get_attribute('data-showcase-target')
            assert target and card.inner_text().strip(), (key, target)
            if target.startswith('/'):
                page_before = page.url
                path, fragment = urldefrag(target)
                expect(card).to_have_attribute('target', '_blank')
                href = card.get_attribute('href')
                assert href and urljoin(page_before, href) == urljoin(page_before, target), (target, href)
                standalone.add(path)
                with page.context.expect_page() as opened:
                    card.click()
                popup = opened.value
                try:
                    popup.wait_for_load_state('domcontentloaded')
                    actual = urlsplit(popup.url)
                    assert actual.path == path, (target, popup.url)
                    if path == '/arena/index.html':
                        expect(popup.locator('#page-title')).to_have_text('Robot arcade')
                    else:
                        expect(popup.locator('h1').first).to_be_visible()
                    if path == '/world/sense-trial.html':
                        popup.locator('#step').click()
                        expect(popup.locator('#journal li')).to_have_count(1)
                    elif path == '/world/projects.html':
                        expect(popup.locator('#project-api-key')).to_be_editable()
                        expect(popup.locator('#connection-heading')).to_be_visible()
                    assert popup.title() != 'Error response', target
                    if fragment:
                        assert actual.fragment == fragment, (target, popup.url)
                        expect(popup.locator(f'[id="{fragment}"]')).to_be_attached()
                finally:
                    popup.close()
                assert page.url == page_before
                assert_chapter(page, key)
                continue

            tools.add(target)
            card.focus()
            card.press('Enter')
            if target == '#showroom':
                # The showroom link uses normal fragment navigation in the existing workspace.
                expect(card).to_have_attribute('href', '#showroom')
                expect(page).to_have_url(re.compile(r'#showroom$'))
                showroom = page.locator('#showroom')
                expect(showroom).to_be_focused()
                verify_showroom_walk(page, showroom)
                change = showroom.locator('[data-el="change"]')
                expect(change).to_be_visible()
                if change.inner_text().startswith('Find '):
                    change.click()
                expect(change).to_have_text(re.compile(r'^Remove '))
                change.click()
                expect(change).to_have_text(re.compile(r'^Restore '))
                showroom.locator('[data-close-showroom]').click()
                expect(showroom).to_be_hidden()
                expect(page).to_have_url(re.compile(r'#robot-setup$'))
                assert_chapter(page, key)
                continue
            verify_in_page_destination(page, target)
            label = card.locator('strong').inner_text()
            selector = FOCUS_CHECKS.get(label)
            if selector:
                area = page.frame_locator('#scan-workshop-frame') if target == 'layer:scanedit' else page
                expect(area.locator(selector).first).to_be_focused()
            if target == 'layer:scanedit' and not room_draft_open:
                editor = page.frame_locator('#scan-workshop-frame')
                expect(editor.locator('[data-objectify-source]')).to_contain_text('authored-reading-room.ply')
                editor.locator('[data-scan-example=studio]').click()
                expect(editor.locator('[data-objectify-source]')).to_contain_text('authored-empty-studio.ply')
                editor.locator('#point-size').fill('1.7')
                room_draft_open = True
            expect(return_button).to_be_visible()
            return_button.click()
            assert_chapter(page, key)
            expect(card).to_be_focused()
            expect(return_button).to_be_hidden()

    assert tools >= REQUIRED_TOOLS, REQUIRED_TOOLS - tools
    assert standalone >= REQUIRED_STANDALONE, REQUIRED_STANDALONE - standalone
    set_chapter(page, 'scan')
    page.locator('#showcase-panel [data-showcase-target="layer:scanedit"]').first.click()
    verify_in_page_destination(page, 'layer:scanedit')
    editor = page.frame_locator('#scan-workshop-frame')
    expect(editor.locator('[data-objectify-source]')).to_contain_text('authored-empty-studio.ply')
    expect(editor.locator('#point-size')).to_have_value('1.7')
    return_button.click()
    assert_chapter(page, 'scan')
    return {'tools': sorted(tools), 'standalone': sorted(standalone), 'features': feature_counts}


def verify_browser(engine, url, output, axe_script):
    flags = {'args': ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']} if engine.name == 'chromium' else {}
    browser = engine.launch(headless=True, **flags)
    try:
        context = browser.new_context(viewport={'width': 1360, 'height': 1000}, reduced_motion='reduce',
                                      has_touch=True, service_workers='block')
        errors, writes = [], []
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        def safe_route(route):
            if route.request.method in ('GET', 'HEAD', 'OPTIONS'):
                route.continue_()
            else:
                writes.append(route.request.url)
                route.abort()

        context.route('**/*', safe_route)
        base_url = urldefrag(url)[0]
        response = page.goto(base_url + '#showroom-walk', wait_until='domcontentloaded')
        assert response and response.ok, url
        walk = page.locator('#showroom [data-el="walk"]')
        expect(walk).to_have_attribute('open', '')
        expect(walk.locator('summary')).to_be_focused()
        expect(walk.locator('summary')).to_be_in_viewport()
        expect(walk.locator('[data-walk-method-note]')).to_contain_text('projected color')
        walk.locator('summary').click()
        page.locator('[data-close-showroom]').click()
        expect(page.locator('#showroom')).to_be_hidden()
        response = page.goto(base_url + '#showcase-motion', wait_until='domcontentloaded')
        assert response is None or response.ok, url
        assert_chapter(page, 'motion')
        expect(page.locator('#showcase-motion')).to_be_in_viewport()
        response = page.goto(base_url, wait_until='domcontentloaded')
        assert response is None or response.ok, url
        expect(page.locator('#objects option').first).to_be_attached()
        draft = make_map_edit(page)
        hero_link = page.locator('.hero a[href="#showcase"]')
        hero_link.focus()
        hero_link.press('Enter')
        expect(page.locator('#showcase-title')).to_be_in_viewport()
        assert urldefrag(page.url)[1] == 'showcase'
        verify_keyboard(page)
        media = verify_media(page)
        page.locator('#showcase').screenshot(path=output/f'{engine.name}-desktop.png')
        routes = verify_tool_actions(page)
        verify_map_edit(page, draft)
        showcase = page.locator('#showcase')
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 850})
            if width == 320:
                tab = page.locator('#showcase-robot')
                font_size = tab.evaluate('el => parseFloat(getComputedStyle(el).fontSize)')
                page.locator('#playground-text-size').tap()
                expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
                assert tab.evaluate('el => parseFloat(getComputedStyle(el).fontSize)') > font_size
            for key in CHAPTERS:
                page.locator(f'#showcase-{key}').tap()
                assert_chapter(page, key)
                no_overflow(showcase)
            page.locator('#showcase-panel').screenshot(path=output/f'{engine.name}-{width}.png')
        violations = None
        if axe_script:
            page.add_script_tag(path=str(axe_script))
            violations = showcase.evaluate("""async el => {
              const options = {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}};
              const {violations} = await axe.run(el, options);
              return violations.map(issue => ({id: issue.id, targets:issue.nodes.map(node => node.target)}));
            }""")
            assert not violations, violations
        assert not errors and not writes, (errors, writes)
        report = {'engine': engine.name, 'chapters': CHAPTERS, 'media': media, 'routes': routes,
                  'mobileWidths': [390, 320], 'axeViolations320px': violations, 'writes': writes, 'pageErrors': errors}
        (output/f'{engine.name}.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'{engine.name}: {len(routes["tools"])} in-page tools, {len(routes["standalone"])} standalone pages, '
              'keyboard, captioned MP4, retained map and scan drafts, and 390/320 px layout.', flush=True)
    finally:
        browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default=os.environ.get('WORLD_URL'))
    parser.add_argument('--out', type=Path)
    parser.add_argument('--axe', type=Path, help='Optional local axe-core browser bundle')
    args = parser.parse_args()
    server = None
    try:
        if args.url:
            url = args.url
        else:
            server = StaticServer(('127.0.0.1', 0), partial(ShowcaseHandler, directory=str(PUBLIC)))
            Thread(target=server.serve_forever, daemon=True).start()
            url = f'http://127.0.0.1:{server.server_port}/world/index.html?nosw=1'
        with TemporaryDirectory() as scratch, sync_playwright() as playwright:
            output = args.out or Path(scratch)
            output.mkdir(parents=True, exist_ok=True)
            for name in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                verify_browser(getattr(playwright, name), url, output, args.axe)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
