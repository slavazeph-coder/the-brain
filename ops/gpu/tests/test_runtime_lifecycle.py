"""Offline lifecycle regressions: private temporary state, no GPU or sockets."""
import contextlib
import fcntl
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runtime
import test_orchestration_worker as existing


class RuntimeLifecycleTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.config = existing.OrchestrationTests().config(self.root)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.active = self.state / 'orchestration-active.json'
        self.pause = self.state / 'orchestration-pause.json'
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch('runtime.gpu_snapshot', side_effect=AssertionError('GPU forbidden')))
        stack.enter_context(patch('socket.socket', side_effect=AssertionError('socket forbidden')))
        stack.enter_context(patch('runtime.signal.signal'))

    def instance(self):
        instance = runtime.Runtime(self.config)
        for handler in instance.log.handlers:
            self.addCleanup(handler.close)
        return instance

    def command(self, action):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['runtime.py', '--config', 'unused', action]), \
                patch('runtime.read_config', return_value=self.config), contextlib.redirect_stdout(output):
            runtime.main()
        return output.getvalue()

    def inert_run(self, instance, tick=None):
        gateway, worker = Mock(), Mock()
        with patch('runtime.Gateway', return_value=gateway), \
                patch('orchestration_worker.OrchestrationWorker', return_value=worker), \
                patch.object(instance, 'tick', side_effect=tick or instance.stop.set):
            instance.run()
        return gateway

    def test_preflight_constructor_does_not_write_or_overwrite_pause(self):
        runtime.save_json(self.active, {'id': 'active-job'})
        self.assertTrue(self.instance().orchestration_paused)
        self.assertFalse(self.pause.exists())
        original = {'reason': 'Owned process group termination unverified', 'at': 123}
        runtime.save_json(self.pause, original)
        self.instance()
        self.assertEqual(runtime.load_json(self.pause), original)

    def test_rejected_second_supervisor_cannot_create_pause(self):
        runtime.save_json(self.active, {'id': 'active-job'})
        with (self.state / 'runtime.lock').open('a') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'already running'):
                self.instance().run()
        self.assertFalse(self.pause.exists())

    def test_real_restart_latches_only_under_lock_and_survives_cleanup(self):
        instance = self.instance()
        # The marker may appear after construction; startup must re-read it.
        runtime.save_json(self.active, {'id': 'orphan'})
        self.inert_run(instance)
        self.assertTrue(runtime.load_json(self.pause)['reason'].startswith('Unclean restart:'))
        self.assertTrue(self.instance().orchestration_paused)

    def test_hardware_fault_preserves_first_uncertainty_reason(self):
        instance = self.instance()
        original = {'reason': 'Owned process group termination unverified', 'at': 123}
        runtime.save_json(self.pause, original)
        instance.orchestration_paused = True
        instance.orchestration_hardware_fault('GPU hardware fault')
        self.assertEqual(runtime.load_json(self.pause), original)

    def test_stop_rejects_active_marker_even_when_pid_disappears(self):
        runtime.save_json(self.active, {'id': 'orphan'})
        with patch('runtime.verified_pid', side_effect=[12345, None, None]), patch('runtime.os.kill'):
            with self.assertRaisesRegex(ValueError, 'cleanup unconfirmed'):
                self.command('stop')
        self.assertTrue(self.active.exists())
        self.assertFalse(self.pause.exists())

    def test_stop_rejects_held_lock_without_verified_pid(self):
        with (self.state / 'runtime.lock').open('a') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch('runtime.verified_pid', return_value=None), \
                    self.assertRaisesRegex(ValueError, 'cleanup unconfirmed'):
                self.command('stop')

    def test_normal_cleanup_is_confirmed_without_clearing_pause(self):
        instance = self.instance()
        runtime.save_json(self.pause, {'reason': 'GPU hardware fault', 'at': 123})
        self.inert_run(instance)
        with patch('runtime.verified_pid', return_value=None):
            self.assertIn('Runtime stopped', self.command('stop'))
        self.assertTrue(self.pause.exists())
        self.assertFalse((self.state / 'pid.json').exists())

    def test_worker_start_failure_closes_gateway_and_releases_lock(self):
        instance, gateway = self.instance(), Mock()
        with patch('runtime.Gateway', return_value=gateway), \
                patch('orchestration_worker.OrchestrationWorker', side_effect=RuntimeError('synthetic')):
            with self.assertRaises(RuntimeError):
                instance.run()
        gateway.shutdown.assert_called_once()
        gateway.server_close.assert_called_once()
        self.assertFalse((self.state / 'pid.json').exists())
        with (self.state / 'runtime.lock').open('a') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_run_startup_failure_records_private_fixed_diagnostic(self):
        secret = self.config['GPU_API_KEY']
        with patch('runtime.Gateway', side_effect=OSError('credential=' + secret)):
            with self.assertRaises(OSError):
                self.command('run')
        path = self.state / 'runtime-exit.json'
        record = runtime.load_json(path)
        self.assertEqual(record['phase'], 'startup')
        self.assertEqual(record['exception_type'], 'OSError')
        self.assertEqual(record['exit_code'], 1)
        self.assertNotIn(secret, path.read_text())
        self.assertNotIn('credential', path.read_text())
        self.assertLess(path.stat().st_size, 1024)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_run_tick_failure_records_safe_type_and_clean_shutdown(self):
        instance = self.instance()
        with patch('runtime.Runtime', return_value=instance), patch('runtime.Gateway', return_value=Mock()), \
                patch('orchestration_worker.OrchestrationWorker', return_value=Mock()), \
                patch.object(instance, 'tick', side_effect=RuntimeError('never log config: ' + json.dumps(self.config))):
            with self.assertRaises(RuntimeError):
                self.command('run')
        record = runtime.load_json(self.state / 'runtime-exit.json')
        self.assertEqual(record['phase'], 'running')
        self.assertEqual(record['exception_type'], 'RuntimeError')
        self.assertTrue(runtime.load_json(self.state / 'status.json')['stopped'])
        self.assertNotIn(self.config['GPU_API_KEY'], (self.state / 'runtime-exit.json').read_text())

    def test_gateway_cleanup_failure_still_stops_owned_children_without_success_receipt(self):
        instance, gateway = self.instance(), Mock()
        gateway.shutdown.side_effect = OSError('synthetic cleanup failure')
        instance.bridge = bridge = Mock()
        instance.inference = child = Mock()
        bridge.pid, child.pid = 12345, 12346
        bridge.poll.return_value = child.poll.return_value = None
        with patch('runtime.Gateway', return_value=gateway), \
                patch('orchestration_worker.OrchestrationWorker', return_value=Mock()), \
                patch.object(instance, 'tick', side_effect=instance.stop.set), \
                patch.object(instance, 'terminate') as terminate:
            with self.assertRaises(OSError):
                instance.run()
        gateway.server_close.assert_called_once()
        self.assertIn(unittest.mock.call(bridge, 5), terminate.call_args_list)
        self.assertIn(unittest.mock.call(child, 10), terminate.call_args_list)
        self.assertFalse(runtime.load_json(self.state / 'status.json')['stopped'])
        self.assertTrue((self.state / 'pid.json').exists())

    def test_unjoined_worker_preserves_active_marker_and_latches(self):
        instance = self.instance()
        gateway_thread, worker_thread = Mock(), Mock()
        worker_thread.is_alive.return_value = True
        def work():
            runtime.save_json(self.active, {'id': 'unfinished'})
            instance.stop.set()
        with patch('runtime.Gateway', return_value=Mock()), \
                patch('runtime.threading.Thread', side_effect=[gateway_thread, worker_thread]), \
                patch('orchestration_worker.OrchestrationWorker', return_value=Mock()), \
                patch.object(instance, 'tick', side_effect=work):
            with self.assertRaisesRegex(RuntimeError, 'worker stop unconfirmed'):
                instance.run()
        self.assertTrue(self.active.exists())
        self.assertTrue(self.pause.exists())
        self.assertFalse(runtime.load_json(self.state / 'status.json')['stopped'])

    def test_native_start_observes_detached_startup_failure(self):
        # A real detached Python process, with an inert startup failure injected
        # before any gateway/GPU access; config contains synthetic keys only.
        fixture = self.root / 'startup_fixture.py'
        fixture.write_text('import sys\nsys.path.insert(0, ' + repr(str(Path(runtime.__file__).parent)) + ')\n'
                           'import runtime\n'
                           'def fail(*args, **kwargs): raise OSError("synthetic private startup detail")\n'
                           'runtime.Gateway = fail\n'
                           'try: runtime.main()\n'
                           'except Exception: sys.exit(1)\n')
        with patch.object(sys, 'argv', ['runtime.py', '--config', str(self.root / 'runtime.env'), 'start']), \
                patch('runtime.__file__', str(fixture)), patch('runtime.verified_pid', return_value=None):
            with self.assertRaisesRegex(ValueError, 'Runtime failed to start'):
                runtime.main()
        record = runtime.load_json(self.state / 'runtime-exit.json')
        self.assertEqual(record['exit_code'], 1)
        self.assertEqual(record['phase'], 'startup')
        self.assertEqual(record['exception_type'], 'OSError')

    def test_normal_run_writes_exit_zero_and_replaces_prior_record(self):
        for _ in range(2):
            instance = self.instance()
            with patch('runtime.Runtime', return_value=instance), patch('runtime.Gateway', return_value=Mock()), \
                    patch('orchestration_worker.OrchestrationWorker', return_value=Mock()), \
                    patch.object(instance, 'tick', side_effect=instance.stop.set):
                self.command('run')
        record = runtime.load_json(self.state / 'runtime-exit.json')
        self.assertEqual(record['exit_code'], 0)
        self.assertIsNone(record['exception_type'])
        self.assertEqual(len(list(self.state.glob('runtime-exit*'))), 1)

    def test_custom_exception_type_is_fixed_only(self):
        custom = type('private_credential_' + self.config['GPU_API_KEY'], (Exception,), {})
        with patch('runtime.Runtime', side_effect=custom('secret config')):
            with self.assertRaises(custom):
                self.command('run')
        record = runtime.load_json(self.state / 'runtime-exit.json')
        self.assertEqual(record['phase'], 'initialization')
        self.assertEqual(record['exception_type'], 'OtherError')

    def test_detached_configuration_and_spawn_failures_are_observable(self):
        path = self.state / 'runtime-exit.json'
        with patch.object(sys, 'argv', ['runtime.py', '--startup-diagnostic', str(path), 'run']), \
                patch('runtime.read_config', side_effect=ValueError('private config data')):
            with self.assertRaises(ValueError):
                runtime.main()
        self.assertEqual(runtime.load_json(path)['phase'], 'configuration')
        with patch('runtime.verified_pid', return_value=None), \
                patch('runtime.subprocess.Popen', side_effect=OSError('private executable')):
            with self.assertRaises(OSError):
                self.command('start')
        self.assertEqual(runtime.load_json(path)['phase'], 'spawn')
        self.assertNotIn('private', path.read_text())

    def test_base_exception_exits_are_normalized_without_raw_stderr(self):
        for error in (SystemExit('private key'), SystemExit(0), KeyboardInterrupt('private config')):
            with self.subTest(kind=type(error).__name__):
                instance = self.instance()
                with patch('runtime.Runtime', return_value=instance), patch.object(instance, 'run', side_effect=error):
                    with self.assertRaises(RuntimeError):
                        self.command('run')
                record = runtime.load_json(self.state / 'runtime-exit.json')
                self.assertEqual(record['exit_code'], 1)
                self.assertEqual(record['exception_type'], type(error).__name__)
        output = io.StringIO()
        with patch('runtime.main', side_effect=SystemExit('private key')), contextlib.redirect_stderr(output):
            self.assertEqual(runtime.entrypoint(), 1)
        self.assertNotIn('private key', output.getvalue())


if __name__ == '__main__':
    unittest.main()
