"""Optional read-only localhost telemetry; no ROS or robot command endpoint."""
from __future__ import annotations
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from urllib.parse import urlparse
from . import contracts as c


def serve(collector, token_file, port, allowed_origin=None):
    token = c.read_file(token_file, 256).strip()
    if not 32 <= len(token) <= 128 or any(b <= 32 or b >= 127 for b in token):
        raise ValueError('Telemetry token must be 32-128 printable non-space bytes')
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('Invalid telemetry port')
    if allowed_origin is not None:
        parsed = urlparse(allowed_origin)
        if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1'))) or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('Use one explicit HTTPS browser origin')

    class Handler(BaseHTTPRequestHandler):
        def origin_allowed(self):
            origin = self.headers.get('Origin')
            return origin is None or (allowed_origin is not None and origin == allowed_origin)

        def end_headers(self):
            if self.headers.get('Origin') == allowed_origin and allowed_origin is not None:
                self.send_header('Access-Control-Allow-Origin', allowed_origin)
                self.send_header('Vary', 'Origin')
            super().end_headers()

        def do_OPTIONS(self):
            if (not self.origin_allowed() or self.path != '/v1/localization' or
                    self.headers.get('Access-Control-Request-Method') != 'GET' or
                    self.headers.get('Access-Control-Request-Headers', '').lower() not in ('authorization', '')):
                self.send_response(403)
            else:
                self.send_response(204)
                self.send_header('Access-Control-Allow-Methods', 'GET')
                self.send_header('Access-Control-Allow-Headers', 'Authorization')
                self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Content-Length', '0'); self.end_headers()

        def do_GET(self):
            if not self.origin_allowed():
                self.send_response(403); self.send_header('Content-Length', '0'); self.end_headers(); return
            supplied = self.headers.get('Authorization', '').encode()
            if not hmac.compare_digest(supplied, b'Bearer ' + token):
                self.send_response(401); self.send_header('Content-Length', '0'); self.end_headers(); return
            if self.path != '/v1/localization':
                self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
            snapshot = collector.snapshot(); raw = c.encode(snapshot)
            self.send_response(200 if snapshot['sample'] is not None else 409)
            self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff'); self.send_header('Content-Length', str(len(raw)))
            self.end_headers(); self.wfile.write(raw)

        def log_message(self, *_args):
            pass  # Never log bearer tokens or request paths.

    class BoundedServer(HTTPServer):
        request_queue_size = 8

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(3.)
            return connection, address

    # A serialized bounded endpoint needs no unbounded per-connection threads.
    server = BoundedServer(('127.0.0.1', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    return server
