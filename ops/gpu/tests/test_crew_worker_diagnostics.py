"""Offline kickoff-boundary unit tests, not evidence of real CrewAI execution."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import crew_worker
from test_crew_worker import CONFIG, PAYLOAD


class KickoffDiagnosticTests(unittest.TestCase):
    def assert_kickoff_code(self, error, expected, modules=None):
        # Only inject the failing boundary. These doubles never generate a draft.
        kickoff = Mock(side_effect=error)
        framework = types.ModuleType('crewai')
        framework.LLM = Mock()
        framework.Agent = Mock()
        framework.Task = Mock()
        framework.Crew = Mock(return_value=types.SimpleNamespace(kickoff=kickoff))
        framework.Process = types.SimpleNamespace(sequential='sequential')
        with patch.dict(sys.modules, {'crewai': framework, **(modules or {})}), \
                patch.object(crew_worker.importlib.metadata, 'version', return_value=crew_worker.CREWAI_VERSION), \
                patch.object(crew_worker.sys, 'version_info', (3, 13)), \
                self.assertRaises(crew_worker.ResearchError) as raised:
            crew_worker._execute(PAYLOAD, CONFIG)
        self.assertEqual(raised.exception.code, expected)
        self.assertEqual(str(raised.exception), expected)
        self.assertTrue(raised.exception.__suppress_context__)
        kickoff.assert_called_once_with()
        self.assertEqual(framework.LLM.call_args.kwargs['max_retries'], 0)
        self.assertEqual(framework.Agent.call_args.kwargs['max_iter'], crew_worker.MAX_ITERATIONS)
        self.assertEqual(framework.Agent.call_args.kwargs['max_retry_limit'], 0)
        self.assertEqual(framework.Task.call_args.kwargs['guardrail_max_retries'], 0)

    def test_http_statuses_preserved_without_url_headers_or_body(self):
        for status in (300, 307, 400, 401, 403, 408, 429, 500, 502, 503, 504, 599):
            with self.subTest(status=status):
                error = HTTPError('https://secret.invalid/private', status, 'secret body',
                                  {'Authorization': 'secret credential'}, None)
                self.assert_kickoff_code(error, f'inference_http_{status}')

    def test_invalid_http_status_is_not_interpolated(self):
        for status in ('429 secret', True, None, -1, 600):
            with self.subTest(status=status):
                self.assert_kickoff_code(HTTPError('secret', status, 'secret', {}, None),
                                         'inference_http_rejected')

    def test_broken_diagnostic_property_still_returns_safe_failure(self):
        class BrokenStatusError(HTTPError):
            def __getattribute__(self, name):
                if name == 'code' and self.__dict__.get('break_status'):
                    raise RuntimeError('secret property failure')
                return super().__getattribute__(name)
        error = BrokenStatusError('secret', 503, 'secret', {}, None)
        error.break_status = True
        self.assert_kickoff_code(error, 'inference_http_rejected')

    def test_timeout_and_connection_preserved(self):
        for error, expected in ((TimeoutError('secret'), 'inference_timeout'),
                                (ConnectionRefusedError('secret'), 'inference_transport'),
                                (URLError(TimeoutError('secret')), 'inference_timeout'),
                                (URLError('secret'), 'inference_transport')):
            with self.subTest(expected=expected, error_type=type(error).__name__):
                self.assert_kickoff_code(error, expected)

    def test_wrapped_failures_follow_cause_then_context(self):
        for attribute in ('__cause__', '__context__'):
            outer = RuntimeError('secret wrapper')
            setattr(outer, attribute, HTTPError('secret', 503, 'secret body', {}, None))
            self.assert_kickoff_code(outer, 'inference_http_503')
        outer = RuntimeError('secret wrapper')
        outer.__cause__ = TimeoutError('secret')
        outer.__context__ = HTTPError('secret', 401, 'secret', {}, None)
        self.assert_kickoff_code(outer, 'inference_timeout')

    def test_hidden_context_retains_only_safe_typed_diagnostic(self):
        outer = RuntimeError('secret wrapper')
        outer.__context__ = TimeoutError('secret')
        outer.__suppress_context__ = True
        self.assert_kickoff_code(outer, 'inference_timeout')

    def test_unknown_text_and_class_names_cannot_supply_diagnostics(self):
        class UnprintableError(Exception):
            def __str__(self):
                raise AssertionError('Exception text must never be rendered')
        for error in (ValueError('HTTP 503 timeout OutputParserException secret'),
                      type('OutputParserException', (Exception,), {})('secret'),
                      UnprintableError()):
            self.assert_kickoff_code(error, 'inference_unavailable')

    def test_cyclic_and_deep_chains_are_bounded(self):
        first, second = RuntimeError('secret'), RuntimeError('secret')
        first.__cause__, second.__cause__ = second, first
        self.assert_kickoff_code(first, 'inference_unavailable')
        head = TimeoutError('secret')
        for _ in range(50):
            wrapper = RuntimeError('secret')
            wrapper.__cause__ = head
            head = wrapper
        self.assert_kickoff_code(head, 'inference_unavailable')

    def test_known_research_code_is_revalidated(self):
        self.assert_kickoff_code(crew_worker.ResearchError('research_timeout'), 'research_timeout')
        mutated = crew_worker.ResearchError('research_timeout')
        mutated.code = 'secret credential'
        self.assert_kickoff_code(mutated, 'research_failed')

    def test_parser_identity_and_json_decode_error(self):
        # Unit identity fixture only; the opt-in pinned tests must verify real parser behavior.
        parser = types.ModuleType('crewai.agents.parser')
        parser.OutputParserException = type('OutputParserException', (Exception,), {})
        self.assert_kickoff_code(parser.OutputParserException('secret model output'),
                                 'inference_parser_error', {'crewai.agents.parser': parser})
        self.assert_kickoff_code(json.JSONDecodeError('secret', 'secret output', 0),
                                 'inference_parser_error')


@unittest.skipUnless(importlib.util.find_spec('openai') and importlib.util.find_spec('httpx'),
                     'Offline real SDK exception checks require installed openai/httpx')
class InstalledSDKDiagnosticTests(unittest.TestCase):
    def test_real_sdk_types_without_any_http_requests(self):
        import httpx
        import openai
        request = httpx.Request('POST', 'http://127.0.0.1:1/v1/chat/completions',
                                headers={'Authorization': 'secret fixture'})
        response = httpx.Response(429, request=request, text='secret fixture response')
        errors = [
            (openai.APIStatusError('secret', response=response, body={'secret': True}), 'inference_http_429'),
            (httpx.HTTPStatusError('secret', request=request, response=response), 'inference_http_429'),
            (openai.APITimeoutError(request=request), 'inference_timeout'),
            (openai.APIConnectionError(request=request), 'inference_transport'),
            (httpx.ConnectTimeout('secret', request=request), 'inference_timeout'),
            (httpx.ReadTimeout('secret', request=request), 'inference_timeout'),
            (httpx.ConnectError('secret', request=request), 'inference_transport'),
            (httpx.RemoteProtocolError('secret', request=request), 'inference_transport'),
        ]
        harness = KickoffDiagnosticTests()
        for error, expected in errors:
            with self.subTest(expected=expected, error_type=type(error).__name__):
                harness.assert_kickoff_code(error, expected)


if __name__ == '__main__':
    unittest.main()
