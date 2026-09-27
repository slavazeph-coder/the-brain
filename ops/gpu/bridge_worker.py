#!/usr/bin/env python3
"""Outbound HTTPS worker. Jobs select two fixed loopback operations, never URLs or commands."""
import http.client
import json
import os
import random
import signal
import socket
import threading
import time
from urllib.parse import urlsplit
import uuid

MAX_BYTES = 64 * 1024


class Worker:
    def __init__(self, env):
        parsed = urlsplit(env.get('GPU_BRIDGE_URL', ''))
        local_test = (env.get('GPU_BRIDGE_ALLOW_LOOPBACK_HTTP') == '1'
                      and parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')
        if (parsed.scheme != 'https' and not local_test) or not parsed.hostname or parsed.username or parsed.password \
                or parsed.query or parsed.fragment or parsed.path.rstrip('/') != '/api/gpu-worker':
            raise ValueError('GPU_BRIDGE_URL must be HTTPS ending /api/gpu-worker')
        self.origin = parsed
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError('Invalid bridge port')
        self.key = env.get('GPU_BRIDGE_WORKER_KEY', '')
        self.gateway_key = env.get('GPU_API_KEY', '')
        if any(len(key) < 32 or len(key) > 256 or '\n' in key or '\r' in key
               for key in (self.key, self.gateway_key)) or self.key == self.gateway_key:
            raise ValueError('Use separate generated bridge and gateway keys')
        self.gateway_port = int(env.get('GATEWAY_PORT', '8787'))
        if not 1024 <= self.gateway_port <= 65535:
            raise ValueError('Invalid loopback gateway port')
        self.worker_id = uuid.uuid4().hex
        self.stop = threading.Event()
        self.lock = threading.RLock()
        self.connections = set()
        self.deadlines = {}

    def shutdown(self):
        self.stop.set()
        with self.lock:
            for cancel in tuple(self.connections):
                cancel()

    def http(self, method, path, body=None, timeout=5, gateway=False):
        """No proxy/redirect support; total timer also bounds slow streamed responses."""
        if self.stop.is_set():
            raise OSError('worker_stopped')
        if gateway:
            connection = http.client.HTTPConnection('127.0.0.1', self.gateway_port, timeout=timeout)
            key = self.gateway_key
        else:
            cls = http.client.HTTPSConnection if self.origin.scheme == 'https' else http.client.HTTPConnection
            connection = cls(self.origin.hostname, self.origin.port, timeout=min(timeout, 5))
            key = self.key
            path = self.origin.path.rstrip('/') + path
        payload = None if body is None else json.dumps(body, separators=(',', ':'), allow_nan=False).encode()
        if payload is not None and len(payload) > MAX_BYTES:
            raise ValueError('request_too_large')
        expired, sock = threading.Event(), [None]

        def cancel():
            expired.set()
            current = sock[0] or connection.sock
            if current:
                try: current.shutdown(socket.SHUT_RDWR)
                except OSError: pass

        timer = threading.Timer(timeout, cancel)
        timer.daemon = True
        with self.lock:
            self.connections.add(cancel)
            self.deadlines[threading.get_ident()] = time.monotonic() + timeout
        timer.start()
        try:
            connection.connect()
            sock[0] = connection.sock
            if expired.is_set() or self.stop.is_set():
                raise OSError('request_expired')
            # The connect timeout is short; a long-poll body can wait longer.
            sock[0].settimeout(timeout)
            headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
            if not gateway: headers['X-BrainSNN-Worker'] = self.worker_id
            connection.request(method, path, body=payload, headers=headers)
            result = connection.getresponse()
            if result.status in (204, 205) or 300 <= result.status < 400:
                raise ValueError('unexpected_status')
            data = result.read(MAX_BYTES + 1)
            if expired.is_set() or len(data) > MAX_BYTES:
                raise ValueError('response_expired_or_large')
            if result.headers.get_content_type() != 'application/json':
                raise ValueError('json_required')
            decoded = json.loads(data)
            if not isinstance(decoded, dict):
                raise ValueError('object_required')
            return result.status, decoded
        finally:
            timer.cancel()
            connection.close()
            with self.lock:
                self.connections.discard(cancel)
                self.deadlines.pop(threading.get_ident(), None)

    def process(self, job):
        if not isinstance(job, dict) or not isinstance(job.get('id'), str):
            raise ValueError('invalid_job')
        try: parsed_id = str(uuid.UUID(job['id']))
        except (ValueError, AttributeError): raise ValueError('invalid_job_id')
        if parsed_id != job['id']:
            raise ValueError('invalid_job_id')
        timeout = job.get('timeoutMs')
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 30_000:
            raise ValueError('invalid_deadline')
        operation = job.get('operation')
        if operation == 'models' and job.get('body') is None:
            method, path, body = 'GET', '/v1/models', None
        elif operation == 'chat/completions' and isinstance(job.get('body'), dict):
            method, path, body = 'POST', '/v1/chat/completions', job['body']
        else:
            raise ValueError('invalid_operation')
        # The only payload handed to the gateway is a chat body. It independently
        # rejects tools, remote media, wrong models and unbounded output tokens.
        started = time.monotonic()
        try:
            status, answer = self.http(method, path, body, timeout=timeout / 1000, gateway=True)
            if len(json.dumps({'status': status, 'body': answer}, separators=(',', ':')).encode()) > MAX_BYTES:
                status, answer = 502, {'error': 'response_too_large'}
        except (OSError, ValueError, http.client.HTTPException):
            status, answer = 502, {'error': 'gateway_unavailable'}
        if self.stop.is_set() or time.monotonic() - started >= timeout / 1000:
            return
        # Cancellation is authoritative at the broker. Never publish a result
        # for an expired lease; the broker also rechecks after reading its body.
        remaining = timeout / 1000 - (time.monotonic() - started)
        if remaining <= 0:
            return
        code, _ = self.http('GET', '/jobs/' + parsed_id, timeout=min(2, remaining))
        if code != 200:
            return
        remaining = timeout / 1000 - (time.monotonic() - started)
        if remaining > 0:
            self.http('POST', '/jobs/' + parsed_id, {'status': status, 'body': answer}, timeout=min(3, remaining))

    def loop(self):
        delay = 1
        while not self.stop.is_set():
            try:
                status, job = self.http('GET', '/next', timeout=25)
                if status != 200:
                    raise OSError('bridge_unavailable')
                delay = 1
                if job.get('idle') is not True:
                    self.process(job)
            except (OSError, ValueError, http.client.HTTPException):
                # Never log bodies, URLs, tokens, or exceptions containing them.
                self.stop.wait(delay + random.uniform(0, min(delay, 1)))
                delay = min(delay * 2, 30)

    def run(self):
        threads = [threading.Thread(target=self.loop, daemon=True) for _ in range(2)]
        for thread in threads: thread.start()
        try:
            while not self.stop.wait(1):
                if any(not thread.is_alive() for thread in threads):
                    raise RuntimeError('bridge_worker_thread_stopped')
                # DNS can block before a socket exists for the total timer to
                # shut down. Let the outer runtime restart this whole process.
                with self.lock:
                    if any(time.monotonic() > deadline + 5 for deadline in self.deadlines.values()):
                        raise RuntimeError('bridge_worker_request_stalled')
        finally:
            self.shutdown()
            for thread in threads: thread.join(timeout=1)


if __name__ == '__main__':
    worker = Worker(os.environ)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: worker.shutdown())
    worker.run()
