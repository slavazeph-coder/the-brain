"""Controlled local invariants; these tests never contact a GPU or production host."""
import fcntl
import hashlib
import json
import os
import time
from types import SimpleNamespace
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runtime
from orchestration_worker import ArtifactStore, ComfyAdapter, OrchestrationWorker, validate_config, hardware_error, JsonClient, TransportFault, HardwareFault, LeaseLost


class OrchestrationTests(unittest.TestCase):
    def config(self, root):
        raw = (Path(runtime.__file__).parent / 'runtime.env.example').read_text().replace('__RUNTIME_DIR__', str(root))
        for key in ['a' * 40, 'b' * 40, 'c' * 40]:
            raw = raw.replace('GENERATE_ON_INSTALL', key, 1)
        path = root / 'runtime.env'
        path.write_text(raw)
        path.chmod(0o600)
        c = runtime.read_config(path)
        c.update(ORCHESTRATION_ENABLED='1', ORCHESTRATION_URL='https://example.invalid/api/orchestration-worker',
                 ORCHESTRATION_WORKER_KEY='d' * 40, ORCHESTRATION_WORKER_ID='controlled-test', MIN_DISK_FREE_MB='0')
        return c

    def test_missing_keys_and_competing_workers_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            validate_config(c)
            for change in [{'ORCHESTRATION_WORKER_KEY': ''}, {'ORCHESTRATION_WORKER_KEY': c['GPU_API_KEY']},
                           {'BRIDGE_COMMAND': ['/bin/true']}, {'BACKGROUND_COMMAND': ['/bin/true']},
                           {'ORCHESTRATION_URL': 'http://example.invalid/api/orchestration-worker'}]:
                with self.subTest(change=change), self.assertRaises(ValueError):
                    validate_config(dict(c, **change))

    def test_artifacts_are_content_addressed_and_detect_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ArtifactStore(Path(tmp))
            first = store.put(b'controlled render bytes', 'video/mp4')
            self.assertEqual(first, store.put(b'controlled render bytes', 'video/mp4'))
            self.assertEqual(store.read(first), b'controlled render bytes')
            (Path(tmp) / first['sha256']).chmod(0o600)
            (Path(tmp) / first['sha256']).write_bytes(b'tampered')
            with self.assertRaises(ValueError):
                store.read(first)

    def test_hardware_pause_survives_runtime_restart_and_stops_owned_children(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            instance = runtime.Runtime(c)
            instance.orchestration_hardware_fault('NVML device lost')
            self.assertTrue(instance.orchestration_paused)
            restarted = runtime.Runtime(c)
            self.assertTrue(restarted.orchestration_paused)
            with patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(restarted, 'launch') as launch:
                restarted.tick()
                launch.assert_not_called()

    def test_orchestration_mode_does_not_autostart_inference(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = ['/bin/false']
            instance = runtime.Runtime(c)
            with patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'launch') as launch:
                instance.tick()
                launch.assert_not_called()

    def test_unclean_active_job_restart_requires_manual_clearance(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            root = Path(tmp)
            (root / 'state').mkdir()
            (root / 'state/orchestration-active.json').write_text(json.dumps({'id': 'lost-job'}))
            instance = runtime.Runtime(c)
            self.assertTrue(instance.orchestration_paused)


    def test_owned_child_boundary_is_exclusive_and_stops_process_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c.update(INFERENCE_COMMAND=['/bin/sleep', '60'], COMFY_GPU_COMMAND=['/bin/sleep', '60'])
            instance = runtime.Runtime(c)
            cancel = threading.Event()
            job = {'id': 'controlled', 'kind': 'inference', 'lease': {'token': 't' * 40}}
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True):
                instance.orchestration_begin(job, cancel)
                instance.orchestration_start_child('inference', cancel)
                pid = instance.inference.pid
                with self.assertRaisesRegex(ValueError, 'overlap'):
                    instance.orchestration_start_child('comfy_gpu', cancel)
                instance.orchestration_end()
                self.assertTrue(instance.orchestration_quiescent())
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
                self.assertFalse((Path(tmp) / 'state/orchestration-active.json').exists())

    def test_foreign_process_port_is_never_taken_over(self):
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(self.config(Path(tmp)))
            with patch.object(instance, 'port_occupied', return_value=True), patch.object(instance, 'terminate') as terminate:
                with self.assertRaises(LeaseLost):
                    instance.orchestration_begin({'id': 'foreign', 'kind': 'video'}, threading.Event())
                terminate.assert_not_called()

    def test_gateway_requires_current_inference_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(self.config(Path(tmp)))
            instance.backend_ready = True
            handler = object.__new__(runtime.Handler)
            handler.server = SimpleNamespace(runtime=instance)
            handler.command, handler.path = 'GET', '/v1/models'
            handler.headers = {'Authorization': 'Bearer ' + instance.c['GPU_API_KEY']}
            with patch.object(handler, 'reply') as reply:
                handler.handle_request()
                reply.assert_called_once_with(503, {'error': 'orchestration_lease_required'})
            instance.orchestration_job = {'kind': 'video', 'lease': {'token': 't' * 40}}
            handler.headers['X-BrainSNN-Orchestration-Token'] = 't' * 40
            with patch.object(handler, 'reply') as reply:
                handler.handle_request()
                reply.assert_called_once_with(503, {'error': 'orchestration_lease_required'})

    def test_heartbeat_rejection_quiesces_real_owned_child_before_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = ['/bin/sleep', '60']
            instance = runtime.Runtime(c)
            worker = OrchestrationWorker(instance)
            calls = []
            class Scheduler:
                def request(self, method, path, value=None, **kwargs):
                    calls.append((path, value))
                    if path.endswith('/heartbeat'):
                        raise LeaseLost('controlled revocation')
                    return {}
            worker.client = Scheduler()
            def render(job, cancel, publish):
                instance.orchestration_start_child('inference', cancel)
                self.assertTrue(cancel.wait(3), 'heartbeat must cancel owned work promptly')
                raise LeaseLost('cancelled')
            worker.comfy.run = render
            job = {'id': 'controlled', 'kind': 'video', 'payload': {},
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 0.6) * 1000}}
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True):
                worker.execute(job)
                failures = [body for path, body in calls if path.endswith('/fail')]
                self.assertEqual(len(failures), 1)
                self.assertTrue(failures[0]['quiescent'])
                self.assertEqual(failures[0]['category'], 'transport')
                self.assertFalse(any(path.endswith('/complete') for path, body in calls))
                self.assertTrue(instance.orchestration_quiescent())

    def workflow(self, root):
        info = {}
        for stage in ('generate', 'decode'):
            path = root / (stage + '.json')
            data = json.dumps({'1': {'class_type': 'ControlledFixtureOnly', 'inputs': {'text': '', 'filename': ''}}}).encode()
            path.write_bytes(data)
            info[stage] = {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(),
                           'outputNode': '1', 'outputKey': 'files', 'mediaType': 'video/mp4',
                           'bindings': {'prompt': ['1', 'text'], 'input': ['1', 'filename']}}
        info['inputDirectory'] = str(root)
        manifest = root / 'manifest.json'
        manifest.write_text(json.dumps({'workflows': {'controlled': info}}))
        return manifest, info

    def test_decode_resumes_verified_generation_checkpoint_without_regeneration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            c = self.config(root)
            manifest, info = self.workflow(root)
            c['COMFY_WORKFLOW_MANIFEST'] = str(manifest)
            instance = runtime.Runtime(c)
            artifacts = ArtifactStore(root / 'artifacts')
            adapter = ComfyAdapter(instance, artifacts)
            generated = artifacts.put(b'controlled latent', 'application/octet-stream')
            rendered = artifacts.put(b'controlled video', 'video/mp4')
            job = {'payload': {'workflowId': 'controlled'}, 'checkpoint': {
                'workflowHashes': {key: info[key]['sha256'] for key in ('generate', 'decode')}, 'generated': generated}}
            with patch.object(adapter, 'stage', return_value=rendered) as stage:
                output = adapter.run(job, threading.Event(), lambda *args: None)
                self.assertEqual(stage.call_count, 1)
                self.assertEqual(stage.call_args.args[0], 'decode')
                self.assertFalse(output['result']['visuallyApproved'])
                self.assertFalse(output['result']['sale'])
                self.assertEqual(output['artifacts'], [generated, rendered])
            (root / 'generate.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                adapter.run(job, threading.Event(), lambda *args: None)

    def test_actual_comfy_adapter_protocol_with_controlled_transport(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            c = self.config(root)
            manifest, info = self.workflow(root)
            c.update(COMFY_WORKFLOW_MANIFEST=str(manifest), COMFY_GPU_COMMAND=['/bin/sleep', '60'],
                     COMFY_CPU_COMMAND=['/bin/sleep', '60'])
            instance = runtime.Runtime(c)
            adapter = ComfyAdapter(instance, ArtifactStore(root / 'artifacts'))
            protocol = []
            def request(client, method, path, value=None, **kwargs):
                protocol.append((method, path, value))
                if path == '/system_stats':
                    return {'controlled': True}
                if path == '/prompt':
                    return {'prompt_id': 'controlled-prompt'}
                if path == '/history/controlled-prompt':
                    return {'controlled-prompt': {'status': {'completed': True}, 'outputs': {'1': {'files': [{'filename': 'controlled.bin', 'subfolder': '', 'type': 'output'}]}}}}
                raise AssertionError(path)
            class View:
                status = 200
                def __init__(self, *args, **kwargs): pass
                def connect(self): pass
                def request(self, method, path):
                    self.path = path
                    if not path.startswith('/view?filename=controlled.bin'):
                        raise AssertionError(path)
                def getresponse(self): return self
                def read(self, limit): return b'controlled renderer output, no real render'
                def close(self): pass
            published = []
            job = {'id': 'comfy-protocol', 'kind': 'video', 'payload': {'workflowId': 'controlled', 'prompt': 'example'},
                   'lease': {'token': 't' * 40}}
            cancel = threading.Event()
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch('orchestration_worker.JsonClient.request', new=request), patch('orchestration_worker.http.client.HTTPConnection', new=View):
                instance.orchestration_begin(job, cancel)
                output = adapter.run(job, cancel, lambda stage, value: published.append((stage, value)))
                instance.orchestration_end()
                self.assertTrue(instance.orchestration_quiescent())
                self.assertEqual(len(output['artifacts']), 2)
                self.assertEqual([path for method, path, value in protocol].count('/prompt'), 2)
                self.assertEqual([stage for stage, value in published], ['generating', 'decoding', 'decoding', 'decoding'])
                prompts = [value['prompt']['1']['inputs'] for method, path, value in protocol if path == '/prompt']
                self.assertEqual(prompts[0]['text'], 'example')
                self.assertTrue(prompts[1]['filename'].endswith('.latent'))


    def test_owned_child_hardware_log_latches_pause_and_cancels_without_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = [sys.executable, '-c', 'import time; print("CUDA error: device lost", flush=True); time.sleep(60)']
            instance = runtime.Runtime(c)
            cancel = threading.Event()
            job = {'id': 'hardware-log', 'kind': 'inference', 'lease': {'token': 't' * 40}}
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True):
                instance.orchestration_begin(job, cancel)
                try:
                    instance.orchestration_start_child('inference', cancel)
                except LeaseLost:
                    pass
                self.assertTrue(cancel.wait(3))
                deadline = time.monotonic() + 3
                while instance.orchestration_children and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(instance.orchestration_paused)
                self.assertFalse(instance.orchestration_children)
                with patch.object(instance, 'launch') as launch:
                    instance.tick()
                    launch.assert_not_called()
                instance.orchestration_end()
                self.assertTrue(runtime.Runtime(c).orchestration_paused)


    def test_hybrid_job_checkpoints_json_before_executor_and_keeps_artifact_provenance(self):
        from test_swarms_worker import HANDOFF, ENGINE
        from test_crew_worker import PAYLOAD, DRAFT
        from crew_worker import validate_draft
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            c = self.config(root)
            c.update(INFERENCE_COMMAND=['/bin/sleep', '60'], SERVED_MODEL_NAME='controlled-test-model')
            instance = runtime.Runtime(c)
            worker = OrchestrationWorker(instance)
            sent = []
            def request(method, path, value=None, **kwargs):
                sent.append((path, value))
                return {}
            def crew(packet, config, cancel, handoff):
                checkpoints = [value for path, value in sent if path.endswith('/checkpoint')]
                self.assertEqual(len(checkpoints), 1)
                self.assertEqual(checkpoints[0]['checkpoint']['handoff'], handoff)
                self.assertEqual(handoff, HANDOFF)
                return validate_draft(DRAFT, packet)
            job = {'id': 'hybrid-test', 'kind': 'research', 'payload': PAYLOAD | {'engine': ENGINE},
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 20) * 1000}}
            try:
                with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True), patch.object(worker.client, 'request', side_effect=request), patch('swarms_worker.run_swarms', return_value=HANDOFF), patch('swarms_worker.run_research', side_effect=crew):
                    worker.execute(job)
                completion = [value for path, value in sent if path.endswith('/complete')]
                self.assertEqual(len(completion), 1, sent)
                self.assertEqual(completion[0]['result']['engine'], ENGINE)
                self.assertEqual(len(completion[0]['artifacts']), 2)
                artifact = completion[0]['artifacts'][0]
                self.assertEqual(json.loads(worker.artifacts.read(artifact)), HANDOFF)
                self.assertFalse(completion[0]['result']['external_execution_enabled'])
            finally:
                instance.orchestration_end()

    def test_successful_inference_retains_owned_model_then_video_drains_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = ['/bin/sleep', '60']
            instance = runtime.Runtime(c)
            cancel = threading.Event()
            job = {'id': 'warm-one', 'kind': 'inference', 'lease': {'token': 't' * 40}}
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True):
                instance.orchestration_begin(job, cancel)
                instance.orchestration_start_child('inference', cancel)
                original_pid = instance.inference.pid
                instance.orchestration_end(keep_inference=True)
                self.assertFalse(instance.orchestration_quiescent())
                self.assertTrue(instance.orchestration_quiescent(allow_warm=True))
                self.assertTrue((Path(tmp) / 'state/orchestration-active.json').exists())
                self.assertTrue(runtime.Runtime(c).orchestration_paused, 'restart must not forget a resident orphan')
                instance.orchestration_begin(dict(job, id='warm-two'), cancel)
                instance.orchestration_start_child('inference', cancel)
                self.assertEqual(instance.inference.pid, original_pid)
                instance.orchestration_end(keep_inference=True)
                instance.orchestration_begin(dict(job, id='video', kind='video'), cancel)
                self.assertIsNone(instance.inference)
                with self.assertRaises(ProcessLookupError):
                    os.kill(original_pid, 0)
                instance.orchestration_end()

    def test_warm_resident_expires_and_next_reconcile_requires_actual_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c.update(INFERENCE_COMMAND=['/bin/sleep', '60'], ORCHESTRATION_WARM_IDLE_SECONDS='0.01')
            instance = runtime.Runtime(c)
            instance.orchestration_worker = SimpleNamespace(reconciled=True)
            cancel = threading.Event()
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True):
                instance.orchestration_begin({'id': 'expiring', 'kind': 'inference', 'lease': {'token': 't' * 40}}, cancel)
                instance.orchestration_start_child('inference', cancel)
                instance.orchestration_end(keep_inference=True)
                time.sleep(0.02)
                instance.tick()
                self.assertTrue(instance.orchestration_quiescent())
                self.assertFalse(instance.orchestration_worker.reconciled)
                self.assertFalse((Path(tmp) / 'state/orchestration-active.json').exists())


    def test_hardware_classifier_ignores_healthy_startup_banners(self):
        for message in ('Using CUDA device: NVIDIA RTX4090', 'Initialized NVML',
                        'CUDA device count: 1', 'NVML driver version 535.183.01', 'oxidation shader initialized'):
            with self.subTest(message=message):
                self.assertFalse(hardware_error(message))
        for message in ('NVML device lost', 'Failed to initialize NVML: Unknown Error',
                        'CUDA error: device lost', 'device-side assert triggered',
                        'NVRM: Xid (PCI:0000:01:00): 79, GPU has fallen off the bus', 'Xid79'):
            with self.subTest(message=message):
                self.assertTrue(hardware_error(message))

    def test_idle_hardware_latch_is_reported_without_active_lease(self):
        with tempfile.TemporaryDirectory() as tmp:
            instance = runtime.Runtime(self.config(Path(tmp)))
            worker = OrchestrationWorker(instance)
            instance.orchestration_hardware_fault('NVML device lost')
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch.object(worker.client, 'request', return_value={}) as request:
                worker.once()
                worker.once()
                self.assertEqual(request.call_count, 1)
                self.assertEqual(request.call_args.args[1], '/fault')
                self.assertTrue(request.call_args.args[2]['quiescent'])


    def test_clearance_refuses_held_runtime_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.config(root)
            (root / 'state').mkdir()
            with (root / 'state/runtime.lock').open('a') as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(sys, 'argv', ['runtime.py', '--config', str(root / 'runtime.env'), 'clear-orchestration-pause']):
                    with self.assertRaisesRegex(ValueError, 'Runtime lock held'):
                        runtime.main()


    def test_json_transport_absolute_deadline_stops_controlled_trickle(self):
        closed = threading.Event()
        class Trickle:
            status = 200
            def __init__(self, *args, **kwargs): self.sock = self
            def connect(self): pass
            def request(self, *args, **kwargs): pass
            def getresponse(self): return self
            def read(self, count):
                if not closed.wait(1):
                    raise AssertionError('Absolute deadline failed to interrupt response')
                return b'{}'
            def shutdown(self, how): closed.set()
            def close(self): pass
        with patch('orchestration_worker.http.client.HTTPSConnection', new=Trickle):
            start = time.monotonic()
            with self.assertRaises(TransportFault):
                JsonClient('https://example.invalid').request('GET', '/controlled-trickle', timeout=0.05)
            self.assertLess(time.monotonic() - start, 0.5)
            self.assertTrue(closed.is_set())


    def test_local_lease_timer_stops_owned_work_when_heartbeat_resolver_stalls(self):
        with tempfile.TemporaryDirectory() as tmp:
            c = self.config(Path(tmp))
            c['INFERENCE_COMMAND'] = ['/bin/sleep', '60']
            instance = runtime.Runtime(c)
            worker = OrchestrationWorker(instance)
            calls = []
            class StalledHeartbeat:
                def request(self, method, path, value=None, **kwargs):
                    if path.endswith('/heartbeat'):
                        time.sleep(0.7)  # Controlled stand-in for uninterruptible DNS.
                        return {'lease': {'expiresAt': (time.time() + 30) * 1000}}
                    calls.append((path, value))
                    return {}
            worker.client = StalledHeartbeat()
            def render(job, cancel, publish):
                instance.orchestration_start_child('inference', cancel)
                start = time.monotonic()
                self.assertTrue(cancel.wait(0.5), 'Local lease expiry must not wait for heartbeat I/O')
                self.assertLess(time.monotonic() - start, 0.5)
                raise LeaseLost('expired')
            worker.comfy.run = render
            job = {'id': 'stalled-heartbeat', 'kind': 'video', 'payload': {},
                   'lease': {'token': 't' * 40, 'expiresAt': (time.time() + 0.2) * 1000}}
            with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': []}), patch.object(instance, 'health', return_value=True):
                worker.execute(job)
                self.assertTrue(instance.orchestration_quiescent())
                failures = [body for path, body in calls if path.endswith('/fail')]
                self.assertEqual(len(failures), 1)
                self.assertTrue(failures[0]['quiescent'])


if __name__ == '__main__':
    unittest.main()
