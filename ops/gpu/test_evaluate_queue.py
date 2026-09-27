import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('evaluate_queue', Path(__file__).with_name('evaluate_queue.py'))
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)

class QueueTests(unittest.TestCase):
    def completion(self, content='plain text', **changes):
        value = dict(riskRating='Low', urgency=0, trust=100, summary='A neutral statement.', evidence=content)
        value.update(changes)
        return {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(value)}}]}

    def test_exact_evidence_and_zero_scores(self):
        self.assertEqual(q.validate('plain text', self.completion()), [])
        self.assertIn('evidence_not_exact_source', q.validate('plain text', self.completion(evidence='invented')))
        self.assertIn('urgency_range', q.validate('plain text', self.completion(urgency=True)))

    def test_checkpoint_prevents_duplicate_model_work(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            db = q.connect(Path(folder) / 'jobs.sqlite')
            calls = []
            case = {'id': 'a', 'content': 'plain text'}
            def inference(*args):
                calls.append(1)
                return self.completion()
            q.run_pass(db, [case], 'model-revision-1', 'http://localhost/v1', 'secret', 3, inference)
            self.assertFalse(q.has_pending(db, [case], 'model-revision-1', 'test-only'))
            db.close()
            db = q.connect(Path(folder) / 'jobs.sqlite')
            q.run_pass(db, [case], 'model-revision-1', 'http://localhost/v1', 'secret', 3, inference)
            q.run_pass(db, [case], 'model-revision-2', 'http://localhost/v1', 'secret', 3, inference)
            self.assertEqual(len(calls), 2)
            self.assertEqual(db.execute('select count(*) from jobs').fetchone()[0], 2)
            db.close()

    def test_interruption_does_not_mark_unfinished_case_complete(self):
        with tempfile.TemporaryDirectory() as folder:
            db = q.connect(Path(folder) / 'jobs.sqlite')
            def interrupted(*_args):
                raise q.Interrupted()
            with self.assertRaises(q.Interrupted):
                q.run_pass(db, [{'id': 'a', 'content': 'plain text'}], 'm', '', '', 3, interrupted)
            self.assertEqual(db.execute('select count(*) from jobs').fetchone()[0], 0)
            self.assertTrue(q.has_pending(db, [{'id': 'a', 'content': 'plain text'}], 'm', 'test-only'))
            db.close()

    def test_foreground_preemption_does_not_consume_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            db = q.connect(Path(folder) / 'jobs.sqlite')
            def busy(*_args):
                raise urllib.error.HTTPError('http://localhost', 503, 'busy', {}, None)
            self.assertEqual(q.run_pass(db, [{'id': 'a', 'content': 'plain text'}], 'm', '', '', 3, busy), 0)
            self.assertEqual(db.execute('select count(*) from jobs').fetchone()[0], 0)
            db.close()

    def test_endpoint_rejects_plaintext_remote_and_embedded_credentials(self):
        self.assertEqual(q.endpoint_url('http://127.0.0.1:8787/v1/'), 'http://127.0.0.1:8787/v1/chat/completions')
        for base in ['http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/other']:
            with self.assertRaises(ValueError):
                q.endpoint_url(base)

    def test_weight_revision_changes_evaluation_identity(self):
        case = {'id': 'a', 'content': 'plain text'}
        self.assertNotEqual(q.identity(case, 'stable-alias', 'a' * 40), q.identity(case, 'stable-alias', 'b' * 40))

    def test_pack_is_bounded_unique_and_valid(self):
        cases = list(q.read_cases(Path(__file__).with_name('evaluation-cases.jsonl')))
        self.assertEqual(len(cases), 8)
        self.assertEqual(len(set(c['id'] for c in cases)), 8)

    def test_expanded_backlog_preserves_completed_seed_work_and_parks(self):
        seed = list(q.read_cases(Path(__file__).with_name('evaluation-cases.jsonl')))
        cases = list(q.read_cases(Path(__file__).with_name('regression-cases.jsonl')))
        self.assertEqual(cases[:8], seed)
        self.assertEqual(len(cases), 64)
        self.assertEqual(len({c['id'] for c in cases}), 64)
        self.assertGreaterEqual(sum(len(c['content']) > 1000 for c in cases), 4)
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            path = Path(folder) / 'jobs.sqlite'
            db = q.connect(path)
            def infer(_url, _key, _model, content, _timeout):
                # Preserve a recorded failure as terminal; expansion must not hide
                # or automatically rerun it to turn the summary green.
                return self.completion(content, evidence='fabricated' if content == seed[6]['content'] else content)
            self.assertEqual(q.run_pass(db, seed, 'alias', '', '', 3, infer, revision='c' * 40), 8)
            db.close()
            db = q.connect(path)
            self.assertEqual(q.run_pass(db, cases, 'alias', '', '', 3, infer, revision='c' * 40), 56)
            self.assertEqual(q.run_pass(db, cases, 'alias', '', '', 3, infer, revision='c' * 40), 0)
            self.assertFalse(q.has_pending(db, cases, 'alias', 'c' * 40))
            self.assertEqual(db.execute('select status,count(*) from jobs group by status order by status').fetchall(),
                             [('failed', 1), ('passed', 63)])
            db.close()

if __name__ == '__main__':
    unittest.main()
