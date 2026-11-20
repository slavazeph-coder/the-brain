"""Local browser smoke for Phase 2 offline report, no network or operator uploads."""
from pathlib import Path
import json
import shutil
import sys
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
HTML=ROOT/'brainsnn-r3f-app/public/world/fleet-evaluation.html'
sys.path.insert(0, str(ROOT))
from robotics.world_worker import fleet_field_trial as field
from robotics.world_worker.fleet_campaign import sample_fixture


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
            with TemporaryDirectory() as tmp:
                sample, trial = Path(tmp) / 'fixture', Path(tmp) / 'trial'
                sample_fixture(sample)
                map_dir = sample / 'candidate-map'
                field.prepare(map_dir, trial, start=(3,10), goal=(22,10), robot_id='fixture', radius=.2,
                              speed=.45, tolerance=.25, attempts=3, basis='authored-synthetic')
                field.record(trial, 1, 'reached-unassisted', poses=sample / 'robot-poses.csv')
                field.record(trial, 2, 'intervention', reason='<b>Operator stopped</b>')
                report = field.report(trial, map_dir)
                def upload(data):
                    page.locator('#file').set_input_files({'name':'report.json','mimeType':'application/json',
                                                           'buffer':json.dumps(data).encode()})
                upload(report)
                page.locator('#field').wait_for()
                assert page.locator('#field-basis').inner_text() == 'Authored synthetic trial'
                assert page.locator('#field-reaches').inner_text() == page.locator('#field-consistent').inner_text() == '1/3'
                assert page.locator('#field-pending').inner_text() == '1'
                assert page.locator('#field-rows tr').count() == 3
                assert '<b>Operator stopped</b>' in page.locator('#field-rows').inner_text()
                assert page.locator('#field-rows b').count() == 0
                page.locator('#sample').click()
                assert page.locator('#field').is_hidden() and page.locator('#results').is_visible()
                report['summary']['consistentReaches'] = 3
                upload(report)
                page.wait_for_function("document.getElementById('status').textContent.includes('Rejected')")
                assert page.locator('#field').is_hidden() and page.locator('#results').is_hidden()
            assert not errors, errors
            print('Phase 2 browser smoke PASS')
        finally:browser.close()

if __name__=='__main__':main()
