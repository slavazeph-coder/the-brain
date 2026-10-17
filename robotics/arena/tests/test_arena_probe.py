"""Actual HTTP/archive acceptance with injected CPU physics, no model or GPU."""
from dataclasses import replace
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from workers.arena.app import create_app
from workers.arena.core import ArenaError, MAX_STEPS, SETTLE_STEPS
from workers.arena.recording import MAX_BUNDLE_BYTES, SCHEMA, verify_bundle
from test_arena_worker import episode, settings

spec = importlib.util.spec_from_file_location('arena_probe', Path(__file__).resolve().parents[1] / 'scripts/probe-worker.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class ProbeSession:
    def __init__(self, item): self.episode = item
    def call(self, operation, data=None):
        if operation == 'frame':
            if self.episode.status == 'running': self.episode.advance()
            return self.episode.frame()
        if operation == 'command': return self.episode.command(data)
        if operation == 'evidence': return self.episode.evidence()
        raise AssertionError(operation)

class ProbeManager:
    def __init__(self, config):
        self.archive = config.recording_archive()
        self.session = None
        self.created, self.deleted = [], []
        self.fail_horizon = False
    def capabilities(self):
        item = episode()
        try:
            return {'version': 1, 'profiles': [item.profile], 'recordings': {'schema': SCHEMA, 'readOnly': True, 'maxBundleBytes': MAX_BUNDLE_BYTES}}
        finally: item.close()
    def create(self, body):
        item = episode(body['protocol'])
        item.session_id = 'probe-session-' + str(len(self.created) + 1)
        item.archive = self.archive
        item.reset()
        if body['protocol'] == 'benchmark': item.env.success_at = 100000 if self.fail_horizon else SETTLE_STEPS + 3
        self.session = ProbeSession(item)
        self.created.append(item.session_id)
        return {'version': 1, 'sessionId': item.session_id, 'profile': item.profile, 'frame': item.frame()}
    def get(self, sid):
        if self.session is None or self.session.episode.session_id != sid: raise ArenaError('session_not_found', 'No fixture session', 404)
        return self.session
    def delete(self, sid):
        self.get(sid).episode.close()
        self.deleted.append(sid)
        self.session = None
    def close(self):
        if self.session is not None: self.delete(self.session.episode.session_id)

class AsgiOpener:
    def __init__(self, client):
        self.client, self.requests, self.modify = client, [], None
    def open(self, request, timeout):
        path = request.full_url.removeprefix('http://127.0.0.1:8081')
        self.requests.append((request.method, path))
        response = self.client.request(request.method, path, headers=dict(request.header_items()), content=request.data)
        value = response.json()
        if self.modify: value = self.modify(request.method, path, value)
        raw = io.BytesIO(json.dumps(value).encode())
        raw.status = response.status_code
        return raw

class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.output = root / 'private-evidence'; self.output.mkdir(mode=0o700)
        self.config = replace(settings(), recording_dir=str(root / 'archive'))
        self.manager = ProbeManager(self.config)
        self.client = TestClient(create_app(self.config, self.manager))
        self.addCleanup(self.client.close); self.addCleanup(self.manager.close)
        self.http = probe.ProbeHTTP('http://127.0.0.1:8081', self.config.origins[0], self.config.token)
        self.opener = AsgiOpener(self.client); self.http.opener = self.opener
    def run_probe(self):
        return probe.run_probe(self.http, self.output, sleep=lambda _: time.sleep(0.002))
    def test_success_checks_complete_recordings_after_reset_and_deletion(self):
        result = self.run_probe()
        self.assertTrue(result['transportAndExecutionPassed']); self.assertTrue(result['durableRecordingsPassed']); self.assertTrue(result['taskSuccess'])
        self.assertEqual(len(self.manager.deleted), 2)
        for key, filename in (('practice', 'practice-recording.json'), ('formal', 'benchmark-recording.json')):
            bundle = json.loads((self.output / filename).read_text()); manifest = verify_bundle(bundle)
            self.assertEqual(manifest['completion']['status'], 'complete')
            self.assertEqual(bundle['manifestSha256'], result['recordings'][key]['manifestSha256'])
            index = self.opener.requests.index(('DELETE', '/v1/sessions/' + manifest['sessionId']))
            self.assertIn(('GET', '/v1/recordings/' + manifest['recordingId'] + '/bundle'), self.opener.requests[index + 1:])
        self.assertNotIn(self.config.token, ''.join(p.read_text() for p in self.output.glob('*.json')))
    def test_full_horizon_miss_passes_execution_but_remains_failed_task(self):
        self.manager.fail_horizon = True
        result = self.run_probe()
        self.assertTrue(result['transportAndExecutionPassed']); self.assertFalse(result['taskSuccess'])
        self.assertEqual(result['episodeOutcome'], 'failed'); self.assertEqual(result['metrics']['steps'], MAX_STEPS)
    def test_partial_recording_cannot_pass(self):
        def change(method, path, value):
            if path.startswith('/v1/recordings/') and not path.endswith('/bundle'): value['completion']['status'] = 'partial'
            return value
        self.opener.modify = change
        with self.assertRaisesRegex(RuntimeError, 'partial'): self.run_probe()
        self.assertFalse((self.output / 'summary.json').exists()); self.assertIsNone(self.manager.session)
    def test_tampered_bundle_cannot_pass(self):
        def change(method, path, value):
            if path.endswith('/bundle'): value['manifestSha256'] = '0' * 64
            return value
        self.opener.modify = change
        with self.assertRaises(Exception): self.run_probe()
        self.assertFalse((self.output / 'summary.json').exists()); self.assertIsNone(self.manager.session)
    def test_archive_disappearing_after_delete_fails(self):
        original = self.manager.delete
        def remove(sid):
            original(sid); self.manager.archive.retention_seconds = -1
        self.manager.delete = remove
        with self.assertRaisesRegex(RuntimeError, 'received 404'): self.run_probe()
        self.assertFalse((self.output / 'summary.json').exists())
    def test_prepared_camera_cannot_satisfy_consumption(self):
        def change(method, path, value):
            frame = value.get('frame', {})
            if frame.get('metrics', {}).get('steps') == 1:
                for camera in frame['cameras']:
                    if camera.get('role') == 'policy': camera['consumedByPolicy'] = False
            return value
        self.opener.modify = change
        with self.assertRaisesRegex(RuntimeError, 'consumed policy cameras'): self.run_probe()
        self.assertIsNone(self.manager.session)
    def test_early_failure_is_not_a_horizon_pass(self):
        def change(method, path, value):
            if path.endswith('/frame') and value.get('protocol') == 'benchmark':
                value['status'] = 'failed'; value['metrics']['success'] = False
            return value
        self.opener.modify = change
        with self.assertRaisesRegex(RuntimeError, 'exact 220-step horizon'): self.run_probe()
        self.assertIsNone(self.manager.session)
    def test_missing_recording_capability_fails_before_session(self):
        def change(method, path, value):
            if path == '/v1/capabilities': value.pop('recordings', None)
            return value
        self.opener.modify = change
        with self.assertRaisesRegex(RuntimeError, 'durable recording contract'): self.run_probe()
        self.assertEqual(self.manager.created, [])
    def test_credential_echo_and_response_size_are_rejected(self):
        self.opener.modify = lambda method, path, value: {'echo': self.config.token}
        with self.assertRaisesRegex(RuntimeError, 'credential'): self.http('GET', '/v1/capabilities')
        self.assertEqual(list(self.output.iterdir()), [])
        self.opener.modify = lambda method, path, value: {'large': 'x' * 100}
        with self.assertRaisesRegex(RuntimeError, 'bounded size'): self.http('GET', '/v1/capabilities', max_bytes=20)
    def test_escaped_credential_and_invalid_header_never_leak(self):
        raw = ('{"echo":"' + self.config.token.replace('u', '\\u0075') + '"}').encode()
        response = io.BytesIO(raw); response.status = 200
        with patch.object(self.opener, 'open', return_value=response):
            with self.assertRaisesRegex(RuntimeError, 'credential'): self.http('GET', '/v1/capabilities')
        with self.assertRaisesRegex(ValueError, 'printable ASCII'):
            probe.ProbeHTTP('http://127.0.0.1:8081', self.config.origins[0], self.config.token + '\n')
    def test_body_trickle_cannot_extend_deadline(self):
        with patch.object(probe, 'time', SimpleNamespace(monotonic=Mock(side_effect=[0, 0, 61]))):
            with self.assertRaisesRegex(RuntimeError, 'Worker request failed'): self.http('GET', '/v1/capabilities')

if __name__ == '__main__': unittest.main()
