"""Native depth review plus real WorkerClient protocol against an explicit local predictor fixture.

No model weights are loaded and no external service is contacted by this test.
"""
from __future__ import annotations

import argparse
import base64
from functools import partial
import hashlib
import io
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright
from stereo_depth_browser_smoke import PUBLIC, StaticServer
from world_showcase_browser_smoke import ShowcaseHandler

JOB_ID = 'd' * 32
UPLOAD_ID = 'e' * 32
TOKEN = 'local-depth-browser-fixture-token-0000'


def fixture():
    image = Image.new('RGB', (64, 48), (100, 140, 180))
    for x in range(16, 32):
        for y in range(12, 36):
            image.putpixel((x, y), (210, 140, 80))
    stream = io.BytesIO()
    image.save(stream, format='JPEG')
    raw = stream.getvalue()
    result = {
        'schema': 'brainsnn.depth-sequence.v1', 'engine': 'metric-depth-sequence',
        'source': {'kind': 'image', 'name': 'depth-test.jpg', 'sha256': hashlib.sha256(raw).hexdigest()},
        'model': {'repo': 'test/explicit-predictor', 'revision': 'browser-fixture', 'license': 'Authored test fixture'},
        'units': 'm', 'coordinateFrame': 'camera-x-right-y-down-z-forward', 'depthConvention': 'camera-z',
        'scale': {'basis': 'model-estimated', 'verified': False}, 'registration': {'available': False},
        'temporal': {'mode': 'independent-frames'}, 'provenance': {'inferenceExecuted': False},
        'additionalEvidenceRetained': {'fixture': True, 'reason': 'Test the real protocol without model inference'},
        'frames': [{'index': 0, 'timeSeconds': None, 'timestampBasis': 'still-image', 'width': 64, 'height': 48,
                    'inputWidth': 64, 'inputHeight': 48, 'camera': {'fx': 60, 'fy': 60, 'cx': 31.5, 'cy': 23.5},
                    'depth': [None if y < 5 else 2 if 16 <= x < 32 and 12 <= y < 36 else 5
                              for y in range(48) for x in range(64)],
                    'imageDataUrl': 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()}],
    }
    return raw, json.dumps(result, separators=(',', ':')).encode()


class DepthHandler(ShowcaseHandler):
    def send_json(self, value, status=200):
        raw = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def check_token(self):
        assert self.headers.get('Authorization') == 'Bearer ' + TOKEN

    def job(self, status):
        result = self.server.depth_result
        return {'id': JOB_ID, 'engine': 'metric-depth-sequence', 'status': status,
                'artifacts': [{'name': 'depth-sequence.json', 'kind': 'evidence', 'size': len(result),
                               'sha256': hashlib.sha256(result).hexdigest()}] if status == 'complete' else []}

    def do_GET(self):
        if self.path == '/api/world/processing':
            return self.send_json({'available': False, 'passcode': False, 'visitors': False})
        if self.path == '/v1/capabilities':
            self.check_token()
            return self.send_json({'api_version': 'brainsnn.worker.v1', 'limits': {'chunk_bytes': 1024},
                                   'engines': [{'id': 'metric-depth-sequence', 'label': 'Fixture depth', 'available': True,
                                                'input_kinds': ['image', 'video'], 'max_inputs': 1},
                                               {'id': 'depth-pro-2', 'label': 'Restricted model', 'available': False,
                                                'input_kinds': ['image', 'video'], 'max_inputs': 1},
                                               {'id': 'photo-metric', 'label': 'Ordinary photo preview', 'available': True,
                                                'input_kinds': ['image'], 'max_inputs': 1}]})
        if self.path == '/v1/download/depth-fixture':
            self.server.ticket_reads += 1
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(self.server.depth_result)))
            self.end_headers()
            self.wfile.write(self.server.depth_result)
            return
        return super().do_GET()

    def do_POST(self):
        self.check_token()
        raw = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(raw)
        self.server.depth_writes.append((self.path, data))
        if self.path == '/v1/uploads':
            assert data['kind'] == 'image'
            assert data['size'] == len(self.server.depth_source)
            return self.send_json({'id': UPLOAD_ID, 'offset': 0, 'size': len(self.server.depth_source)}, 201)
        if self.path == '/v1/jobs':
            assert data == {'engine': 'metric-depth-sequence', 'upload_ids': [UPLOAD_ID], 'consent': True}
            assert bytes(self.server.uploaded) == self.server.depth_source
            return self.send_json(self.job('prepared'), 201)
        if self.path == f'/v1/jobs/{JOB_ID}/start':
            return self.send_json(self.job('complete'))
        if self.path == f'/v1/jobs/{JOB_ID}/ticket':
            assert data == {'artifact': 0}
            return self.send_json({'url': '/v1/download/depth-fixture'})
        self.send_json({'detail': 'Unknown fixture path'}, 404)

    def do_PUT(self):
        self.check_token()
        assert urlsplit(self.path).path == f'/v1/uploads/{UPLOAD_ID}'
        assert urlsplit(self.path).query == 'offset=' + str(len(self.server.uploaded))
        self.server.uploaded.extend(self.rfile.read(int(self.headers['Content-Length'])))
        return self.send_json({'offset': len(self.server.uploaded)})


def smoke(origin, output, server):
    with sync_playwright() as pw:
        options = {'headless': True, 'args': ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']}
        if os.environ.get('BROWSER_EXECUTABLE'):
            options['executable_path'] = os.environ['BROWSER_EXECUTABLE']
        browser = pw.chromium.launch(**options)
        context = browser.new_context(viewport={'width': 1360, 'height': 1000}, reduced_motion='reduce', accept_downloads=True)
        page = context.new_page()
        errors, external = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def local_only(route):
            if not route.request.url.startswith(origin + '/'):
                external.append(route.request.url)
                route.abort()
            else:
                route.continue_()

        context.route('http**/*', local_only)
        page.goto(origin + '/world/index.html?nosw=1#layer-tab-depth', wait_until='domcontentloaded')
        panel = page.locator('#layer-panel-depth')
        expect(panel).to_be_visible(timeout=20000)
        get = lambda key: panel.locator('[data-depth-' + key + ']')
        expect(get('run')).to_be_disabled()
        get('example').click()
        expect(get('origin')).to_contain_text('NO INFERENCE')
        expect(get('frame-label')).to_contain_text('Frame 1 of 5')
        depth = get('map')
        bounds = depth.bounding_box()
        depth.click(position={'x': 20.5 / 64 * bounds['width'], 'y': 20.5 / 48 * bounds['height']})
        expect(get('probe')).to_contain_text('forward depth 2.00 m')
        expect(get('marker')).to_be_visible()
        panel.get_by_text('Compare with a known forward distance', exact=True).click()
        get('known').fill('2.5')
        expect(get('check-result')).to_contain_text('-0.500 m (-20.0%)')
        get('next').click()
        expect(get('known')).to_have_value('')
        expect(get('frame-label')).to_contain_text('authored time 0.50 s')
        get('map').press('ArrowRight')
        expect(get('probe')).to_contain_text('Pixel 21, 20')
        panel.get_by_text('Look around this frame in 3D', exact=True).click()
        before = get('points').screenshot()
        panel.locator('[data-depth-turn="left"]').click()
        assert before != get('points').screenshot(), 'The orbit control should change the visible depth points.'
        with page.expect_download() as pending:
            get('save-ply').click()
        ply = pending.value.path().read_text()
        assert 'not measured or registered' in ply
        assert 'review_frame_index 1' in ply
        with page.expect_popup() as popup_pending:
            get('save-project').click()
        popup = popup_pending.value
        expect(popup.locator('#handoff-note')).to_contain_text('brainsnn-depth-review.json')
        expect(popup.locator('#save-handoff')).to_be_disabled()
        popup.close()

        # Full connected service flow: capability gate, explicit source consent,
        # actual chunk upload, job, ticket, checksum validation and result reopening.
        get('connect').click()
        page.locator('#worker-url').fill(origin)
        page.locator('#worker-token').fill(TOKEN)
        page.locator('#connect').click()
        expect(page.locator('#connection-status')).to_contain_text('Connected.')
        page.locator('#connection button[aria-label="Close"]').click()
        expect(get('availability')).to_contain_text('1 depth engine is available')
        expect(get('engine').locator('option[value="depth-pro-2"]')).to_have_js_property('disabled', True)
        # The ordinary capture route consumes reconstruction artifacts, so depth
        # sequences must be offered only by their dedicated native workbench.
        page.locator('#tab-capture').click()
        expect(page.locator('#engine option[value="photo-metric"]')).to_have_count(1)
        expect(page.locator('#engine option[value="metric-depth-sequence"]')).to_have_count(0)
        expect(page.locator('#engine option[value="depth-pro-2"]')).to_have_count(0)
        get('source').set_input_files({'name': 'depth-test.jpg', 'mimeType': 'image/jpeg', 'buffer': server.depth_source})
        expect(get('run')).to_be_disabled()
        get('consent').check()
        expect(get('run')).to_be_enabled()
        get('run').click()
        expect(get('status')).to_contain_text('Depth result opened', timeout=20000)
        expect(get('name')).to_have_text('depth-test.jpg')
        expect(get('origin')).to_contain_text('SOURCE FILE MATCHED')
        expect(get('basis')).to_contain_text('Frames estimated independently')
        assert server.ticket_reads == 1
        assert bytes(server.uploaded) == server.depth_source
        with page.expect_download() as pending:
            get('save-json').click()
        saved = pending.value.path().read_bytes()
        assert saved == server.depth_result, 'The full original evidence and result bytes must survive download.'
        assert json.loads(saved)['additionalEvidenceRetained']['fixture'] is True

        # Reopen from the actual workspace result registry; no new job is created.
        get('clear').click()
        panel.get_by_text('Open a saved depth result', exact=True).click()
        get('results').select_option(index=1)
        get('open-result').click()
        expect(get('result')).to_be_visible()
        expect(get('status')).to_contain_text('Depth result opened')
        expect(get('name')).to_have_text('depth-test.jpg')
        expect(get('origin')).to_contain_text('SOURCE FILE MATCHED')
        assert sum(path == '/v1/jobs' for path, _ in server.depth_writes) == 1
        assert server.ticket_reads == 2
        panel.screenshot(path=output / 'depth-workbench-desktop.png')

        # Import refuses a claimed verified map and keeps the previous valid review.
        invalid = json.loads(server.depth_result)
        invalid['scale']['verified'] = True
        get('file').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json', 'buffer': json.dumps(invalid).encode()})
        expect(get('status')).to_contain_text('estimated, unregistered depth only')
        expect(get('name')).to_have_text('depth-test.jpg')
        for width in (390, 320):
            page.set_viewport_size({'width': width, 'height': 844})
            panel.scroll_into_view_if_needed()
            page.screenshot(path=output / f'depth-workbench-{width}.png')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            assert panel.locator('button:visible').evaluate_all('(buttons)=>buttons.every(b=>b.getBoundingClientRect().height>=44)')
        assert not errors, errors
        assert not external, external
        print(json.dumps({'depthProbe': True, 'opticalZ': True, 'frameScrub': True, 'pointsExport': True,
                          'projectHandoff': True, 'dedicatedDepthEngineRoute': True,
                          'realWorkerClientFixture': True, 'inferenceExecuted': False,
                          'originalEvidenceBytes': True, 'sourceUploadBytes': len(server.uploaded),
                          'ticketReads': server.ticket_reads, 'mobileWidths': [390, 320], 'pageErrors': errors}, indent=2))
        browser.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    server = StaticServer(('127.0.0.1', 0), partial(DepthHandler, directory=str(PUBLIC)))
    server.depth_source, server.depth_result = fixture()
    server.depth_writes, server.uploaded, server.ticket_reads = [], bytearray(), 0
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with TemporaryDirectory() as temporary:
            output = args.out or Path(temporary)
            output.mkdir(parents=True, exist_ok=True)
            smoke(f'http://127.0.0.1:{server.server_port}', output, server)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
