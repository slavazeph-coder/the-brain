"""CONTROLLED LOCAL ADAPTERS, not real model, ComfyUI, GPU or production proof.

Actual runtime/worker, child process groups, pinned workflow parsing, checkpoint
files and immutable artifacts execute. Network protocols are replaced in memory
and scheduler requests cross the real subprocess boundary using stdio.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys
import threading
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runtime
import orchestration_worker as ow


def emit(value):
    print(json.dumps(value), flush=True)


class SchedulerIPC:
    def __init__(self):
        self.lock = threading.Lock()

    def request(self, method, path, value=None, **_):
        with self.lock:
            emit({'request': {'method': method, 'path': path, 'body': value}})
            reply = json.loads(sys.stdin.readline())
        if reply['status'] in (401, 403, 409, 410):
            raise ow.LeaseLost('controlled IPC lease rejected')
        if reply['status'] != 200:
            raise ow.TransportFault('controlled IPC request failed')
        return reply['body']


root = Path(sys.argv[1])
raw = (Path(runtime.__file__).parent / 'runtime.env.example').read_text().replace('__RUNTIME_DIR__', str(root))
for key in ['a' * 40, 'b' * 40, 'c' * 40]:
    raw = raw.replace('GENERATE_ON_INSTALL', key, 1)
config_file = root / 'runtime.env'
config_file.write_text(raw)
config_file.chmod(0o600)
c = runtime.read_config(config_file)
c.update(ORCHESTRATION_ENABLED='1', ORCHESTRATION_URL='https://controlled.invalid/api/orchestration-worker',
         ORCHESTRATION_WORKER_KEY='w' * 40, ORCHESTRATION_WORKER_ID='controlled_slice',
         COMFY_GPU_COMMAND=['/bin/sleep', '60'], COMFY_CPU_COMMAND=['/bin/sleep', '60'],
         INFERENCE_COMMAND=['/bin/sleep', '60'], STARTUP_GRACE_SECONDS='2', MIN_DISK_FREE_MB='1',
         COMFY_STAGE_TIMEOUT_SECONDS='3', COMFY_GPU_PORT='8190', COMFY_CPU_PORT='8189')
input_dir = root / 'comfy-input'
input_dir.mkdir()
spec = {'inputDirectory': str(input_dir)}
for stage in ('generate', 'decode'):
    graph = {'1': {'class_type': 'ControlledFixture', 'inputs': {'text': '', 'input': ''}}}
    path = root / (stage + '.json')
    path.write_text(json.dumps(graph))
    spec[stage] = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                   'outputNode': '1', 'outputKey': 'images',
                   'mediaType': 'application/octet-stream' if stage == 'generate' else 'image/png',
                   'bindings': {'prompt': ['1', 'text'], 'input': ['1', 'input']}}
manifest = root / 'workflows.json'
manifest.write_text(json.dumps({'workflows': {'controlled-local': spec}}))
c['COMFY_WORKFLOW_MANIFEST'] = str(manifest)

png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
counts = {'generate': 0, 'decode': 0}


class ControlledClient:
    def __init__(self, base, *_, **__):
        self.base = ow.endpoint(base, allow_local_http=True)

    def request(self, method, path, value=None, **_):
        port = self.base.port
        if path == '/system_stats':
            return {'controlledAdapter': True}
        if path == '/models':
            return {'object': 'list', 'data': [{'id': c['SERVED_MODEL_NAME']}]}
        stage = 'generate' if port == 8190 else 'decode'
        if path == '/prompt':
            counts[stage] += 1
            if stage == 'decode' and counts[stage] == 1:
                raise ow.TransportFault('controlled one-time decoder transport loss')
            return {'prompt_id': stage + '-fixture'}
        if path.startswith('/history/'):
            return {path.split('/')[-1]: {'status': {'completed': True, 'status_str': 'success'},
                    'outputs': {'1': {'images': [{'filename': stage + '.bin', 'subfolder': '', 'type': 'output'}]}}}}
        raise AssertionError('Unexpected controlled protocol operation: ' + path)


class ControlledDownload:
    def __init__(self, host, port, **_):
        assert host == '127.0.0.1'
        self.data = b'controlled-latent-no-gpu' if port == 8190 else png
        self.status = 200

    def connect(self):
        pass

    def request(self, method, path):
        assert method == 'GET' and path.startswith('/view?')

    def getresponse(self):
        return self

    def read(self, limit):
        return self.data[:limit]

    def close(self):
        pass


instance = runtime.Runtime(c)
worker = ow.OrchestrationWorker(instance)
worker.client = SchedulerIPC()
launch = instance.launch
stop_child = instance.orchestration_stop_child


def observed_launch(kind, command):
    child = launch(kind, command)
    emit({'event': 'child_started', 'kind': kind, 'pid': child.pid})
    return child


def observed_stop(kind):
    child = instance.orchestration_children.get(kind)
    stop_child(kind)
    if child:
        emit({'event': 'child_stopped', 'kind': kind, 'pid': child.pid, 'returncode': child.poll()})


try:
    with patch.object(instance, 'orchestration_ownership_verified', return_value=True), patch.object(instance, 'port_occupied', return_value=False), \
         patch.object(instance, 'health', return_value=True), \
         patch.object(instance, 'launch', side_effect=observed_launch), \
         patch.object(instance, 'orchestration_stop_child', side_effect=observed_stop), \
         patch('runtime.gpu_snapshot', return_value={'available': True, 'devices': [{'controlled': True}]}), \
         patch('orchestration_worker.JsonClient', ControlledClient), \
         patch('orchestration_worker.http.client.HTTPConnection', ControlledDownload):
        for _ in range(4):
            worker.once()
        # Explicit fixture teardown drains a healthy model retained for reuse.
        instance.orchestration_end()
        worker.client.request('POST', '/reconcile', {'quiescent': True, 'reason': 'Controlled fixture drained all owned children'})
        assert instance.orchestration_quiescent()
        emit({'event': 'fixture_complete', 'counts': counts,
              'artifacts': [p.name for p in worker.artifacts.root.iterdir()],
              'quiescent': True, 'controlledAdapters': True})
finally:
    instance.orchestration_end()
