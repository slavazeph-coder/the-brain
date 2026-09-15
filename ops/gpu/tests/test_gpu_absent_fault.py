"""An absent GPU must be reported as a hardware fault, not spun on silently.

Observed in production 2026-09-15: the device left the PCI bus, so
orchestration_ownership_verified() could never succeed. once() raised a bare
ValueError, run() swallowed it, and the worker emitted one identical warning
per second indefinitely -- ~86k lines/day -- while burying the actual cause.

The device being gone is a host-level fault. The worker cannot reconcile its
way out of it, so it must classify it apart from ordinary non-quiescence and
retry slowly instead of hammering the scheduler.
"""
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runtime
from orchestration_worker import (
    HARDWARE_RETRY_SECONDS,
    HardwareFault,
    OrchestrationWorker,
)
from test_orchestration_worker import OrchestrationTests


class GpuAbsentTests(unittest.TestCase):
    def config(self, root):
        return OrchestrationTests().config(root)

    def test_absent_gpu_raises_hardware_fault_not_value_error(self):
        """A missing device must be classified as hardware, not as bad state."""
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(self.config(Path(tmp)))
            worker = OrchestrationWorker(instance)
            worker.client = type('Scheduler', (), {'request': lambda *a, **k: {}})()

            # Reconciliation is pending and the device is gone from the bus.
            worker.reconciled = False
            with patch.object(instance, 'orchestration_quiescent', return_value=False), \
                 patch.object(instance, 'orchestration_gpu_present', return_value=False):
                with self.assertRaises(HardwareFault):
                    worker.once()

    def test_present_gpu_keeps_the_original_reconciliation_error(self):
        """A present-but-busy GPU is still ordinary non-quiescence."""
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(self.config(Path(tmp)))
            worker = OrchestrationWorker(instance)
            worker.client = type('Scheduler', (), {'request': lambda *a, **k: {}})()

            worker.reconciled = False
            with patch.object(instance, 'orchestration_quiescent', return_value=False), \
                 patch.object(instance, 'orchestration_gpu_present', return_value=True):
                with self.assertRaises(ValueError):
                    worker.once()

    def test_run_reports_the_fault_once_and_backs_off(self):
        """The loop must report a hardware fault once, then poll slowly."""
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(self.config(Path(tmp)))
            worker = OrchestrationWorker(instance)

            faults = []
            polls = []

            class Scheduler:
                def request(self, method, path, value=None, **kwargs):
                    polls.append(path)
                    if path.endswith('/fault'):
                        faults.append(value)
                    return {}

            worker.client = Scheduler()
            worker.reconciled = False

            # Stop the loop shortly after it has had time to iterate many times.
            def stopper():
                time.sleep(5)
                instance.stop.set()

            with patch.object(instance, 'orchestration_quiescent', return_value=False), \
                 patch.object(instance, 'orchestration_gpu_present', return_value=False):
                threading.Thread(target=stopper, daemon=True).start()
                worker.run()

            self.assertEqual(len(faults), 1, 'the hardware fault must be reported exactly once')
            self.assertEqual(faults[0]['category'], 'hardware')
            # With a 30s backoff a 5s window allows only the first iteration;
            # previously this produced one warning per second.
            self.assertLessEqual(len(polls), 2,
                                 'a 30s backoff must not re-poll at 1 Hz')
            self.assertGreaterEqual(HARDWARE_RETRY_SECONDS, 5)


if __name__ == '__main__':
    unittest.main()
