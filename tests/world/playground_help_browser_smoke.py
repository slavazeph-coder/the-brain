"""Real-browser playground help and reading checks, with no model output substituted.

The speech API is an explicit wiring fixture: it records user-initiated requests and
cancellation, not audible speech quality. WORLD_URL accepts the complete World URL;
WORLD_BROWSERS and WORLD_CHROME_PATH follow the other World browser smoke scripts.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
URL = os.environ.get('WORLD_URL', 'http://127.0.0.1:4181/world/index.html?nosw=1')
BROWSERS = os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(',')
OUTPUT = Path(os.environ.get('WORLD_SMOKE_OUT', str(ROOT / 'output/playwright/world')))

SPEECH_WIRING_FIXTURE = """(() => {
  const state = window.helpSpeechFixture = {speaks: [], cancels: 0, click: null};
  document.addEventListener('click', event => {
    state.click = {id: event.target.closest('button')?.id, trusted: event.isTrusted};
  }, true);
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable: true,
    value: class {constructor(text) {this.text = text;}}});
  Object.defineProperty(window, 'speechSynthesis', {configurable: true, value: {
    speak(utterance) {state.speaks.push({text: utterance.text, click: state.click});},
    cancel() {state.cancels++;}
  }});
})();"""


def open_world(page):
    response = page.goto(URL, wait_until='domcontentloaded')
    assert response and response.ok, f'World document failed: {response}'
    expect(page.locator('#objects option').first).to_be_attached()
    expect(page.locator('#playground-help-open')).to_be_enabled()
    # The module initializes this state, unlike merely receiving the HTML.
    expect(page.locator('#playground-help-speak')).not_to_have_attribute('hidden', '')


def no_overflow(page, label):
    size = page.evaluate("""() => ({viewport: innerWidth,
      page: document.documentElement.scrollWidth, body: document.body.scrollWidth})""")
    assert max(size['page'], size['body']) <= size['viewport'] + 1, f'{label}: {size}'


def help_open(page):
    # Check native keyboard focus restoration; WebKit mouse clicks do not focus buttons by default.
    opener = page.locator('#playground-help-open')
    opener.focus()
    opener.press('Enter')
    expect(page.locator('#playground-help')).to_be_visible()
    assert page.locator('#playground-help').evaluate("el => el.matches(':modal')")


def check_menu(page):
    opener = page.locator('#studio-search-open')
    opener.click()
    search = page.locator('#studio-search')
    expect(search).to_be_focused()
    expected = (
        ('photo and video studio', '/scan'),
        ('move blocks', '/arena/index.html'),
        ('compare a model', '/world/facility.html#facility-example'),
        ('review human movement', '/world/movement.html#trial-demo'),
        ('processing api', '/world/api.html'),
        ('compare routes between robots', '/world/fleet-learning.html#record'),
        ('classic', '/?classic=1'),
    )
    for query, target in expected:
        search.fill(query)
        result = page.locator(f'#studio-panel [data-studio-target="{target}"]')
        result.click(trial=True)
        box = result.bounding_box()
        assert box and box['x'] >= -1 and box['x'] + box['width'] <= page.viewport_size['width'] + 1
    no_overflow(page, 'open tool library')
    search.focus()
    page.keyboard.press('Escape')
    expect(page.locator('#studio-panel')).to_be_hidden()
    expect(opener).to_be_focused()


def check_browser(playwright, name):
    launch = {'headless': True}
    if name == 'chromium' and os.environ.get('WORLD_CHROME_PATH'):
        launch['executable_path'] = os.environ['WORLD_CHROME_PATH']
    browser = getattr(playwright, name).launch(**launch)
    context = browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce')
    context.add_init_script(SPEECH_WIRING_FIXTURE)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        open_world(page)
        assert page.evaluate('helpSpeechFixture.speaks.length') == 0
        help_open(page)
        assert page.evaluate('helpSpeechFixture.speaks.length') == 0, 'Opening help must not start audio'
        page.keyboard.press('Escape')
        expect(page.locator('#playground-help')).not_to_be_visible()
        expect(page.locator('#playground-help-open')).to_be_focused()

        # Edit a real sample object, then navigate help shortcuts without losing the edit or granting review.
        page.locator('#tab-world').click()
        edited_name = 'My unchanged playground object'
        page.locator('#object-name').fill(edited_name)
        page.locator('#object-name').press('Tab')
        expect(page.locator('#map-reviewed')).not_to_be_checked()
        for tool in ('test', 'capture', 'world'):
            help_open(page)
            page.locator(f'[data-help-tool="{tool}"]').click()
            expect(page.locator('#playground-help')).not_to_be_visible()
            expect(page.locator(f'#tab-{tool}')).to_have_attribute('aria-selected', 'true')
            expect(page.locator('#panel')).to_have_attribute('aria-labelledby', f'tab-{tool}')
            expect(page.locator('#object-name')).to_have_value(edited_name)
        expect(page.locator('#map-reviewed')).not_to_be_checked()

        # Explicit speech wiring fixture: actual clicks, only visible help copy, no autoplay.
        help_open(page)
        copy = page.locator('#playground-help-copy').evaluate("el => el.innerText.replace(/\\s+/g, ' ').trim()")
        speak = page.locator('#playground-help-speak')
        speak.click()
        expect(speak).to_have_attribute('aria-pressed', 'true')
        recorded = page.evaluate('helpSpeechFixture.speaks')
        assert recorded == [{'text': copy, 'click': {'id': 'playground-help-speak', 'trusted': True}}]
        speak.click()
        expect(speak).to_have_attribute('aria-pressed', 'false')
        assert page.evaluate('helpSpeechFixture.cancels') == 1
        speak.click()
        page.keyboard.press('Escape')
        expect(page.locator('#playground-help')).not_to_be_visible()
        expect(page.locator('#playground-help-open')).to_be_focused()
        page.wait_for_function('helpSpeechFixture.cancels === 2')
        help_open(page)
        speak.click()
        page.locator('#playground-help-close').click()
        expect(page.locator('#playground-help-open')).to_be_focused()
        assert page.evaluate('helpSpeechFixture.cancels') == 3

        # Persist larger text through a real navigation; pagehide must also cancel active reading.
        page.locator('#playground-text-size').click()
        expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
        help_open(page)
        speak.click()
        page.evaluate("""() => addEventListener('pagehide', () => {
          localStorage.setItem('help-test-pagehide-cancels', String(helpSpeechFixture.cancels));
        }, {once: true})""")
        page.reload(wait_until='domcontentloaded')
        expect(page.locator('#objects option').first).to_be_attached()
        expect(page.locator('#playground-text-size')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('html')).to_have_attribute('data-reading-size', 'large')
        assert page.evaluate("localStorage.getItem('help-test-pagehide-cancels')") == '4'
        assert page.locator('#object-name').evaluate('el => parseFloat(getComputedStyle(el).fontSize)') >= 18
        assert page.evaluate('helpSpeechFixture.speaks.length') == 0, 'Reload must not start audio'

        layouts = []
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            for large in (False, True):
                toggle = page.locator('#playground-text-size')
                if (toggle.get_attribute('aria-pressed') == 'true') != large:
                    toggle.click()
                expect(toggle).to_have_attribute('aria-pressed', str(large).lower())
                if large:
                    assert page.locator('#object-name').evaluate('el => parseFloat(getComputedStyle(el).fontSize)') >= 18
                no_overflow(page, f'{width}px / large={large}')
                check_menu(page)
                help_open(page)
                dialog_size = page.locator('#playground-help').evaluate('el => ({scroll: el.scrollWidth, client: el.clientWidth})')
                assert dialog_size['scroll'] <= dialog_size['client'] + 1, dialog_size
                no_overflow(page, f'open help / {width}px / large={large}')
                page.screenshot(path=str(OUTPUT / f'playground-help-{name}-{width}-{"large" if large else "standard"}.png'))
                page.keyboard.press('Escape')
                expect(page.locator('#playground-help-open')).to_be_focused()
                layouts.append({'width': width, 'large': large, 'horizontalOverflow': False})
        assert not errors, errors
        receipt = {'browser': name, 'layouts': layouts, 'dialogFocus': 'passed',
                   'editedObjectPreserved': True, 'reviewNotGranted': True,
                   'largeTextPersisted': True, 'speech': 'fixture wiring only; audible quality not tested'}
        (OUTPUT / f'playground-help-{name}.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(f'{name}: playground help, preserved edit, large text, menus, 390/320px layouts, speech wiring PASS', flush=True)
    finally:
        context.close()
        browser.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        for name in BROWSERS:
            check_browser(playwright, name.strip())


if __name__ == '__main__':
    main()
