"""Integrity/review failures and a real HTTP upload-only CLI run; no model weights or Blender."""
import importlib.util
import json
from pathlib import Path
import shutil
import signal
import struct
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts' / 'world-demo'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('qualify_video_cli', SCRIPTS / 'qualify_video.py')
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)


def glb_bytes():
    payload = json.dumps({'asset': {'version': '2.0'}, 'meshes': [{'primitives': []}]}).encode()
    payload += b' ' * (-len(payload) % 4)
    return struct.pack('<4sII', b'glTF', 2, 20 + len(payload)) + struct.pack('<II', len(payload), 0x4E4F534A) + payload


def test_glb_container_checks_version_length_chunk_bounds_and_json(tmp_path):
    good = glb_bytes()
    path = tmp_path / 'scene.glb'
    path.write_bytes(good)
    q.validate_glb(path)
    for damaged in (good[:4], good[:4] + struct.pack('<I', 1) + good[8:],
                    good + b'extra', good[:12] + struct.pack('<I', 0xFFFFFFFC) + good[16:]):
        path.write_bytes(damaged)
        with pytest.raises(q.QualificationError):
            q.validate_glb(path)


def retained_run(root):
    """Public synthetic evidence only. Hashes bind ledger, receipt, cloud and manifest."""
    output = root / 'downloads/reconstruction'
    output.mkdir(parents=True)
    source = {'name': 'synthetic.mp4', 'kind': 'video', 'sha256': 'a' * 64}
    receipt = {'schema': 'brainsnn.reconstruction.v1', 'sources': [source],
               'units': 'arbitrary', 'metric_verified': False, 'reconstructed_points': 100,
               'mean_reprojection_error_pixels': .5,
               'capture': {'images': 10, 'registered_images': 10, 'registration_fraction': 1.0,
                           'models_found': 1, 'consistency': {'status': 'consistent', 'pairsChecked': 9,
                           'pairsSkipped': 0, 'pairsDisagreeing': 0, 'worstDisagreementDegrees': 1,
                           'thresholdDegrees': 15}}}
    q.save_json(output / 'reconstruction.json', receipt)
    (output / 'sparse-preview.ply').write_text('synthetic cloud fixture\n')
    ledger = {'schema': 'brainsnn.camera-frames.v1', 'sources': [source],
              'reconstruction': {'sha256': q.digest(output / 'reconstruction.json')},
              'clouds': [{'sha256': q.digest(output / 'sparse-preview.ply')}],
              'frames': [{'image': {'name': f'image_{i:04d}.jpg'}} for i in range(10)]}
    q.save_json(output / 'camera-frames.json', ledger)
    write_manifest(root)
    scene_output = root / 'downloads/scene'
    scene_output.mkdir()
    q.save_json(scene_output / 'scene.json', {'units': 'arbitrary', 'scale': None})
    q.save_json(scene_output / 'arena-cloud.json', {'units': 'arbitrary', 'scale': None})
    scene_receipt = dict.fromkeys(('metric_verified', 'policy_executed', 'model_weights_used', 'physics_ready'), False)
    scene_receipt.update(compiler={'counts': {'walls': 1}, 'walls': [{'support_points': 30}]},
                         handoff={'provenance': {'floorAligned': True, 'floorInlierFraction': .5}})
    q.save_json(scene_output / 'scene-usd.json', scene_receipt)
    (scene_output / 'scene.glb').write_bytes(glb_bytes())
    rows = [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': q.digest(p)} for p in scene_output.iterdir()]
    q.save_json(root / 'scene-download-verification.json', rows)
    return output, receipt, ledger


def write_manifest(root):
    rows = [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': q.digest(p)}
            for p in sorted((root / 'downloads/reconstruction').iterdir())]
    q.save_json(root / 'reconstruction-download-verification.json', rows)


def review_args(source, output):
    return SimpleNamespace(review=source, out=output, repo=ROOT,
                           min_registration_fraction=.9, min_wall_support=20, expected_video_sha256=None)


def test_review_rechecks_bytes_and_cannot_claim_another_execution(tmp_path):
    run = tmp_path / 'retained'
    artifacts, _, _ = retained_run(run)
    report = tmp_path / 'review'
    assert q.review(review_args(run, report)) == 0
    summary = q.read_json(report / 'summary.json')
    assert summary['artifactIntegrityPassed'] is True
    assert summary['softwareWorkflowExecuted'] is False
    assert summary['physicalAccuracyValidated'] is False
    assert summary['geometryQuality']['layoutUsableClaim'] is False
    # Same length corruption must fail hashing, not just the size check.
    cloud = artifacts / 'sparse-preview.ply'
    cloud.write_bytes(b'X' + cloud.read_bytes()[1:])
    damaged = tmp_path / 'corrupt-review'
    assert q.review(review_args(run, damaged)) == 1
    assert q.read_json(damaged / 'summary.json')['artifactIntegrityPassed'] is False


@pytest.mark.parametrize('corruption', ['source', 'receipt-binding', 'cloud-binding'])
def test_rehashed_downloads_do_not_bypass_ledger_binding(tmp_path, corruption):
    run = tmp_path / 'retained'
    artifacts, _, ledger = retained_run(run)
    if corruption == 'source':
        ledger['sources'] = [dict(ledger['sources'][0], sha256='b' * 64)]
    elif corruption == 'receipt-binding':
        ledger['reconstruction']['sha256'] = 'b' * 64
    else:
        ledger['clouds'][0]['sha256'] = 'b' * 64
    q.save_json(artifacts / 'camera-frames.json', ledger)
    write_manifest(run)
    assert q.review(review_args(run, tmp_path / 'review')) == 1


def test_retained_manifest_rejects_traversal_duplicates_and_symlink_escape(tmp_path):
    run = tmp_path / 'retained'
    artifacts, _, _ = retained_run(run)
    manifest = run / 'reconstruction-download-verification.json'
    rows = q.read_json(manifest)
    for invalid in ([dict(rows[0], name='../escape')], rows + [rows[0]]):
        q.save_json(manifest, invalid)
        with pytest.raises(q.QualificationError):
            q.verify_retained(run)
    q.save_json(manifest, rows)
    target = artifacts / 'sparse-preview.ply'
    external = tmp_path / 'elsewhere.ply'
    target.rename(external)
    target.symlink_to(external)
    with pytest.raises(q.QualificationError):
        q.verify_retained(run)


def test_unscaled_gate_refuses_metric_exports_and_physical_claims():
    scene = {'units': 'arbitrary', 'scale': None}
    receipt = dict.fromkeys(('metric_verified', 'policy_executed', 'model_weights_used', 'physics_ready'), False)
    q.check_unscaled(scene, receipt, {'scene.glb'})
    for claim in receipt:
        with pytest.raises(q.QualificationError):
            q.check_unscaled(scene, dict(receipt, **{claim: True}), {'scene.glb'})
    with pytest.raises(q.QualificationError):
        q.check_unscaled(scene, receipt, {'scene.glb', 'scene.ifc'})
    with pytest.raises(q.QualificationError):
        q.check_unscaled(scene, dict(receipt, navigation={'written': True}), {'scene.glb'})


def test_review_honors_the_optional_admitted_source_guard(tmp_path):
    run = tmp_path / 'retained'
    retained_run(run)
    args = review_args(run, tmp_path / 'review')
    args.expected_video_sha256 = 'c' * 64
    assert q.review(args) == 1


def test_rehashed_metric_cloud_does_not_pass_unscaled_review(tmp_path):
    run = tmp_path / 'retained'
    retained_run(run)
    cloud = run / 'downloads/scene/arena-cloud.json'
    q.save_json(cloud, {'units': 'm', 'scale': {'metresPerUnit': 1}})
    manifest = run / 'scene-download-verification.json'
    rows = q.read_json(manifest)
    for row in rows:
        if row['name'] == cloud.name:
            row.update(bytes=cloud.stat().st_size, sha256=q.digest(cloud))
    q.save_json(manifest, rows)
    assert q.review(review_args(run, tmp_path / 'review')) == 1


def test_a_deleted_scene_manifest_cannot_downgrade_a_full_review_to_reconstruction_only(tmp_path):
    run = tmp_path / 'retained'
    retained_run(run)
    (run / 'scene-download-verification.json').unlink()
    assert q.review(review_args(run, tmp_path / 'review')) == 1


def test_folded_review_preserves_the_geometry_failure_when_scene_was_correctly_skipped(tmp_path):
    run = tmp_path / 'retained'
    artifacts, receipt, ledger = retained_run(run)
    receipt['capture']['consistency'].update(status='folded', pairsDisagreeing=1, worstDisagreementDegrees=25)
    q.save_json(artifacts / 'reconstruction.json', receipt)
    ledger['reconstruction']['sha256'] = q.digest(artifacts / 'reconstruction.json')
    q.save_json(artifacts / 'camera-frames.json', ledger)
    write_manifest(run)
    (run / 'scene-download-verification.json').unlink()
    report = tmp_path / 'folded-review'
    assert q.review(review_args(run, report)) == 2
    summary = q.read_json(report / 'summary.json')
    assert summary['artifactIntegrityPassed'] is True
    assert summary['geometryQuality']['screeningPassed'] is False
    assert summary['geometryQuality']['metrics']['sceneAssessed'] is False


def test_upload_must_match_the_source_admitted_before_processing():
    source = {'bytes': 10, 'sha256': 'a' * 64}
    q.check_admitted_upload({'bytes': 10, 'sha256': 'a' * 64}, source)
    for changed in ({'bytes': 10, 'sha256': 'b' * 64}, {'bytes': 11, 'sha256': 'a' * 64}):
        with pytest.raises(q.QualificationError):
            q.check_admitted_upload(changed, source)


@pytest.mark.skipif(sys.platform == 'win32', reason='Worker uses POSIX process groups')
def test_sigterm_stops_the_detached_worker_and_records_interruption(tmp_path):
    entry = tmp_path / 'terminate_probe.py'
    entry.write_text('''import pathlib, subprocess, sys, time
sys.path.insert(0, sys.argv.pop(1))
import qualify_video as q
class Probe(q.Run):
    def preflight(self):
        self.out.mkdir(mode=0o700)
        self.initialized = True
    def start_worker(self):
        self.server = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], start_new_session=True)
        (self.out / 'worker-pid').write_text(str(self.server.pid))
    def reconstruct(self):
        time.sleep(120)
q.Run = Probe
raise SystemExit(q.main())
''')
    output = tmp_path / 'cancelled'
    child = subprocess.Popen([sys.executable, str(entry), str(SCRIPTS), '--video', str(tmp_path / 'unused.mp4'),
                              '--out', str(output)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 10
        while not (output / 'worker-pid').exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(.05)
        assert (output / 'worker-pid').exists()
        child.send_signal(signal.SIGTERM)
        stdout, stderr = child.communicate(timeout=10)
        assert child.returncode == 130, stdout + stderr
        summary = q.read_json(output / 'summary.json')
        assert summary['status'] == 'interrupted' and summary['workerStopped'] is True
        worker_pid = int((output / 'worker-pid').read_text())
        with pytest.raises(ProcessLookupError):
            import os
            os.kill(worker_pid, 0)
    finally:
        if child.poll() is None:
            child.kill()
            child.communicate(timeout=5)


@pytest.mark.skipif(not (shutil.which('ffmpeg') and shutil.which('ffprobe')), reason='FFmpeg required for native HTTP upload test')
def test_cli_upload_resume_over_real_http_preserves_venv_and_source_bytes(tmp_path):
    video = tmp_path / 'synthetic.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10',
                    '-t', '2.2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(video)],
                   check=True, timeout=20)
    output = tmp_path / 'actual-upload'
    result = subprocess.run([sys.executable, str(SCRIPTS / 'qualify_video.py'), '--video', str(video),
                             '--out', str(output), '--upload-only'], cwd=ROOT,
                            capture_output=True, text=True, timeout=40)
    assert result.returncode == 0, result.stdout + result.stderr
    summary = q.read_json(output / 'summary.json')
    assert summary['status'] == 'upload-passed'
    assert summary['runtime']['workerPython'] == str(Path(sys.executable).absolute())
    assert summary['upload']['sha256'] == q.digest(video)
    assert summary['upload']['partialResumeChecked'] and summary['upload']['staleOffsetRejected']
    assert summary['upload']['acceptedChunks'] >= 2
    assert summary['workerStopped'] and summary['ephemeralTokenPersisted'] is False
    assert summary['geometryQuality']['status'] == 'not-evaluated'
    assert summary['physicalAccuracyValidated'] is False
    assert not list((output / 'worker/jobs').glob('*/input.json'))
