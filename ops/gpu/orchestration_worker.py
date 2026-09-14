"""Outbound leased work, owned GPU arbitration and pinned loopback ComfyUI adapter.

Only Runtime starts this worker (a thread, never a second watchdog). Job data
cannot select commands, endpoints, workflow code or enable external execution.
"""
from contextlib import contextmanager
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import socket
import tempfile
import threading
import time
from urllib.parse import urlencode, urlsplit

from checkpoint import load_json, save_json
from crew_worker import ResearchError


class LeaseLost(RuntimeError):
    pass


class HardwareFault(RuntimeError):
    pass


class TransportFault(RuntimeError):
    pass


HARDWARE_PATTERNS = tuple(re.compile(pattern, re.IGNORECASE) for pattern in (
    r'\bnvml\b[^\n]{0,160}\b(?:error|failed|failure|lost|unavailable|uninitialized)\b',
    r'\b(?:failed|failure|error|lost)\b[^\n]{0,80}\bnvml\b',
    r'\bcuda\s+(?:error|failure)\b',
    r'\bcuda\s+device\s+(?:lost|unavailable)\b',
    r'\bdevice-side assert\b',
    r'\bxid\s*(?:\([^)]*\)\s*)?[:=]?\s*\d+\b',
    r'\bfallen off the bus\b',
    r'\bgpu (?:has been |is )?lost\b',
    r'\bdriver shutting down\b',
))


def hardware_error(value):
    # Healthy banners such as "Initialized NVML" and "Using CUDA device" are
    # capability reports, not failures. Only explicit failure signatures latch.
    return any(pattern.search(str(value)) for pattern in HARDWARE_PATTERNS)


def endpoint(value, *, allow_local_http=False):
    parsed = urlsplit(value)
    loopback = parsed.hostname in ('127.0.0.1', '::1')
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ValueError('Invalid orchestration endpoint')
    if parsed.scheme != 'https' and not (allow_local_http and loopback and parsed.scheme == 'http'):
        raise ValueError('HTTPS required (HTTP only with explicit controlled loopback allowance)')
    return parsed


def validate_config(c):
    if c.get('ORCHESTRATION_ENABLED', '0') != '1':
        return
    if c.get('BRIDGE_COMMAND') or c.get('BACKGROUND_COMMAND'):
        raise ValueError('Orchestration cannot coexist with legacy bridge/background commands')
    key = c.get('ORCHESTRATION_WORKER_KEY', '')
    if len(key) < 32 or key in [c.get(k) for k in ('GPU_API_KEY', 'BACKEND_API_KEY', 'BACKGROUND_API_KEY', 'GPU_BRIDGE_WORKER_KEY')]:
        raise ValueError('Orchestration requires a separate worker credential of at least 32 characters')
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', c.get('ORCHESTRATION_WORKER_ID', '')):
        raise ValueError('Set a stable orchestration worker identity')
    parsed = endpoint(c.get('ORCHESTRATION_URL', ''), allow_local_http=c.get('ORCHESTRATION_ALLOW_LOOPBACK_HTTP') == '1')
    if parsed.path.rstrip('/') != '/api/orchestration-worker':
        raise ValueError('Use the canonical /api/orchestration-worker endpoint')
    for name in ('COMFY_GPU_COMMAND', 'COMFY_CPU_COMMAND'):
        command = c.get(name, [])
        if isinstance(command, str):
            command = json.loads(command)
        if not isinstance(command, list) or any(not isinstance(v, str) or not v for v in command):
            raise ValueError(f'{name} must be a JSON argv array')
        if command and not Path(command[0]).is_absolute():
            raise ValueError(f'{name} executable must be absolute')
        c[name] = command
    for name, default, upper in [('ORCHESTRATION_WARM_IDLE_SECONDS', '300', 3600),
                                 ('ORCHESTRATION_WARM_HEALTH_SECONDS', '30', 300),
                                 ('COMFY_STAGE_TIMEOUT_SECONDS', '3600', 7200),
                                 ('COMFY_MAX_ARTIFACT_BYTES', str(256 * 1024**2), 1024**3)]:
        value = float(c.get(name, default))
        if not math.isfinite(value) or not 0 < value <= upper:
            raise ValueError(f'{name} is outside its finite budget')
    # Opt-in only. The finite idle budget above stays the default and is still
    # validated, so an unset or malformed flag keeps the existing expiry.
    if c.get('ORCHESTRATION_WARM_PERSISTENT', '0') not in ('0', '1'):
        raise ValueError('ORCHESTRATION_WARM_PERSISTENT must be 0 or 1')
    if c.get('ORCHESTRATION_WARM_PERSISTENT') == '1' and (
            c.get('GPU_OWNERSHIP_SCOPE') != 'exclusive-container' or not c.get('GPU_OWNERSHIP_UUID') or
            len(c.get('GPU_OWNERSHIP_BASIS', '').strip()) < 20):
        raise ValueError('Persistent warm idle holds device memory indefinitely and requires the '
                         'exclusive-container ownership attestation')
    ports = [int(c[k]) for k in ('GATEWAY_PORT', 'BACKEND_PORT')]
    for name, default in [('COMFY_GPU_PORT', '8190'), ('COMFY_CPU_PORT', '8189')]:
        number = int(c.get(name, default))
        if not 1024 <= number <= 65535:
            raise ValueError(f'{name} invalid port')
        ports.append(number)
    if len(set(ports)) != len(ports):
        raise ValueError('Gateway, inference and Comfy endpoints must be distinct')


@contextmanager
def connection_deadline(connection, seconds):
    """Bound connect/read lifetime, including a peer that continuously trickles.

    OS DNS resolution itself is not interruptible by stdlib socket shutdown;
    the separate local lease-expiry timer still stops owned GPU children.
    """
    expired, connected = threading.Event(), [None]
    def cancel():
        expired.set()
        sock = connected[0] or getattr(connection, 'sock', None)
        if sock:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
    timer = threading.Timer(max(0.001, seconds), cancel)
    timer.daemon = True
    timer.start()
    try:
        connection.connect()
        connected[0] = getattr(connection, 'sock', None)
        if expired.is_set():
            raise TransportFault('Connection deadline expired')
        yield
        if expired.is_set():
            raise TransportFault('Response deadline expired')
    except (OSError, http.client.HTTPException) as error:
        raise TransportFault(type(error).__name__) from error
    finally:
        timer.cancel()
        connection.close()


class JsonClient:
    def __init__(self, base, headers=None, allow_local_http=False):
        self.base = endpoint(base, allow_local_http=allow_local_http)
        self.headers = headers or {}

    def request(self, method, path, value=None, timeout=10, max_bytes=4 * 1024 * 1024):
        cls = http.client.HTTPSConnection if self.base.scheme == 'https' else http.client.HTTPConnection
        conn = cls(self.base.hostname, self.base.port, timeout=timeout)
        try:
            with connection_deadline(conn, timeout):
                body = json.dumps(value, allow_nan=False).encode() if value is not None else None
                conn.request(method, self.base.path.rstrip('/') + path, body,
                             {'Content-Type': 'application/json', **self.headers})
                response = conn.getresponse()
                raw = response.read(max_bytes + 1)
                if len(raw) > max_bytes:
                    raise ValueError('Response exceeds byte budget')
                if response.status in (401, 403, 409, 410):
                    raise LeaseLost('Lease/authentication rejected')
                if response.status != 200:
                    if hardware_error(raw[:4096]):
                        raise HardwareFault('GPU backend hardware fault')
                    if response.status >= 500 or response.status == 429:
                        raise TransportFault('Remote service unavailable')
                    raise ValueError('Remote request rejected')
                decoded = json.loads(raw)
                if not isinstance(decoded, dict):
                    raise ValueError('JSON object response required')
                return decoded
        except (OSError, http.client.HTTPException) as error:
            raise TransportFault(type(error).__name__) from error


class ArtifactStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def put(self, data, media_type):
        digest = hashlib.sha256(data).hexdigest()
        path = self.root / digest
        fd, temporary = tempfile.mkstemp(prefix='.pending-', dir=self.root)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o400)
            try:
                # Atomic no-clobber publish: interrupted writes never create a
                # partial file under an immutable content-addressed name.
                os.link(temporary, path)
            except FileExistsError:
                if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise ValueError('Immutable artifact was modified')
            directory = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            os.unlink(temporary)
        return {'sha256': digest, 'uri': 'sha256:' + digest, 'bytes': len(data), 'mediaType': media_type}

    def read(self, ref):
        digest = ref.get('sha256', '')
        if not re.fullmatch('[a-f0-9]{64}', digest) or ref.get('uri') != 'sha256:' + digest:
            raise ValueError('Invalid artifact reference')
        path = self.root / digest
        if path.is_symlink():
            raise ValueError('Artifact must not be a symlink')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest or len(data) != ref['bytes']:
            raise ValueError('Immutable artifact failed verification')
        return data


class ComfyAdapter:
    """Two-stage API workflows selected from a local SHA256-pinned manifest.

    Manifest: {workflows: {name: {generate: {path,sha256,outputNode,outputKey,
    mediaType,bindings:{prompt:[node,input],seed:[node,input]}}, decode: {same,
    bindings:{input:[node,input]}}, inputDirectory: absolute Comfy input folder}}}.
    Workflow graph/code and all substitutions are operator owned. CPU decode
    receives a verified copy named by the generation artifact digest.
    """
    def __init__(self, runtime, artifacts):
        self.runtime, self.artifacts = runtime, artifacts

    def specification(self, payload):
        if not isinstance(payload, dict) or set(payload) - {'workflowId', 'prompt', 'seed'}:
            raise ValueError('Video accepts only workflowId, prompt and seed')
        if 'prompt' in payload and (not isinstance(payload['prompt'], str) or len(payload['prompt']) > 8000):
            raise ValueError('Invalid bounded prompt')
        if 'seed' in payload and (type(payload['seed']) is not int or not 0 <= payload['seed'] < 2**63):
            raise ValueError('Invalid seed')
        manifest_path = self.runtime.c.get('COMFY_WORKFLOW_MANIFEST', '')
        if not manifest_path or not Path(manifest_path).is_absolute():
            raise ValueError('Operator workflow manifest is required')
        manifest = load_json(manifest_path)
        spec = manifest['workflows'].get(payload.get('workflowId'))
        if not spec:
            raise ValueError('Unknown operator workflow')
        for stage in ('generate', 'decode'):
            info = spec[stage]
            path = Path(info['path'])
            if not path.is_absolute() or not re.fullmatch('[a-f0-9]{64}', info['sha256']):
                raise ValueError('Workflow requires absolute path and SHA256 pin')
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != info['sha256']:
                raise ValueError('Workflow SHA256 mismatch')
            graph = json.loads(data)
            if not isinstance(graph, dict):
                raise ValueError('Expected Comfy API workflow graph')
        return spec

    def stage(self, name, info, values, cancel, checkpoint):
        runtime = self.runtime
        kind = 'comfy_gpu' if name == 'generate' else 'comfy_cpu'
        client = JsonClient(f"http://127.0.0.1:{runtime.c.get('COMFY_GPU_PORT' if name == 'generate' else 'COMFY_CPU_PORT', '8190' if name == 'generate' else '8189')}", allow_local_http=True)
        runtime.orchestration_start_child(kind, cancel)
        try:
            raw = Path(info['path']).read_bytes()
            if hashlib.sha256(raw).hexdigest() != info['sha256']:
                raise ValueError('Workflow changed after validation')
            graph = json.loads(raw)
            for key, value in values.items():
                binding = info.get('bindings', {}).get(key)
                if binding:
                    node, field = binding
                    graph[str(node)]['inputs'][field] = value
            submitted = client.request('POST', '/prompt', {'prompt': graph, 'client_id': runtime.c['ORCHESTRATION_WORKER_ID']})
            prompt_id = submitted.get('prompt_id')
            if not isinstance(prompt_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', prompt_id):
                raise ValueError('Comfy did not accept prompt')
            checkpoint({'phase': name, 'promptId': prompt_id})
            deadline = time.monotonic() + min(7200, max(1, float(runtime.c.get('COMFY_STAGE_TIMEOUT_SECONDS', '3600'))))
            while time.monotonic() < deadline:
                if cancel.wait(0.25):
                    raise LeaseLost('Stage cancelled')
                history = client.request('GET', '/history/' + prompt_id)
                result = history.get(prompt_id)
                if not result:
                    continue
                status = result.get('status', {})
                if status.get('status_str') == 'error':
                    if hardware_error(status):
                        raise HardwareFault('Comfy GPU hardware fault')
                    raise ValueError('Comfy execution failed')
                outputs = result.get('outputs', {}).get(str(info['outputNode']), {}).get(info['outputKey'], [])
                if not outputs:
                    if status.get('completed'):
                        raise ValueError('Workflow completed without expected artifact')
                    continue
                output = outputs[0]
                if not isinstance(output, dict) or not isinstance(output.get('filename'), str):
                    raise ValueError('Invalid Comfy artifact result')
                query = urlencode({key: output.get(key, '') for key in ('filename', 'subfolder', 'type')})
                budget = max(0.001, min(30, deadline - time.monotonic()))
                conn = http.client.HTTPConnection(client.base.hostname, client.base.port, timeout=budget)
                with connection_deadline(conn, budget):
                    conn.request('GET', '/view?' + query)
                    response = conn.getresponse()
                    limit = min(1024**3, int(runtime.c.get('COMFY_MAX_ARTIFACT_BYTES', str(256 * 1024**2))))
                    data = response.read(limit + 1)
                    if response.status != 200 or not data or len(data) > limit:
                        raise ValueError('Comfy artifact missing or exceeds byte budget')
                return self.artifacts.put(data, info['mediaType'])
            raise TransportFault('Comfy stage deadline exceeded')
        finally:
            # Only the Runtime-owned process group is stopped. Never interrupt a
            # pre-existing Comfy server with /interrupt or OS process discovery.
            runtime.orchestration_stop_child(kind)

    def run(self, job, cancel, publish):
        payload = job['payload']
        spec = self.specification(payload)
        checkpoint = dict(job.get('checkpoint') or {})
        # Local fsynced stage state may be newer than the server after an upload
        # acknowledgement was lost. Only matching workflow pins and verified
        # content hashes below can be resumed; stale prompt IDs are never reused.
        if job.get('id'):
            local = load_json(self.runtime.root / 'checkpoints' / ('orchestration-' + job['id'] + '.json'))
            if local and (local.get('generated') or local.get('rendered')):
                checkpoint = local
        identity = {key: spec[key]['sha256'] for key in ('generate', 'decode')}
        if checkpoint and checkpoint.get('workflowHashes') != identity:
            raise ValueError('Checkpoint workflow identity changed')
        checkpoint.update(workflowHashes=identity)
        generated = checkpoint.get('generated')
        if generated:
            self.artifacts.read(generated)
        else:
            def generating(update):
                publish('generating', dict(checkpoint, **update))
            generated = self.stage('generate', spec['generate'], payload, cancel, generating)
            checkpoint.update(generated=generated, phase='decode')
            publish('decoding', checkpoint)
        if checkpoint.get('rendered'):
            self.artifacts.read(checkpoint['rendered'])
            return {'result': {'rendered': True, 'visuallyApproved': False, 'sale': False,
                               'workflowId': payload['workflowId']}, 'artifacts': [generated, checkpoint['rendered']]}
        source = self.artifacts.read(generated)
        folder = Path(spec['inputDirectory'])
        if not folder.is_absolute() or not folder.is_dir():
            raise ValueError('Pinned Comfy inputDirectory missing')
        # Immutable generated bytes copied into the operator-controlled Comfy input tree.
        filename = generated['sha256'] + '.latent'
        input_path = folder / filename
        stage_decode_input(input_path, source)
        def decoding(update):
            publish('decoding', dict(checkpoint, **update))
        rendered = self.stage('decode', spec['decode'], {'input': filename}, cancel, decoding)
        publish('decoding', dict(checkpoint, rendered=rendered, phase='ready-for-review'))
        return {'result': {'rendered': True, 'visuallyApproved': False, 'sale': False,
                           'workflowId': payload['workflowId']}, 'artifacts': [generated, rendered]}


def stage_decode_input(path, source):
    """Publish verified bytes without replacing an independently changed file."""
    def verify():
        if path.is_symlink() or path.read_bytes() != source:
            raise ValueError('Comfy decode input was modified')
    if path.exists() or path.is_symlink():
        verify()
        return
    fd, temporary = tempfile.mkstemp(prefix='.decode-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(source)
            stream.flush()
            os.fsync(stream.fileno())
        if Path(temporary).read_bytes() != source:
            raise ValueError('Comfy decode staging verification failed')
        try:
            os.link(temporary, path)  # Atomic no-clobber publication.
        except FileExistsError:
            verify()
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


class OrchestrationWorker:
    def __init__(self, runtime):
        self.runtime = runtime
        self.c = runtime.c
        validate_config(self.c)
        self.client = JsonClient(self.c['ORCHESTRATION_URL'],
            {'Authorization': 'Bearer ' + self.c['ORCHESTRATION_WORKER_KEY'],
             'X-BrainSNN-Worker': self.c['ORCHESTRATION_WORKER_ID']},
            allow_local_http=self.c.get('ORCHESTRATION_ALLOW_LOOPBACK_HTTP') == '1')
        self.artifacts = ArtifactStore(runtime.root / 'artifacts')
        self.comfy = ComfyAdapter(runtime, self.artifacts)
        self.reconciled = False
        self.pause_reported = False

    def run(self):
        while not self.runtime.stop.is_set():
            try:
                self.once()
            except (TransportFault, LeaseLost, ValueError, KeyError) as error:
                self.runtime.log.warning('orchestration poll failed (%s)', type(error).__name__)
            self.runtime.stop.wait(1)

    def once(self):
        runtime = self.runtime
        if runtime.orchestration_paused:
            if not self.pause_reported:
                self.client.request('POST', '/fault', {'category': 'hardware',
                    'message': 'GPU safety latch requires explicit operator clearance',
                    'quiescent': runtime.orchestration_quiescent()})
                self.pause_reported = True
            return
        if not self.reconciled:
            if not runtime.orchestration_quiescent():
                raise ValueError('Worker must be quiescent before reconciliation')
            self.client.request('POST', '/reconcile', {'quiescent': True, 'reason': 'Owned processes stopped; runtime clean'})
            self.reconciled = True
        response = self.client.request('GET', '/next')
        control = response.get('control', {})
        if any(control.get(k) for k in ('paused', 'kill', 'hardwarePaused', 'gpuQuarantined')):
            if control.get('kill') or control.get('hardwarePaused') or control.get('gpuQuarantined'):
                runtime.orchestration_end()
                self.reconciled = False
            return
        job = response.get('job')
        if job:
            self.execute(job)

    def execute(self, job):
        runtime = self.runtime
        cancel = threading.Event()
        finished = threading.Event()
        completion_lock = threading.Lock()
        token = job['lease']['token']
        base = '/jobs/' + job['id']
        deadline = [job['lease']['expiresAt'] / 1000]
        # A job owns the single GPU for its entire boundary, including startup.
        try:
            runtime.orchestration_begin(job, cancel)
        except (LeaseLost, ValueError):
            self.reconciled = False
            raise
        completed = False
        heartbeat_stop = threading.Event()
        abort_reason = [None]
        retain = job['kind'] in ('inference', 'research', 'research_draft')
        def abort_owned(reason='lease_expired'):
            with completion_lock:
                if finished.is_set():
                    return
                if abort_reason[0] is None:
                    abort_reason[0] = reason
                cancel.set()
                runtime.orchestration_cancel_owned()
        lease_timers = []
        def arm_lease_deadline():
            for previous in lease_timers:
                previous.cancel()
            timer = threading.Timer(max(0.001, deadline[0] - time.time()), abort_owned)
            timer.daemon = True
            lease_timers[:] = [timer]
            timer.start()
        arm_lease_deadline()
        def heartbeat():
            while not heartbeat_stop.wait(min(1, max(0.05, (deadline[0] - time.time()) / 3))):
                try:
                    state = self.client.request('POST', base + '/heartbeat', {'token': token}, timeout=2)
                    if finished.is_set():
                        return
                    control = state.get('control', {})
                    if control.get('kill') or control.get('hardwarePaused') or runtime.stop.is_set():
                        reason = ('heartbeat_kill' if control.get('kill') else
                                  'heartbeat_hardware_paused' if control.get('hardwarePaused') else 'runtime_stopped')
                        abort_owned(reason)
                        return
                    lease = state.get('lease') or (state.get('job') or {}).get('lease')
                    if lease:
                        deadline[0] = lease['expiresAt'] / 1000
                        arm_lease_deadline()
                except (TransportFault, LeaseLost, ValueError, KeyError) as error:
                    # On any uncertainty stop now. The scheduler owns bounded retries.
                    reason = ('heartbeat_lease_lost' if isinstance(error, LeaseLost) else
                              'heartbeat_transport' if isinstance(error, TransportFault) else 'heartbeat_invalid')
                    abort_owned(reason)
                    return
                if time.time() >= deadline[0]:
                    abort_owned()
                    return
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        def publish(stage, checkpoint):
            if cancel.is_set():
                raise LeaseLost('Checkpoint after cancellation forbidden')
            save_json(runtime.root / 'checkpoints' / ('orchestration-' + job['id'] + '.json'), checkpoint)
            self.client.request('POST', base + '/checkpoint', {'token': token, 'stage': stage, 'checkpoint': checkpoint})
        try:
            if job['kind'] == 'video':
                output = self.comfy.run(job, cancel, publish)
            elif job['kind'] == 'inference':
                runtime.orchestration_start_child('inference', cancel)
                payload = job['payload']
                operation = payload.get('operation')
                if operation not in ('models', 'chat/completions'):
                    raise ValueError('Unsupported inference operation')
                client = JsonClient(f"http://127.0.0.1:{runtime.c['GATEWAY_PORT']}/v1", {
                    'Authorization': 'Bearer ' + runtime.c['GPU_API_KEY'], 'X-BrainSNN-Orchestration-Token': token}, allow_local_http=True)
                value = client.request('GET' if operation == 'models' else 'POST', '/' + operation,
                                       payload.get('body') if operation != 'models' else None,
                                       timeout=float(runtime.c['INFERENCE_TIMEOUT_SECONDS']) + 2)
                output = {'result': {'status': 200, 'body': value}, 'artifacts': []}
            elif job['kind'] in ('research', 'research_draft'):
                runtime.orchestration_start_child('inference', cancel)
                from swarms_worker import run_job
                config = {**runtime.c, 'ORCHESTRATION_TOKEN': token}
                handoff_refs = []
                def record_handoff(value):
                    ref = self.artifacts.put(json.dumps(value, allow_nan=False).encode(), 'application/json')
                    handoff_refs.append(ref)
                    publish('generating', {'phase': 'crewai-executor', 'engine': 'swarms-crewai',
                                           'handoff': value, 'handoffArtifact': ref})
                result = run_job(job['payload'], config, cancel_event=cancel, publish_handoff=record_handoff)
                ref = self.artifacts.put(json.dumps(result, allow_nan=False).encode(), 'application/json')
                output = {'result': result, 'artifacts': [*handoff_refs, ref]}
            else:
                raise ValueError('Unsupported work kind')
            heartbeat_stop.set()
            thread.join(timeout=3)
            if thread.is_alive():
                raise LeaseLost('Heartbeat did not stop before completion')
            with completion_lock:
                if cancel.is_set() or runtime.stop.is_set() or time.time() >= deadline[0]:
                    raise LeaseLost('Lease lost before completion')
                finished.set()  # Drained work: serialize timer shutdown with retention.
            for timer in lease_timers:
                timer.cancel()
            runtime.orchestration_end(keep_inference=retain)
            self.client.request('POST', base + '/complete', {'token': token, **output,
                                'quiescent': runtime.orchestration_quiescent(),
                                'idleResident': bool(runtime.inference and not runtime.orchestration_job and runtime.active_foreground == 0)})
            completed = True
        except Exception as error:
            cancel.set()
            runtime.orchestration_end()
            # Only fixed codes/classes cross the worker transport. An exception
            # may carry a secret in .code, its class name, or its rendered text.
            code = ResearchError(error.code).code if isinstance(error, ResearchError) else None
            message = code or next((name for cls, name in (
                (LeaseLost, 'LeaseLost'), (TransportFault, 'TransportFault'),
                (HardwareFault, 'HardwareFault'), (ValueError, 'ValueError'),
                (KeyError, 'KeyError')) if isinstance(error, cls)), 'worker_failed')
            if abort_reason[0] and (code == 'research_cancelled' or isinstance(error, LeaseLost)):
                message = abort_reason[0]
            if runtime.orchestration_paused or isinstance(error, HardwareFault) or hardware_error(error):
                runtime.orchestration_hardware_fault('GPU hardware fault')
                category = 'hardware'
            else:
                category = ('cancelled' if code == 'research_cancelled' else
                            'transport' if isinstance(error, (TransportFault, LeaseLost)) else 'invalid')
            try:
                self.client.request('POST', base + '/fail', {'token': token, 'category': category,
                    'message': message, 'quiescent': runtime.orchestration_quiescent()})
            except (TransportFault, LeaseLost, ValueError):
                self.reconciled = False
        finally:
            finished.set()
            heartbeat_stop.set()
            for timer in lease_timers:
                timer.cancel()
            thread.join(timeout=3)
            runtime.orchestration_end(keep_inference=completed and retain)
            if not completed or (retain and not runtime.inference):
                self.reconciled = False
