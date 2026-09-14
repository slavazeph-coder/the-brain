#!/usr/bin/env python3
"""Container-friendly BrainSNN inference gateway and finite-job supervisor (stdlib)."""
import argparse
import fcntl
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import sys
import threading
import time

from checkpoint import load_json, save_json


def read_config(path):
    path = Path(path).resolve()
    if path.stat().st_mode & 0o077:
        raise ValueError('runtime.env must be owner-only (chmod 600)')
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not key.strip().replace('_', '').isalnum():
            raise ValueError('Invalid runtime.env line')
        result[key.strip()] = value.strip()
    if not Path(result['RUNTIME_DIR']).is_absolute():
        raise ValueError('RUNTIME_DIR must be absolute')
    for key in ('GPU_API_KEY', 'BACKEND_API_KEY', 'BACKGROUND_API_KEY'):
        if len(result.get(key, '')) < 32 or result[key] == 'GENERATE_ON_INSTALL':
            raise ValueError(f'{key} must be a generated secret with at least 32 characters')
    if len({result[k] for k in ('GPU_API_KEY', 'BACKEND_API_KEY', 'BACKGROUND_API_KEY')}) != 3:
        raise ValueError('Use separate gateway, backend and background keys')
    for key in ('INFERENCE_COMMAND', 'BACKGROUND_COMMAND', 'BACKUP_COMMAND', 'BRIDGE_COMMAND'):
        value = json.loads(result.get(key, '[]'))
        if not isinstance(value, list) or any(not isinstance(v, str) or not v for v in value):
            raise ValueError(f'{key} must be a JSON array of nonempty arguments')
        if value and not Path(value[0]).is_absolute():
            raise ValueError(f'{key} executable must use an absolute path')
        result[key] = value
    if result['BRIDGE_COMMAND']:
        from bridge_worker import Worker
        Worker(result)  # Validate endpoints and separate keys without making a connection.
        if result['GPU_BRIDGE_WORKER_KEY'] in (result['BACKEND_API_KEY'], result['BACKGROUND_API_KEY']):
            raise ValueError('Bridge key must differ from every GPU service key')
    for key in ('GATEWAY_PORT', 'BACKEND_PORT'):
        if not 1024 <= int(result[key]) <= 65535:
            raise ValueError(f'{key} must be in 1024..65535')
    if result['GATEWAY_PORT'] == result['BACKEND_PORT']:
        raise ValueError('Gateway and backend ports must differ')
    if result['BACKGROUND_COMMAND'] and not result.get('BACKGROUND_LABEL'):
        raise ValueError('Name the useful workload with BACKGROUND_LABEL')
    for key in ('POLL_SECONDS', 'RESTART_MIN_SECONDS', 'RESTART_MAX_SECONDS', 'INFERENCE_TIMEOUT_SECONDS',
                'STARTUP_GRACE_SECONDS', 'BACKGROUND_CHECKPOINT_GRACE_SECONDS', 'LOG_MAX_BYTES',
                'LOG_BACKUPS', 'INFERENCE_CONCURRENCY', 'MAX_REQUEST_BYTES', 'MAX_RESPONSE_BYTES',
                'MAX_OUTPUT_TOKENS', 'HEALTH_FAILURE_LIMIT', 'BACKUP_INTERVAL_SECONDS', 'BACKUP_TIMEOUT_SECONDS'):
        if not math.isfinite(float(result[key])) or float(result[key]) <= 0:
            raise ValueError(f'{key} must be positive')
    for key in ('MIN_DISK_FREE_MB', 'MAX_CHECKPOINT_MB', 'BACKGROUND_MIN_FREE_MB',
                'BACKGROUND_IDLE_SECONDS', 'BACKGROUND_MAX_START_GPU_PERCENT'):
        if not math.isfinite(float(result[key])) or float(result[key]) < 0:
            raise ValueError(f'{key} must be nonnegative')
    from orchestration_worker import validate_config
    validate_config(result)
    return result


def gpu_snapshot():
    """Read only: never change clocks, persistence, power limits or other users' jobs."""
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=uuid,name,utilization.gpu,memory.used,memory.free,temperature.gpu',
                                 '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3, check=True)
        rows = []
        for line in result.stdout.splitlines():
            uuid, name, utilization, used, free, temperature = [part.strip() for part in line.split(',')]
            rows.append(dict(uuid=uuid, name=name, utilization_percent=float(utilization), memory_used_mb=float(used),
                             memory_free_mb=float(free), temperature_c=float(temperature)))
        return {'available': bool(rows), 'devices': rows}
    except (OSError, subprocess.SubprocessError, ValueError):
        return {'available': False, 'devices': []}


class Redact(logging.Filter):
    def __init__(self, secrets):
        super().__init__()
        self.secrets = secrets

    def filter(self, record):
        message = record.getMessage()
        for secret in self.secrets:
            message = message.replace(secret, '[redacted]')
        record.msg, record.args = message, ()
        return True


class Runtime:
    def __init__(self, config):
        self.c = config
        self.root = Path(config['RUNTIME_DIR']).resolve()
        for name in ('state', 'logs', 'checkpoints', 'cache'):
            (self.root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
        self.log = logging.getLogger(f'brainsnn.{id(self)}')
        self.log.setLevel(logging.INFO)
        handler = RotatingFileHandler(self.root / 'logs/runtime.log', maxBytes=int(config['LOG_MAX_BYTES']),
                                      backupCount=int(config['LOG_BACKUPS']))
        handler.addFilter(Redact([config[k] for k in ('GPU_API_KEY', 'BACKEND_API_KEY', 'BACKGROUND_API_KEY', 'GPU_BRIDGE_WORKER_KEY', 'ORCHESTRATION_WORKER_KEY') if config.get(k)]))
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        self.log.addHandler(handler)
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.inference = self.background = self.backup = None
        self.bridge = None
        self.next_bridge = 0
        self.bridge_backoff = float(config['RESTART_MIN_SECONDS'])
        self.bridge_started = 0
        self.backend_ready = False
        self.backend_was_ready = False
        self.backend_started = 0
        self.restarts = self.failures = 0
        self.next_backend = 0
        self.backoff = float(config['RESTART_MIN_SECONDS'])
        self.background_next = 0
        self.background_done = bool(load_json(self.root / 'state/background-complete.json', False))
        self.background_upstream = None
        self.background_cancel = None
        self.active_foreground = 0
        self.last_foreground = time.monotonic()
        self.completed = self.failed = 0
        self.last_backup = 0
        self.backup_started = 0
        self.backup_last_exit_code = None
        self.gpu = {'available': False, 'devices': []}
        self.storage_ok = True
        self.slots = threading.BoundedSemaphore(int(config['INFERENCE_CONCURRENCY']))
        self.orchestration_enabled = config.get('ORCHESTRATION_ENABLED', '0') == '1'
        self.orchestration_children = {}
        self.orchestration_job = None
        self.orchestration_cancel = None
        self.orchestration_worker = None
        self.orchestration_warm_until = 0
        self.orchestration_warm_persistent = config.get('ORCHESTRATION_WARM_PERSISTENT', '0') == '1'
        self.warm_health_next = 0
        self.warm_health_failures = 0
        self.warm_epoch = 0
        self.orchestration_paused = bool(load_json(self.root / 'state/orchestration-pause.json', False))
        if self.orchestration_enabled and load_json(self.root / 'state/orchestration-active.json', False):
            # Preflight objects have no supervisor ownership. Stay fail-closed in
            # memory, but only run() under the exclusive lock may latch a restart.
            self.orchestration_paused = True

    def orchestration_pause(self, reason):
        """Retain the first durable reason until explicit operator clearance."""
        with self.lock:
            self.orchestration_paused = True
            path = self.root / 'state/orchestration-pause.json'
            if not load_json(path, False):
                save_json(path, {'reason': reason, 'at': time.time()})

    def child_env(self, kind):
        # Deliberately exclude inherited credentials and unrelated application env.
        keep = ('PATH', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'CUDA_VISIBLE_DEVICES', 'HOME', 'TMPDIR')
        env = {key: os.environ[key] for key in keep if key in os.environ}
        env.update(PYTHONUNBUFFERED='1', BRAINSNN_CHECKPOINT_DIR=str(self.root / 'checkpoints'),
                   BRAINSNN_RUNTIME_DIR=str(self.root), HF_HOME=str(self.root / 'cache/huggingface'),
                   XDG_CACHE_HOME=str(self.root / 'cache'), VLLM_NO_USAGE_STATS='1', DO_NOT_TRACK='1')
        if kind == 'inference':
            for key in ('MODEL_PATH', 'MODEL_REVISION', 'VLLM_EXECUTABLE', 'GPU_MEMORY_UTILIZATION', 'MAX_MODEL_LEN',
                        'ALLOW_MODEL_DOWNLOAD', 'SERVED_MODEL_NAME', 'BACKEND_PORT', 'BACKEND_API_KEY'):
                env[key] = self.c[key]
            for key in ('LLAMACPP_EXECUTABLE', 'MODEL_SHA256', 'GPU_LAYERS', 'BACKEND_PARALLEL',
                        'INFERENCE_JSON_SCHEMA_FILE', 'MODEL_MANIFEST', 'CHAT_TEMPLATE_PATH', 'CHAT_TEMPLATE_SHA256',
                        'VLLM_DTYPE', 'VLLM_MAX_NUM_SEQS', 'VLLM_MAX_BATCHED_TOKENS'):
                if self.c.get(key):
                    env[key] = self.c[key]
            if 'VLLM_LD_LIBRARY_PATH' in self.c:
                env['VLLM_LD_LIBRARY_PATH'] = self.c['VLLM_LD_LIBRARY_PATH']
        elif kind == 'background':
            env.update(BRAINSNN_GPU_BASE_URL=f"http://127.0.0.1:{self.c['GATEWAY_PORT']}/v1",
                       BRAINSNN_GPU_API_KEY=self.c['BACKGROUND_API_KEY'], BRAINSNN_GPU_MODEL=self.c['SERVED_MODEL_NAME'],
                       INFERENCE_MODEL=self.c['SERVED_MODEL_NAME'], BRAINSNN_GPU_MODEL_REVISION=self.c['MODEL_REVISION'])
        elif kind == 'bridge':
            for key in ('GPU_BRIDGE_URL', 'GPU_BRIDGE_WORKER_KEY', 'GATEWAY_PORT', 'GPU_API_KEY'):
                env[key] = self.c[key]
        elif kind in ('comfy_gpu', 'comfy_cpu'):
            env['COMFY_PORT'] = self.c.get('COMFY_GPU_PORT' if kind == 'comfy_gpu' else 'COMFY_CPU_PORT',
                                          '8190' if kind == 'comfy_gpu' else '8189')
            if kind == 'comfy_cpu':
                env['CUDA_VISIBLE_DEVICES'] = ''
        return env

    def launch(self, kind, command):
        try:
            process = subprocess.Popen(command, cwd=self.root, env=self.child_env(kind), stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as error:
            self.log.error('%s launch failed (%s)', kind, type(error).__name__)
            return None
        def drain():
            try:
                while True:
                    chunk = process.stdout.readline(4096)
                    if not chunk:
                        break
                    text = chunk.decode('utf8', errors='replace').rstrip()
                    self.log.info('%s: %s', kind, text)
                    if self.orchestration_enabled and kind in ('inference', 'comfy_gpu', 'comfy_cpu'):
                        from orchestration_worker import hardware_error
                        if hardware_error(text):
                            self.orchestration_hardware_fault('Hardware error in owned child log')
            finally:
                process.stdout.close()
        threading.Thread(target=drain, daemon=True).start()
        self.log.info('%s started pid=%d', kind, process.pid)
        return process

    def terminate(self, process, grace):
        if process is None:
            return
        # Signal the whole session, including grandchildren even if leader exited.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=3)

    def preempt_background(self):
        # Caller holds lock. Closing the upstream socket cancels in-flight evaluation.
        if self.background_cancel:
            self.background_cancel()
        if self.background:
            self.log.info('background checkpoint/stop requested for foreground work')
            self.terminate(self.background, float(self.c['BACKGROUND_CHECKPOINT_GRACE_SECONDS']))
            self.background = None
            self.background_next = time.monotonic() + float(self.c['BACKGROUND_IDLE_SECONDS'])

    def health(self):
        connection = http.client.HTTPConnection('127.0.0.1', int(self.c['BACKEND_PORT']), timeout=2)
        probe_socket = None
        expired = threading.Event()
        def cancel_probe():
            expired.set()
            sock = probe_socket or connection.sock
            if sock:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        deadline = threading.Timer(2, cancel_probe)
        deadline.daemon = True
        deadline.start()
        try:
            connection.connect()
            probe_socket = connection.sock
            if expired.is_set():
                return False
            connection.request('GET', '/health', headers={'Authorization': 'Bearer ' + self.c['BACKEND_API_KEY']})
            response = connection.getresponse()
            return response.status == 200 and not expired.is_set()
        except (OSError, http.client.HTTPException):
            return False
        finally:
            deadline.cancel()
            connection.close()

    @staticmethod
    def port_occupied(port):
        with socket.socket() as sock:
            sock.settimeout(0.2)
            return sock.connect_ex(('127.0.0.1', int(port))) == 0

    def orchestration_ownership_verified(self, allowed_groups=()):
        # Container PID visibility is not host exclusivity. Only an explicit
        # operator attestation establishes that outer allocation boundary.
        if (self.c.get('GPU_OWNERSHIP_SCOPE') != 'exclusive-container' or
                len(self.c.get('GPU_OWNERSHIP_BASIS', '').strip()) < 20):
            return False
        snapshot = gpu_snapshot()
        if (not snapshot['available'] or len(snapshot['devices']) != 1 or
                snapshot['devices'][0]['uuid'] != self.c.get('GPU_OWNERSHIP_UUID')):
            return False
        try:
            result = subprocess.run(['nvidia-smi', 'pmon', '-c', '1'],
                                    capture_output=True, text=True, timeout=3, check=True)
            rows = [line.split() for line in result.stdout.splitlines()
                    if line.strip() and not line.lstrip().startswith('#')]
            if not rows:
                return False
            for row in rows:
                if len(row) < 8 or row[0] != '0':
                    return False
                if row[1] == '-':
                    if any(value != '-' for value in row[1:]):
                        return False
                    continue
                if not row[1].isdigit() or os.getpgid(int(row[1])) not in allowed_groups:
                    return False
            return True
        except (OSError, subprocess.SubprocessError, ValueError):
            return False

    def orchestration_quiescent(self, allow_warm=False):
        with self.lock:
            warm = (allow_warm and set(self.orchestration_children) == {'inference'} and
                    self.inference is self.orchestration_children['inference'] and
                    self.inference.poll() is None and self.backend_ready and not self.orchestration_job)
            if (self.orchestration_children or self.inference) and not warm:
                return False
            if self.active_foreground:
                return False
            endpoints = [('COMFY_GPU_PORT', '8190'), ('COMFY_CPU_PORT', '8189')]
            if not warm:
                endpoints.append(('BACKEND_PORT', '8000'))
            return (not any(self.port_occupied(self.c.get(key, default)) for key, default in endpoints)
                    and self.orchestration_ownership_verified([self.inference.pid] if warm else ()))

    def orchestration_begin(self, job, cancel):
        from orchestration_worker import LeaseLost
        with self.lock:
            if self.orchestration_paused or self.orchestration_job:
                raise LeaseLost('GPU paused or already leased')
            # A resident model has no authority to execute a request without the
            # next lease token. Render transitions drain it before acquiring GPU.
            if job.get('kind') == 'video' and self.orchestration_children:
                self.orchestration_stop_child('inference')
            allow_warm = job.get('kind') in ('inference', 'research', 'research_draft')
            if not self.orchestration_quiescent(allow_warm=allow_warm):
                raise LeaseLost('GPU not quiescent; no process takeover permitted')
            if not isinstance(job['id'], str) or not all(ch.isalnum() or ch in '-_' for ch in job['id']):
                raise ValueError('Invalid job identity')
            self.orchestration_job, self.orchestration_cancel = job, cancel
            save_json(self.root / 'state/orchestration-active.json', {'id': job['id'], 'kind': job['kind'], 'at': time.time()})

    def orchestration_hardware_fault(self, reason):
        with self.lock:
            self.orchestration_pause(reason)
            if self.orchestration_cancel:
                self.orchestration_cancel.set()
            self.backend_ready = False
            for kind in list(self.orchestration_children):
                self.orchestration_stop_child(kind)

    def orchestration_start_child(self, kind, cancel):
        from orchestration_worker import HardwareFault, LeaseLost, TransportFault, JsonClient
        with self.lock:
            if self.orchestration_paused or cancel.is_set() or self.stop.is_set():
                raise LeaseLost('Runtime paused or lease cancelled')
            if not self.orchestration_ownership_verified(
                    [p.pid for p in self.orchestration_children.values()]):
                raise LeaseLost('GPU ownership unverified; operator clearance required')
            if (kind == 'inference' and set(self.orchestration_children) == {'inference'} and
                    self.inference is self.orchestration_children['inference'] and
                    self.inference.poll() is None and self.backend_ready):
                return
            if self.orchestration_children:
                raise ValueError('GPU job overlap forbidden')
            key = {'inference': 'INFERENCE_COMMAND', 'comfy_gpu': 'COMFY_GPU_COMMAND', 'comfy_cpu': 'COMFY_CPU_COMMAND'}[kind]
            port = self.c.get({'inference': 'BACKEND_PORT', 'comfy_gpu': 'COMFY_GPU_PORT', 'comfy_cpu': 'COMFY_CPU_PORT'}[kind],
                              '8190' if kind == 'comfy_gpu' else '8189')
            if self.port_occupied(port):
                raise ValueError('Configured port already owned; refusing process takeover')
            self.storage_ok = shutil.disk_usage(self.root).free >= float(self.c['MIN_DISK_FREE_MB']) * 1024**2
            if not self.storage_ok:
                raise ValueError('Insufficient local storage for an owned GPU job')
            command = self.c.get(key)
            if not command:
                raise ValueError('Operator-owned child command is not configured')
            snapshot = gpu_snapshot()
            if not snapshot['available']:
                self.orchestration_hardware_fault('NVML unavailable before owned child launch')
                raise HardwareFault('NVML unavailable')
            if cancel.is_set() or self.stop.is_set() or self.orchestration_paused:
                raise LeaseLost('Lease cancelled during hardware preflight')
            process = self.launch(kind, command)
            if not process:
                raise TransportFault('Owned child launch failed')
            self.orchestration_children[kind] = process
            if kind == 'inference':
                self.inference = process
                self.backend_started = time.monotonic()
        deadline = time.monotonic() + float(self.c['STARTUP_GRACE_SECONDS'])
        client = JsonClient(f'http://127.0.0.1:{port}', allow_local_http=True)
        while time.monotonic() < deadline:
            if cancel.is_set() or self.stop.is_set() or self.orchestration_paused:
                raise LeaseLost('Lease cancelled during child startup')
            if process.poll() is not None:
                raise TransportFault('Owned child exited during startup')
            try:
                healthy = self.health() if kind == 'inference' else isinstance(client.request('GET', '/system_stats', timeout=2), dict)
            except (TransportFault, LeaseLost, ValueError):
                healthy = False
            if healthy:
                if kind == 'inference':
                    self.backend_ready = True
                return
            cancel.wait(0.2)
        raise TransportFault('Owned child startup timed out')

    def orchestration_stop_child(self, kind):
        with self.lock:
            process = self.orchestration_children.get(kind)
            if process:
                try:
                    self.terminate(process, 2)
                except (OSError, subprocess.SubprocessError):
                    self.orchestration_pause('Owned process stop could not be confirmed; manual quiescence required')
                    raise
                stopped = False
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    stopped = True
                except OSError:
                    pass  # Permission/inspection failures are not proof of exit.
                if not stopped:
                    self.orchestration_pause('Owned process group termination unverified')
                    raise RuntimeError('Owned process group termination unverified')
                del self.orchestration_children[kind]
            if kind == 'inference':
                self.inference = None
                self.backend_ready = False

    def orchestration_cancel_owned(self):
        with self.lock:
            if self.orchestration_cancel:
                self.orchestration_cancel.set()
            for kind in list(self.orchestration_children):
                self.orchestration_stop_child(kind)

    def warm_resident(self):
        """Caller holds lock: exactly one retained, healthy, unleased inference child."""
        child = self.orchestration_children.get('inference')
        return (not self.orchestration_job and self.backend_ready and child is not None and
                child is self.inference and child.poll() is None and
                set(self.orchestration_children) == {'inference'})

    def orchestration_end(self, keep_inference=False):
        with self.lock:
            self.warm_epoch += 1
            keep = (keep_inference and not self.stop.is_set() and not self.orchestration_paused and
                    self.inference and self.inference.poll() is None and self.backend_ready and
                    self.active_foreground == 0 and not (self.orchestration_cancel and self.orchestration_cancel.is_set()))
            for kind in list(self.orchestration_children):
                if not (keep and kind == 'inference'):
                    self.orchestration_stop_child(kind)
            # Persistent retention removes only the idle clock. Handoff, cancellation,
            # health/ownership faults, operator stop and shutdown still release below.
            now = time.monotonic()
            if not keep:
                self.orchestration_warm_until = 0
            elif self.orchestration_warm_persistent:
                self.orchestration_warm_until = math.inf
            else:
                self.orchestration_warm_until = now + float(self.c.get('ORCHESTRATION_WARM_IDLE_SECONDS', '300'))
            if keep:
                self.warm_health_next = now + float(self.c.get('ORCHESTRATION_WARM_HEALTH_SECONDS', '30'))
                self.warm_health_failures = 0
            self.orchestration_job = None
            self.orchestration_cancel = None
            if keep:
                save_json(self.root / 'state/orchestration-active.json', {
                    'kind': 'idle_inference', 'pid': self.inference.pid, 'at': time.time()})
            else:
                (self.root / 'state/orchestration-active.json').unlink(missing_ok=True)

    def tick_orchestration(self):
        self.gpu = gpu_snapshot()
        with self.lock:
            probe = self.orchestration_warm_persistent and self.warm_resident() and time.monotonic() >= self.warm_health_next
            probe_child, probe_epoch = self.inference, self.warm_epoch
        # HTTP liveness only, outside the lock; this does not prove generation.
        # Productive jobs retain bounded deadlines and release children on failure.
        # Never submit an unleased keepalive completion here.
        healthy = self.health() if probe else None
        now = time.monotonic()
        with self.lock:
            if (probe and self.warm_resident() and self.inference is probe_child
                    and self.warm_epoch == probe_epoch):
                self.warm_health_next = now + float(self.c.get('ORCHESTRATION_WARM_HEALTH_SECONDS', '30'))
                self.warm_health_failures = 0 if healthy else self.warm_health_failures + 1
                if self.warm_health_failures >= int(self.c['HEALTH_FAILURE_LIMIT']):
                    self.log.warning('retained idle model failed %d health probes; releasing owned child',
                                     self.warm_health_failures)
                    self.orchestration_warm_until = 0
            if self.orchestration_children and (not self.gpu['available'] or
                    not self.orchestration_ownership_verified([p.pid for p in self.orchestration_children.values()])):
                self.orchestration_hardware_fault('GPU ownership or NVML unavailable during active job')
            if self.inference and not self.orchestration_job and (
                    self.inference.poll() is not None or now >= self.orchestration_warm_until):
                self.orchestration_end()
                if self.orchestration_worker:
                    self.orchestration_worker.reconciled = False
            if self.orchestration_cancel and (self.orchestration_cancel.is_set() or self.stop.is_set()):
                for kind in list(self.orchestration_children):
                    self.orchestration_stop_child(kind)
            save_json(self.root / 'state/status.json', self.status())

    def tick(self):
        if self.orchestration_enabled:
            self.tick_backup(time.monotonic())
            return self.tick_orchestration()
        now = time.monotonic()
        self.gpu = gpu_snapshot()
        used = 0
        for path in (self.root / 'checkpoints').rglob('*'):
            try:
                if path.is_file() and not path.is_symlink():
                    used += path.stat().st_size
            except FileNotFoundError:
                pass  # A job atomically replaced/pruned its own checkpoint during the scan.
        self.storage_ok = (shutil.disk_usage(self.root).free >= float(self.c['MIN_DISK_FREE_MB']) * 1024**2
                           and used < float(self.c['MAX_CHECKPOINT_MB']) * 1024**2)
        healthy = self.health() if self.inference and self.inference.poll() is None else False
        with self.lock:
            if self.bridge and self.bridge.poll() is not None:
                self.terminate(self.bridge, 0.1)
                self.bridge = None
                self.next_bridge = now + self.bridge_backoff
                self.bridge_backoff = min(float(self.c['RESTART_MAX_SECONDS']), self.bridge_backoff * 2)
                self.log.warning('bridge worker exited; restart scheduled')
            if self.bridge and now - self.bridge_started > 60:
                self.bridge_backoff = float(self.c['RESTART_MIN_SECONDS'])
            if not self.bridge and self.c.get('BRIDGE_COMMAND') and now >= self.next_bridge:
                self.bridge = self.launch('bridge', self.c['BRIDGE_COMMAND'])
                self.bridge_started = now
                self.next_bridge = now + self.bridge_backoff
                if self.bridge is None:
                    self.bridge_backoff = min(float(self.c['RESTART_MAX_SECONDS']), self.bridge_backoff * 2)
            if self.inference and (self.inference.poll() is not None or (
                    (self.backend_was_ready or now - self.backend_started > float(self.c['STARTUP_GRACE_SECONDS'])) and
                    not healthy and self.failures + 1 >= int(self.c['HEALTH_FAILURE_LIMIT']))):
                self.preempt_background()
                self.terminate(self.inference, 5)
                self.inference = None
                self.backend_ready = False
                self.restarts += 1
                self.next_backend = now + self.backoff
                self.backoff = min(float(self.c['RESTART_MAX_SECONDS']), self.backoff * 2)
                self.log.warning('inference exited/unhealthy; restart scheduled')
            self.backend_ready = healthy and self.inference is not None
            self.backend_was_ready = self.backend_was_ready or self.backend_ready
            self.failures = 0 if healthy else self.failures + 1
            if healthy and now - self.backend_started > 60:
                self.backoff = float(self.c['RESTART_MIN_SECONDS'])
            if not self.inference and self.c['INFERENCE_COMMAND'] and now >= self.next_backend and self.storage_ok:
                self.inference = self.launch('inference', self.c['INFERENCE_COMMAND'])
                self.backend_started = now
                self.backend_was_ready = False
                self.failures = 0
                self.next_backend = now + self.backoff
                if self.inference is None:
                    self.backoff = min(float(self.c['RESTART_MAX_SECONDS']), self.backoff * 2)
            if self.background and self.background.poll() is not None:
                code = self.background.returncode
                self.terminate(self.background, 0.1)
                self.background = None
                self.background_next = now + float(self.c['RESTART_MAX_SECONDS'])
                if code == 0:
                    self.background_done = True
                    save_json(self.root / 'state/background-complete.json', {'completed_at': time.time()})
                self.log.info('background exited code=%d; %s', code, 'queue parked' if code == 0 else 'retry later')
            if not self.storage_ok:
                self.preempt_background()
            required_free = float(self.c['BACKGROUND_MIN_FREE_MB'])
            # API-based evaluation uses no second model: zero free-memory threshold opts into that mode.
            idle_gpu = required_free == 0 or (self.gpu['available'] and len(self.gpu['devices']) == 1 and
                self.gpu['devices'][0]['memory_free_mb'] >= required_free and
                self.gpu['devices'][0]['utilization_percent'] <= float(self.c['BACKGROUND_MAX_START_GPU_PERCENT']))
            if (self.c['BACKGROUND_COMMAND'] and not self.background and not self.background_done and
                    self.backend_ready and self.storage_ok and idle_gpu and self.active_foreground == 0 and
                    now >= self.background_next and now - self.last_foreground >= float(self.c['BACKGROUND_IDLE_SECONDS'])):
                self.background = self.launch('background', self.c['BACKGROUND_COMMAND'])
                self.background_next = now + float(self.c['RESTART_MAX_SECONDS'])
            self.tick_backup(now)
            save_json(self.root / 'state/status.json', self.status())

    def tick_backup(self, now):
        with self.lock:
            if self.backup and self.backup.poll() is not None:
                self.backup_last_exit_code = self.backup.returncode
                self.log.info('backup exited code=%d', self.backup.returncode)
                self.terminate(self.backup, 0.1)
                self.backup = None
            if self.backup and now - self.backup_started > float(self.c['BACKUP_TIMEOUT_SECONDS']):
                self.log.warning('backup timed out')
                self.backup_last_exit_code = 'timeout'
                self.terminate(self.backup, 2)
                self.backup = None
            if self.c['BACKUP_COMMAND'] and not self.backup and now - self.last_backup >= float(self.c['BACKUP_INTERVAL_SECONDS']):
                self.backup = self.launch('backup', self.c['BACKUP_COMMAND'])
                self.last_backup = self.backup_started = now

    def status(self):
        return {'updated_at': time.time(), 'pid': os.getpid(), 'backend_ready': self.backend_ready,
                'inference_configured': bool(self.c['INFERENCE_COMMAND']),
                'inference_pid': self.inference.pid if self.inference else None,
                'backend_restarts': self.restarts, 'foreground_active': self.active_foreground,
                'requests_completed': self.completed, 'requests_failed': self.failed,
                'background_configured': bool(self.c['BACKGROUND_COMMAND']),
                'background_running': bool(self.background), 'background_complete': self.background_done,
                'backup_configured': bool(self.c['BACKUP_COMMAND']), 'backup_running': bool(self.backup),
                'bridge_configured': bool(self.c.get('BRIDGE_COMMAND')),
                'bridge_running': bool(self.bridge and self.bridge.poll() is None),
                'backup_last_exit_code': self.backup_last_exit_code,
                'storage_ok': self.storage_ok, 'gpu': self.gpu,
                'orchestration_enabled': self.orchestration_enabled,
                'orchestration_paused': self.orchestration_paused,
                'orchestration_job': self.orchestration_job['id'] if self.orchestration_job else None,
                'orchestration_warm_persistent': self.orchestration_warm_persistent,
                'orchestration_warm_resident': self.warm_resident(),
                'orchestration_warm_health_failures': self.warm_health_failures,
                # Never serialize an infinite retention budget into JSON.
                'orchestration_warm_idle_remaining': None if self.orchestration_warm_persistent or not self.warm_resident()
                else round(max(0.0, self.orchestration_warm_until - time.monotonic()), 1),
                'orchestration_children': {kind: child.pid for kind, child in self.orchestration_children.items()}}

    def run(self):
        self.phase = 'startup'
        with (self.root / 'state/runtime.lock').open('a') as lockfile:
            try:
                fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('Runtime already running') from None
            prior_active = self.orchestration_enabled and bool(load_json(self.root / 'state/orchestration-active.json', False))
            if prior_active:
                self.orchestration_pause('Unclean restart: verify all prior child processes stopped before explicit clearance')
            # Re-read a hold written after a preflight object was constructed.
            self.orchestration_paused = bool(load_json(self.root / 'state/orchestration-pause.json', False))
            gateway = thread = orchestration_thread = None
            try:
                state = self.status()
                state['stopped'] = False
                save_json(self.root / 'state/status.json', state)
                gateway = Gateway(('127.0.0.1', int(self.c['GATEWAY_PORT'])), Handler)
                gateway.runtime = self
                save_json(self.root / 'state/pid.json', {'pid': os.getpid(), 'script': str(Path(__file__).resolve())})
                for sig in (signal.SIGTERM, signal.SIGINT):
                    signal.signal(sig, lambda *_: self.stop.set())
                candidate = threading.Thread(target=gateway.serve_forever, daemon=True)
                candidate.start()
                thread = candidate
                self.log.info('runtime started; gateway listens only on loopback')
                if self.orchestration_enabled:
                    from orchestration_worker import OrchestrationWorker
                    self.orchestration_worker = OrchestrationWorker(self)
                    candidate = threading.Thread(target=self.orchestration_worker.run, daemon=True)
                    candidate.start()
                    orchestration_thread = candidate
                self.phase = 'running'
                while not self.stop.is_set():
                    self.tick()
                    self.stop.wait(float(self.c['POLL_SECONDS']))
            except BaseException:
                self.failure_phase = self.phase
                raise
            finally:
                self.phase = 'shutdown'
                try:
                    cleanup_errors = []
                    def cleanup(action, *args):
                        try:
                            action(*args)
                        except BaseException as error:
                            cleanup_errors.append(error)
                    self.stop.set()
                    if self.orchestration_cancel:
                        self.orchestration_cancel.set()
                    if gateway:
                        if thread:
                            cleanup(gateway.shutdown)
                        cleanup(gateway.server_close)
                    if orchestration_thread:
                        cleanup(orchestration_thread.join, 15)
                        if orchestration_thread.is_alive():
                            cleanup(self.orchestration_pause, 'Orchestration worker stop unconfirmed; manual quiescence required')
                            cleanup(self.orchestration_cancel_owned)
                            cleanup_errors.append(RuntimeError('Orchestration worker stop unconfirmed'))
                        elif not prior_active:
                            cleanup(self.orchestration_end)
                    with self.lock:
                        cleanup(self.preempt_background)
                        cleanup(self.terminate, self.bridge, 5)
                        self.bridge = None
                        cleanup(self.terminate, self.backup, 2)
                        cleanup(self.terminate, self.inference, 10)
                        self.inference = None
                        self.backend_ready = False
                        if cleanup_errors:
                            # Other owned cleanup is still attempted, but neither
                            # PID metadata nor a success receipt is cleared/written.
                            raise cleanup_errors[0]
                        state = self.status()
                        state['stopped'] = True
                        save_json(self.root / 'state/status.json', state)
                        (self.root / 'state/pid.json').unlink(missing_ok=True)
                    self.log.info('runtime stopped')
                except BaseException:
                    self.failure_phase = 'shutdown'
                    raise


class Gateway(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        self.handler_slots = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.handler_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.handler_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.handler_slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass  # Never log prompts, authorization, request paths or provider responses.

    def reply(self, status, value):
        data = json.dumps(value, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_request(self):
        runtime = self.server.runtime
        authorization = self.headers.get('Authorization', '')
        background = self.headers.get('X-BrainSNN-Background') == '1'
        expected = runtime.c['BACKGROUND_API_KEY' if background else 'GPU_API_KEY']
        if not hmac.compare_digest(authorization.encode(), ('Bearer ' + expected).encode()):
            return self.reply(401, {'error': 'unauthorized'})
        if self.command == 'GET' and self.path == '/health':
            return self.reply(200 if runtime.backend_ready else 503, {'ready': runtime.backend_ready})
        allowed = (self.command == 'GET' and self.path == '/v1/models') or (
            self.command == 'POST' and self.path == '/v1/chat/completions')
        if not allowed:
            return self.reply(404, {'error': 'not_found'})
        body = None
        if self.command == 'POST':
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                return self.reply(400, {'error': 'invalid_length'})
            try:
                size = int(self.headers['Content-Length'])
                if not 0 < size <= int(runtime.c['MAX_REQUEST_BYTES']):
                    return self.reply(413, {'error': 'body_too_large'})
                if self.headers.get_content_type() != 'application/json':
                    return self.reply(415, {'error': 'json_required'})
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict) or body.get('stream') not in (None, False):
                    return self.reply(400, {'error': 'nonstreaming_json_required'})
                if body.get('model') != runtime.c['SERVED_MODEL_NAME']:
                    return self.reply(400, {'error': 'unknown_model'})
                if not isinstance(body.get('messages'), list) or not body['messages']:
                    return self.reply(400, {'error': 'messages_required'})
                tokens = body.get('max_tokens', body.get('max_completion_tokens', 512))
                if isinstance(tokens, bool) or not isinstance(tokens, int) or not 1 <= tokens <= int(runtime.c['MAX_OUTPUT_TOKENS']):
                    return self.reply(400, {'error': 'invalid_token_limit'})
                # Only text chats, no network-fetchable media, plugins, tools or custom vLLM extension fields.
                for message in body['messages']:
                    if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant') or not isinstance(message.get('content'), str):
                        return self.reply(400, {'error': 'text_messages_required'})
                body = {key: body[key] for key in ('model', 'messages', 'temperature', 'top_p', 'response_format', 'seed') if key in body}
                body['max_tokens'] = tokens
                body['stream'] = False
                body = json.dumps(body).encode()
            except (ValueError, OSError):
                return self.reply(400, {'error': 'invalid_json'})
        if runtime.orchestration_enabled:
            job = runtime.orchestration_job
            token = self.headers.get('X-BrainSNN-Orchestration-Token', '')
            if (not job or job['kind'] not in ('inference', 'research', 'research_draft') or not token or
                    not hmac.compare_digest(token.encode(), str(job['lease']['token']).encode()) or
                    runtime.orchestration_paused or not runtime.orchestration_cancel or runtime.orchestration_cancel.is_set()):
                return self.reply(503, {'error': 'orchestration_lease_required'})
        if not runtime.backend_ready or runtime.stop.is_set():
            return self.reply(503, {'error': 'backend_unavailable'})
        foreground = self.command == 'POST' and not background
        counted_foreground = False
        slot = False
        connection = None
        deadline_timer = None
        upstream_socket = None
        canceled = threading.Event()
        try:
            with runtime.lock:
                if runtime.orchestration_enabled and (
                        runtime.orchestration_job is not job or runtime.orchestration_paused or
                        not runtime.orchestration_cancel or runtime.orchestration_cancel.is_set()):
                    return self.reply(503, {'error': 'orchestration_lease_required'})
                if background and (runtime.active_foreground or runtime.background is None):
                    return self.reply(429, {'error': 'foreground_priority'})
                if foreground:
                    runtime.active_foreground += 1
                    counted_foreground = True
                    runtime.last_foreground = time.monotonic()
                    runtime.preempt_background()
            slot = runtime.slots.acquire(blocking=False)
            if not slot:
                return self.reply(429, {'error': 'busy'})
            connection = http.client.HTTPConnection('127.0.0.1', int(runtime.c['BACKEND_PORT']),
                                                     timeout=float(runtime.c['INFERENCE_TIMEOUT_SECONDS']))
            def cancel_upstream():
                canceled.set()
                sock = upstream_socket or connection.sock
                if sock:
                    try:
                        sock.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
            deadline_timer = threading.Timer(float(runtime.c['INFERENCE_TIMEOUT_SECONDS']), cancel_upstream)
            deadline_timer.daemon = True
            deadline_timer.start()
            connection.connect()
            upstream_socket = connection.sock
            if canceled.is_set():
                raise TimeoutError('upstream canceled')
            if background:
                with runtime.lock:
                    if runtime.active_foreground:
                        return self.reply(429, {'error': 'foreground_priority'})
                    runtime.background_upstream = connection
                    runtime.background_cancel = cancel_upstream
            connection.request(self.command, self.path, body=body,
                               headers={'Authorization': 'Bearer ' + runtime.c['BACKEND_API_KEY'], 'Content-Type': 'application/json'})
            response = connection.getresponse()
            data = response.read(int(runtime.c['MAX_RESPONSE_BYTES']) + 1)
            if canceled.is_set():
                raise TimeoutError('upstream canceled')
            if response.status != 200 or len(data) > int(runtime.c['MAX_RESPONSE_BYTES']):
                runtime.failed += 1
                return self.reply(502, {'error': 'backend_error'})
            value = json.loads(data)
            runtime.completed += 1
            return self.reply(200, value)
        except (OSError, http.client.HTTPException, ValueError):
            runtime.failed += 1
            return self.reply(503, {'error': 'backend_unavailable'})
        finally:
            if deadline_timer:
                deadline_timer.cancel()
            if connection:
                connection.close()
            if slot:
                runtime.slots.release()
            with runtime.lock:
                if background and runtime.background_upstream is connection:
                    runtime.background_upstream = None
                    runtime.background_cancel = None
                if counted_foreground:
                    runtime.active_foreground -= 1
                    runtime.last_foreground = time.monotonic()

    do_GET = handle_request
    do_POST = handle_request


def verified_pid(root):
    info = load_json(root / 'state/pid.json')
    if not info:
        return None
    pid = int(info['pid'])
    try:
        if Path(f'/proc/{pid}/cmdline').exists():
            command = Path(f'/proc/{pid}/cmdline').read_bytes().decode().split('\0')
        else:
            command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).split()
        if str(Path(__file__).resolve()) not in command or 'run' not in command:
            return None
        os.kill(pid, 0)
        return pid
    except (OSError, subprocess.SubprocessError):
        return None


def safe_exception_type(error):
    # Never persist arbitrary exception messages, custom class names, traceback
    # locals, paths or configuration. Unknown subclasses use a fixed fallback.
    allowed = (ValueError, KeyError, OSError, RuntimeError, TypeError, AttributeError,
               PermissionError, FileNotFoundError, TimeoutError, KeyboardInterrupt, SystemExit)
    return type(error).__name__ if type(error) in allowed else 'OtherError'


def run_runtime(config):
    """One atomic, owner-only, bounded exit receipt, including startup failures."""
    path = Path(config['RUNTIME_DIR']) / 'state/runtime-exit.json'
    instance = None
    try:
        save_json(path, {'state': 'starting', 'pid': os.getpid(), 'at': time.time()})
        instance = Runtime(config)
        instance.run()
    except BaseException as error:
        phase = getattr(instance, 'failure_phase', getattr(instance, 'phase', 'initialization'))
        save_json(path, {'state': 'exited', 'pid': os.getpid(), 'at': time.time(),
                         'phase': phase, 'exit_code': 1, 'exception_type': safe_exception_type(error)})
        if not isinstance(error, Exception):
            raise RuntimeError('Runtime interrupted; inspect private exit receipt') from None
        raise
    else:
        save_json(path, {'state': 'exited', 'pid': os.getpid(), 'at': time.time(),
                         'phase': 'shutdown', 'exit_code': 0, 'exception_type': None})


def confirm_stopped(root):
    """PID disappearance alone is not evidence of completed owned cleanup."""
    (root / 'state').mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / 'state/runtime.lock').open('a') as lockfile:
        try:
            fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Runtime cleanup unconfirmed: supervisor lock held') from None
        if ((root / 'state/pid.json').exists() or (root / 'state/orchestration-active.json').exists()
                or load_json(root / 'state/status.json', {}).get('stopped') is not True):
            raise ValueError('Runtime cleanup unconfirmed: inspect local state; holds require explicit clearance')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(Path(__file__).resolve().parent / 'runtime.env'))
    parser.add_argument('--startup-diagnostic', help=argparse.SUPPRESS)
    parser.add_argument('action', choices=('run', 'start', 'stop', 'status', 'check', 'resume-background', 'clear-orchestration-pause'))
    args = parser.parse_args()
    os.umask(0o077)
    try:
        config = read_config(args.config)
    except Exception as error:
        # Detached start already validated the root. Record a config read/race
        # failure there even when the child cannot construct a Runtime.
        if args.action == 'run' and args.startup_diagnostic:
            save_json(args.startup_diagnostic, {'state': 'exited', 'pid': os.getpid(), 'at': time.time(),
                      'phase': 'configuration', 'exit_code': 1, 'exception_type': safe_exception_type(error)})
        raise
    root = Path(config['RUNTIME_DIR']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.action == 'check':
        print(json.dumps({'config_valid': True, 'inference_configured': bool(config['INFERENCE_COMMAND']),
                          'background_configured': bool(config['BACKGROUND_COMMAND']), 'gpu': gpu_snapshot()}))
        return
    if args.action == 'clear-orchestration-pause':
        (root / 'state').mkdir(parents=True, exist_ok=True, mode=0o700)
        with (root / 'state/runtime.lock').open('a') as clearance_lock:
            try:
                fcntl.flock(clearance_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('Runtime lock held; stop runtime before explicit clearance') from None
            if verified_pid(root):
                raise ValueError('Stop runtime and verify orphan children before explicit hardware clearance')
            instance = Runtime(config)
            if not instance.orchestration_quiescent() or not gpu_snapshot()['available']:
                raise ValueError('Clearance requires attested GPU ownership, verified processes, closed ports and healthy NVML')
            (root / 'state/orchestration-active.json').unlink(missing_ok=True)
            (root / 'state/orchestration-pause.json').unlink(missing_ok=True)
        print('Local pause cleared; owner must separately clear scheduler hardware pause')
        return
    if args.action == 'resume-background':
        if verified_pid(root):
            raise ValueError('Stop runtime before resetting completed background queue')
        (root / 'state/background-complete.json').unlink(missing_ok=True)
        print('Background completion latch reset; next start will consume remaining/new work')
        return
    if args.action == 'status':
        state = load_json(root / 'state/status.json', {})
        state['running'] = verified_pid(root) is not None
        state['runtime_exit'] = load_json(root / 'state/runtime-exit.json')
        state['status_stale'] = time.time() - state.get('updated_at', 0) > max(20, float(config['POLL_SECONDS']) * 4)
        print(json.dumps(state, indent=2))
        return
    if args.action == 'stop':
        pid = verified_pid(root)
        if pid:
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 25
            while verified_pid(root) and time.monotonic() < deadline:
                time.sleep(0.2)
            if verified_pid(root):
                raise ValueError('Runtime did not stop within 25 seconds; inspect process state')
        confirm_stopped(root)
        print('Runtime stopped' + ('; orchestration pause still requires explicit clearance'
                                  if (root / 'state/orchestration-pause.json').exists() else ''))
        return
    if args.action == 'start':
        if verified_pid(root):
            print('Runtime already running')
            return
        diagnostic = root / 'state/runtime-exit.json'
        try:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--config', str(Path(args.config).resolve()),
                                        '--startup-diagnostic', str(diagnostic), 'run'],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except OSError as error:
            save_json(diagnostic, {'state': 'exited', 'pid': None, 'at': time.time(),
                                  'phase': 'spawn', 'exit_code': 1, 'exception_type': safe_exception_type(error)})
            raise
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise ValueError('Runtime failed to start; inspect private state/runtime-exit.json and logs/runtime.log')
            if verified_pid(root) == process.pid:
                print('Runtime process started; use status to verify backend readiness')
                return
            time.sleep(0.1)
        raise ValueError('Runtime startup not confirmed; inspect status before retrying')
    run_runtime(config)


def entrypoint():
    try:
        main()
    except BaseException as error:
        if isinstance(error, SystemExit) and error.code in (None, 0):
            return 0  # argparse --help
        # Foreground and detached startup use the same fixed-only error boundary.
        print('Runtime command failed (' + safe_exception_type(error) + '); inspect private state/runtime-exit.json and logs/runtime.log', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(entrypoint())
