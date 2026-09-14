"""Review regressions: synthetic telemetry only; no GPU or deployment access."""
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import test_orchestration_worker as existing
import runtime
import orchestration_worker as worker


class ReviewBlockers(unittest.TestCase):
    def instance(self, root):
        return runtime.Runtime(existing.OrchestrationTests().config(root))

    def test_s1_empty_namespace_is_not_ownership(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self.instance(Path(tmp))
            with patch.object(r, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': [{'uuid': 'GPU-test'}]}), patch('runtime.subprocess.run', return_value=SimpleNamespace(stdout='# gpu pid type sm mem enc dec command\n0 - - - - - - -\n')):
                self.assertFalse(r.orchestration_quiescent())
                r.c.update(GPU_OWNERSHIP_SCOPE='exclusive-container', GPU_OWNERSHIP_UUID='GPU-test', GPU_OWNERSHIP_BASIS='Operator verified dedicated device allocation and disabled other launchers')
                self.assertTrue(r.orchestration_quiescent())
                with patch('runtime.subprocess.run', return_value=SimpleNamespace(stdout='0 999999 C 0 0 0 0 foreign\n')):
                    self.assertFalse(r.orchestration_quiescent())

    def test_l2_backup_runs_and_times_out_in_orchestration(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self.instance(Path(tmp))
            r.c['BACKUP_COMMAND'] = ['/bin/true']
            r.last_backup = -1e12  # Due regardless of interpreter monotonic epoch.
            child = SimpleNamespace(poll=lambda: None, pid=123)
            with patch('runtime.gpu_snapshot', return_value={'available': False, 'devices': []}), patch.object(r, 'launch', return_value=child) as launch, patch.object(r, 'terminate') as stop:
                r.tick()
                launch.assert_called_once_with('backup', ['/bin/true'])
                r.backup_started = -1e12
                r.tick()
                stop.assert_called_once_with(child, 2)
                self.assertEqual(r.backup_last_exit_code, 'timeout')

    def test_l4_interrupted_stage_retries_without_corrupt_final(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / 'hash.latent'
            with patch('orchestration_worker.os.fsync', side_effect=OSError('disk full')):
                with self.assertRaises(OSError):
                    worker.stage_decode_input(dest, b'complete latent')
            self.assertFalse(dest.exists())
            worker.stage_decode_input(dest, b'complete latent')
            self.assertEqual(dest.read_bytes(), b'complete latent')
            dest.write_bytes(b'independent change')
            with self.assertRaises(ValueError):
                worker.stage_decode_input(dest, b'complete latent')
            self.assertEqual(dest.read_bytes(), b'independent change')

    def test_l1_images_require_sqlite_runtime(self):
        root = Path(runtime.__file__).resolve().parents[2]
        for path in [root / 'Dockerfile', root / 'brainsnn-r3f-app/Dockerfile']:
            self.assertIn('FROM node:22.22.2-slim', path.read_text())

    def test_installer_includes_backup_and_workflow_documentation(self):
        source = (Path(runtime.__file__).parent / 'install.py').read_text()
        for name in ['requirements-swarms.txt', 'orchestration-runbook.md']:
            self.assertIn("'" + name + "'", source)

    def test_completion_drains_inflight_heartbeat_before_retention(self):
        import time
        with tempfile.TemporaryDirectory() as tmp:
            r = self.instance(Path(tmp))
            w = worker.OrchestrationWorker(r)
            entered, released = threading.Event(), threading.Event()
            completions = []
            def scheduler(method, path, value=None, **kwargs):
                if path.endswith('/heartbeat'):
                    entered.set()
                    time.sleep(0.15)
                    released.set()
                    return {'lease': {'expiresAt': (time.time() + 30) * 1000}}
                if path.endswith('/complete'):
                    completions.append(released.is_set())
                return {}
            def inference(*args, **kwargs):
                self.assertTrue(entered.wait(2))
                return {'data': []}
            job = {'id': 'race', 'kind': 'inference', 'payload': {'operation': 'models'},
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 3) * 1000}}
            with patch.object(r, 'orchestration_begin'), patch.object(r, 'orchestration_start_child'), patch.object(r, 'orchestration_end'), patch.object(r, 'orchestration_quiescent', return_value=True), patch.object(w.client, 'request', side_effect=scheduler), patch('orchestration_worker.JsonClient.request', side_effect=inference):
                w.execute(job)
            self.assertEqual(completions, [True])
            self.assertFalse(w.reconciled)  # Missing retained model forces reconciliation.

    def test_backup_restore_artifact_and_checkpoint_hashes(self):
        import hashlib
        import json
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, restored = root / 'source', root / 'restored'
            store = worker.ArtifactStore(source / 'artifacts')
            artifact = store.put(b'immutable generated latent', 'application/octet-stream')
            worker.save_json(source / 'checkpoints/job.json', {'generated': artifact})
            inventory = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in source.rglob('*') if p.is_file()}
            shutil.copytree(source, restored)
            self.assertEqual(inventory, {str(p.relative_to(restored)): hashlib.sha256(p.read_bytes()).hexdigest()
                                        for p in restored.rglob('*') if p.is_file()})
            checkpoint = json.loads((restored / 'checkpoints/job.json').read_text())
            self.assertEqual(worker.ArtifactStore(restored / 'artifacts').read(checkpoint['generated']), b'immutable generated latent')

    def test_s1_unconfirmed_owned_group_is_never_released(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self.instance(Path(tmp))
            process = SimpleNamespace(pid=123)
            r.orchestration_children['comfy_gpu'] = process
            with patch.object(r, 'terminate'), patch('runtime.os.killpg'):
                with self.assertRaises(RuntimeError):
                    r.orchestration_stop_child('comfy_gpu')
            self.assertTrue(r.orchestration_paused)
            self.assertIs(r.orchestration_children['comfy_gpu'], process)

    def test_installer_copies_required_files_and_preserves_existing_config(self):
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'runtime.env').write_text('synthetic-existing-config')
            subprocess.run([sys.executable, str(Path(runtime.__file__).parent / 'install.py'),
                            '--destination', tmp], check=True, capture_output=True)
            for name in ('requirements-swarms.txt', 'orchestration-runbook.md'):
                self.assertEqual((root / name).read_bytes(), (Path(runtime.__file__).parent / name).read_bytes())
            self.assertEqual((root / 'runtime.env').read_text(), 'synthetic-existing-config')

    def test_s1_telemetry_errors_foreign_groups_and_missing_basis_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self.instance(Path(tmp))
            r.c.update(GPU_OWNERSHIP_SCOPE='exclusive-container', GPU_OWNERSHIP_UUID='GPU-test',
                       GPU_OWNERSHIP_BASIS='Synthetic operator dedicated allocation evidence')
            with patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': [{'uuid': 'GPU-test'}]}):
                for output in ('', 'unsupported', '0 999 C 0 0 0 0 foreign', '0 - N/A - - - - -'):
                    with patch('runtime.subprocess.run', return_value=SimpleNamespace(stdout=output)), patch('runtime.os.getpgid', return_value=555):
                        self.assertFalse(r.orchestration_ownership_verified([123]))
                with patch('runtime.subprocess.run', side_effect=OSError('unavailable')):
                    self.assertFalse(r.orchestration_ownership_verified())
            with patch.object(r, 'orchestration_ownership_verified', return_value=False), patch.object(r, 'launch') as launch:
                with self.assertRaises(worker.LeaseLost):
                    r.orchestration_start_child('inference', threading.Event())
                launch.assert_not_called()
