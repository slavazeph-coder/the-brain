"""Local browser smoke for Phase 2 offline report, no network or operator uploads."""
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
HTML=ROOT/'brainsnn-r3f-app/public/world/fleet-evaluation.html'


def main():
    with sync_playwright() as p:
        executable=shutil.which('chromium')
        browser=p.chromium.launch(headless=True, executable_path=executable,
                                  args=['--no-sandbox'])
        try:
            page=browser.new_page(viewport={'width':1200,'height':830})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(HTML.read_text(),wait_until='load')
            assert page.title()=='Fleet Learning Evaluation | BrainSNN'
            assert page.locator('#results').is_hidden()
            page.locator('#sample').click()
            assert page.locator('#results').is_visible()
            assert page.locator('#base-val').inner_text()=='21/24'
            assert page.locator('#transfer-val').inner_text()=='17/24'
            assert page.locator('#rows tr').count()==24
            assert 'Negative result' in page.locator('#interpretation').inner_text()
            page.locator('#clear').click()
            assert page.locator('#results').is_hidden()
            assert not errors, errors
            print('Phase 2 browser smoke PASS')
        finally:browser.close()

if __name__=='__main__':main()
