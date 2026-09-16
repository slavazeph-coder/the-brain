"""Contract/lifecycle tests; optional real CrewAI uses a controlled local adapter."""
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crew_worker import (CREWAI_VERSION, ResearchError, run_research,
                         validate_config, validate_draft, validate_payload)

PAYLOAD = {'objective': 'Draft an evidence-based offer for human review.', 'sources': [{
    'id': 's1', 'title': 'Operator supplied product notes', 'url': 'https://example.org/product',
    'content': 'BrainSNN exposes a text analysis API. No sale or customer outcome has been verified.',
}]}
DRAFT = {'title': 'API integration draft', 'claims': [{
    'id': 'c1', 'statement': 'BrainSNN exposes a text analysis API.', 'source_id': 's1',
    'quote': 'BrainSNN exposes a text analysis API.',
}], 'draft': [
    {'kind': 'fact', 'text': 'BrainSNN exposes a text analysis API.', 'claim_ids': ['c1']},
    {'kind': 'proposal', 'text': 'Proposal: consider an integration discovery session.', 'claim_ids': []},
], 'limitations': ['Human review is required. No sale or customer outcome has been verified.']}
CONFIG = {'GATEWAY_PORT': 8787, 'GPU_API_KEY': 'local-test-gateway-' + 'g' * 32,
          'ORCHESTRATION_TOKEN': 'local-test-lease-' + 'l' * 32, 'SERVED_MODEL_NAME': 'controlled-test-model',
          'CREWAI_PYTHON': sys.executable}


class ContractTests(unittest.TestCase):
    def assert_code(self, code, function, *args):
        with self.assertRaises(ResearchError) as raised:
            function(*args)
        self.assertEqual(raised.exception.code, code)
        self.assertEqual(str(raised.exception), code)

    def test_exact_evidence_manifest_and_fixed_approval_boundary(self):
        result = validate_draft(copy.deepcopy(DRAFT), copy.deepcopy(PAYLOAD))
        self.assertEqual(result['status'], 'pending_human_review')
        self.assertFalse(result['external_execution_enabled'])
        self.assertEqual(result['external_spend_usd'], 0)
        self.assertEqual(result['approval_required'], ['outreach', 'publication', 'spend'])
        self.assertEqual(result['sources'][0]['content_sha256'], hashlib.sha256(PAYLOAD['sources'][0]['content'].encode()).hexdigest())
        self.assertNotIn('content', result['sources'][0])
        self.assertEqual(len(result['source_packet_sha256']), 64)
        self.assertIn('semantic_review_required', result['evidence_validation'])

    def test_packet_cannot_supply_provider_tools_or_execution_authority(self):
        for field in ('tools', 'model', 'base_url', 'command', 'external_execution_enabled', 'spend'):
            with self.subTest(field=field):
                payload = copy.deepcopy(PAYLOAD)
                payload[field] = True
                self.assert_code('invalid_research_payload', validate_payload, payload)

    def test_reject_empty_duplicate_oversized_or_credential_source(self):
        invalid = [dict(PAYLOAD, sources=[]), dict(PAYLOAD, sources=PAYLOAD['sources'] * 2)]
        for changes in ({'content': ''}, {'content': 'x' * 6001}, {'url': 'https://user:password@example.org/'},
                        {'url': 'file:///etc/passwd'}, {'url': 'javascript:alert(1)'}, {'id': []}):
            payload = copy.deepcopy(PAYLOAD)
            payload['sources'][0].update(changes)
            invalid.append(payload)
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assert_code('invalid_research_payload', validate_payload, payload)

    def test_reject_fabricated_quote_and_missing_sources(self):
        for changes in ({'quote': 'A customer paid $1000.'}, {'source_id': 'unknown'}, {'source_id': []}):
            draft = copy.deepcopy(DRAFT)
            draft['claims'][0].update(changes)
            self.assert_code('research_contract_invalid', validate_draft, draft, PAYLOAD)

    def test_reject_uncited_factual_prose_and_fake_approval_fields(self):
        drafts = []
        for changes in ({'text': 'A sale is confirmed.'}, {'claim_ids': []}, {'claim_ids': ['missing']},
                        {'claim_ids': ['c1', 'c1']}, {'kind': 'approved'}):
            draft = copy.deepcopy(DRAFT)
            draft['draft'][0].update(changes)
            drafts.append(draft)
        drafts.append(dict(DRAFT, external_execution_enabled=True))
        drafts.append(dict(DRAFT, status='approved'))
        for draft in drafts:
            self.assert_code('research_contract_invalid', validate_draft, draft, PAYLOAD)

    def test_reject_unused_or_duplicate_claim_and_proposal_citation(self):
        draft = copy.deepcopy(DRAFT)
        draft['claims'].append(dict(draft['claims'][0], id='c2'))
        self.assert_code('research_contract_invalid', validate_draft, draft, PAYLOAD)
        draft['claims'][1]['id'] = 'c1'
        self.assert_code('research_contract_invalid', validate_draft, draft, PAYLOAD)
        draft = copy.deepcopy(DRAFT)
        draft['draft'][1]['claim_ids'] = ['c1']
        self.assert_code('research_contract_invalid', validate_draft, draft, PAYLOAD)

    def test_reject_missing_explicit_model_credentials_token_and_invalid_bounds(self):
        for field in ('GPU_API_KEY', 'SERVED_MODEL_NAME', 'ORCHESTRATION_TOKEN', 'GATEWAY_PORT'):
            config = dict(CONFIG)
            config.pop(field)
            self.assert_code('invalid_research_config', validate_config, config)
        for changes in ({'CREWAI_TIMEOUT_SECONDS': 91}, {'CREWAI_TIMEOUT_SECONDS': 0},
                        {'MAX_OUTPUT_TOKENS': 99999}, {'GATEWAY_PORT': True},
                        {'SERVED_MODEL_NAME': 'model\nprovider'}, {'GPU_API_KEY': 'g' * 32 + '\r'}):
            self.assert_code('invalid_research_config', validate_config, CONFIG | changes)

    def test_missing_interpreter_fails_without_success(self):
        self.assert_code('crewai_unavailable', run_research, PAYLOAD,
                         CONFIG | {'CREWAI_PYTHON': '/nonexistent/crewai/python'})

    def test_pre_cancel_does_not_spawn(self):
        canceled = threading.Event()
        canceled.set()
        with patch('crew_worker.subprocess.Popen') as launch:
            self.assert_code('research_cancelled', run_research, PAYLOAD, CONFIG, canceled)
            launch.assert_not_called()

    def test_real_child_reports_unavailable_without_installed_dependency(self):
        # -S would bypass the real dependency check; use the normal stdlib host.
        try:
            installed = importlib.util.find_spec('crewai') is not None
        except ModuleNotFoundError:
            installed = False
        if installed and sys.version_info[:2] < (3, 14):
            self.skipTest('Host already has CrewAI; missing interpreter test covers unavailability')
        self.assert_code('crewai_unavailable', run_research, PAYLOAD, CONFIG)

    def test_child_guard_rejects_external_dns_connect_and_process_creation(self):
        # Guards reject before any actual outbound connection/process is made.
        module_dir = str(Path(__file__).resolve().parents[1])
        code = '''
import socket, subprocess, sys
sys.path.insert(0, sys.argv[1])
from crew_worker import _install_network_guard
_install_network_guard(8787)
denied = 0
for operation in (
    lambda: socket.getaddrinfo('outside.invalid', 443),
    lambda: socket.socket().connect(('192.0.2.1', 443)),
    lambda: socket.socket().connect(('127.0.0.1', 8788)),
    lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'x', ('192.0.2.1', 443)),
    lambda: subprocess.Popen([sys.executable, '-c', 'pass']),
):
    try:
        operation()
    except PermissionError:
        denied += 1
print(denied)
'''
        process = subprocess.run([sys.executable, '-c', code, module_dir],
                                 capture_output=True, text=True, timeout=5)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout.strip(), '5')

    def test_timeout_kills_and_reaps_actual_process(self):
        # A sleeping process is a lifecycle fixture only, never a CrewAI result.
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        started = time.monotonic()
        with patch('crew_worker.subprocess.Popen', return_value=process):
            self.assert_code('research_timeout', run_research, PAYLOAD,
                             CONFIG | {'CREWAI_TIMEOUT_SECONDS': 1})
        self.assertIsNotNone(process.poll())
        self.assertLess(time.monotonic() - started, 3)

    def test_cancellation_kills_and_reaps_actual_process(self):
        process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        canceled = threading.Event()
        timer = threading.Timer(0.15, canceled.set)
        timer.start()
        try:
            with patch('crew_worker.subprocess.Popen', return_value=process):
                self.assert_code('research_cancelled', run_research, PAYLOAD, CONFIG, canceled)
            self.assertIsNotNone(process.poll())
        finally:
            timer.cancel()


class ControlledOpenAIAdapter(BaseHTTPRequestHandler):
    """Explicitly synthetic response server; exercises real installed CrewAI only."""
    def log_message(self, *_):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append({'path': self.path, 'body': request,
                                     'token_ok': self.headers.get('X-BrainSNN-Orchestration-Token') == CONFIG['ORCHESTRATION_TOKEN'],
                                     'key_ok': self.headers.get('Authorization') == 'Bearer ' + CONFIG['GPU_API_KEY']})
        status = self.server.response_status
        if status >= 300:
            data = {'error': {'message': 'synthetic-provider-secret-must-not-leak',
                              'type': 'controlled_adapter_error', 'code': 'controlled'}}
        else:
            data = {'id': 'controlled-adapter-completion', 'object': 'chat.completion', 'created': 0,
                    'model': 'controlled-test-model', 'choices': [{'index': 0, 'finish_reason': 'stop',
                    'message': {'role': 'assistant', 'content': self.server.response_content}}],
                    'usage': {'prompt_tokens': 100, 'completion_tokens': 150, 'total_tokens': 250}}
        encoded = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


class RealCrewAIIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.python = os.environ.get('CREWAI_TEST_PYTHON', '')
        if not cls.python:
            raise unittest.SkipTest('Real CrewAI integration requires CREWAI_TEST_PYTHON; no simulated CrewAI fallback')
        check = subprocess.run([cls.python, '-c', 'import importlib.metadata; print(importlib.metadata.version("crewai"))'],
                               capture_output=True, text=True, timeout=10)
        if check.returncode or check.stdout.strip() != CREWAI_VERSION:
            raise RuntimeError('Requested real CrewAI interpreter lacks pinned dependency')

    def _run_controlled(self, label, content, response_status=200):
        server = ThreadingHTTPServer(('127.0.0.1', 0), ControlledOpenAIAdapter)
        server.requests = []
        server.response_content = content
        server.response_status = response_status
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result, error_code = None, None
            try:
                result = run_research(PAYLOAD, CONFIG | {
                    'CREWAI_PYTHON': self.python, 'GATEWAY_PORT': server.server_port})
            except ResearchError as error:
                error_code = error.code
                self.assertEqual(str(error), error_code)
                self.assertNotIn('synthetic-provider-secret', error_code)
            self.assertTrue(1 <= len(server.requests) <= 3)
            for request in server.requests:
                self.assertEqual(request['path'], '/v1/chat/completions')
                self.assertEqual(request['body']['model'], 'controlled-test-model')
                self.assertFalse(request['body'].get('tools'))
                self.assertTrue(request['token_ok'])
                self.assertTrue(request['key_ok'])
            # Controlled-framework evidence only: never print generated content or provider text.
            print(json.dumps({'controlled_crewai_case': label,
                              'outcome': error_code or 'validated_draft',
                              'request_count': len(server.requests)}, sort_keys=True))
            return result, error_code
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def _assert_validated_draft(self, result):
        self.assertEqual(result, validate_draft(copy.deepcopy(DRAFT), copy.deepcopy(PAYLOAD)))
        self.assertEqual(result['status'], 'pending_human_review')
        self.assertFalse(result['external_execution_enabled'])

    def test_real_crew_with_controlled_loopback_openai_adapter(self):
        result, error_code = self._run_controlled(
            'final_answer_json', 'Thought: I now know the final answer\nFinal Answer: ' + json.dumps(DRAFT))
        self.assertIsNone(error_code)
        self._assert_validated_draft(result)

    def test_real_crew_bare_json_records_actual_framework_outcome(self):
        result, error_code = self._run_controlled('bare_json', json.dumps(DRAFT))
        if error_code is None:
            self._assert_validated_draft(result)
        else:
            # Bare-JSON rejection is a hypothesis until a pinned run supplies evidence.
            self.assertIsNone(result)
            self.assertEqual(error_code, 'inference_parser_error')

    def test_real_crew_malformed_response_never_fabricates_success(self):
        result, error_code = self._run_controlled('malformed_response', 'synthetic malformed output {')
        self.assertIsNone(result)
        self.assertIn(error_code, ('inference_parser_error', 'research_contract_invalid'))

    def test_real_crew_malformed_final_answer_fails_strict_json(self):
        result, error_code = self._run_controlled(
            'malformed_final_answer', 'Thought: I now know the final answer\nFinal Answer: {"title":')
        self.assertIsNone(result)
        self.assertIn(error_code, ('inference_parser_error', 'research_contract_invalid'))

    def test_real_crew_fabricated_quote_fails_evidence_validation(self):
        draft = copy.deepcopy(DRAFT)
        draft['claims'][0]['quote'] = 'This fabricated quote is absent from every supplied source.'
        result, error_code = self._run_controlled(
            'fabricated_quote', 'Thought: I now know the final answer\nFinal Answer: ' + json.dumps(draft))
        self.assertIsNone(result)
        self.assertEqual(error_code, 'research_contract_invalid')

    def test_real_crew_http_statuses_survive_kickoff_wrapping(self):
        for status in (400, 401, 403, 429, 500, 503):
            with self.subTest(status=status):
                result, error_code = self._run_controlled('http_' + str(status), '', status)
                self.assertIsNone(result)
                self.assertEqual(error_code, 'inference_http_' + str(status))

    def test_real_pinned_parser_direct_controlled_probes(self):
        # The candidate module is verified by the real pinned interpreter at run time;
        # missing classes skip this probe instead of supplying a simulated parser.
        probe = '''
import contextlib, hashlib, importlib, inspect, json, os, sys
def deny_network(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system', 'os.posix_spawn'):
        raise PermissionError('direct_parser_probe_network_denied')
sys.addaudithook(deny_network)
with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
    try:
        module = importlib.import_module('crewai.agents.parser')
        parser_type = getattr(module, 'CrewAgentParser')
        error_type = getattr(module, 'OutputParserException')
    except (ImportError, AttributeError):
        record = {'available': False}
    else:
        parser = parser_type()
        value = sys.stdin.read()
        cases = {'bare_json': value, 'malformed': 'synthetic malformed output {',
                 'final_answer': 'Thought: I now know the final answer\\nFinal Answer: ' + value}
        outcomes = {}
        for label, content in cases.items():
            try:
                parsed = parser.parse(content)
            except error_type:
                outcomes[label] = 'parser_error'
            else:
                outcomes[label] = ('exact_final_output' if getattr(parsed, 'output', None) == value
                                   else 'other_parser_result')
        record = {'available': True, 'outcomes': outcomes,
                  'parser_type': parser_type.__module__ + '.' + parser_type.__name__,
                  'parser_error_type': error_type.__module__ + '.' + error_type.__name__,
                  'parser_source_sha256': hashlib.sha256(inspect.getsource(module).encode()).hexdigest()}
print(json.dumps(record, sort_keys=True), flush=True)
os._exit(0)
'''
        with tempfile.TemporaryDirectory(prefix='brainsnn-parser-probe-') as scratch:
            env = {'PATH': '/usr/bin:/bin', 'HOME': scratch, 'TMPDIR': scratch,
                   'CREWAI_STORAGE_DIR': scratch, 'XDG_DATA_HOME': scratch,
                   'LITELLM_LOCAL_MODEL_COST_MAP': 'True',
                   'CREWAI_DISABLE_TELEMETRY': 'true', 'CREWAI_TELEMETRY_ENABLED': 'false',
                   'CREWAI_TRACING_ENABLED': 'false', 'OTEL_SDK_DISABLED': 'true',
                   'DO_NOT_TRACK': 'true', 'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
            result = subprocess.run([self.python, '-c', probe], input=json.dumps(DRAFT),
                                    capture_output=True, text=True, timeout=30, cwd=scratch, env=env)
        self.assertEqual(result.returncode, 0, 'Real pinned parser probe failed; no model was called')
        record = json.loads(result.stdout)
        if record.get('available') is not True:
            self.skipTest('Pinned parser class/module unavailable; no direct-parser evidence')
        self.assertEqual(record['outcomes']['final_answer'], 'exact_final_output')
        self.assertIn(record['outcomes']['bare_json'], ('exact_final_output', 'parser_error'))
        self.assertIn(record['outcomes']['malformed'], ('other_parser_result', 'parser_error'))
        print(json.dumps({'controlled_crewai_parser': record}, sort_keys=True))

    def test_real_crew_unavailable_gateway_fails_without_fabricated_result(self):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        with self.assertRaisesRegex(ResearchError, '^inference_transport$'):
            run_research(PAYLOAD, CONFIG | {'CREWAI_PYTHON': self.python, 'GATEWAY_PORT': port})


if __name__ == '__main__':
    unittest.main()
