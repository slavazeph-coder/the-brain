from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
import time
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge_worker import Worker

ENV = {'GPU_BRIDGE_URL': 'https://www.brainsnn.com/api/gpu-worker',
       'GPU_BRIDGE_WORKER_KEY': 'w' * 40, 'GPU_API_KEY': 'g' * 40}


class WorkerTests(unittest.TestCase):
    def test_rejects_remote_plaintext_credentials_and_job_urls(self):
        for url in ('http://example.com/api/gpu-worker', 'https://u:p@example.com/api/gpu-worker',
                    'https://example.com/api/gpu-worker?key=x', 'https://example.com/admin'):
            with self.assertRaises(ValueError):
                Worker({**ENV, 'GPU_BRIDGE_URL': url, 'GPU_BRIDGE_ALLOW_LOOPBACK_HTTP': '1'})
        with self.assertRaises(ValueError):
            Worker({**ENV, 'GPU_BRIDGE_WORKER_KEY': ENV['GPU_API_KEY']})
        worker = Worker(ENV)
        worker.http = lambda *args, **kwargs: self.fail('invalid operation reached HTTP')
        with self.assertRaises(ValueError):
            worker.process({'id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'operation': 'http://attacker/',
                            'timeoutMs': 1000, 'body': {}})

    def server(self, handler):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def test_fixed_loopback_transport_does_not_forward_worker_key_or_follow_redirect(self):
        seen = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append((self.path, self.headers.get('Authorization'), self.headers.get('X-BrainSNN-Worker')))
                self.send_response(302)
                self.send_header('Location', 'http://example.invalid/secret')
                self.end_headers()
            def log_message(self, *args): pass
        server = self.server(Handler)
        worker = Worker({**ENV, 'GATEWAY_PORT': str(server.server_port)})
        with self.assertRaises(ValueError):
            worker.http('GET', '/v1/models', gateway=True)
        self.assertEqual(seen, [('/v1/models', 'Bearer ' + ENV['GPU_API_KEY'], None)])

    def test_total_deadline_bounds_trickled_http10_response(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                try:
                    self.wfile.write(b'{'); self.wfile.flush()
                    for _ in range(100):
                        time.sleep(0.03); self.wfile.write(b' '); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError): pass
            def log_message(self, *args): pass
        server = self.server(Handler)
        worker = Worker({**ENV, 'GATEWAY_PORT': str(server.server_port)})
        started = time.monotonic()
        with self.assertRaises((OSError, ValueError)):
            worker.http('GET', '/v1/models', gateway=True, timeout=0.12)
        self.assertLess(time.monotonic() - started, 0.6)

    def test_oversize_gateway_response_is_rejected(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json'); self.end_headers()
                try: self.wfile.write(json.dumps({'data': 'x' * 70000}).encode())
                except BrokenPipeError: pass
            def log_message(self, *args): pass
        server = self.server(Handler)
        worker = Worker({**ENV, 'GATEWAY_PORT': str(server.server_port)})
        with self.assertRaisesRegex(ValueError, 'response_expired_or_large'):
            worker.http('GET', '/v1/models', gateway=True, timeout=1)

    def test_stalled_resolver_deadline_fails_process_for_supervisor_restart(self):
        worker = Worker(ENV)
        worker.deadlines[123] = time.monotonic() - 10
        worker.loop = lambda: worker.stop.wait(10)
        with self.assertRaisesRegex(RuntimeError, 'request_stalled'):
            worker.run()
        self.assertTrue(worker.stop.is_set())


if __name__ == '__main__':
    unittest.main()
