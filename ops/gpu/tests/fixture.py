"""CPU-only subprocess fixtures for supervision tests; no ML dependencies."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import sys
import time
import urllib.request

root = Path(os.environ['BRAINSNN_RUNTIME_DIR'])
if sys.argv[1] in ('worker', 'eval'):
    (root / 'worker-started').write_text(str(os.getpid()))
    def checkpoint(*_):
        (root / 'checkpoints' / 'signal.json').write_text('{"saved":true}')
        sys.exit(0)
    signal.signal(signal.SIGTERM, checkpoint)
    if sys.argv[1] == 'eval':
        data = json.dumps({'model': 'brainsnn-local', 'messages': [{'role': 'user', 'content': 'background'}]}).encode()
        request = urllib.request.Request(os.environ['BRAINSNN_GPU_BASE_URL'] + '/chat/completions', data=data,
            headers={'Authorization': 'Bearer ' + os.environ['BRAINSNN_GPU_API_KEY'], 'X-BrainSNN-Background': '1', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
    while True:
        time.sleep(0.1)
elif sys.argv[1] == 'once':
    path = root / 'work-count'
    path.write_text(str(int(path.read_text()) + 1 if path.exists() else 1))
else:
    count = root / 'backend-starts'
    count.write_text(str(int(count.read_text()) + 1 if count.exists() else 1))
    if sys.argv[1] == 'crash-first' and count.read_text() == '1':
        sys.exit(3)
    class Handler(BaseHTTPRequestHandler):
        health_checks = 0
        def log_message(self, *_):
            pass
        def do_GET(self):
            if sys.argv[1] == 'health-drip' and self.path == '/health':
                self.connection.sendall(b'HTTP/1.0 200 OK\r\nX-Test: ')
                try:
                    for _ in range(100):
                        self.connection.sendall(b'x')
                        time.sleep(0.1)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            if self.path == '/health':
                Handler.health_checks += 1
                if sys.argv[1] == 'unhealthy' and Handler.health_checks > 2:
                    self.send_response(503)
                    self.end_headers()
                    return
            if self.path == '/health':
                response = {'ready': True}
            else:
                response = {'object': 'list', 'data': [{'id': 'brainsnn-local'}]}
            data = json.dumps(response).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def do_POST(self):
            assert self.headers['Authorization'] == 'Bearer ' + os.environ['BACKEND_API_KEY']
            value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if sys.argv[1] == 'drip' or (sys.argv[1] == 'drip-background' and value['messages'][0]['content'] == 'background'):
                (root / 'background-inflight').touch()
                self.send_response(200)
                self.send_header('Content-Length', '100')
                self.end_headers()
                try:
                    for _ in range(100):
                        self.wfile.write(b' ')
                        self.wfile.flush()
                        time.sleep(0.1)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            data = json.dumps({'choices': [{'message': {'content': '{"ok":true}'}, 'finish_reason': 'stop'}],
                               'received_model': value['model']}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    ThreadingHTTPServer(('127.0.0.1', int(os.environ['BACKEND_PORT'])), Handler).serve_forever()
