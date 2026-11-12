"""Autonomy trial in the browser over real HTTP: the live loop runs, a crate drops and the route replans, a button
drops another, and a paired trial completes, downloads a sealed report and verifies it. Kinematic simulation only;
no robot, model or network call. WORLD_URL and WORLD_BROWSERS as browser_smoke."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('WORLD_URL', 'http://127.0.0.1:4180/') + 'world/autonomy.html'
BROWSERS = os.environ.get('WORLD_BROWSERS', 'chromium').split(',')
OUT = Path(os.environ.get('WORLD_SMOKE_OUT', 'output/playwright/world'))


def check(playwright, name, viewport, label):
    launch = {'executable_path': os.environ['WORLD_CHROME_PATH']} if name == 'chromium' and os.environ.get('WORLD_CHROME_PATH') else {}
    browser = getattr(playwright, name).launch(**launch)
    try:
        page = browser.new_page(viewport=viewport, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(URL, wait_until='networkidle')
        assert page.title() == 'Autonomy Trial | BrainSNN'
        # The demo starts by itself and drops a crate 4 s in; the robot has to see it and replan.
        page.wait_for_function("document.querySelector('#log').textContent.includes('Crate dropped')", timeout=30000)
        page.wait_for_function("/Replanned in [0-9.]+ ms/.test(document.querySelector('#log').textContent) || document.querySelector('#log').textContent.includes('no way around')", timeout=30000)
        hud = page.locator('#hud').inner_text()
        assert 'plans' in hud and 'map 4 cm' in hud, hud
        OUT.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(OUT / f'autonomy-{name}-{label}.png'), full_page=False)
        # Another crate on demand.
        before = page.locator('#log li').count()
        page.locator('#crate').click()
        page.wait_for_function(f"document.querySelectorAll('#log li').length > {before}", timeout=15000)
        # A short paired trial in the worker: five tasks, ten runs, sealed and verifiable.
        page.select_option('#t-episodes', '5')
        page.locator('#t-run').click()
        page.wait_for_selector('#trial-results:not([hidden])', timeout=180000)
        assert page.locator('#t-rows tr').count() == 5
        assert 'when broken on purpose' in page.locator('#t-interpretation').inner_text()
        assert page.locator('#t-seal').inner_text().startswith('SHA-256 ')
        with page.expect_download() as info:
            page.locator('#t-download').click()
        path = info.value.path()
        report = json.loads(Path(path).read_text())
        assert report['schema'] == 'brainsnn.autonomy-trial.v1' and report['claims']['physicalRobotExecuted'] is False
        page.locator('#t-verify').set_input_files(path)
        page.wait_for_function("document.querySelector('#t-status').textContent.startsWith('Verified')", timeout=15000)
        report['summary']['broken']['reached'] = -1
        page.locator('#t-verify').set_input_files({'name': 'tampered.json', 'mimeType': 'application/json', 'buffer': json.dumps(report).encode()})
        page.wait_for_function("document.querySelector('#t-status').textContent.includes('changed after it was sealed')", timeout=15000)
        page.screenshot(path=str(OUT / f'autonomy-{name}-{label}-trial.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'no horizontal page scroll'
        assert not errors, errors
        print(f'{name} {label} autonomy smoke PASS')
    finally:
        browser.close()


def main():
    with sync_playwright() as playwright:
        for name in BROWSERS:
            check(playwright, name, {'width': 1280, 'height': 900}, 'desktop')
            check(playwright, name, {'width': 390, 'height': 844}, 'phone')


if __name__ == '__main__':
    main()
