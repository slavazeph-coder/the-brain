import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
import checkpoint
import runtime
import vllm_launch


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = self.root / 'runtime.env'
        value = (SOURCE / 'runtime.env.example').read_text().replace('__RUNTIME_DIR__', str(self.root))
        for secret in ('a' * 40, 'b' * 40, 'c' * 40):
            value = value.replace('GENERATE_ON_INSTALL', secret, 1)
        self.config.write_text(value)
        self.config.chmod(0o600)
        self.gateway, self.backend = port(), port()
        while self.backend == self.gateway:
            self.backend = port()
        self.update(GATEWAY_PORT=str(self.gateway), BACKEND_PORT=str(self.backend), POLL_SECONDS='0.15',
                    BACKGROUND_IDLE_SECONDS='0.2', BACKGROUND_MIN_FREE_MB='0', MIN_DISK_FREE_MB='0',
                    RESTART_MIN_SECONDS='0.2', RESTART_MAX_SECONDS='0.4', STARTUP_GRACE_SECONDS='3')
        self.process = None

    def tearDown(self):
        if self.process and self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.process and self.process.stderr:
            self.process.stderr.close()
        self.temp.cleanup()

    def update(self, **values):
        lines = self.config.read_text().splitlines()
        self.config.write_text('\n'.join(key + '=' + values[key] if (key := line.partition('=')[0]) in values else line for line in lines) + '\n')

    def launch(self, mode='serve', worker=None):
        command = [sys.executable, str(SOURCE / 'tests/fixture.py'), mode]
        self.update(INFERENCE_COMMAND=json.dumps(command))
        if worker:
            self.update(BACKGROUND_COMMAND=json.dumps([sys.executable, str(SOURCE / 'tests/fixture.py'), worker]), BACKGROUND_LABEL='fixture useful finite work')
        self.process = subprocess.Popen([sys.executable, str(SOURCE / 'runtime.py'), '--config', str(self.config), 'run'],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.wait(lambda: self.status().get('backend_ready'), 10)

    def wait(self, condition, timeout=6):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition():
                return
            if self.process and self.process.poll() is not None:
                self.fail(self.process.stderr.read().decode())
            time.sleep(0.05)
        self.fail('Timed out waiting for runtime condition')

    def status(self):
        return checkpoint.load_json(self.root / 'state/status.json', {})

    def request(self, path, key=None, body=None):
        headers = {'Authorization': 'Bearer ' + (key or 'a' * 40), 'Content-Type': 'application/json'}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f'http://127.0.0.1:{self.gateway}{path}', headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, timeout=6) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_empty_config_runs_no_work(self):
        config = runtime.read_config(self.config)
        instance = runtime.Runtime(config)
        instance.tick()
        self.assertIsNone(instance.inference)
        self.assertIsNone(instance.background)
        self.assertFalse(instance.status()['inference_configured'])
        self.assertFalse(instance.status()['backend_ready'])

    def test_bridge_worker_is_separate_supervised_and_stops_with_runtime(self):
        fixture = self.root / 'bridge_fixture.py'
        fixture.write_text('''import os,signal,time,json
from pathlib import Path
p=Path(os.environ['BRAINSNN_RUNTIME_DIR'])
n=p/'bridge_count'
count=int(n.read_text())+1 if n.exists() else 1
n.write_text(str(count))
if count == 1: raise SystemExit(1)
(p/'bridge_pid').write_text(str(os.getpid()))
(p/'bridge_env_names').write_text(json.dumps(sorted(os.environ)))
while True: time.sleep(1)
''')
        self.update(BRIDGE_COMMAND=json.dumps([sys.executable, str(fixture)]),
                    GPU_BRIDGE_URL='https://www.brainsnn.com/api/gpu-worker', GPU_BRIDGE_WORKER_KEY='d' * 40)
        self.launch()
        self.wait(lambda: (self.root / 'bridge_pid').exists())
        self.assertGreaterEqual(int((self.root / 'bridge_count').read_text()), 2)
        keys = json.loads((self.root / 'bridge_env_names').read_text())
        self.assertIn('GPU_BRIDGE_WORKER_KEY', keys)
        self.assertIn('GPU_API_KEY', keys)
        self.assertNotIn('BACKEND_API_KEY', keys)
        self.assertNotIn('BACKGROUND_API_KEY', keys)
        pid = int((self.root / 'bridge_pid').read_text())
        self.process.send_signal(signal.SIGTERM)
        self.process.wait(timeout=10)
        with self.assertRaises(ProcessLookupError): os.kill(pid, 0)
        self.assertFalse(self.status()['bridge_running'])

    def test_crash_restarts_and_authenticated_allowlist(self):
        self.launch('crash-first')
        self.assertGreaterEqual(int((self.root / 'backend-starts').read_text()), 2)
        self.assertEqual(self.request('/v1/models', key='wrong')[0], 401)
        self.assertEqual(self.request('/metrics')[0], 404)
        self.assertEqual(self.request('/v1/models')[0], 200)
        body = {'model': 'brainsnn-local', 'messages': [{'role': 'user', 'content': 'hello'}], 'max_tokens': 20}
        self.assertEqual(self.request('/v1/chat/completions', body=body)[0], 200)
        body['messages'][0]['content'] = [{'type': 'image_url', 'image_url': {'url': 'http://private-host'}}]
        self.assertEqual(self.request('/v1/chat/completions', body=body)[0], 400)

    def test_foreground_preempts_and_checkpoints_worker(self):
        self.launch(worker='worker')
        self.wait(lambda: (self.root / 'worker-started').exists())
        worker_pid = int((self.root / 'worker-started').read_text())
        body = {'model': 'brainsnn-local', 'messages': [{'role': 'user', 'content': 'hello'}]}
        self.assertEqual(self.request('/v1/chat/completions', body=body)[0], 200)
        self.assertTrue((self.root / 'checkpoints/signal.json').exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(worker_pid, 0)

    def test_successful_finite_worker_parks(self):
        self.launch(worker='once')
        self.wait(lambda: self.status().get('background_complete'))
        time.sleep(0.7)
        self.assertEqual((self.root / 'work-count').read_text(), '1')

    def test_sigterm_stops_backend_and_writes_status(self):
        self.launch()
        backend_pid = self.status()['inference_pid']
        self.process.send_signal(signal.SIGTERM)
        self.process.wait(timeout=10)
        self.assertEqual(self.process.returncode, 0)
        self.assertTrue(self.status()['stopped'])
        self.assertFalse(self.status()['backend_ready'])
        with self.assertRaises(ProcessLookupError):
            os.kill(backend_pid, 0)

    def test_unhealthy_ready_backend_restarts_without_full_startup_grace(self):
        self.update(STARTUP_GRACE_SECONDS='900')
        self.launch('unhealthy')
        self.wait(lambda: int((self.root / 'backend-starts').read_text()) >= 2)

    def test_total_deadline_bounds_slow_drip_response(self):
        self.update(INFERENCE_TIMEOUT_SECONDS='0.4')
        self.launch('drip')
        body = {'model': 'brainsnn-local', 'messages': [{'role': 'user', 'content': 'hello'}]}
        before = time.monotonic()
        self.assertEqual(self.request('/v1/chat/completions', body=body)[0], 503)
        self.assertLess(time.monotonic() - before, 1.5)

    def test_foreground_cancels_http10_background_response(self):
        self.launch('drip-background', worker='eval')
        self.wait(lambda: (self.root / 'background-inflight').exists())
        body = {'model': 'brainsnn-local', 'messages': [{'role': 'user', 'content': 'hello'}]}
        before = time.monotonic()
        self.assertEqual(self.request('/v1/chat/completions', body=body)[0], 200)
        self.assertLess(time.monotonic() - before, 1.5)
        self.assertTrue((self.root / 'checkpoints/signal.json').exists())

    def test_health_probe_deadline_bounds_slow_headers(self):
        instance = runtime.Runtime(runtime.read_config(self.config))
        backend = instance.launch('inference', [sys.executable, str(SOURCE / 'tests/fixture.py'), 'health-drip'])
        try:
            self.wait(lambda: (self.root / 'backend-starts').exists())
            before = time.monotonic()
            self.assertFalse(instance.health())
            elapsed = time.monotonic() - before
            self.assertGreater(elapsed, 1.5)
            self.assertLess(elapsed, 3)
        finally:
            instance.terminate(backend, 1)

    def test_config_secret_permissions_and_download_guard(self):
        self.config.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'owner-only'):
            runtime.read_config(self.config)
        with self.assertRaisesRegex(ValueError, 'explicit download'):
            vllm_launch.command({'MODEL_PATH': 'example/not-installed'})

    def test_checkpoint_invalid_update_preserves_previous(self):
        path = self.root / 'cursor.json'
        checkpoint.save_json(path, {'completed': 3})
        with self.assertRaises(ValueError):
            checkpoint.save_json(path, {'invalid': float('nan')})
        self.assertEqual(checkpoint.load_json(path), {'completed': 3})
        self.assertEqual(list(self.root.glob('.cursor.json*')), [])


if __name__ == '__main__':
    unittest.main()
