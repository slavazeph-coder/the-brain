"""What-if in the browser: route to a spot on a reviewed map, remove the obstacle in the way, see the gate close, review
again, route again, read the comparison. Real HTTP, real planner, no robot. WORLD_URL and WORLD_BROWSERS as browser_smoke."""
import json
import os
from playwright.sync_api import sync_playwright

URL = os.environ.get('WORLD_URL', 'http://127.0.0.1:4180/') + 'world/index.html'
BROWSERS = os.environ.get('WORLD_BROWSERS', 'chromium').split(',')
WORLD = {'schema': 'brainsnn.world.v1', 'name': 'What-if fixture', 'width': 10, 'depth': 6, 'provenance': 'observed', 'scaleReviewed': True,
         'mapReviewed': True, 'start': {'x': 1.0, 'z': 3.0},
         'objects': [{'id': 'cart', 'name': 'golf cart', 'kind': 'obstacle', 'x': 4.0, 'z': 2.0, 'w': 1.2, 'd': 2.0, 'h': 1.8}]}


def check(playwright, name):
    browser = getattr(playwright, name).launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.goto(URL, wait_until='networkidle')
    page.locator('#files').set_input_files({'name': 'what-if.json', 'mimeType': 'application/json', 'buffer': json.dumps(WORLD).encode()})
    page.wait_for_function("document.querySelector('#world-title').textContent==='What-if fixture'")
    # An import is reviewed by the person, never by the file.
    page.locator('#scale-reviewed').check(); page.locator('#map-reviewed').check()
    page.locator('[data-tab=test]').click()
    page.locator('.goal-spot summary').click()
    page.locator('#goal-x').fill('8.5'); page.locator('#goal-x').dispatch_event('change')
    page.locator('#goal-z').fill('3'); page.locator('#goal-z').dispatch_event('change')
    page.locator('[data-action=route-spot]').click()
    page.wait_for_function("document.querySelector('#status').textContent.startsWith('Route to the spot:')")
    before = float(page.locator('#status').text_content().split(':')[1].split('m')[0])
    assert before > 7.8, before  # the cart stands across the straight line (7.5 m); the route goes around it
    # The receipt says why: the cart on the straight line, the tightest point, and which envelopes can make the trip.
    receipt = page.locator('.route-receipt'); assert receipt.count() == 1, 'route receipt card'
    text = receipt.text_content(); assert 'straight line' in text and 'cart' in text.lower() and 'Compact forklift' in text, text[:300]
    assert page.locator('.fleet-fit li').count() >= 5, 'one row per envelope'
    # Edit: remove the cart. The map goes back to review and the card asks for it.
    page.locator('[data-tab=world]').click()
    page.select_option('#objects', 'cart')
    page.locator('[data-action=remove-object]').click()
    page.locator('[data-tab=test]').click()
    card = page.locator('[data-testid=what-if]')
    assert 'removed golf cart' in card.text_content() and f'{before:.1f} m' in card.text_content(), card.text_content()
    assert page.locator('[data-action=what-if-route]').is_disabled()
    # Review the edited map, then route again to the same spot.
    page.locator('[data-tab=world]').click()
    page.locator('#map-reviewed').check()
    page.locator('[data-tab=test]').click()
    assert page.locator('[data-action=what-if-route]').is_enabled()
    page.locator('[data-action=what-if-route]').click()
    page.wait_for_function("document.querySelector('[data-testid=what-if]').textContent.includes('→')")
    text = page.locator('[data-testid=what-if]').text_content()
    after = float(text.split('→')[1].split('m')[0])
    assert after < before - 0.5 and 'removed golf cart' in text and 'no robot was moved' in text, text
    assert page.evaluate("document.querySelector('#status').textContent").startswith('Same spot, same robot')
    # A fresh import drops the comparison.
    page.locator('#files').set_input_files({'name': 'what-if-2.json', 'mimeType': 'application/json', 'buffer': json.dumps({**WORLD, 'name': 'Other'}).encode()})
    page.wait_for_function("document.querySelector('#world-title').textContent==='Other'")
    page.locator('[data-tab=test]').click()
    assert page.locator('[data-testid=what-if]').count() == 0
    print(f'{name}: what-if route {before:.1f} m -> {after:.1f} m after removing the cart; gate, review and comparison verified')
    browser.close()


with sync_playwright() as playwright:
    for name in BROWSERS:
        check(playwright, name.strip())
