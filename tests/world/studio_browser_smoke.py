"""Exercise the World Builder studio: one bar for every tool and a workbench for separate tool pages.

Real browser, real static site, no worker and no uploads. Checks that every chapter lists its tools,
that in-page tools and workbench pages open without losing a map edit, that focus returns where it
came from, and that the bar holds together at 1360, 390 and 320 px with standard and larger text.
"""
from __future__ import annotations

import argparse
from functools import partial
import json
import os
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urldefrag

from playwright.sync_api import expect, sync_playwright

from stereo_depth_browser_smoke import PUBLIC, QuietHandler, StaticServer

CHAPTERS = ('robot', 'capture', 'scan', 'building', 'motion', 'share')
WORKBENCH_SAMPLES = ('/world/autonomy.html#view', '/world/sense-trial.html', '/arena/index.html')


def chapter_sizes(page):
    return page.evaluate("""async () => {
      const {chapters} = await import('./showcase-features.mjs');
      return Object.fromEntries(chapters.map(chapter => [chapter.id, chapter.features.length]));
    }""")


def make_map_edit(page):
    page.locator('#tab-world').click()
    name = page.locator('#object-name')
    draft = 'Studio keeps this authored edit'
    name.fill(draft)
    name.press('Tab')
    return {'name': draft, 'object': page.locator('#objects').input_value()}


def verify_map_edit(page, draft):
    page.locator('#tab-world').click()
    expect(page.locator('#objects')).to_have_value(draft['object'])
    expect(page.locator('#object-name')).to_have_value(draft['name'])


def open_chapter(page, key):
    button = page.locator(f'#studio-chapter-{key}')
    button.click()
    expect(button).to_have_attribute('aria-expanded', 'true')
    expect(page.locator('#studio-panel')).to_be_visible()
    return button


def verify_chapters(page, sizes):
    for key in CHAPTERS:
        button = open_chapter(page, key)
        tools = page.locator('#studio-panel .studio-tool')
        expect(tools).to_have_count(sizes[key])
        for card in tools.all():
            assert card.locator('strong').inner_text().strip()
            assert card.locator('.studio-access').inner_text().strip()
        expect(page.locator('#studio-panel .studio-tool').first).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#studio-panel')).to_be_hidden()
        expect(button).to_have_attribute('aria-expanded', 'false')
        expect(button).to_be_focused()
    expect(page.locator('[data-studio-chapter][aria-expanded="true"]')).to_have_count(0)


def verify_search(page):
    page.locator('#studio-search-open').click()
    search = page.locator('#studio-search')
    expect(search).to_be_focused()
    search.fill('drawings')
    expect(page.locator('#studio-panel .studio-tool').first).to_be_visible()
    hits = page.locator('#studio-panel .studio-tool').count()
    search.fill('route zzzznothing')
    expect(page.locator('#studio-panel .studio-tool')).to_have_count(0)
    expect(page.locator('#studio-panel .studio-panel-count')).to_contain_text('No tool matches')
    page.keyboard.press('Escape')
    expect(page.locator('#studio-panel')).to_be_hidden()
    expect(page.locator('#studio-search-open')).to_be_focused()
    return hits


def verify_in_page(page):
    open_chapter(page, 'robot')
    page.locator('#studio-panel [data-studio-target="tab:world"]').click()
    expect(page.locator('#tab-world')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#map-name')).to_be_focused()
    expect(page.locator('#map-name')).to_be_in_viewport()
    open_chapter(page, 'scan')
    page.locator('#studio-panel [data-studio-target="layer:repair"]').click()
    expect(page.locator('#layer-tab-repair')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#layer-panel-repair')).to_be_visible()
    expect(page.locator('#studio-chapter-scan')).to_have_class(re.compile(r'\bcurrent\b'))


def verify_workbench(page, target):
    path, fragment = urldefrag(target)
    chapter = 'robot'
    open_chapter(page, chapter)
    page.locator(f'#studio-panel [data-studio-target="{target}"]').click()
    workbench = page.locator('#studio-workbench')
    expect(workbench).to_be_visible()
    expect(page.locator('#studio-workbench-title')).to_be_focused()
    page.wait_for_function("""path => { try {
      const frame = document.getElementById('studio-workbench-frame');
      return frame.contentWindow.location.pathname === path && frame.contentDocument.readyState === 'complete';
    } catch { return false; } }""", arg=path)
    frame = page.frame_locator('#studio-workbench-frame')
    expect(frame.locator('#page-title' if path.startswith('/arena/') else 'h1').first).to_be_visible()
    state = page.locator('#studio-workbench-frame').evaluate("""frame => {
      const header = frame.contentDocument.querySelector('[data-studio-hidden=site-header]');
      return {hash: frame.contentWindow.location.hash.slice(1), header: header ? header.hidden : null,
              embedded: frame.contentDocument.documentElement.dataset.embedded || null};
    }""")
    assert state['embedded'] == 'studio', state
    # World pages lose their duplicate site header; the Arena keeps its own section navigation.
    assert state['header'] == (True if path.startswith('/world/') else None), (target, state)
    if fragment:
        assert state['hash'] == fragment, (target, state)
    # The workbench header stays readable below the bar after the page settles.
    page.wait_for_timeout(1800)
    bar = page.locator('#studio-bar').bounding_box()
    title = page.locator('#studio-workbench-title').bounding_box()
    assert title['y'] >= bar['y'] + bar['height'] - 1, (bar, title)
    expect(page.locator('#studio-workbench-tab')).to_have_attribute('target', '_blank')
    page.locator('#studio-workbench-close').click()
    expect(workbench).to_be_hidden()
    expect(page.locator(f'#studio-chapter-{chapter}')).to_be_focused()
    assert page.locator('#studio-workbench-frame').get_attribute('src') == 'about:blank'


def verify_home(page):
    open_chapter(page, 'robot')
    page.locator('#studio-panel [data-studio-target="/world/autonomy.html#view"]').click()
    expect(page.locator('#studio-workbench')).to_be_visible()
    page.locator('#studio-home').click()
    expect(page.locator('#studio-workbench')).to_be_hidden()
    expect(page.locator('#workspace')).to_be_in_viewport()
    expect(page.locator('#studio-world-name')).to_have_text(page.locator('#workspace-project-name').inner_text().strip())


def verify_layout(page, width):
    page.set_viewport_size({'width': width, 'height': 850})
    size = page.evaluate("""() => {
      const visible = [...document.querySelectorAll('#studio-bar > a, #studio-bar > button, #studio-chapters > button')]
        .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
      let overlaps = 0;
      for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i], b = visible[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
      }
      const small = [...document.querySelectorAll('#studio-sticky button, #studio-sticky a')]
        .filter(el => el.getClientRects().length && el.getBoundingClientRect().height < 44).length;
      return {viewport: innerWidth, page: document.documentElement.scrollWidth, overlaps, small};
    }""")
    assert size['page'] <= size['viewport'] + 1, size
    assert size['overlaps'] == 0 and size['small'] == 0, size
    open_chapter(page, 'capture')
    panel = page.locator('#studio-panel').bounding_box()
    bar = page.locator('#studio-bar').bounding_box()
    assert panel['y'] >= bar['y'] + bar['height'] - 1, (bar, panel)
    assert panel['x'] >= -1 and panel['x'] + panel['width'] <= width + 1, (panel, width)
    page.keyboard.press('Escape')
    return size


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
        response = page.goto(url, wait_until='domcontentloaded')
        assert response and response.ok, url
        expect(page.locator('#objects option').first).to_be_attached()
        expect(page.locator('#studio-chapters [data-studio-chapter]')).to_have_count(len(CHAPTERS))
        sizes = chapter_sizes(page)
        draft = make_map_edit(page)
        verify_chapters(page, sizes)
        hits = verify_search(page)
        verify_in_page(page)
        for target in WORKBENCH_SAMPLES:
            verify_workbench(page, target)
        verify_home(page)
        verify_map_edit(page, draft)
        page.locator('#studio-sticky').screenshot(path=output/f'{engine.name}-bar.png')
        layouts = {}
        for width in (390, 320):
            layouts[width] = verify_layout(page, width)
        page.locator('#playground-text-size').tap()
        expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
        layouts['320-large'] = verify_layout(page, 320)
        violations = None
        if axe_script:
            page.set_viewport_size({'width': 1360, 'height': 1000})
            open_chapter(page, 'robot')
            page.add_script_tag(path=str(axe_script))
            violations = page.locator('#studio-sticky').evaluate("""async el => {
              const options = {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}};
              const {violations} = await axe.run(el, options);
              return violations.map(issue => ({id: issue.id, targets: issue.nodes.map(node => node.target)}));
            }""")
            assert not violations, violations
        assert not errors and not writes, (errors, writes)
        report = {'engine': engine.name, 'chapters': sizes, 'searchHits': hits, 'workbench': list(WORKBENCH_SAMPLES),
                  'layouts': layouts, 'axeViolations': violations, 'pageErrors': errors, 'writes': writes}
        (output/f'{engine.name}-studio.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'{engine.name}: {sum(sizes.values())} tools in {len(sizes)} chapters, search, in-page tools, '
              f'{len(WORKBENCH_SAMPLES)} workbench pages, retained map edit, 390/320 px and larger text.', flush=True)
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
            server = StaticServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(PUBLIC)))
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
