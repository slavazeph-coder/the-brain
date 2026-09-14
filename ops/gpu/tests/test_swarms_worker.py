"""Offline contracts plus opt-in real installed frameworks against loopback only."""
import copy
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crew_worker import ResearchError, validate_draft, validate_config, CREWAI_VERSION
from swarms_worker import (SWARMS_VERSION, ENGINE, packet_hash, strict_json,
                           validate_handoff, run_swarms, run_job, LoopbackModel)
from test_crew_worker import PAYLOAD, CONFIG, DRAFT

HANDOFF = {'schema': 'brainsnn.hybrid.v1', 'source_packet_sha256': packet_hash(PAYLOAD),
           'proposal': {'alternatives': [{'id': 'p1', 'proposal': 'Consider an integration discovery session.', 'source_ids': ['s1']}]},
           'critique': {'reviews': [{'proposal_id': 'p1', 'concerns': ['No sale has been verified.']}]}}


class HybridContracts(unittest.TestCase):
    def test_valid_handoff_and_strict_json(self):
        self.assertEqual(validate_handoff(copy.deepcopy(HANDOFF), PAYLOAD), HANDOFF)
        for raw in ('{"a":1,"a":2}', '{"a":NaN}', '```json\n{}\n```', '{} trailing'):
            with self.subTest(raw=raw), self.assertRaises(ResearchError):
                strict_json(raw)

    def test_handoff_rejects_authority_extra_fields_missing_reviews_and_foreign_evidence(self):
        variants = [HANDOFF | {'approved': True}, HANDOFF | {'source_packet_sha256': '0' * 64},
                    HANDOFF | {'schema': 'unknown'}, HANDOFF | {'critique': {'reviews': []}}]
        for path, value in [('source_ids', ['unknown']), ('id', 'p3'), ('proposal', '')]:
            item = copy.deepcopy(HANDOFF)
            item['proposal']['alternatives'][0][path] = value
            variants.append(item)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ResearchError):
                validate_handoff(value, PAYLOAD)

    def test_engine_dispatch_handoff_precedes_executor_and_total_budget(self):
        order = []
        def publish(value):
            order.append('checkpoint')
            self.assertEqual(value, HANDOFF)
        def crew(packet, config, cancel, handoff):
            order.append('crew')
            self.assertEqual(packet, PAYLOAD)
            self.assertEqual(handoff, HANDOFF)
            self.assertLessEqual(config['CREWAI_TIMEOUT_SECONDS'], 90)
            return validate_draft(DRAFT, packet)
        with patch('swarms_worker.run_swarms', return_value=HANDOFF), patch('swarms_worker.run_research', side_effect=crew):
            result = run_job(PAYLOAD | {'engine': ENGINE}, CONFIG, publish_handoff=publish)
        self.assertEqual(order, ['checkpoint', 'crew'])
        self.assertEqual(result['engine'], ENGINE)
        self.assertEqual(result['execution_limits']['agents'], 3)
        self.assertFalse(result['external_execution_enabled'])
        self.assertEqual(result['external_spend_usd'], 0)
        self.assertEqual(result['status'], 'pending_human_review')

    def test_default_preserves_crewai_and_invalid_engine_fails_closed(self):
        with patch('swarms_worker.run_research', return_value={}) as crew, patch('swarms_worker.run_swarms') as swarm:
            self.assertEqual(run_job(PAYLOAD, CONFIG)['engine'], 'crewai')
            crew.assert_called_once()
            swarm.assert_not_called()
        for engine in ('auto', '', None, [], {}):
            with self.subTest(engine=engine), self.assertRaises(ResearchError):
                run_job(PAYLOAD | {'engine': engine}, CONFIG)

    def test_failed_checkpoint_or_cancel_never_starts_executor(self):
        cancel = threading.Event()
        for canceled in (False, True):
            if canceled:
                cancel.set()
            with patch('swarms_worker.run_swarms', return_value=HANDOFF), patch('swarms_worker.run_research') as crew:
                with self.assertRaises((ResearchError, RuntimeError)):
                    run_job(PAYLOAD | {'engine': ENGINE}, CONFIG, cancel,
                            lambda _: (_ for _ in ()).throw(RuntimeError('checkpoint denied')))
                crew.assert_not_called()

    def test_swarms_unavailable_has_no_fallback(self):
        with self.assertRaisesRegex(ResearchError, 'swarms_unavailable'):
            run_swarms(PAYLOAD, CONFIG | {'SWARMS_PYTHON': '/nonexistent/python'})
        with patch('swarms_worker.run_swarms', side_effect=ResearchError('swarms_unavailable')), patch('swarms_worker.run_research') as crew:
            with self.assertRaisesRegex(ResearchError, 'swarms_unavailable'):
                run_job(PAYLOAD | {'engine': ENGINE}, CONFIG)
            crew.assert_not_called()

    def test_swarms_timeout_and_cancellation_reap_process(self):
        for canceled in (False, True):
            process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, start_new_session=True)
            event = threading.Event()
            timer = threading.Timer(.15, event.set)
            if canceled:
                timer.start()
            try:
                with patch('crew_worker.subprocess.Popen', return_value=process):
                    with self.assertRaisesRegex(ResearchError, 'research_cancelled' if canceled else 'research_timeout'):
                        run_swarms(PAYLOAD, CONFIG | {'SWARMS_PYTHON': sys.executable, 'CREWAI_TIMEOUT_SECONDS': 1}, event)
                self.assertIsNotNone(process.poll())
            finally:
                timer.cancel()

    def test_exhausted_shared_budget_and_invalid_handoff_stop_before_crew(self):
        with patch('swarms_worker.run_swarms', return_value=HANDOFF), patch('swarms_worker.time.monotonic', side_effect=[0, 91]), patch('swarms_worker.run_research') as crew:
            with self.assertRaisesRegex(ResearchError, 'research_timeout'):
                run_job(PAYLOAD | {'engine': ENGINE}, CONFIG)
            crew.assert_not_called()
        with patch('swarms_worker.run_swarms', return_value=HANDOFF | {'approved': True}), patch('swarms_worker.run_research') as crew:
            with self.assertRaisesRegex(ResearchError, 'research_contract_invalid'):
                run_job(PAYLOAD | {'engine': ENGINE}, CONFIG)
            crew.assert_not_called()

    def test_provider_validates_before_returning_content_to_framework(self):
        from swarms_worker import validate_proposal
        raw = json.dumps({'choices': [{'finish_reason': 'stop', 'message': {
            'content': '{"tool_calls":[{"name":"handoff_task"}]}'}}]}).encode()
        with patch('swarms_worker.build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = raw
            model = LoopbackModel(validate_config(CONFIG), 'test', lambda value: validate_proposal(value, PAYLOAD))
            with self.assertRaisesRegex(ResearchError, 'research_contract_invalid'):
                model.run('test')
            self.assertIsNone(model.output)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'http://127.0.0.1:8787/v1/chat/completions')
            self.assertNotIn('tools', json.loads(request.data))

    def test_provider_budget_prevents_second_call(self):
        model = LoopbackModel(CONFIG, 'test')
        model.calls = 1
        with self.assertRaisesRegex(ResearchError, 'research_contract_invalid'):
            model.run('test')


class HybridProvider(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append((self.path, dict(self.headers), body))
        index = len(self.server.requests) - 1
        if self.server.delay:
            time.sleep(self.server.delay)
        if self.server.redirect:
            self.send_response(302)
            self.send_header('Location', 'http://192.0.2.1/forbidden')
            self.end_headers()
            return
        content = json.dumps([HANDOFF['proposal'], HANDOFF['critique'], DRAFT][min(index, 2)])
        if index >= 2:
            content = 'Thought: I now know the final answer\nFinal Answer: ' + content
        if self.server.invalid:
            content = '{"unexpected":true}'
        data = json.dumps({'id': 'synthetic-hybrid-fixture', 'object': 'chat.completion', 'created': 0,
                           'model': CONFIG['SERVED_MODEL_NAME'], 'choices': [{'index': 0, 'finish_reason': 'stop',
                           'message': {'role': 'assistant', 'content': content}}],
                           'usage': {'prompt_tokens': 100, 'completion_tokens': 100, 'total_tokens': 200}}).encode()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


class RealHybridIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.swarm = os.environ.get('SWARMS_TEST_PYTHON', '')
        cls.crew = os.environ.get('CREWAI_TEST_PYTHON', '')
        if not cls.swarm or not cls.crew:
            raise unittest.SkipTest('Set SWARMS_TEST_PYTHON and CREWAI_TEST_PYTHON to isolated pinned interpreters')
        for python, name, version in ((cls.swarm, 'swarms', SWARMS_VERSION), (cls.crew, 'crewai', CREWAI_VERSION)):
            result = subprocess.run([python, '-c', f'import importlib.metadata; print(importlib.metadata.version({name!r}))'],
                                    text=True, capture_output=True, timeout=10)
            if result.returncode or result.stdout.strip() != version:
                raise RuntimeError('Requested real integration interpreter lacks exact pin')

    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), HybridProvider)
        self.server.requests = []
        self.server.invalid = self.server.redirect = False
        self.server.delay = 0
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.config = CONFIG | {'SWARMS_PYTHON': self.swarm, 'CREWAI_PYTHON': self.crew,
                                'GATEWAY_PORT': self.server.server_port}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_real_swarms_then_real_crew(self):
        checkpoints = []
        result = run_job(PAYLOAD | {'engine': ENGINE}, self.config, publish_handoff=checkpoints.append)
        self.assertEqual(checkpoints, [HANDOFF])
        self.assertEqual(result['draft'], DRAFT)
        self.assertEqual(result['handoff'], HANDOFF)
        self.assertEqual(len(self.server.requests), 3)
        for path, headers, body in self.server.requests:
            self.assertEqual(path, '/v1/chat/completions')
            self.assertEqual(headers.get('Authorization'), 'Bearer ' + CONFIG['GPU_API_KEY'])
            self.assertEqual({k.lower(): v for k, v in headers.items()}['x-brainsnn-orchestration-token'], CONFIG['ORCHESTRATION_TOKEN'])
            self.assertEqual(body['model'], CONFIG['SERVED_MODEL_NAME'])
            self.assertFalse(body.get('tools'))
            self.assertFalse(body.get('stream'))
            self.assertLessEqual(body['max_tokens'], 2048)
        self.assertIn('brainsnn.hybrid.v1', json.dumps(self.server.requests[2][2]))

    def test_real_invalid_json_contract_never_reaches_crew(self):
        self.server.invalid = True
        with self.assertRaises(ResearchError):
            run_job(PAYLOAD | {'engine': ENGINE}, self.config)
        self.assertEqual(len(self.server.requests), 1)

    def test_real_redirect_is_denied(self):
        self.server.redirect = True
        with self.assertRaises(ResearchError):
            run_job(PAYLOAD | {'engine': ENGINE}, self.config)
        self.assertEqual(len(self.server.requests), 1)

    def test_real_timeout(self):
        self.server.delay = 3
        with self.assertRaisesRegex(ResearchError, 'research_timeout'):
            run_job(PAYLOAD | {'engine': ENGINE}, self.config | {'CREWAI_TIMEOUT_SECONDS': 1})

    def test_real_cancellation(self):
        cancel = threading.Event()
        timer = threading.Timer(.5, cancel.set)
        self.server.delay = 3
        timer.start()
        try:
            with self.assertRaisesRegex(ResearchError, 'research_cancelled'):
                run_job(PAYLOAD | {'engine': ENGINE}, self.config, cancel)
        finally:
            timer.cancel()


if __name__ == '__main__':
    unittest.main()
