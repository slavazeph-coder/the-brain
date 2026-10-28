"""Submit an existing calibrated native capture through BrainSNN's authenticated site.

Use --consent only for images you are permitted to process. No ZIP extraction,
credentials in arguments, native phone app, or measured-accuracy claim is implied.
"""
from __future__ import annotations
import argparse
import getpass
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.world_worker.native_capture import read_metadata, inputs_evidence
from robotics.world_worker import camera_frames
from robotics.world_worker.simready_bridge import local
from site_processing_check import Site, download_all, run_job, reconstruction_screen, CHUNK


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


def verify_result(out, names, expected):
    """Require executed geometry and evidence bound to this exact capture."""
    if not {'reconstruction.json', 'native-capture.json', 'camera-frames.json', 'sparse-preview.ply'}.issubset(names):
        raise RuntimeError('Native capture result is missing geometry, camera ledger or reconstruction evidence.')
    reconstruction = json.loads((out / 'reconstruction.json').read_text())
    native_bytes = (out / 'native-capture.json').read_bytes()
    native = json.loads(native_bytes)
    if not isinstance(reconstruction, dict) or not isinstance(native, dict):
        raise RuntimeError('Native capture result contains invalid evidence.')
    capture = reconstruction.get('capture')
    if not isinstance(capture, dict) or not isinstance(capture.get('consistency'), dict):
        raise RuntimeError('Native capture result is missing its geometry screening evidence.')
    screened, status = reconstruction_screen(reconstruction)
    if not screened:
        raise RuntimeError(f'Native capture did not pass reconstruction screening: {status}.')
    binding = reconstruction.get('native_capture')
    digest = hashlib.sha256(native_bytes).hexdigest()
    if (not isinstance(binding, dict) or binding.get('artifact') != 'native-capture.json'
            or binding.get('sha256') != digest
            or binding.get('bundle_sha256') != expected['bundle_sha256']
            or native.get('schema') != 'brainsnn.capture-evidence.v1'
            or native.get('bundle_sha256') != expected['bundle_sha256']
            or native.get('frames') != expected['frames']):
        raise RuntimeError('Native result is not bound to the submitted capture and original frames.')
    alignment = native.get('alignment')
    if (native.get('reconstruction_executed') is not True or not isinstance(alignment, dict)
            or alignment.get('applied') is not True or binding.get('alignment') != alignment):
        raise RuntimeError('Native result does not confirm executed reconstruction and pose alignment.')
    if (native.get('metric_verified') is not False or reconstruction.get('metric_verified') is not False
            or reconstruction.get('units') != 'arbitrary' or alignment.get('metric_verified') is not False):
        raise RuntimeError('Native result incorrectly claims independently verified metric geometry.')
    sources = [{'name': frame['image'], 'kind': 'image', 'sha256': frame['image_sha256']} for frame in expected['frames']]
    registered = capture.get('registered_images')
    if (reconstruction.get('schema') != 'brainsnn.reconstruction.v1' or reconstruction.get('sources') != sources
            or capture.get('images') != len(sources) or type(registered) is not int or not 3 <= registered <= len(sources)
            or type(reconstruction.get('reconstructed_points')) is not int or reconstruction['reconstructed_points'] <= 0):
        raise RuntimeError('Reconstruction has missing geometry, registered cameras or different input sources.')

    def bound_file(record, name):
        # The exported record has a job-relative name; only read the fixed downloaded basename.
        data = (out / name).read_bytes()
        if (not isinstance(record, dict) or Path(str(record.get('name', ''))).name != name
                or record.get('bytes') != len(data) or record.get('sha256') != hashlib.sha256(data).hexdigest()):
            raise RuntimeError(f'{name} does not match its reconstruction evidence binding.')

    ledger = json.loads((out / 'camera-frames.json').read_text())
    try:
        camera_frames.validate(ledger)  # Source indices, rigid poses, calibration and content-derived frame identities.
    except (ValueError, TypeError) as error:
        raise RuntimeError(f'Invalid camera ledger: {error}') from error
    if (not isinstance(ledger, dict) or ledger.get('schema') != 'brainsnn.camera-frames.v1'
            or ledger.get('sources') != sources or ledger.get('metric_verified') is not False):
        raise RuntimeError('Camera ledger is not bound to this original capture.')
    bound_file(ledger.get('reconstruction'), 'reconstruction.json')
    clouds = reconstruction.get('point_clouds')
    if not isinstance(clouds, list) or ledger.get('clouds') != clouds:
        raise RuntimeError('Camera ledger does not bind the reconstructed point clouds.')
    sparse = [record for record in clouds if isinstance(record, dict) and Path(str(record.get('name', ''))).name == 'sparse-preview.ply']
    if len(sparse) != 1:
        raise RuntimeError('Reconstruction is missing its sparse point cloud binding.')
    bound_file(sparse[0], 'sparse-preview.ply')
    # The adapter exports bounded ASCII XYZ/RGB points, not a surface or a metric model.
    lines = (out / 'sparse-preview.ply').read_text(encoding='ascii').splitlines()
    try:
        end = lines.index('end_header')
        vertices = [int(line.split()[-1]) for line in lines[:end] if line.startswith('element vertex ')]
        rows = [line.split() for line in lines[end+1:] if line.strip()]
        valid_rows = all(len(row) == 6 and all(math.isfinite(float(value)) for value in row[:3])
                         and all(0 <= int(value) <= 255 for value in row[3:]) for row in rows)
        valid_cloud = lines[:2] == ['ply', 'format ascii 1.0'] and vertices == [len(rows)] and valid_rows and len(rows) > 0
    except (ValueError, IndexError):
        valid_cloud = False
    if not valid_cloud or len(rows) != reconstruction.get('preview_points'):
        raise RuntimeError('Downloaded sparse geometry is empty, invalid or disagrees with its point count.')
    cameras, frames = reconstruction.get('cameras'), ledger.get('frames')
    if (not isinstance(cameras, list) or not isinstance(frames, list) or len(cameras) != registered or len(frames) != registered
            or not all(isinstance(item, dict) and isinstance(item.get('frame_id'), str) for item in [*cameras, *frames])
            or {item['frame_id'] for item in cameras} != {item['frame_id'] for item in frames}
            or len({item['frame_id'] for item in frames}) != registered):
        raise RuntimeError('Camera ledger disagrees with the registered reconstruction views.')
    return {'fold_status': status, 'native_evidence_sha256': digest,
            'bundle_sha256': expected['bundle_sha256'], 'source_frames': len(expected['frames']),
            'registered_frames': registered, 'preview_points': len(rows)}


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
    expected = inputs_evidence(items)[1]
    args.out.mkdir(parents=True, exist_ok=False)
    site = Site(args.site)
    receipt = {'schema': 'brainsnn.native-capture-submission.v1', 'job_id': None, 'status': 'not-started',
               'site': site.base, 'bundle_sha256': expected['bundle_sha256'], 'passed': False, 'metric_verified': False}
    receipt_path = args.out / 'submission.json'
    with receipt_path.open('x') as stream:
        stream.write(json.dumps(receipt, indent=2))

    def remember_job(job):
        receipt.update(job_id=job['id'], status=job['status'])
        receipt_path.write_text(json.dumps(receipt, indent=2))

    try:
        passcode = os.environ.get('BRAINSNN_PASSCODE') or getpass.getpass('BrainSNN processing passcode: ')
        site.token = site.json('POST', '/api/world/session', {'passcode': passcode})['token']
        caps = site.json('GET', '/api/world/worker/v1/capabilities')
        engine = next((item for item in caps['engines'] if item['id'] == 'colmap-sparse'), {})
        if not engine.get('available') or 'capture' not in engine.get('input_kinds', []):
            raise RuntimeError('This worker has not enabled native capture inputs for colmap-sparse.')
        ids = [upload(site, item) for item in items]
        job, _ = run_job(site, 'colmap-sparse', ids, 3, args.timeout, on_job=remember_job)
        remember_job(job)
        if job['status'] != 'complete':
            raise RuntimeError(f"Capture job {job['id']} {job['status']}: {job.get('error') or 'no successful result'}")
        names = download_all(site, job, args.out)
        receipt['downloaded_sha256_checked'] = names
        receipt.update(verify_result(args.out, names, expected))
        receipt['passed'] = True
    finally:
        # Preserve the last known job status on timeout; it is not a terminal-status claim.
        receipt_path.write_text(json.dumps(receipt, indent=2))
    print(f"Native capture checks passed; verified {len(names)} downloads in {args.out.resolve()}. Independent dimensions still required.")
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Native capture failed: {error}', file=sys.stderr)
        sys.exit(1)
