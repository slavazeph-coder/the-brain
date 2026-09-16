"""Heartbeat resilience: a transient transport blip must not destroy a long render.

Long HQ renders issue thousands of heartbeats (30s lease, ~1s cadence). Aborting
on the first transport failure made multi-minute jobs effectively impossible,
so a bounded run of failed renewals is tolerated while the independent local
lease timer remains the authority on ownership.
"""
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runtime
from orchestration_worker import (
    HEARTBEAT_FAILURE_BUDGET,
    LeaseLost,
    OrchestrationWorker,
    TransportFault,
)
from test_orchestration_worker import OrchestrationTests


class HeartbeatResilienceTests(unittest.TestCase):
    def config(self, root):
        return OrchestrationTests().config(root)

    def execute(self, worker, instance, job, render):
        worker.comfy.run = render
        with patch.object(instance, 'orchestration_ownership_verified', return_value=True), \
             patch.object(instance, 'port_occupied', return_value=False), \
             patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), \
             patch.object(instance, 'health', return_value=True):
            worker.execute(job)

    def test_transient_transport_blips_do_not_fail_the_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = ['/bin/sleep', '60']
            instance = runtime.Runtime(c)
            worker = OrchestrationWorker(instance)
            calls = []
            state = {'faults': 0, 'renewed': 0}

            class Scheduler:
                def request(self, method, path, value=None, **kwargs):
                    calls.append(path)
                    if path.endswith('/heartbeat'):
                        if state['faults'] < 2:
                            state['faults'] += 1
                            raise TransportFault('controlled blip', subtype='timeout')
                        state['renewed'] += 1
                        return {'control': {}, 'lease': {'expiresAt': (time.time() + 30) * 1000}}
                    return {}

            worker.client = Scheduler()

            def render(job, cancel, publish):
                limit = time.time() + 25
                while state['renewed'] < 3 and time.time() < limit and not cancel.is_set():
                    time.sleep(0.05)
                self.assertFalse(cancel.is_set(), 'a transient blip must not cancel the render')
                return {'result': {}, 'artifacts': []}

            job = {'id': 'tolerant', 'kind': 'video', 'payload': {},
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 30) * 1000}}
            self.execute(worker, instance, job, render)
            self.assertEqual([p for p in calls if p.endswith('/fail')], [],
                             'a transient heartbeat blip must not fail the job')
            self.assertTrue(any(p.endswith('/complete') for p in calls))

    def test_sustained_transport_faults_still_abort(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = ['/bin/sleep', '60']
            instance = runtime.Runtime(c)
            worker = OrchestrationWorker(instance)
            calls = []

            class Scheduler:
                def request(self, method, path, value=None, **kwargs):
                    calls.append(path)
                    if path.endswith('/heartbeat'):
                        raise TransportFault('controlled outage', subtype='timeout')
                    return {}

            worker.client = Scheduler()

            def render(job, cancel, publish):
                self.assertTrue(cancel.wait(25), 'sustained loss must cancel the render')
                raise LeaseLost('cancelled')

            job = {'id': 'outage', 'kind': 'video', 'payload': {},
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 2) * 1000}}
            self.execute(worker, instance, job, render)
            self.assertEqual(len([p for p in calls if p.endswith('/fail')]), 1)
            self.assertFalse(any(p.endswith('/complete') for p in calls))
            self.assertGreater(HEARTBEAT_FAILURE_BUDGET, 0)


if __name__ == '__main__':
    unittest.main()
