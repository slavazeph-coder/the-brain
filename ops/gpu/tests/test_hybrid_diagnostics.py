"""Offline diagnostic regressions. Framework/HTTP doubles are explicitly synthetic."""
import copy
import inspect
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import crew_worker
import swarms_worker
import orchestration_worker as ow
import runtime
from test_crew_worker import CONFIG, PAYLOAD
from test_swarms_worker import HANDOFF
import test_orchestration_worker as existing

SECRET = 'synthetic-secret-body-key https://private.invalid/token'


def reply(content=None, finish='stop'):
    return json.dumps({'choices': [{'finish_reason': finish, 'message': {
        'content': json.dumps(HANDOFF['proposal']) if content is None else content}}]}).encode()


def framework(mode):
    """Exercise the production BoundedAgent hook, including swallowed exceptions.

    This is an API-shaped double, not evidence of installed Swarms execution.
    Opt-in RealHybridIntegration covers the actual pinned framework separately.
    """
    class Agent:
        def __init__(self, llm, **kwargs):
            self.llm = llm

        def call_llm(self, task=None, **kwargs):
            raise AssertionError('Production hook must override this')

        def run(self, task):
            try:
                result = self.call_llm(task=task)
            except Exception:
                if mode == 'raise':
                    raise
                if mode == 'retry':
                    try:
                        self.call_llm(task=task)
                    except Exception:
                        pass
                return SECRET
            if mode == 'repeat_success':
                try:
                    self.call_llm(task=task)
                except Exception:
                    pass
            if mode == 'fail_after_success':
                raise RuntimeError(SECRET)
            return result

    names = ('self llm agent_name system_prompt model_name max_loops retry_attempts tools selected_tools '
             'dynamic_tools handoffs autosave persistent_memory context_compression context_length max_tokens '
             'plan_enabled auto_generate_prompt dynamic_loops dynamic_context_window reasoning_prompt_on '
             'print_on streaming_on stream interactive verbose fallback_models random_models_on '
             'publish_to_marketplace').split()
    Agent.__init__.__signature__ = inspect.Signature([
        inspect.Parameter(name, inspect.Parameter.POSITIONAL_OR_KEYWORD) for name in names])
    return SimpleNamespace(Agent=Agent)


class ModelDiagnostics(unittest.TestCase):
    def cases(self):
        for status in (302, 307, 400, 401, 403, 413, 429, 500, 503):
            yield str(status), HTTPError(SECRET, status, SECRET, {'Secret': SECRET}, io.BytesIO(SECRET.encode())), 'inference_http_' + str(status // 100) + 'xx'
        yield 'direct_timeout', TimeoutError(SECRET), 'inference_timeout'
        yield 'wrapped_timeout', URLError(TimeoutError(SECRET)), 'inference_timeout'
        yield 'transport', URLError(SECRET), 'inference_transport'
        yield 'reset', ConnectionResetError(SECRET), 'inference_transport'
        yield 'truncated', reply('{"private":"' + SECRET, 'length'), 'inference_output_truncated'
        yield 'bad_envelope', SECRET.encode(), 'research_contract_invalid'
        yield 'bad_shape', b'{"choices":[]}', 'research_contract_invalid'
        yield 'bad_json', reply(SECRET), 'research_contract_invalid'
        yield 'duplicate', reply('{"alternatives":[],"alternatives":[]}'), 'research_contract_invalid'
        yield 'bad_schema', reply(json.dumps({'secret': SECRET})), 'research_contract_invalid'
        yield 'unexpected', RuntimeError(SECRET), 'inference_unavailable'

    def configure(self, opener, value):
        if isinstance(value, Exception):
            opener.return_value.open.side_effect = value
        else:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = value

    def test_fixed_codes_survive_framework_raise_swallow_and_retry(self):
        for name, value, expected in self.cases():
            for mode in ('raise', 'swallow', 'retry'):
                with self.subTest(case=name, mode=mode), patch.dict(sys.modules, {'swarms': framework(mode)}), \
                     patch('swarms_worker.importlib.metadata.version', return_value=swarms_worker.SWARMS_VERSION), \
                     patch('swarms_worker.build_opener') as opener:
                    self.configure(opener, value)
                    with self.assertRaises(crew_worker.ResearchError) as raised:
                        swarms_worker._execute(PAYLOAD, CONFIG)
                    self.assertEqual(str(raised.exception), expected)
                    self.assertNotIn(SECRET, ''.join(traceback.format_exception(type(raised.exception), raised.exception, raised.exception.__traceback__)))
                    self.assertEqual(opener.return_value.open.call_count, 1)

    def test_model_latches_first_safe_failure_and_clears_output(self):
        with patch('swarms_worker.build_opener') as opener:
            self.configure(opener, URLError(TimeoutError(SECRET)))
            model = swarms_worker.LoopbackModel(crew_worker.validate_config(CONFIG), 'test')
            for _ in range(2):
                with self.assertRaises(crew_worker.ResearchError) as raised:
                    model.run('synthetic request')
                self.assertEqual(str(raised.exception), 'inference_timeout')
                self.assertEqual(model.failure_code, 'inference_timeout')
                self.assertIsNone(model.output)
            opener.return_value.open.assert_called_once()

    def test_success_cannot_override_repeat_or_framework_failure(self):
        for mode, expected in [('repeat_success', 'research_contract_invalid'),
                               ('fail_after_success', 'inference_unavailable')]:
            with self.subTest(mode=mode), patch.dict(sys.modules, {'swarms': framework(mode)}), \
                 patch('swarms_worker.importlib.metadata.version', return_value=swarms_worker.SWARMS_VERSION), \
                 patch('swarms_worker.build_opener') as opener:
                self.configure(opener, reply())
                with self.assertRaises(crew_worker.ResearchError) as raised:
                    swarms_worker._execute(PAYLOAD, CONFIG)
                self.assertEqual(str(raised.exception), expected)
                opener.return_value.open.assert_called_once()

    def test_critic_failure_stops_handoff_and_executor(self):
        with patch.dict(sys.modules, {'swarms': framework('swallow')}), \
             patch('swarms_worker.importlib.metadata.version', return_value=swarms_worker.SWARMS_VERSION), \
             patch('swarms_worker.build_opener') as opener, \
             patch('swarms_worker.run_swarms', side_effect=lambda p, c, _: swarms_worker._execute(p, c)), \
             patch('swarms_worker.run_research') as crew:
            opener.return_value.open.return_value.__enter__.return_value.read.side_effect = [reply(), reply('{}', 'length')]
            with self.assertRaisesRegex(crew_worker.ResearchError, '^inference_output_truncated$'):
                swarms_worker.run_job(PAYLOAD | {'engine': swarms_worker.ENGINE}, CONFIG)
            self.assertEqual(opener.return_value.open.call_count, 2)
            crew.assert_not_called()

    def test_redirect_and_proxy_restrictions_remain_in_place(self):
        with patch('swarms_worker.build_opener') as opener:
            self.configure(opener, reply())
            model = swarms_worker.LoopbackModel(crew_worker.validate_config(CONFIG), 'test')
            model.run('test')
            proxy, redirect = opener.call_args.args
            self.assertEqual(proxy.proxies, {})
            with self.assertRaisesRegex(crew_worker.ResearchError, '^inference_http_3xx$'):
                redirect.redirect_request(None, None, 302, SECRET, {}, SECRET)
            self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 30)

    def test_codes_cross_child_transport_and_unknown_code_is_redacted(self):
        codes = {case[2] for case in self.cases()}
        for code in sorted(codes) + [SECRET]:
            with self.subTest(code=code if code != SECRET else 'unknown'):
                expected = code if code != SECRET else 'research_failed'
                process = subprocess.Popen([sys.executable, '-c',
                    'import sys; sys.stdin.read(); print(sys.argv[1]); sys.exit(1)',
                    json.dumps({'ok': False, 'error': code})], stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
                with patch('crew_worker.subprocess.Popen', return_value=process):
                    with self.assertRaises(crew_worker.ResearchError) as raised:
                        swarms_worker.run_swarms(PAYLOAD, CONFIG | {'SWARMS_PYTHON': sys.executable})
                self.assertEqual(str(raised.exception), expected)
                self.assertIsNotNone(process.poll())

    def test_child_entrypoint_suppresses_secret_bearing_framework_logs_and_errors(self):
        code = '''
import sys, importlib
sys.path.insert(0, sys.argv[1])
worker = importlib.import_module(sys.argv[4])
secret, mode = sys.argv[2:4]
sys.argv = [sys.argv[0], '--child']
def fail(*args):
    print(secret)
    print(secret, file=sys.stderr)
    error = worker.ResearchError('inference_timeout')
    if mode == 'tampered':
        error.code = secret
    raise error
worker._execute = fail
sys.exit(worker.main())
'''
        for module, mode, expected in [(module, mode, expected) for module in ('swarms_worker', 'crew_worker')
                                      for mode, expected in [('safe', 'inference_timeout'), ('tampered', 'research_failed')]]:
            with self.subTest(module=module, mode=mode):
                child = subprocess.run([sys.executable, '-c', code, str(Path(swarms_worker.__file__).parent), SECRET, mode, module],
                    input=json.dumps({'payload': PAYLOAD, 'config': CONFIG}), text=True,
                    capture_output=True, timeout=5, env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'})
                self.assertEqual(child.returncode, 1)
                self.assertEqual(child.stderr, '')
                self.assertNotIn(SECRET, child.stdout)
                self.assertEqual(json.loads(child.stdout), {'ok': False, 'error': expected})


class AbortDiagnostics(unittest.TestCase):
    def run_failure(self, error=None, heartbeat=None):
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(existing.OrchestrationTests().config(Path(tmp)))
            worker = ow.OrchestrationWorker(instance)
            calls = []
            def request(method, path, value=None, **kwargs):
                calls.append((path, value))
                if path.endswith('/heartbeat'):
                    if isinstance(heartbeat, Exception):
                        raise heartbeat
                    return heartbeat or {}
                return {}
            def research(*args, cancel_event, **kwargs):
                if heartbeat is not None:
                    self.assertTrue(cancel_event.wait(1))
                    raise crew_worker.ResearchError('research_cancelled')
                raise error
            job = {'id': 'diagnostic-fixture', 'kind': 'research', 'payload': copy.deepcopy(PAYLOAD),
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + .3) * 1000}}
            with patch.object(instance, 'orchestration_begin'), patch.object(instance, 'orchestration_start_child'), \
                 patch.object(instance, 'orchestration_cancel_owned') as abort, \
                 patch.object(instance, 'orchestration_end') as end, \
                 patch.object(instance, 'orchestration_quiescent', return_value=True), \
                 patch.object(worker.client, 'request', side_effect=request), \
                 patch('swarms_worker.run_job', side_effect=research) as run:
                worker.execute(job)
            self.assertEqual(run.call_count, 1)
            self.assertFalse(any(path.endswith('/complete') for path, _ in calls))
            failures = [value for path, value in calls if path.endswith('/fail')]
            self.assertEqual(len(failures), 1)
            self.assertTrue(failures[0]['quiescent'])
            self.assertNotIn(SECRET, json.dumps(failures))
            self.assertTrue(end.called)
            if heartbeat is not None:
                self.assertTrue(abort.called)
            return failures[0]

    def test_research_cancellation_is_terminal_with_fixed_abort_reason(self):
        for heartbeat, expected in [
            (ow.LeaseLost(SECRET), 'heartbeat_lease_lost'),
            (ow.TransportFault(SECRET), 'heartbeat_transport_unknown'),
            (ValueError(SECRET), 'heartbeat_invalid'),
            ({'control': {'kill': True}}, 'heartbeat_kill'),
            ({'control': {'hardwarePaused': True}}, 'heartbeat_hardware_paused'),
            ({}, 'lease_expired'),
        ]:
            with self.subTest(reason=expected):
                failure = self.run_failure(heartbeat=heartbeat)
                self.assertEqual(failure['category'], 'cancelled')
                self.assertEqual(failure['message'], expected)

    def test_cancellation_without_heartbeat_keeps_safe_code(self):
        failure = self.run_failure(crew_worker.ResearchError('research_cancelled'))
        self.assertEqual(failure['category'], 'cancelled')
        self.assertEqual(failure['message'], 'research_cancelled')

    def test_only_allowlisted_exception_codes_or_classes_enter_failure_transport(self):
        for error, expected in [(crew_worker.ResearchError('inference_timeout'), 'inference_timeout'),
                                (RuntimeError(SECRET), 'worker_failed')]:
            with self.subTest(expected=expected):
                failure = self.run_failure(error)
                self.assertEqual(failure['category'], 'invalid')
                self.assertEqual(failure['message'], expected)
        error = crew_worker.ResearchError('research_cancelled')
        error.code = SECRET
        self.assertEqual(self.run_failure(error)['message'], 'research_failed')
        error = type('private_exception_name', (RuntimeError,), {})(SECRET)
        error.code = SECRET
        self.assertEqual(self.run_failure(error)['message'], 'worker_failed')


if __name__ == '__main__':
    unittest.main()
