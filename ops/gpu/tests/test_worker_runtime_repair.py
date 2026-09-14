"""Bounded local pause and heartbeat lifecycle regressions; no sockets or GPU."""
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import orchestration_worker as ow
import runtime
import test_orchestration_worker as existing


class WorkerRuntimeRepairTests(unittest.TestCase):
    def fixture(self, stack):
        root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        instance = runtime.Runtime(existing.OrchestrationTests().config(root))
        worker = ow.OrchestrationWorker(instance)
        for name in ('orchestration_begin', 'orchestration_start_child', 'orchestration_end'):
            stack.enter_context(patch.object(instance, name))
        stack.enter_context(patch.object(instance, 'orchestration_quiescent', return_value=True))
        return instance, worker

    def job(self, seconds=30):
        return {'id': 'local-repair', 'kind': 'inference',
                'payload': {'operation': 'models'},
                'lease': {'token': 't' * 40, 'expiresAt': (time.time() + seconds) * 1000}}

    def test_paused_uncertainty_keeps_original_reason_and_scheduler_quarantine(self):
        reasons = (
            'Unclean restart: verify all prior child processes stopped before explicit clearance',
            'Owned process stop could not be confirmed; manual quiescence required',
            'Owned process group termination unverified',
        )
        for reason in reasons:
            with self.subTest(reason=reason), ExitStack() as stack:
                instance, worker = self.fixture(stack)
                latch = {'reason': reason, 'at': 1234}
                def uncertain(*args, **kwargs):
                    instance.orchestration_paused = True
                    ow.save_json(instance.root / 'state/orchestration-pause.json', latch)
                    raise ow.LeaseLost('synthetic-private exception text')
                faults = stack.enter_context(patch.object(instance, 'orchestration_hardware_fault',
                                                          wraps=instance.orchestration_hardware_fault))
                requests = stack.enter_context(patch.object(worker.client, 'request', return_value={}))
                stack.enter_context(patch('orchestration_worker.JsonClient.request', side_effect=uncertain))
                worker.execute(self.job())
                faults.assert_not_called()
                self.assertEqual(json.loads((instance.root / 'state/orchestration-pause.json').read_text()), latch)
                self.assertTrue(instance.orchestration_paused)
                failure = next(call.args[2] for call in requests.call_args_list if call.args[1].endswith('/fail'))
                self.assertEqual(failure['category'], 'hardware')  # Existing scheduler quarantine contract.
                self.assertEqual(failure['message'], 'runtime_pause_requires_clearance')
                self.assertFalse(any(call.args[1].endswith('/complete') for call in requests.call_args_list))

    def test_explicit_hardware_failure_still_latches_and_quarantines(self):
        for error in (ow.HardwareFault('synthetic-private'), ValueError('CUDA error: synthetic-private')):
            with self.subTest(error=type(error).__name__), ExitStack() as stack:
                instance, worker = self.fixture(stack)
                requests = stack.enter_context(patch.object(worker.client, 'request', return_value={}))
                stack.enter_context(patch('orchestration_worker.JsonClient.request', side_effect=error))
                worker.execute(self.job())
                self.assertTrue(instance.orchestration_paused)
                self.assertEqual(ow.load_json(instance.root / 'state/orchestration-pause.json')['reason'], 'GPU hardware fault')
                failure = next(call.args[2] for call in requests.call_args_list if call.args[1].endswith('/fail'))
                self.assertEqual(failure['category'], 'hardware')
                self.assertNotIn('synthetic-private', json.dumps(failure))

    def test_unverified_cleanup_reports_failure_and_keeps_owned_child_and_latches(self):
        for workload_fails in (False, True):
            with self.subTest(workload_fails=workload_fails), ExitStack() as stack:
                root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
                instance = runtime.Runtime(existing.OrchestrationTests().config(root))
                worker = ow.OrchestrationWorker(instance)
                child = SimpleNamespace(pid=123456789)
                def workload(*args, **kwargs):
                    instance.orchestration_children['comfy_gpu'] = child
                    if workload_fails:
                        raise ow.TransportFault('synthetic-private')
                    return {'result': {}, 'artifacts': []}
                requests = stack.enter_context(patch.object(worker.client, 'request', return_value={}))
                stack.enter_context(patch.object(worker.comfy, 'run', side_effect=workload))
                stack.enter_context(patch.object(instance, 'port_occupied', return_value=False))
                stack.enter_context(patch.object(instance, 'orchestration_ownership_verified', return_value=True))
                stack.enter_context(patch.object(instance, 'terminate'))
                stack.enter_context(patch('runtime.os.killpg'))  # Controlled process group remains unverified.
                job = dict(self.job(), kind='video', payload={})
                worker.execute(job)
                self.assertTrue(instance.orchestration_paused)
                self.assertIs(instance.orchestration_children['comfy_gpu'], child)
                self.assertTrue((root / 'state/orchestration-active.json').exists())
                self.assertEqual(ow.load_json(root / 'state/orchestration-pause.json')['reason'],
                                 'Owned process group termination unverified')
                failure = next(call.args[2] for call in requests.call_args_list if call.args[1].endswith('/fail'))
                self.assertEqual(failure['category'], 'hardware')
                self.assertEqual(failure['message'], 'runtime_pause_requires_clearance')
                self.assertFalse(failure['quiescent'])
                self.assertFalse(worker.reconciled)
                self.assertFalse(any(call.args[1].endswith('/complete') for call in requests.call_args_list))

    def test_completion_drains_valid_heartbeat_longer_than_three_seconds(self):
        with ExitStack() as stack:
            instance, worker = self.fixture(stack)
            entered, released = threading.Event(), threading.Event()
            calls, budgets = [], []
            def scheduler(method, path, value=None, **kwargs):
                calls.append((path, value))
                if path.endswith('/heartbeat'):
                    budgets.append(kwargs['timeout'])
                    entered.set()
                    time.sleep(3.2)
                    released.set()
                    return {'lease': {'expiresAt': (time.time() + 30) * 1000}}
                if path.endswith('/complete'):
                    self.assertTrue(released.is_set(), 'Heartbeat must be fully drained before completion')
                return {}
            def workload(*args, **kwargs):
                self.assertTrue(entered.wait(2))
                return {'data': []}
            stack.enter_context(patch.object(worker.client, 'request', side_effect=scheduler))
            stack.enter_context(patch('orchestration_worker.JsonClient.request', side_effect=workload))
            worker.execute(self.job())
            self.assertEqual(budgets, [5.0])
            self.assertEqual(len([path for path, _ in calls if path.endswith('/complete')]), 1)
            self.assertFalse(any(path.endswith('/fail') for path, _ in calls))
            self.assertTrue(any(call.kwargs.get('keep_inference') for call in instance.orchestration_end.call_args_list))

    def test_inflight_timeout_never_completes_or_retains_or_retries(self):
        with ExitStack() as stack:
            instance, worker = self.fixture(stack)
            entered, workload_done = threading.Event(), threading.Event()
            calls = []
            def scheduler(method, path, value=None, **kwargs):
                calls.append((path, value))
                if path.endswith('/heartbeat'):
                    entered.set()
                    self.assertTrue(workload_done.wait(2))
                    raise ow.TransportFault('synthetic-private', subtype='timeout')
                return {}
            def workload(*args, **kwargs):
                self.assertTrue(entered.wait(2))
                workload_done.set()
                return {'data': []}
            stack.enter_context(patch.object(worker.client, 'request', side_effect=scheduler))
            stack.enter_context(patch('orchestration_worker.JsonClient.request', side_effect=workload))
            stack.enter_context(patch.object(instance, 'orchestration_cancel_owned'))
            worker.execute(self.job(3))
            self.assertEqual(len([path for path, _ in calls if path.endswith('/heartbeat')]), 1)
            failures = [body for path, body in calls if path.endswith('/fail')]
            self.assertEqual(len(failures), 1)
            self.assertEqual(failures[0]['message'], 'heartbeat_transport_timeout')
            self.assertEqual(failures[0]['category'], 'transport')
            self.assertFalse(any(path.endswith('/complete') for path, _ in calls))
            self.assertFalse(any(call.kwargs.get('keep_inference') for call in instance.orchestration_end.call_args_list))

    def test_expired_lease_stops_work_and_rejects_late_heartbeat_renewal(self):
        with ExitStack() as stack:
            instance, worker = self.fixture(stack)
            entered, cancelled = threading.Event(), threading.Event()
            calls, timers, budgets = [], [], []
            real_timer = threading.Timer
            def timer(seconds, callback):
                item = real_timer(seconds, callback)
                timers.append(item)
                return item
            def scheduler(method, path, value=None, **kwargs):
                calls.append((path, value))
                if path.endswith('/heartbeat'):
                    budgets.append(kwargs['timeout'])
                    entered.set()
                    self.assertTrue(cancelled.wait(2), 'Lease timer must stop work during stalled heartbeat')
                    return {'lease': {'expiresAt': (time.time() + 30) * 1000}}
                return {}
            def workload(*args, **kwargs):
                self.assertTrue(entered.wait(2))
                return {'data': []}
            stack.enter_context(patch('orchestration_worker.threading.Timer', side_effect=timer))
            stack.enter_context(patch.object(instance, 'orchestration_cancel_owned', side_effect=cancelled.set))
            stack.enter_context(patch.object(worker.client, 'request', side_effect=scheduler))
            stack.enter_context(patch('orchestration_worker.JsonClient.request', side_effect=workload))
            worker.execute(self.job(0.3))
            self.assertTrue(cancelled.is_set())
            self.assertEqual(len(timers), 1, 'Late heartbeat must not rearm an expired lease')
            self.assertEqual(len(budgets), 1)
            self.assertGreater(budgets[0], 0)
            self.assertLessEqual(budgets[0], 0.3)
            failure = next(body for path, body in calls if path.endswith('/fail'))
            self.assertEqual(failure['message'], 'lease_expired')
            self.assertFalse(any(path.endswith('/complete') for path, _ in calls))
            self.assertFalse(any(call.kwargs.get('keep_inference') for call in instance.orchestration_end.call_args_list))

    def test_uninterruptible_heartbeat_exhausts_bounded_drain_without_completion(self):
        with ExitStack() as stack:
            instance, worker = self.fixture(stack)
            heartbeat = Mock()
            heartbeat.is_alive.return_value = True
            stack.enter_context(patch('orchestration_worker.threading.Timer'))
            stack.enter_context(patch('orchestration_worker.threading.Thread', return_value=heartbeat))
            requests = stack.enter_context(patch.object(worker.client, 'request', return_value={}))
            stack.enter_context(patch('orchestration_worker.JsonClient.request', return_value={'data': []}))
            worker.execute(self.job())
            for call in heartbeat.join.call_args_list:
                self.assertGreaterEqual(call.kwargs['timeout'], 5)
                self.assertLessEqual(call.kwargs['timeout'], 5.1)
            self.assertFalse(any(call.args[1].endswith('/complete') for call in requests.call_args_list))
            self.assertEqual(len([call for call in requests.call_args_list if call.args[1].endswith('/fail')]), 1)
            self.assertFalse(any(call.kwargs.get('keep_inference') for call in instance.orchestration_end.call_args_list))


if __name__ == '__main__':
    unittest.main()
