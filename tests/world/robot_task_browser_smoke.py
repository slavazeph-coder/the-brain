"""Run the genuine local MuJoCo worker through the playground in Chromium and WebKit."""
from __future__ import annotations

import argparse
from base64 import b64decode
from functools import partial
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urljoin, urlsplit
from zipfile import ZipFile

from PIL import Image
from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright

from stereo_depth_browser_smoke import PUBLIC, StaticServer
from world_showcase_browser_smoke import ShowcaseHandler

REFERENCE_NAME = 'my-reference.PNG'
BRIEF = 'Push the puck 30 cm'
DRAFT_PROBE = """<!doctype html><html lang="en"><meta charset="utf-8"><title>Robot task lifecycle probe</title>
<main id="probe"></main><script type="module">
import {robotTaskMarkup, mountRobotTask} from '/world/robot-task-panel.mjs';
const root = document.getElementById('probe');
root.innerHTML = robotTaskMarkup();
window.probeCalls = [];
window.probeTask = mountRobotTask({root, draftWithGemini:({brief, reference, signal}) =>
  new Promise(resolve => probeCalls.push({brief, reference, signal, resolve}))});
</script></html>"""


def download(page, control, filename):
    with page.expect_download() as received:
        control.click()
    file = received.value
    assert file.suggested_filename == filename
    return file.path().read_bytes()


def verify_episode(record, task, controller, success):
    record = json.loads(record)
    assert record['schema'] == 'brainsnn.robot-task.episode.v1'
    assert record['config'] == {'task': task, 'distance': .3, 'seed': 42, 'controller': controller}
    assert record['engine']['name'] == 'MuJoCo' and record['engine']['version']
    assert record['provenance']['physicsExecuted'] is True
    assert record['provenance']['learnedPolicyExecuted'] is False
    assert record['steps'] == 2000 and record['timestepSeconds'] == .002
    assert record['score']['success'] is success
    assert record['score']['reason'] == ('goal-reached' if success else 'outside-goal')
    frames = record['frames']
    assert len(frames) == 81 and frames[0]['time'] == 0 and frames[-1]['time'] == 4
    assert frames[-1]['pusher'] != frames[0]['pusher']
    assert all(len(sample['action']) == 2 for sample in frames)
    if task == 'reach':
        assert all(sample['puck'] is None and not sample['contact'] for sample in frames)
    else:
        assert all(len(sample['puck']) == 3 and len(sample['puckQuaternion']) == 4 for sample in frames)
        assert any(sample['contact'] for sample in frames) and record['score']['contactSeconds'] > 0
        assert record['score']['puckDisplacementMeters'] > 0.1
    return record


def verify_replay(page, field, episode, output, engine):
    timeline = field('timeline')
    gap = episode['frames'][-1]['errorMeters'] * 100
    expect(timeline).to_have_attribute('aria-valuetext', f'4.00 seconds, {gap:.1f} cm from the goal')
    timeline.press('Home')
    expect(timeline).to_have_value('0')
    expect(timeline).to_have_attribute('aria-valuetext', '0.00 seconds, 30.0 cm from the goal')
    start = field('canvas').screenshot()
    timeline.press('ArrowRight')
    expect(timeline).to_have_value('1')
    timeline.press('End')
    expect(timeline).to_have_value('80')
    end = field('canvas').screenshot(path=output / f'{engine}-push-final.png')
    assert start != end, 'The canvas should draw recorded movement.'
    field('play').click()
    expect(field('pause')).to_be_enabled()
    expect(timeline).not_to_have_value('80')
    field('pause').click()
    expect(field('pause')).to_be_disabled()
    stopped = timeline.input_value()
    page.evaluate('() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
    expect(timeline).to_have_value(stopped)


def verify_rendered_materials(screenshot):
    with Image.open(BytesIO(screenshot)) as image:
        rgb = image.convert('RGB').tobytes()
    amber = cyan = 0
    for r, g, b in zip(rgb[0::3], rgb[1::3], rgb[2::3]):
        amber += r > 130 and g > 70 and r > g + 20 and g > b + 20
        cyan += g > 125 and b > 90 and g > r + 25 and b > r + 20
    assert amber > 15 and cyan > 15, (amber, cyan)
    return {'amberPuckPixels':amber, 'cyanPusherPixels':cyan}


def verify_3d_replay(page, field, output, engine, requests):
    canvas = field('3d-canvas')
    mode = field('3d')
    note = field('view-status')
    timeline = field('timeline')
    expect(field('2d')).to_have_attribute('aria-pressed', 'true')
    expect(canvas).to_be_hidden()
    assert not any(url.endswith('/vendor/robot-task-3d.mjs') for url in requests), '3D must load on request.'
    has_gl = page.evaluate("""() => {
      try { return Boolean(document.createElement('canvas').getContext('webgl2')); }
      catch { return false; }
    }""")
    mode.click()
    if not has_gl:
        expect(note).to_contain_text('top-down replay is ready')
        expect(field('canvas')).to_be_visible()
        return {'rendered':False, 'nativeWebGL2':False, 'topDownFallback':True}

    expect(note).to_have_text('3D replay ready.')
    expect(mode).to_have_attribute('aria-pressed', 'true')
    expect(field('canvas')).to_be_hidden()
    expect(canvas).to_be_visible()
    assert any(url.endswith('/vendor/robot-task-3d.mjs') for url in requests)
    timeline.press('Home')
    expect(timeline).to_have_value('0')
    canvas.focus()
    start = canvas.screenshot()
    verify_rendered_materials(start)
    canvas.press('ArrowRight')
    assert canvas.screenshot() != start, 'ArrowRight should orbit the rendered scene.'
    field('reset-view').click()
    still = canvas.screenshot()
    timeline.press('End')
    expect(timeline).to_have_value('80')
    final = canvas.screenshot(path=output / f'{engine}-push-3d.png')
    assert final != still, 'The recorded frame should move the pusher and puck.'
    verify_rendered_materials(final)
    field('zoom-in').click()

    field('2d').click()
    expect(field('canvas')).to_be_visible()
    mode.click()
    expect(note).to_have_text('3D replay ready.')
    replay_pixels = verify_rendered_materials(canvas.screenshot(path=output / f'{engine}-push-3d-remount.png'))
    old = canvas.element_handle()
    page.locator('#layer-tab-stereo').click()
    page.locator('#layer-tab-robottask').click()
    expect(field('2d')).to_have_attribute('aria-pressed', 'true')
    expect(field('canvas')).to_be_visible()
    expect(timeline).to_have_value('80')
    assert not old.evaluate('el => el.isConnected'), 'Leaving the tool should release the old 3D canvas.'

    page.evaluate("""() => {
      window.originalReplayContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...options) {
        if (this.hasAttribute('data-robot-task-3d-canvas') && type.startsWith('webgl')) return null;
        return window.originalReplayContext.call(this, type, ...options);
      };
    }""")
    try:
        mode.click()
        expect(note).to_contain_text('top-down replay is ready')
        expect(field('canvas')).to_be_visible()
        expect(timeline).to_have_value('80')
    finally:
        page.evaluate("""() => {
          HTMLCanvasElement.prototype.getContext = window.originalReplayContext;
          delete window.originalReplayContext;
        }""")
    return {'rendered':True, 'nativeWebGL2':True, 'forcedFallbackFixture':True, 'remount':replay_pixels}


def verify_draft_guard(page, field):
    help_box = field('brief').locator('xpath=ancestor::details[1]')
    help_box.locator('summary').first.click()
    field('brief').fill('A scene that is outside the supported vocabulary.')
    field('use-words').click()
    expect(field('brief-status')).to_contain_text('Push the puck 30 cm')
    expect(field('preset')).to_have_value('reach')
    field('brief').fill(BRIEF)
    field('use-words').click()
    expect(field('brief-status')).to_contain_text('Settings filled in.')
    expect(field('preset')).to_have_value('push')
    expect(field('distance')).to_have_value('30')
    expect(field('result')).to_be_hidden()
    expect(field('stop')).to_be_hidden()

    with BytesIO() as original:
        Image.new('RGB', (4, 3), (204, 124, 28)).save(original, format='PNG')
        reference = original.getvalue()
    field('reference').set_input_files({'name': REFERENCE_NAME, 'mimeType': 'image/png', 'buffer': reference})
    expect(field('reference-name')).to_have_text(REFERENCE_NAME)
    expect(field('image')).to_have_js_property('naturalWidth', 4)
    field('reference').set_input_files({'name': 'other.txt', 'mimeType': 'text/plain', 'buffer': b'invalid'})
    expect(field('reference-status')).to_contain_text('Kept your previous reference')
    expect(field('reference-name')).to_have_text(REFERENCE_NAME)
    expect(field('image')).to_have_js_property('naturalWidth', 4)

    # Functionality is exercised through the real unauthenticated World shell.
    # Keep the reference and use an empty brief to check the reference-only path.
    field('brief').fill('')
    page.get_by_text('Ask Gemini for a task', exact=True).click()
    field('ai-draft').click()
    expect(field('ai-status')).to_contain_text('owner connection')
    expect(field('preset')).to_have_value('push')
    expect(field('distance')).to_have_value('30')
    expect(field('result')).to_be_hidden()
    field('brief').fill(BRIEF)
    return reference


def verify_draft_lifecycle(context, url, reference):
    # Inject a deferred provider solely to exercise real UI freshness and cancellation behavior.
    # No request is sent to Google or to the application's draft API by this probe.
    address = urljoin(url, './robot-task-lifecycle-probe.html')
    probe = context.new_page()
    probe.route(address, lambda route: route.fulfill(content_type='text/html', body=DRAFT_PROBE))
    try:
        probe.goto(address, wait_until='domcontentloaded')
        def field(name):
            return probe.locator(f'[data-robot-task-{name}]')

        field('brief').locator('xpath=ancestor::details[1]').locator('summary').first.click()
        field('reference').set_input_files({'name': REFERENCE_NAME, 'mimeType': 'image/png', 'buffer': reference})
        probe.get_by_text('Ask Gemini for a task', exact=True).click()
        assert probe.evaluate('probeCalls.length') == 0
        field('ai-draft').click()
        assert probe.evaluate('probeCalls.map(c => [c.brief, c.reference.name, c.reference.size])') == [
            ['', REFERENCE_NAME, len(reference)]
        ]
        probe.evaluate("probeCalls[0].resolve({task:'push',distance:.31})")
        expect(field('ai-status')).to_contain_text('Draft ready.')
        expect(field('preset')).to_have_value('push')
        expect(field('distance')).to_have_value('31')
        expect(field('result')).to_be_hidden()
        expect(field('stop')).to_be_hidden()

        field('ai-draft').click()
        field('distance').fill('42')
        assert probe.evaluate('probeCalls[1].signal.aborted')
        probe.evaluate("probeCalls[1].resolve({task:'reach',distance:.55})")
        expect(field('preset')).to_have_value('push')
        expect(field('distance')).to_have_value('42')

        field('ai-draft').click()
        probe.evaluate('probeTask.suspend()')
        assert probe.evaluate('probeCalls[2].signal.aborted')
        probe.evaluate("probeCalls[2].resolve({task:'reach',distance:.58})")
        expect(field('ai-status')).to_contain_text('Draft cancelled')
        expect(field('distance')).to_have_value('42')
    finally:
        probe.close()


def verify_session_gating(browser, url, output, engine, reference):
    # The public Connect dialog and its API client are real. Session and provider replies are fixtures.
    context = browser.new_context(service_workers='block')
    page = context.new_page()
    drafts, unexpected = [], []
    owner_token = 'mock-robot-task-owner-session-only'
    origin = urlsplit(url).netloc

    def block_unexpected(route):
        request = route.request
        if urlsplit(request.url.removeprefix('blob:')).netloc == origin and request.method in ('GET', 'HEAD', 'OPTIONS'):
            route.continue_()
        else:
            unexpected.append((request.method, request.url))
            route.abort()

    def session(route):
        owner = route.request.post_data_json.get('passcode') == 'test owner'
        token = owner_token if owner else 'mock-robot-task-visitor-session-only'
        route.fulfill(status=201, json={'kind': 'owner' if owner else 'visitor', 'token': token})

    def generate(route):
        assert route.request.headers.get('authorization') == f'Bearer {owner_token}'
        drafts.append(route.request.post_data_json)
        route.fulfill(json={'task':'push', 'distanceCm':45} if len(drafts) == 1 else {'task':'unsupported'})

    page.route('**/*', block_unexpected)
    page.route('**/api/world/processing', lambda route: route.fulfill(json={'available':True, 'passcode':True, 'visitors':True}))
    page.route('**/api/world/session', session)
    page.route('**/api/world/worker/v1/capabilities', lambda route: route.fulfill(json={'api_version':'brainsnn.worker.v1', 'engines':[]}))
    page.route('**/api/world/robot-task-draft', generate)
    try:
        page.goto(url, wait_until='domcontentloaded')
        def field(name):
            return page.locator(f'[data-robot-task-{name}]')

        dialog = page.locator('#connection')
        field('brief').locator('xpath=ancestor::details[1]').locator('summary').first.click()
        field('reference').set_input_files({'name': REFERENCE_NAME, 'mimeType': 'image/png', 'buffer': reference})
        page.get_by_text('Ask Gemini for a task', exact=True).click()
        expect(dialog).to_be_hidden()
        assert not drafts

        # A guest and a connected visitor cannot send a draft.
        field('ai-draft').click()
        expect(dialog).to_be_visible()
        page.locator('#site-connect').click()
        expect(dialog).to_be_hidden()
        field('ai-draft').click()
        expect(dialog).to_be_visible()
        assert not drafts
        page.locator('#site-passcode').fill('test owner')
        page.locator('#site-connect').click()
        expect(dialog).to_be_hidden()
        assert not drafts

        field('ai-draft').click()
        expect(field('ai-status')).to_contain_text('Draft ready.')
        assert len(drafts) == 1 and drafts[0]['consent'] is True and drafts[0]['brief'] == ''
        assert drafts[0]['reference']['mimeType'] == 'image/png'
        assert b64decode(drafts[0]['reference']['data']) == reference
        expect(field('preset')).to_have_value('push')
        expect(field('distance')).to_have_value('45')
        expect(field('result')).to_be_hidden()
        expect(field('stop')).to_be_hidden()

        field('brief').fill('Build a fruit sorting scene.')
        field('ai-draft').click()
        expect(field('ai-status')).to_contain_text('different scene')
        assert len(drafts) == 2 and drafts[1]['brief'] == 'Build a fruit sorting scene.'
        expect(field('preset')).to_have_value('push')
        expect(field('distance')).to_have_value('45')
        expect(field('result')).to_be_hidden()
        assert not unexpected, unexpected
        receipt = {'engine':engine, 'provider':'intercepted site/worker/Gemini responses', 'externalCalls':0,
                   'noGuestPost':True, 'noVisitorPost':True, 'ownerReferenceOnlyBytes':len(reference),
                   'supportedProposalCm':45, 'explicitRunStillRequired':True, 'unsupportedPreservesSettings':True}
        (output / f'{engine}-draft-routing-fixture.json').write_text(json.dumps(receipt, indent=2) + '\n')
    finally:
        context.close()


def verify_cancel(page, context, field):
    pending = []
    pattern = '**/mujoco.wasm'
    def hold(route):
        pending.append(route)
    context.route(pattern, hold)
    try:
        with context.expect_event('request', predicate=lambda request: request.url.endswith('/mujoco.wasm'), timeout=15_000) as started:
            field('run').click()
        expect(field('stop')).to_be_visible()
        # The worker's import and its HTTP fetch are real. Hold the wasm response until leaving.
        assert started.value.method == 'GET'
        page.locator('#layer-tab-stereo').click()
        page.locator('#layer-tab-robottask').click()
        expect(field('status')).to_contain_text('Run stopped when you left')
        expect(field('result')).to_be_hidden()
        expect(field('stop')).to_be_hidden()
    finally:
        for route in pending:
            try:
                route.abort()
            except PlaywrightError:
                pass  # The discarded worker already closed its resource request.
        context.unroute(pattern, hold)


def verify_kitchen(page, output, engine):
    kitchen = page.locator('[data-kitchen-pin]')
    field = lambda key: kitchen.locator(f'[data-kitchen-{key}]')
    kitchen.locator('summary').click()
    scores = {}
    for mode in ('grip', 'open'):
        field('controller').select_option(mode)
        field('run').click()
        expect(field('result')).to_be_visible(timeout=30000)
        record = json.loads(download(page, field('json'), f'rolling-pin-{mode}.json'))
        assert record['schema'] == 'brainsnn.kitchen-pin.v1'
        assert download(page, field('xml'), f'rolling-pin-{mode}.xml').decode() == record['modelXML']
        scores[mode] = record['score']
        assert record['score']['success'] == (mode == 'grip')
        assert record['frames'][-1]['action'] is None and len(record['frames']) == 121
        field('time').press('Home')
        field('time').press('ArrowRight')
        expect(field('frame')).to_contain_text('0.05 s')
        if mode == 'grip':
            still = field('canvas').evaluate('c => c.toDataURL()')
            field('time').evaluate("e => {e.value='60'; e.dispatchEvent(new Event('input'));}")
            expect(field('frame')).to_contain_text('Held by both fingers')
            assert field('canvas').evaluate('c => c.toDataURL()') != still
            field('canvas').screenshot(path=str(output/f'{engine}-kitchen.png'))
            field('play').click()
            page.wait_for_function("Number(document.querySelector('[data-kitchen-time]').value) > 62")
            field('play').click()
            expect(field('play')).to_have_text('Play the run')
    assert scores['grip']['liftMeters'] > .1 and scores['grip']['settledTraySeconds'] > 1
    assert scores['open']['liftMeters'] == 0
    assert kitchen.evaluate('e => e.scrollWidth <= e.clientWidth + 1')
    kitchen.locator('summary').click()
    direct = page.context.new_page()
    try:
        direct.set_viewport_size({'width': 320, 'height': 850})
        direct.goto(page.url.split('#')[0] + '#rolling-pin', wait_until='domcontentloaded')
        panel = direct.locator('[data-kitchen-pin]')
        expect(panel).to_have_js_property('open', True)
        expect(panel.locator('summary')).to_be_focused()
        expect(panel.locator('[data-kitchen-result]')).to_be_hidden()
    finally:
        direct.close()
    return scores


def verify_browser(engine, url, output, axe_path):
    args = {'args': ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']} if engine.name == 'chromium' else {}
    browser = engine.launch(headless=True, **args)
    try:
        context = browser.new_context(viewport={'width': 1360, 'height': 960}, reduced_motion='reduce',
                                      accept_downloads=True, has_touch=True, service_workers='block')
        errors, writes, requests = [], [], []
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        context.on('request', lambda request: requests.append(request.url))
        def no_writes(route):
            if route.request.method in ('GET', 'HEAD', 'OPTIONS'):
                route.continue_()
            else:
                writes.append(route.request.url)
                route.abort()

        context.route('**/*', no_writes)
        response = page.goto(url, wait_until='domcontentloaded')
        assert response and response.ok, url
        expect(page.locator('#layer-tab-robottask')).to_have_attribute('aria-selected', 'true')
        panel = page.locator('[data-robot-task]')
        def field(name):
            return panel.locator(f'[data-robot-task-{name}]')

        expect(field('result')).to_be_hidden()
        expect(field('run')).to_be_enabled()
        film = field('film')
        assert film.get_attribute('src') is None
        summary = field('example').locator('summary')
        summary.click()
        expect(film).to_have_attribute('src', './media/robot-task-comparison.mp4')
        page.wait_for_function("document.querySelector('[data-robot-task-film]').textTracks.length === 1")
        film.evaluate("v => {v.muted = true; v.textTracks[0].mode = 'hidden'; return v.play();}")
        page.wait_for_function("document.querySelector('[data-robot-task-film]').currentTime > .1")
        page.wait_for_function("document.querySelector('[data-robot-task-film]').textTracks[0].cues?.length === 3")
        film_seconds = film.evaluate('v => v.duration')
        assert abs(film_seconds - 6.55) < .1
        summary.click()
        expect(film).to_have_js_property('paused', True)
        verify_cancel(page, context, field)
        field('run').press('Enter')
        expect(field('status')).to_contain_text('Run complete.', timeout=30_000)
        expect(field('outcome')).to_have_text('Goal reached')
        reach = verify_episode(download(page, field('recording'), 'episode.json'), 'reach', 'standard', True)

        reference = verify_draft_guard(page, field)
        raw_brief = download(page, field('save-brief'), 'brainsnn-robot-task-brief.zip')
        with ZipFile(BytesIO(raw_brief)) as archive:
            assert set(archive.namelist()) == {'brief.txt', 'TASK.md', 'reference/media.png'}
            assert archive.read('reference/media.png') == reference
            assert archive.read('brief.txt').decode() == BRIEF
            assert b'Google Antigravity' in archive.read('TASK.md')
        expect(field('result')).to_be_hidden()
        field('run').click()
        expect(field('status')).to_contain_text('Run complete.', timeout=30_000)
        expect(field('outcome')).to_have_text('Goal reached')
        xml = download(page, field('mjcf'), 'scene.xml')
        assert b'<mujoco model="brainsnn_tabletop_push">' in xml and b'name="puck"' in xml
        push_bytes = download(page, field('recording'), 'episode.json')
        push = verify_episode(push_bytes, 'push', 'standard', True)
        verify_replay(page, field, push, output, engine.name)
        replay_3d = verify_3d_replay(page, field, output, engine.name, requests)
        raw_zip = download(page, field('workspace'), 'brainsnn-robot-task.zip')
        with ZipFile(BytesIO(raw_zip)) as archive:
            assert set(archive.namelist()) == {'scene.xml', 'episode.json', 'brief.txt', 'TASK.md', 'reference/media.png'}
            assert archive.read('scene.xml') == xml
            assert archive.read('episode.json') == push_bytes
            assert archive.read('reference/media.png') == reference
            assert archive.read('brief.txt').decode() == BRIEF
            assert b'Google Antigravity' in archive.read('TASK.md')

        field('run').click()
        expect(field('status')).to_contain_text('Run complete.', timeout=30_000)
        assert download(page, field('recording'), 'episode.json') == push_bytes
        page.get_by_text('Change the controller or starting layout', exact=True).click()
        field('controller').select_option('limited')
        expect(field('result')).to_be_hidden()
        field('run').click()
        expect(field('status')).to_contain_text('Run complete.', timeout=30_000)
        expect(field('outcome')).to_have_text('Goal missed')
        miss = verify_episode(download(page, field('recording'), 'episode.json'), 'push', 'limited', False)
        assert miss['score']['finalErrorMeters'] > push['score']['finalErrorMeters']
        if replay_3d['rendered']:
            field('3d').click()
            expect(field('view-status')).to_have_text('3D replay ready.')
            replay_3d['newRun'] = verify_rendered_materials(field('3d-canvas').screenshot())
            field('2d').click()

        violations = None
        page.set_viewport_size({'width': 320, 'height': 850})
        page.locator('#playground-text-size').tap()
        expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
        kitchen_scores = verify_kitchen(page, output, engine.name)
        sizes = panel.evaluate("""el => ({
          viewport:innerWidth, page:document.documentElement.scrollWidth,
          panel:Math.ceil(el.getBoundingClientRect().width), contents:el.scrollWidth,
        })""")
        assert sizes['page'] <= sizes['viewport'] + 1 and sizes['contents'] <= sizes['panel'] + 1, sizes
        field('result').evaluate("el => el.scrollIntoView({block:'start', behavior:'instant'})")
        skip = page.locator('.skip').evaluate("""el => ({
          focused: el === document.activeElement, bottom: el.getBoundingClientRect().bottom,
        })""")
        assert not skip['focused'] and skip['bottom'] <= 0, skip
        page.screenshot(path=output / f'{engine.name}-320.png')
        if axe_path:
            page.add_script_tag(path=str(axe_path))
            violations = panel.evaluate("""async el => {
              const {violations} = await axe.run(el, {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
              return violations.map(issue => ({id:issue.id, targets:issue.nodes.map(node => node.target)}));
            }""")
            assert not violations, violations
        field('reset').tap()
        expect(field('result')).to_be_hidden()
        expect(field('preset')).to_have_value('reach')
        expect(field('brief')).to_have_value('')
        expect(field('reference')).to_have_value('')
        verify_draft_lifecycle(context, url, reference)
        verify_session_gating(browser, url, output, engine.name, reference)
        assert not errors and not writes, (errors, writes)
        report = {'engine': engine.name, 'kitchen': kitchen_scores, 'version': reach['engine']['version'], 'reach': reach['score'],
                  'push': push['score'], 'limitedPush': miss['score'], 'episodeSha256': sha256(push_bytes).hexdigest(),
                  'referenceSha256': sha256(reference).hexdigest(), 'repeatable': True,
                  'writes': writes, 'errors': errors, 'axeViolations': violations, 'replay3D':replay_3d, 'exampleFilmSeconds':film_seconds}
        (output / f'{engine.name}.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'{engine.name}: real MuJoCo {reach["engine"]["version"]} reach/push/miss, replay, repeat, ZIP, '
              '3D/fallback, worker cancellation, owner-only draft gate and 320px layout.', flush=True)
    finally:
        browser.close()


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog='Build the local MuJoCo, ZIP, and 3D vendor assets before testing. WORLD_BROWSERS defaults to chromium,webkit.',
    )
    parser.add_argument('--url', default=os.environ.get('WORLD_URL'),
                        help='World Builder URL with #layer-tab-robottask. Defaults to a loopback server for public assets.')
    parser.add_argument('--out', type=Path, help='Directory for receipts and screenshots. Defaults to a temporary directory.')
    parser.add_argument('--axe', type=Path, help='Optional local axe-core browser bundle for the 320px audit.')
    args = parser.parse_args()
    server = None
    try:
        if args.url:
            url = args.url
        else:
            server = StaticServer(('127.0.0.1', 0), partial(ShowcaseHandler, directory=str(PUBLIC)))
            Thread(target=server.serve_forever, daemon=True).start()
            url = f'http://127.0.0.1:{server.server_port}/world/index.html?nosw=1#layer-tab-robottask'
        with TemporaryDirectory() as temp, sync_playwright() as playwright:
            output = args.out or Path(temp)
            output.mkdir(parents=True, exist_ok=True)
            for engine in os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(','):
                verify_browser(getattr(playwright, engine), url, output, args.axe)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
