"""The live launch checker must fail on absent evidence and remain bounded."""
import hashlib
import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location('site_check', Path(__file__).resolve().parents[2] / 'scripts/world-demo/site_processing_check.py')
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


@pytest.mark.parametrize('status', [None, 'folded', 'unchecked', 'insufficient-evidence'])
def test_missing_or_failed_fold_evidence_does_not_pass(status):
    assert check.reconstruction_screen({'capture': {'consistency': {'status': status}}})[0] is False


def test_completed_fold_check_passes():
    assert check.reconstruction_screen({'capture': {'consistency': {'status': 'consistent'}}}) == (True, 'consistent')


def test_timeout_requests_cancellation(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(check.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(check.time, 'sleep', lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    calls = []

    class Site:
        def json(self, method, path, *args, **kwargs):
            calls.append((method, path))
            return {'id': 'job', 'status': 'running'}

    with pytest.raises(RuntimeError, match='exceeded'):
        check.run_job(Site(), 'colmap-sparse', 'upload', poll=5, timeout=10)
    assert ('DELETE', '/api/world/worker/v1/jobs/job') in calls
    assert clock[0] == 10


def test_transport_timeout_also_cancels_known_job(monkeypatch):
    monkeypatch.setattr(check.time, 'sleep', lambda _: None)
    calls = []

    class Site:
        def json(self, method, path, *args, **kwargs):
            calls.append((method, path))
            if method == 'GET':
                raise TimeoutError('poll timed out')
            return {'id': 'known-job', 'status': 'running'}

    with pytest.raises(RuntimeError, match='known-job.*cancellation accepted'):
        check.run_job(Site(), 'colmap-sparse', ['one', 'two'], poll=5, timeout=60)
    assert ('DELETE', '/api/world/worker/v1/jobs/known-job') in calls


class Downloads:
    def json(self, *args, **kwargs):
        return {'url': '/api/world/worker/v1/download/ticket'}

    def call(self, *args, **kwargs):
        return 200, b'real returned bytes'


def artifact(name='cloud.ply'):
    return {'name': name, 'sha256': hashlib.sha256(b'real returned bytes').hexdigest()}


def test_downloads_require_artifacts(tmp_path):
    with pytest.raises(RuntimeError, match='no artifacts'):
        check.download_all(Downloads(), {'id': 'job', 'artifacts': []}, tmp_path)


@pytest.mark.parametrize('name', ['../escape', '/escape', '.', 'a\\escape'])
def test_download_cannot_escape_output(tmp_path, name):
    with pytest.raises(RuntimeError, match='unsafe'):
        check.download_all(Downloads(), {'id': 'job', 'artifacts': [artifact(name)]}, tmp_path)


def test_download_hash_and_duplicate_names(tmp_path):
    row = artifact()
    row['sha256'] = '0' * 64
    with pytest.raises(RuntimeError, match='SHA-256'):
        check.download_all(Downloads(), {'id': 'job', 'artifacts': [row]}, tmp_path)
    assert not (tmp_path / row['name']).exists()
    with pytest.raises(RuntimeError, match='duplicate'):
        check.download_all(Downloads(), {'id': 'job', 'artifacts': [artifact(), artifact()]}, tmp_path)
    assert (tmp_path / 'cloud.ply').read_bytes() == b'real returned bytes'


def test_download_never_overwrites_existing_file(tmp_path):
    (tmp_path / 'cloud.ply').write_bytes(b'previous result')
    with pytest.raises(FileExistsError):
        check.download_all(Downloads(), {'id': 'job', 'artifacts': [artifact()]}, tmp_path)
    assert (tmp_path / 'cloud.ply').read_bytes() == b'previous result'
