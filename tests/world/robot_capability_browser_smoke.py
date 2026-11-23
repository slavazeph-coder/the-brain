"""Exercise shared profiles, real MuJoCo, kinematics, telemetry and local BIM intake."""
from __future__ import annotations

import argparse
from functools import partial
import json
import math
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import expect, sync_playwright
from stereo_depth_browser_smoke import PUBLIC, StaticServer
from world_showcase_browser_smoke import ShowcaseHandler


def downloaded_json(page, control):
    with page.expect_download() as pending:
        control.click()
    return json.loads(pending.value.path().read_text())


def smoke(origin: str, output: Path):
    with sync_playwright() as pw:
        launch = dict(headless=True, args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        if os.environ.get('BROWSER_EXECUTABLE'):
            launch['executable_path'] = os.environ['BROWSER_EXECUTABLE']
        browser = pw.chromium.launch(**launch)
        context = browser.new_context(viewport={'width': 1360, 'height': 1000}, reduced_motion='reduce', accept_downloads=True)
        page = context.new_page()
        errors, remote_writes = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def guard(route):
            if route.request.method not in ('GET', 'HEAD', 'OPTIONS'):
                remote_writes.append(route.request.url)
                route.abort()
            else:
                route.continue_()

        page.route('**/*', guard)
        page.goto(origin + '/world/index.html?nosw=1#layer-tab-robotcapability', wait_until='domcontentloaded')
        panel = page.locator('#layer-panel-robotcapability')
        try:
            expect(panel).to_be_visible(timeout=15000)
        except AssertionError:
            if errors:
                raise AssertionError(f'World Builder failed to initialize: {errors}')
            raise
        expect(page.locator('#layer-tab-robotcapability')).to_have_attribute('aria-selected', 'true')
        cap = lambda key: panel.locator(f'[data-cap-{key}]')
        field = lambda key: panel.locator(f'[data-cap-field="{key}"]')
        cap('profile').locator('summary').first.click()
        cap('name').fill('Measured test robot')
        field('speedMps').fill('0.35')
        panel.locator('summary').filter(has_text='Optional motor, driver and thermal model').click()
        motor = dict(voltageV=24, currentLimitA=5, torqueConstantNmPerA=.1, resistanceOhm=1,
                     gearRatio=10, efficiency=.8, backEmfVPerRadPerSecond=.1, noLoadCurrentA=.2,
                     driverResistanceOhm=.05, auxiliaryPowerW=10, thermalResistanceKPerW=10,
                     thermalCapacityJPerK=100, ambientC=20, temperatureLimitC=80)
        for key, value in motor.items():
            panel.locator(f'[data-cap-motor="{key}"]').fill(str(value))
        cap('apply').click()
        expect(cap('status')).to_contain_text('profile applied')
        expect(page.locator('[data-picked-robot]')).to_have_text('Measured test robot')
        cap('profile').locator('summary').first.click()
        field('goalX').fill('2.2')
        field('goalZ').fill('1')
        cap('prepare').click()
        expect(cap('recorder').locator('[data-run-start]')).to_be_enabled()
        cap('recorder').locator('[data-run-driver]').select_option('mppi')
        cap('recorder').locator('[data-run-start]').click()
        print('Recording real MuJoCo route in browser', flush=True)
        expect(cap('recorder').locator('[data-run-result]')).to_be_visible(timeout=60000)
        expect(cap('drive-result')).to_be_visible()
        expect(cap('motor-chart')).to_be_visible()
        bundle = downloaded_json(page, cap('report'))
        episode = bundle['recording']
        assert episode['schema'] == 'brainsnn.robot-capability-episode.v2'
        assert episode['robotCapability']['name'] == 'Measured test robot'
        assert episode['provenance']['physicsExecuted'] is True
        assert episode['provenance']['physicalValidated'] is False
        assert episode['provenance']['controllerKind'] == 'mppi'
        assert episode['score']['success'] is True, episode['score']
        assert len(episode['capabilitySha256']) == 64
        frames = episode['frames']
        assert math.dist(frames[0]['position'], frames[-1]['position']) > .5
        assert any(abs(t) > 0 for f in frames for t in f.get('wheelTorqueNm', []))
        assert bundle['drive']['metrics']['maximumMotorCurrentA'] is not None
        assert bundle['drive']['metrics']['maximumModelledTemperatureC'] is not None
        (output / 'capability-recording.json').write_text(json.dumps(bundle, indent=2))
        print('Physics and modelled motor results passed', flush=True)
        panel.screenshot(path=output / 'robot-capability-desktop.png')

        # A new profile cannot relabel a completed recording.
        cap('profile').locator('summary').first.click()
        cap('name').fill('Changed after recording')
        cap('apply').click()
        expect(cap('frozen')).to_contain_text('earlier snapshot')
        changed = downloaded_json(page, cap('report'))
        assert changed['recording']['robotCapability']['name'] == 'Measured test robot'
        assert changed['activeProfile']['name'] == 'Changed after recording'
        cap('profile').locator('summary').first.click()

        panel.locator('[data-cap-view="arm"]').click()
        cap('arm-solve').click()
        expect(cap('arm-status')).to_contain_text('Target reached')
        arm = downloaded_json(page, cap('report'))['arm']
        assert arm['result']['pathValid'] and arm['result']['configurationValid']
        assert arm['result']['dynamicsValidated'] is False
        assert arm['input']['baseRegistration']['pose']['position'] == dict(zip(('x', 'y', 'z'), frames[0]['positionXYZ']))
        field('targetX').fill('2')
        cap('arm-solve').click()
        expect(cap('arm-status')).to_contain_text('did not pass')
        assert not downloaded_json(page, cap('report'))['arm']['result']['reachable']
        cap('arm-example').click()
        cap('arm-solve').click()
        panel.screenshot(path=output / 'arm-check.png')
        print('Reachable and unreachable arm checks passed', flush=True)

        # Synthetic matched poses test plumbing only; receipt retains synthetic provenance.
        samples = []
        for f in frames:
            position = f.get('positionXYZ', [f['position'][0], -f['position'][1], f.get('heightMeters', 0)])
            if isinstance(position, dict):
                xyz = position
            else:
                xyz = dict(zip(('x', 'y', 'z'), position))
            q = f.get('quaternionWxyz', [1, 0, 0, 0])
            samples.append({'t': f['time'], 'pose': {'position': xyz, 'orientation': {'w': q[0], 'x': q[1], 'y': q[2], 'z': q[3]}}, 'state': 'tracking'})
        payload = {'origin': 'synthetic-browser-test', 'frameId': 'map', 'samples': samples}
        panel.locator('[data-cap-view="compare"]').click()
        cap('telemetry').set_input_files({'name': 'synthetic-fixture.json', 'mimeType': 'application/json', 'buffer': json.dumps(payload).encode()})
        expect(cap('telemetry-status')).to_contain_text('imported samples')
        cap('compare').click()
        expect(cap('telemetry-status')).to_contain_text('needs-registration')
        cap('registered').check()
        cap('time-confirmed').check()
        cap('compare').click()
        expect(cap('telemetry-status')).to_contain_text('compared')
        result = downloaded_json(page, cap('report'))
        comparison = result['comparison']
        assert comparison['matchedSamples'] == len(samples)
        assert comparison['metrics']['positionErrorM']['rms'] < 1e-6, comparison['metrics']
        assert comparison['provenance']['physicalAccuracyVerified'] is False
        assert result['telemetry']['recording']['provenance']['producerOrigin'] == 'synthetic-browser-test'
        expect(cap('comparison-svg')).to_be_visible()
        print('Registered telemetry comparison passed', flush=True)

        # JSON declarations initialize units; fitted bytes cannot become held-out by renaming.
        calibration_payload = {'origin': 'synthetic-calibration-browser-test', 'frameId': 'robot_map',
                               'units': {'time': 'ms', 'length': 'mm', 'angle': 'rad'},
                               'referenceIndependent': True, 'poseSource': 'independent-reference',
                               'samples': [{'t': i*500, 'position': [1000+200*i, -1000, 0],
                                            'orientation': [0, 0, 0, 1], 'state': 'tracking',
                                            'wheelPositionRad': [2*i, 2*i]} for i in range(4)]}
        calibration_bytes = json.dumps(calibration_payload).encode()
        cap('telemetry').set_input_files({'name': 'calibration.json', 'mimeType': 'application/json', 'buffer': calibration_bytes})
        expect(cap('telemetry-status')).to_contain_text('4 imported samples')
        expect(cap('length')).to_have_value('mm')
        expect(cap('time')).to_have_value('ms')
        expect(cap('frame')).to_have_value('robot_map')
        panel.locator('.cap-encoders > summary').click()
        expect(cap('encoder-svg')).to_be_visible()
        cap('independent').check()
        cap('calibrate').click()
        expect(cap('calibration-status')).to_contain_text('Proposed radius 0.10000 m')
        proposal = downloaded_json(page, cap('report'))['wheelCalibration']
        assert proposal['applied'] is False
        assert proposal['input']['inputUnits']['length'] == 'mm'
        cap('telemetry').set_input_files({'name': 'renamed-as-validation.json', 'mimeType': 'application/json', 'buffer': calibration_bytes})
        expect(cap('telemetry-status')).to_contain_text('renamed-as-validation.json')
        cap('registered').check()
        cap('time-confirmed').check()
        cap('held-out').check()
        cap('compare').click()
        expect(cap('telemetry-status')).to_contain_text('calibration-reuse')
        reused = downloaded_json(page, cap('report'))
        assert reused['comparison']['provenance']['evaluationRole'] == 'calibration-data-reused'

        with page.expect_popup() as popup_pending:
            cap('save').click()
        popup = popup_pending.value
        expect(popup.locator('#handoff-note')).to_contain_text('brainsnn-robot-test-summary.json')
        expect(popup.locator('#save-handoff')).to_be_disabled()
        popup.close()
        print('Calibration provenance and shared project handoff passed', flush=True)

        # Local intake and IndexedDB recovery do not fabricate worker output.
        page.locator('#layer-tab-bimworkbench').click()
        bim = page.locator('#layer-panel-bimworkbench')
        expect(bim).to_be_visible()
        bim.locator('[data-bim-project-name]').fill('North building test')
        bim.locator('[data-bim-project-form] button').click()
        expect(bim.locator('[data-bim-status]')).to_contain_text('Created North building test')
        points = '\n'.join(f'{i*.1} {j*.1} {z}' for i in range(15) for j in range(15) for z in [0, 1.5])
        ply = f'ply\nformat ascii 1.0\nelement vertex 450\nproperty float x\nproperty float y\nproperty float z\nend_header\n{points}\n'
        bim.locator('[data-bim-files]').set_input_files({'name': 'registered-room.ply', 'mimeType': 'application/octet-stream', 'buffer': ply.encode()})
        bim.locator('[data-bim-registered]').check()
        bim.locator('[data-bim-add]').click()
        expect(bim.locator('[data-bim-jobs]')).to_contain_text('registered-room.ply', timeout=15000)
        expect(bim.locator('[data-bim-jobs]')).to_contain_text('Ready to send')
        assert bim.locator('[data-bim-download]').count() == 0
        manifest = downloaded_json(page, bim.locator('[data-bim-manifest]'))
        with page.expect_popup() as popup_pending:
            bim.locator('[data-bim-save-project]').click()
        popup = popup_pending.value
        expect(popup.locator('#handoff-note')).to_contain_text('brainsnn-bim-project-summary.json')
        expect(popup.locator('#save-handoff')).to_be_disabled()
        popup.close()
        page.reload(wait_until='domcontentloaded')
        page.locator('#layer-tab-bimworkbench').click()
        expect(bim.locator('[data-bim-jobs]')).to_contain_text('registered-room.ply', timeout=15000)
        assert bim.locator('[data-bim-download]').count() == 0
        (output / 'bim-manifest.json').write_text(json.dumps(manifest, indent=2))
        bim.screenshot(path=output / 'bim-workbench-desktop.png')

        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            page.locator('#layer-tab-robotcapability').click()
            expect(panel).to_be_visible()
            page.screenshot(path=output / f'robot-capability-{width}.png')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
            page.locator('#layer-tab-bimworkbench').click()
            page.screenshot(path=output / f'bim-workbench-{width}.png')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        assert not errors, errors
        assert not remote_writes, remote_writes
        print(json.dumps({'browser': 'chromium', 'physics': episode['score'], 'frames': len(frames),
                          'comparison': comparison['metrics'], 'armReachAndRejection': True,
                          'bimLocalPersistence': True, 'mobileWidths': [390, 320], 'pageErrors': errors}, indent=2))
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    server = StaticServer(('127.0.0.1', 0), partial(ShowcaseHandler, directory=str(PUBLIC)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with TemporaryDirectory() as temporary:
            output = args.out or Path(temporary)
            output.mkdir(parents=True, exist_ok=True)
            smoke(f'http://127.0.0.1:{server.server_port}', output)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
