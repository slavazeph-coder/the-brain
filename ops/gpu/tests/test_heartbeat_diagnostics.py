"""No-socket heartbeat diagnostics and deadline/resource regressions."""
import http.client
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import traceback
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import orchestration_worker as ow
import runtime
from crew_worker import ResearchError
import test_orchestration_worker as existing

SECRET = 'synthetic-private-body https://private.invalid/token key=private'
SUBTYPES = ('timeout', 'connection', 'http_5xx', 'http_429', 'unknown')


class SpoofedSubtype(str):
    def __hash__(self): return hash('timeout')
    def __eq__(self, other): return other == 'timeout'


class ManualTimer:
    """Tests trigger the actual deadline callback without timing races."""
    def __init__(self, seconds, callback):
        self.seconds, self.callback = seconds, callback
        self.cancelled = False

    def start(self):
        pass

    def cancel(self):
        self.cancelled = True


class Response:
    def __init__(self, status=200, body=b'{}'):
        self.status, self.body = status, body
        self.closed = False

    def read(self, _count):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body() if callable(self.body) else self.body

    def close(self):
        self.closed = True


class Connection:
    def __init__(self, response=None, error=None):
        self.response = response or Response()
        self.error = error
        self.sock = self
        self.closed = False
        self.shutdowns = 0
        self.requests = 0

    def connect(self):
        if self.error:
            raise self.error

    def request(self, *args, **kwargs):
        self.requests += 1

    def getresponse(self):
        return self.response

    def shutdown(self, _how):
        self.shutdowns += 1

    def close(self):
        self.closed = True


class DeadlineRegressions(unittest.TestCase):
    def test_expired_deadline_with_partial_json_is_transport_timeout(self):
        timers = []
        def timer(*args):
            result = ManualTimer(*args)
            timers.append(result)
            return result
        def partial_read():
            timers[0].callback()
            return b'{'
        conn = Connection(Response(body=partial_read))
        with patch.object(ow.threading, 'Timer', side_effect=timer), \
             patch.object(ow.http.client, 'HTTPSConnection', return_value=conn):
            with self.assertRaises(ow.TransportFault) as raised:
                ow.JsonClient('https://example.invalid').request('GET', '/heartbeat', timeout=2)
        self.assertEqual(raised.exception.subtype, 'timeout')
        self.assertEqual(conn.shutdowns, 1)
        self.assertEqual(conn.requests, 1)
        self.assertTrue(conn.closed)
        self.assertTrue(conn.response.closed)
        self.assertTrue(timers[0].cancelled)

    def test_detached_http10_response_is_closed_on_rejected_partial_read(self):
        # Use real stdlib response ownership/bounded read behavior, no socket.
        stream = io.BytesIO(b'HTTP/1.0 200 OK\r\nContent-Length: 100\r\n\r\n' + b'x' * 100)
        class MemorySocket:
            def makefile(self, *_args): return stream
            def sendall(self, _data): pass
            def close(self): pass
            def shutdown(self, _how): pass
        class MemoryConnection(http.client.HTTPConnection):
            def connect(self): self.sock = MemorySocket()
            def getresponse(self):
                self.last_response = super().getresponse()
                return self.last_response
        conn = MemoryConnection('example.invalid')
        self.addCleanup(lambda: conn.last_response.close())
        caught = None
        with patch.object(ow.threading, 'Timer', ManualTimer), \
             patch.object(ow.http.client, 'HTTPSConnection', return_value=conn):
            try:
                ow.JsonClient('https://example.invalid').request('GET', '/', max_bytes=4)
            except ValueError as error:
                caught = error  # Retain traceback; GC must not provide cleanup.
            self.assertIsNotNone(caught)
            self.assertIsNone(conn.sock)  # getresponse detached will_close response.
            self.assertTrue(stream.closed, 'Detached response remains open while traceback is retained')
        stream.close()

    def test_overlapping_requests_have_independent_deadlines(self):
        entered, peer_entered = threading.Event(), threading.Event()
        expire, release = threading.Event(), threading.Event()
        timers, connections, outcomes = {}, {}, {}
        def timer(seconds, callback):
            result = ManualTimer(seconds, callback)
            timers[threading.current_thread().name] = result
            return result
        def connection(*args, **kwargs):
            name = threading.current_thread().name
            def read():
                if name == 'short':
                    entered.set()
                    if not expire.wait(2): raise AssertionError('test did not trigger deadline')
                    timers[name].callback()
                else:
                    peer_entered.set()
                    if not release.wait(2): raise AssertionError('test did not release peer')
                return b'{}'
            conn = Connection(Response(body=read))
            connections[name] = conn
            return conn
        client = ow.JsonClient('https://example.invalid')
        def request():
            try:
                outcomes[threading.current_thread().name] = client.request('GET', '/', timeout=2)
            except Exception as error:
                outcomes[threading.current_thread().name] = error
        with patch.object(ow.threading, 'Timer', side_effect=timer), \
             patch.object(ow.http.client, 'HTTPSConnection', side_effect=connection):
            first = threading.Thread(target=request, name='short')
            second = threading.Thread(target=request, name='long')
            first.start()
            try:
                self.assertTrue(entered.wait(2))
                second.start()
                self.assertTrue(peer_entered.wait(2))
                expire.set()
                first.join(2)
                self.assertFalse(first.is_alive())
                release.set()
                second.join(2)
            finally:
                expire.set(); release.set()
                first.join(2)
                if second.ident is not None: second.join(2)
        self.assertIsInstance(outcomes['short'], ow.TransportFault)
        self.assertEqual(outcomes['long'], {})
        self.assertEqual(connections['short'].shutdowns, 1)
        self.assertEqual(connections['long'].shutdowns, 0)
        self.assertTrue(all(conn.closed for conn in connections.values()))
        self.assertTrue(all(timer.cancelled for timer in timers.values()))


class TransportDiagnostics(unittest.TestCase):
    def test_allowlisted_transport_subtypes_no_secrets_or_request_retry(self):
        cases = [
            (Connection(error=TimeoutError(SECRET)), 'timeout'),
            (Connection(error=ConnectionRefusedError(SECRET)), 'connection'),
            (Connection(error=ow.socket.gaierror(SECRET)), 'connection'),
            (Connection(Response(body=TimeoutError(SECRET))), 'timeout'),
            (Connection(Response(body=ConnectionResetError(SECRET))), 'connection'),
            (Connection(Response(body=http.client.IncompleteRead(SECRET.encode()))), 'connection'),
            (Connection(Response(500, SECRET.encode())), 'http_5xx'),
            (Connection(Response(503, SECRET.encode())), 'http_5xx'),
            (Connection(Response(599, SECRET.encode())), 'http_5xx'),
            (Connection(Response(429, SECRET.encode())), 'http_429'),
        ]
        for conn, expected in cases:
            with self.subTest(expected=expected), patch.object(ow.threading, 'Timer', ManualTimer), \
                 patch.object(ow.http.client, 'HTTPSConnection', return_value=conn) as factory:
                with self.assertRaises(ow.TransportFault) as raised:
                    ow.JsonClient('https://example.invalid', {'Authorization': SECRET}).request('POST', '/heartbeat', {'token': SECRET}, timeout=2)
                error = raised.exception
                self.assertEqual(error.subtype, expected)
                self.assertNotIn(SECRET, ''.join(traceback.format_exception(type(error), error, error.__traceback__)))
                factory.assert_called_once_with('example.invalid', None, timeout=2)
                self.assertEqual(conn.requests, 0 if conn.error else 1)
                self.assertTrue(conn.closed)
                if not conn.error: self.assertTrue(conn.response.closed)

    def test_non_transport_classification_and_success_are_preserved(self):
        for status, body, expected in [(200, b'{}', None), (200, b'{', ValueError),
                                       (302, b'{}', ValueError), (400, b'{}', ValueError),
                                       (401, b'{}', ow.LeaseLost), (403, b'{}', ow.LeaseLost),
                                       (409, b'{}', ow.LeaseLost), (410, b'{}', ow.LeaseLost),
                                       (503, b'NVML device lost', ow.HardwareFault)]:
            conn = Connection(Response(status, body))
            with self.subTest(status=status, expected=expected), patch.object(ow.threading, 'Timer', ManualTimer), \
                 patch.object(ow.http.client, 'HTTPSConnection', return_value=conn):
                if expected:
                    with self.assertRaises(expected):
                        ow.JsonClient('https://example.invalid').request('GET', '/')
                else:
                    self.assertEqual(ow.JsonClient('https://example.invalid').request('GET', '/'), {})
                self.assertEqual(conn.requests, 1)
                self.assertTrue(conn.response.closed)


class HeartbeatDiagnostics(unittest.TestCase):
    def test_subtypes_cancel_once_without_changing_scheduler_categories(self):
        for kind in ('video', 'research'):
            for subtype, report_unavailable in [(subtype, False) for subtype in (*SUBTYPES, SECRET, SpoofedSubtype(SECRET))] + [('timeout', True)]:
                expected = subtype if type(subtype) is str and subtype in SUBTYPES else 'unknown'
                with self.subTest(kind=kind, subtype=expected, report_unavailable=report_unavailable), \
                     tempfile.TemporaryDirectory() as tmp:
                    instance = runtime.Runtime(existing.OrchestrationTests().config(Path(tmp)))
                    worker = ow.OrchestrationWorker(instance)
                    error = ow.TransportFault(SECRET, subtype=subtype)
                    self.assertEqual(error.subtype, expected)
                    error.subtype = subtype  # Revalidate at transport boundary too.
                    calls = []
                    def request(method, path, value=None, **kwargs):
                        calls.append((path, value, kwargs))
                        if path.endswith('/heartbeat'): raise error
                        if report_unavailable and path.endswith('/fail'):
                            raise ow.TransportFault(SECRET)
                        return {}
                    def workload(*args, **kwargs):
                        cancel = args[1] if kind == 'video' else kwargs['cancel_event']
                        self.assertTrue(cancel.wait(2))
                        if kind == 'video': raise ow.LeaseLost(SECRET)
                        raise ResearchError('research_cancelled')
                    job = {'id': 'heartbeat-fixture', 'kind': kind, 'payload': {},
                           'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 1) * 1000}}
                    with patch.object(instance, 'orchestration_begin'), patch.object(instance, 'orchestration_start_child'), \
                         patch.object(instance, 'orchestration_cancel_owned') as abort, \
                         patch.object(instance.log, 'warning') as warning, \
                         patch.object(instance, 'orchestration_end'), patch.object(instance, 'orchestration_quiescent', return_value=True), \
                         patch.object(worker.client, 'request', side_effect=request), \
                         patch.object(worker.comfy, 'run', side_effect=workload), \
                         patch('swarms_worker.run_job', side_effect=workload):
                        worker.execute(job)
                    heartbeat = [call for call in calls if call[0].endswith('/heartbeat')]
                    failures = [body for path, body, _ in calls if path.endswith('/fail')]
                    self.assertEqual(len(heartbeat), 1)
                    self.assertEqual(heartbeat[0][2]['timeout'], 2)
                    self.assertEqual(len(failures), 1)
                    self.assertEqual(failures[0]['message'], 'heartbeat_transport_' + expected)
                    self.assertEqual(failures[0]['category'], 'transport' if kind == 'video' else 'cancelled')
                    self.assertTrue(failures[0]['quiescent'])
                    self.assertFalse(any(path.endswith('/complete') for path, _, _ in calls))
                    self.assertNotIn(SECRET, json.dumps(failures))
                    abort.assert_called_once()
                    warning.assert_called_once_with('orchestration heartbeat failed (%s)', failures[0]['message'])
                    self.assertNotIn(SECRET, json.dumps(warning.call_args.args))
                    self.assertNotIn(job['lease']['token'], json.dumps(warning.call_args.args))


if __name__ == '__main__':
    unittest.main()
