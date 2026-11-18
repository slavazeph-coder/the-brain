"""Real-browser checks for the robot-first playground: choose a robot, build its world, let it try.

Covers the robot and world cards, Let it try, the camera buttons, tapping a box on the map, the
object buttons, undo/redo of map edits (an undone map still needs review), More contrast, and
large-target/readable-text layouts at phone widths. The planner is the real browser planner on
the authored sample; no model output is substituted. WORLD_URL, WORLD_BROWSERS and WORLD_SMOKE_OUT
follow the other World browser smoke scripts.
"""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
URL = os.environ.get('WORLD_URL', 'http://127.0.0.1:4180/world/index.html?nosw=1')
BROWSERS = os.environ.get('WORLD_BROWSERS', 'chromium,webkit').split(',')
OUTPUT = Path(os.environ.get('WORLD_SMOKE_OUT', str(ROOT / 'output/playwright/world')))
ROBOTS = ['cleaner', 'vacuum', 'amr', 'humanoid', 'forklift']


def open_world(page):
    response = page.goto(URL, wait_until='domcontentloaded')
    assert response and response.ok, f'World document failed: {response}'
    expect(page.locator('#objects option').first).to_be_attached()
    expect(page.locator('#robot-setup [data-robot]')).to_have_count(len(ROBOTS))


def pressed(page, selector):
    return page.locator(selector).get_attribute('aria-pressed') == 'true'


def object_count(page):
    return page.locator('#objects option').count()


def canvas_png(page):
    return page.locator('#world-canvas').screenshot()


def check_robots(page):
    assert pressed(page, '[data-robot=cleaner]'), 'The cleaning robot starts chosen'
    before = canvas_png(page)
    page.locator('[data-robot=forklift]').click()
    assert pressed(page, '[data-robot=forklift]') and not pressed(page, '[data-robot=cleaner]')
    assert canvas_png(page) != before, 'The chosen robot body is drawn on the map'
    # The card and the existing robot list are the same choice, both ways.
    page.locator('#tab-test').click()
    expect(page.locator('#robot')).to_have_value('forklift')
    page.locator('#robot').select_option('vacuum')
    expect(page.locator('[data-robot=vacuum]')).to_have_attribute('aria-pressed', 'true')
    page.locator('#tab-world').click()
    # Keyboard: a focused card is chosen with Space.
    page.locator('[data-robot=cleaner]').focus()
    page.keyboard.press('Space')
    expect(page.locator('[data-robot=cleaner]')).to_have_attribute('aria-pressed', 'true')


def check_let_it_try(page):
    run = page.locator('#robot-setup-run')
    expect(run).to_be_enabled()
    run.click()
    page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')", timeout=30000)
    expect(page.locator('#status')).to_contain_text('Planning preview complete')
    expect(page.locator('#robot-setup-note')).to_contain_text('simulation')


def check_camera(page):
    before = canvas_png(page)
    page.locator('#cam-left').click()
    turned = canvas_png(page)
    assert turned != before, 'Turn left changes the view'
    page.locator('#cam-in').click()
    assert canvas_png(page) != turned, 'Zoom in changes the view'
    page.locator('#cam-names').click()
    assert pressed(page, '#cam-names')
    page.locator('#cam-names').click()
    page.locator('#reset-view').click()


def check_tap_to_choose(page):
    canvas = page.locator('#world-canvas')
    box = canvas.bounding_box()
    start = page.locator('#objects').input_value()
    for row in range(2, 9):
        for col in range(2, 12):
            page.mouse.click(box['x'] + box['width'] * col / 13, box['y'] + box['height'] * row / 10)
            if page.locator('#objects').input_value() != start:
                chosen = page.locator('#objects').input_value()
                chip = page.locator(f'[data-object-chip="{chosen}"]')
                expect(chip).to_have_attribute('aria-pressed', 'true')
                return
    raise AssertionError('Tapping the map never chose an object')


def check_chips(page):
    chips = page.locator('[data-object-chip]')
    assert chips.count() == object_count(page), 'One button per object'
    last = chips.nth(chips.count() - 1)
    target = last.get_attribute('data-object-chip')
    last.click()
    expect(page.locator('#objects')).to_have_value(target)
    expect(page.locator(f'[data-object-chip="{target}"]')).to_have_attribute('aria-pressed', 'true')


def check_undo(page):
    count = object_count(page)
    expect(page.locator('#undo-edit')).to_be_disabled()
    page.locator('[data-action=remove-object]').click()
    expect(page.locator('#objects option')).to_have_count(count - 1)
    expect(page.locator('#undo-edit')).to_be_enabled()
    page.locator('#undo-edit').click()
    expect(page.locator('#objects option')).to_have_count(count)
    expect(page.locator('#status')).to_contain_text('Change undone')
    # The restored geometry is not trusted until a person reviews it again.
    page.locator('#tab-world').click()
    expect(page.locator('#map-reviewed')).not_to_be_checked()
    expect(page.locator('#robot-setup-note')).to_contain_text('Before it can try')
    page.locator('#redo-edit').click()
    expect(page.locator('#objects option')).to_have_count(count - 1)
    page.locator('body').click(position={'x': 5, 'y': 5})
    page.keyboard.press('Control+z')
    expect(page.locator('#objects option')).to_have_count(count)


def check_worlds(page):
    page.on('dialog', lambda dialog: dialog.accept())
    page.locator('[data-world=empty]').click()
    expect(page.locator('[data-world=empty]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#world-title')).to_have_text('My measured space')
    expect(page.locator('#object-chooser')).to_be_hidden()
    page.locator('[data-world=sample]').click()
    expect(page.locator('[data-world=sample]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#world-title')).to_have_text('Studio 01 / training floor')
    page.locator('[data-world=street]').click()
    expect(page.locator('#street-workspace')).to_be_visible(timeout=45000)
    expect(page.locator('[data-world=street]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#robot-setup-run')).to_contain_text('Open street routes')
    expect(page.locator('#undo-edit')).to_be_hidden()
    page.locator('[data-world=sample]').click()
    expect(page.locator('#map-workspace')).to_be_visible()
    expect(page.locator('[data-world=sample]')).to_have_attribute('aria-pressed', 'true')


def check_contrast(page):
    button = page.locator('#playground-contrast')
    button.click()
    assert page.evaluate("document.documentElement.dataset.contrast") == 'more'
    expect(button).to_have_attribute('aria-pressed', 'true')
    open_world(page)
    assert page.evaluate("document.documentElement.dataset.contrast") == 'more', 'More contrast is remembered'
    page.locator('#playground-contrast').click()
    assert page.evaluate("document.documentElement.dataset.contrast || ''") == ''


def check_big_robot(page):
    # The forklift does not fit the sample's corner start. The setup says so, offers the planner's nearest
    # fitting spot, and then sends the person to the map check that the moved start requires.
    page.locator('[data-robot=forklift]').click()
    page.locator('#robot-setup-run').click()
    expect(page.locator('#robot-setup-note')).to_contain_text('too big for its starting spot', timeout=30000)
    fix = page.locator('#robot-setup-fix')
    expect(fix).to_have_text('Move the start to where it fits')
    fix.click()
    expect(page.locator('#status')).to_contain_text('Start moved to where the compact forklift fits')
    expect(page.locator('#robot-setup-note')).to_contain_text('Before it can try')
    expect(fix).to_have_text('Show me what to check')
    fix.click()
    expect(page.locator('#map-reviewed')).to_be_focused()
    page.locator('#map-reviewed').check()
    expect(fix).to_be_hidden()
    page.locator('#robot-setup-run').click()
    page.wait_for_function("document.querySelector('#metric-distance').textContent.includes('m')", timeout=30000)


def check_readable(page, label):
    size = page.evaluate("""() => ({viewport: innerWidth,
      page: document.documentElement.scrollWidth, body: document.body.scrollWidth})""")
    assert max(size['page'], size['body']) <= size['viewport'] + 1, f'{label}: overflow {size}'
    small = page.evaluate("""() => [...document.querySelectorAll('#robot-setup button, .camera-dock button, #object-chips button, .edit-step')]
      .filter(b => b.offsetParent).map(b => b.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).length""")
    assert small == 0, f'{label}: {small} setup or camera buttons are smaller than 44 px'
    tiny = page.evaluate("""() => [...document.querySelectorAll('#robot-setup *, .camera-dock *, #object-chooser *')]
      .filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
      .filter(e => parseFloat(getComputedStyle(e).fontSize) < 13).map(e => e.textContent.trim().slice(0, 30))""")
    assert not tiny, f'{label}: text under 13 px: {tiny}'


def run_browser(playwright, name):
    browser = getattr(playwright, name).launch()
    try:
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        open_world(page)
        check_robots(page)
        check_let_it_try(page)
        check_camera(page)
        check_tap_to_choose(page)
        check_chips(page)
        check_undo(page)
        check_worlds(page)
        check_contrast(page)
        check_big_robot(page)
        page.screenshot(path=str(OUTPUT / f'robot-setup-{name}-desktop.png'))
        context.close()
        for width in (320, 390):
            for large in (False, True):
                context = browser.new_context(viewport={'width': width, 'height': 844}, has_touch=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                if large:
                    page.add_init_script("localStorage.setItem('brainsnn-world-reading-size','large')")
                open_world(page)
                page.locator('#robot-setup').scroll_into_view_if_needed()
                check_readable(page, f'{name} {width}px {"large" if large else "standard"}')
                page.screenshot(path=str(OUTPUT / f'robot-setup-{name}-{width}{"-large" if large else ""}.png'), full_page=False)
                context.close()
        assert not errors, f'{name} page errors: {errors}'
    finally:
        browser.close()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        for name in BROWSERS:
            run_browser(playwright, name.strip())
            print(f'robot setup browser smoke passed in {name}')


if __name__ == '__main__':
    main()
