"""Check brainsnn.com's own processing end to end, the way the World Builder page uses it, without a browser.

usage: python scripts/world-demo/site_processing_check.py --site https://brainsnn.com [--video walk.mov]
                                                          [--engine colmap-sparse] [--scene] [--out DIR]
The passcode is read from BRAINSNN_PASSCODE, or asked for without echo; it is never printed or written. Standard library
only, so any Python 3.10+ runs it.

Without --video it checks setup only: the site says processing is available, the passcode opens a session, and the
worker answers with its engines. With --video it uploads in 4 MiB chunks, runs the engine, downloads every result
through a download link (checking each SHA-256), and prints what the reconstruction found. --scene also runs the scene
engine on the same video. Results go to --out (default: a new folder in the current directory), never into the repo.
Exit status: 0 when every step passed, 1 when a step failed, 2 when processing is not set up on the site.
"""
from __future__ import annotations
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

CHUNK = 4 * 1024 ** 2


class Site:
    def __init__(self, base: str):
        self.base, self.token = base.rstrip('/'), None

    def call(self, method, path, body=None, *, raw=None, timeout=120):
        headers = {'Cache-Control': 'no-store'}
        data = None
        if self.token and path.startswith('/api/world/worker/') and '/v1/download/' not in path:
            headers['Authorization'] = f'Bearer {self.token}'
        if raw is not None:
            data, headers['Content-Type'] = raw, 'application/octet-stream'
        elif body is not None:
            data, headers['Content-Type'] = json.dumps(body).encode(), 'application/json'
        elif method in ('POST', 'PUT'):
            data = b''
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                return response.status, payload
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def json(self, method, path, body=None, **kw):
        status, payload = self.call(method, path, body, **kw)
        try:
            data = json.loads(payload or b'{}')
        except json.JSONDecodeError:
            data = {'detail': payload[:200].decode(errors='replace')}
        if status >= 400:
            raise RuntimeError(f'{method} {path.split("?")[0]} -> {status}: {data.get("detail", data)}')
        return data


def step(name, ok, detail=''):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + detail) if detail else ''}", flush=True)
    return ok


def run_job(site, engine, upload_id, poll):
    started = time.monotonic()
    job = site.json('POST', '/api/world/worker/v1/jobs', {'engine': engine, 'upload_ids': [upload_id], 'consent': True})
    site.json('POST', f"/api/world/worker/v1/jobs/{job['id']}/start")
    last = None
    while job['status'] not in ('complete', 'failed', 'cancelled'):
        time.sleep(poll)
        job = site.json('GET', f"/api/world/worker/v1/jobs/{job['id']}")
        if job['status'] != last:
            print(f"      {engine}: {job['status']} after {time.monotonic() - started:.0f} s", flush=True)
            last = job['status']
    return job, time.monotonic() - started


def download_all(site, job, out):
    names = []
    for index, artifact in enumerate(job.get('artifacts', [])):
        link = site.json('POST', f"/api/world/worker/v1/jobs/{job['id']}/ticket", {'artifact': index})['url']
        if not link.startswith('/api/world/worker/v1/download/'):
            raise RuntimeError(f'Download link is not under the site: {link[:60]}')
        status, payload = site.call('GET', link, timeout=600)
        if status != 200 or hashlib.sha256(payload).hexdigest() != artifact['sha256']:
            raise RuntimeError(f"{artifact['name']}: download failed or its SHA-256 does not match")
        (out / artifact['name']).write_bytes(payload)
        names.append(artifact['name'])
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--site', default='https://brainsnn.com')
    parser.add_argument('--video', type=Path)
    parser.add_argument('--engine', default='colmap-sparse')
    parser.add_argument('--scene', action='store_true', help='also run the scene engine (scene-usd) on the same video')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--poll', type=float, default=5.0)
    args = parser.parse_args()
    site = Site(args.site)

    status = site.json('GET', '/api/world/processing')
    if not step('site says processing is set up', status.get('available') is True and status.get('passcode') is True, json.dumps(status)):
        print('      Set WORLD_WORKER_INTERNAL_URL and WORLD_SITE_PASSCODE on the site service, then wait for its redeploy.')
        return 2
    passcode = os.environ.get('BRAINSNN_PASSCODE') or getpass.getpass('BrainSNN processing passcode: ')
    try:
        site.token = site.json('POST', '/api/world/session', {'passcode': passcode})['token']
    except RuntimeError as error:
        step('passcode opens a session', False, str(error)); return 1
    step('passcode opens a session', True)
    try:
        caps = site.json('GET', '/api/world/worker/v1/capabilities')
    except RuntimeError as error:
        step('worker answers through the site', False, str(error))
        print('      502 means the site cannot reach the worker: check the worker is Active, PORT=8080, and the URL '
              'http://world-worker.railway.internal:8080/ on the site.')
        return 1
    engines = [e['id'] for e in caps['engines'] if e.get('available')]
    if not step('worker answers through the site', args.engine in engines, f"owner {caps.get('owner_id')}, engines {engines}"):
        return 1
    if not args.video:
        print('Setup checks passed. Add --video to process a walkthrough.')
        return 0

    out = args.out or Path(f'brainsnn-check-{time.strftime("%Y%m%d-%H%M%S")}')
    out.mkdir(parents=True, exist_ok=False)
    data = args.video.read_bytes()
    print(f'      uploading {args.video.name}: {len(data) / 1024 ** 2:.0f} MB in {max(1, -(-len(data) // CHUNK))} chunks', flush=True)

    def upload():
        item = site.json('POST', '/api/world/worker/v1/uploads', {'name': args.video.name, 'size': len(data), 'kind': 'video'})
        offset = 0
        while offset < len(data):
            offset = site.json('PUT', f"/api/world/worker/v1/uploads/{item['id']}?offset={offset}", raw=data[offset:offset + CHUNK])['offset']
        return item['id']

    ok = True
    try:
        job, seconds = run_job(site, args.engine, upload(), args.poll)
        ok &= step(f'{args.engine} finished', job['status'] == 'complete', f"{job['status']} in {seconds:.0f} s {job.get('error') or ''}".strip())
        if job['status'] == 'complete':
            names = download_all(site, job, out)
            step('results downloaded through the site, SHA-256 checked', True, ', '.join(names))
            if 'reconstruction.json' in names:
                evidence = json.loads((out / 'reconstruction.json').read_text())
                capture = evidence.get('capture', {})
                consistency = (capture.get('consistency') or {}).get('status')
                print(f"      frames {capture.get('images')}, registered {capture.get('registered_images')}, "
                      f"points {evidence.get('reconstructed_points')}, reprojection "
                      f"{evidence.get('mean_reprojection_error_pixels', float('nan')):.2f} px, fold check {consistency}")
                ok &= step('reconstruction is not folded', consistency != 'folded',
                           'folded: re-record the room or process it again' if consistency == 'folded' else '')
        if args.scene:
            scene, seconds = run_job(site, 'scene-usd', upload(), args.poll)
            ok &= step('scene-usd finished', scene['status'] == 'complete', f"{scene['status']} in {seconds:.0f} s {scene.get('error') or ''}".strip())
            if scene['status'] == 'complete':
                (out / 'scene').mkdir()
                step('scene downloaded', True, ', '.join(download_all(site, scene, out / 'scene')))
    except RuntimeError as error:
        step('processing', False, str(error))
        return 1
    print(f'Results in {out.resolve()} (outside git; delete when done).')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
