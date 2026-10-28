"""Submit an existing calibrated native capture through BrainSNN's authenticated site.

Use --consent only for images you are permitted to process. No ZIP extraction,
credentials in arguments, native phone app, or measured-accuracy claim is implied.
"""
from __future__ import annotations
import argparse
import getpass
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.world_worker.native_capture import read_metadata, inputs_evidence
from robotics.world_worker.simready_bridge import local
from site_processing_check import Site, download_all, run_job, CHUNK


def capture_inputs(bundle_path, root):
    bundle_path, root = bundle_path.resolve(), root.resolve()
    bundle = read_metadata(bundle_path)
    inputs = [{'name': bundle_path.name, 'kind': 'capture', 'path': str(bundle_path)}]
    for frame in bundle['frames']:
        inputs.append({'name': frame['image'], 'kind': 'image', 'path': str(local(root, frame['image']))})
    inputs_evidence(inputs)  # Complete hashes/calibration/pose checks before sending bytes.
    return inputs


def upload(site, item):
    path = Path(item['path'])
    record = site.json('POST', '/api/world/worker/v1/uploads',
                       {'name': item['name'], 'kind': item['kind'], 'size': path.stat().st_size})
    offset = 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b''):
            result = site.json('PUT', f"/api/world/worker/v1/uploads/{record['id']}?offset={offset}", raw=chunk)
            expected = offset + len(chunk)
            if result.get('offset') != expected:
                raise RuntimeError('Worker upload offset did not match accepted bytes.')
            offset = expected
    return record['id']


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--root', type=Path, help='original image folder; defaults to the bundle folder')
    parser.add_argument('--site', default='https://www.brainsnn.com')
    parser.add_argument('--out', required=True, type=Path, help='fresh result folder')
    parser.add_argument('--consent', action='store_true', help='confirm you may process these original images')
    parser.add_argument('--timeout', type=float, default=3700, help='maximum job wait in seconds (1–7200)')
    args = parser.parse_args()
    if not args.consent:
        parser.error('--consent is required to process your capture')
    origin = urlsplit(args.site)
    if origin.scheme != 'https' or not origin.netloc or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ('', '/'):
        parser.error('--site must be an HTTPS origin without credentials or a path')
    if not 1 <= args.timeout <= 7200:
        parser.error('--timeout must be between 1 and 7200 seconds')
    items = capture_inputs(args.bundle, args.root or args.bundle.parent)
    args.out.mkdir(parents=True, exist_ok=False)
    site = Site(args.site)
    passcode = os.environ.get('BRAINSNN_PASSCODE') or getpass.getpass('BrainSNN processing passcode: ')
    site.token = site.json('POST', '/api/world/session', {'passcode': passcode})['token']
    caps = site.json('GET', '/api/world/worker/v1/capabilities')
    engine = next((item for item in caps['engines'] if item['id'] == 'colmap-sparse'), {})
    if not engine.get('available') or 'capture' not in engine.get('input_kinds', []):
        raise RuntimeError('This worker has not enabled native capture inputs for colmap-sparse.')
    ids = [upload(site, item) for item in items]
    job, _ = run_job(site, 'colmap-sparse', ids, 3, args.timeout)
    if job['status'] != 'complete':
        raise RuntimeError(f"Capture job {job['status']}: {job.get('error') or 'no successful result'}")
    names = download_all(site, job, args.out)
    receipt = {'schema': 'brainsnn.native-capture-submission.v1', 'job_id': job['id'], 'status': job['status'],
               'downloaded_sha256_checked': names, 'metric_verified': False}
    (args.out / 'submission.json').write_text(json.dumps(receipt, indent=2))
    print(f"Completed native capture; verified {len(names)} downloads in {args.out.resolve()}. Independent dimensions still required.")
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Native capture failed: {error}', file=sys.stderr)
        sys.exit(1)
