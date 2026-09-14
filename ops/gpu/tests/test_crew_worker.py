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
        output = self.server.draft
        data = {'id': 'controlled-adapter-completion', 'object': 'chat.completion', 'created': 0,
                'model': 'controlled-test-model', 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': 'Thought: I now know the final answer\nFinal Answer: ' + json.dumps(output)}}],
                'usage': {'prompt_tokens': 100, 'completion_tokens': 150, 'total_tokens': 250}}
        encoded = json.dumps(data).encode()
        self.send_response(200)
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

    def test_real_crew_with_controlled_loopback_openai_adapter(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), ControlledOpenAIAdapter)
        server.requests, server.draft = [], copy.deepcopy(DRAFT)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = run_research(PAYLOAD, CONFIG | {'CREWAI_PYTHON': self.python, 'GATEWAY_PORT': server.server_port})
            self.assertEqual(result['status'], 'pending_human_review')
            self.assertEqual(result['draft'], DRAFT)
            self.assertTrue(1 <= len(server.requests) <= 3)
            for request in server.requests:
                self.assertEqual(request['path'], '/v1/chat/completions')
                self.assertEqual(request['body']['model'], 'controlled-test-model')
                self.assertFalse(request['body'].get('tools'))
                self.assertTrue(request['token_ok'])
                self.assertTrue(request['key_ok'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_real_crew_unavailable_gateway_fails_without_fabricated_result(self):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        with self.assertRaisesRegex(ResearchError, '^inference_unavailable$'):
            run_research(PAYLOAD, CONFIG | {'CREWAI_PYTHON': self.python, 'GATEWAY_PORT': port})


if __name__ == '__main__':
    unittest.main()
