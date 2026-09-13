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
    for key in ('INFERENCE_COMMAND', 'BACKGROUND_COMMAND', 'BACKUP_COMMAND'):
        value = json.loads(result.get(key, '[]'))
        if not isinstance(value, list) or any(not isinstance(v, str) or not v for v in value):
            raise ValueError(f'{key} must be a JSON array of nonempty arguments')
        if value and not Path(value[0]).is_absolute():
            raise ValueError(f'{key} executable must use an absolute path')
        result[key] = value
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
        handler.addFilter(Redact([config[k] for k in ('GPU_API_KEY', 'BACKEND_API_KEY', 'BACKGROUND_API_KEY')]))
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        self.log.addHandler(handler)
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.inference = self.background = self.backup = None
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
                        'INFERENCE_JSON_SCHEMA_FILE'):
                if self.c.get(key):
                    env[key] = self.c[key]
        elif kind == 'background':
            env.update(BRAINSNN_GPU_BASE_URL=f"http://127.0.0.1:{self.c['GATEWAY_PORT']}/v1",
                       BRAINSNN_GPU_API_KEY=self.c['BACKGROUND_API_KEY'], BRAINSNN_GPU_MODEL=self.c['SERVED_MODEL_NAME'],
                       INFERENCE_MODEL=self.c['SERVED_MODEL_NAME'], BRAINSNN_GPU_MODEL_REVISION=self.c['MODEL_REVISION'])
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
                    self.log.info('%s: %s', kind, chunk.decode('utf8', errors='replace').rstrip())
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

    def tick(self):
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
            save_json(self.root / 'state/status.json', self.status())

    def status(self):
        return {'updated_at': time.time(), 'pid': os.getpid(), 'backend_ready': self.backend_ready,
                'inference_configured': bool(self.c['INFERENCE_COMMAND']),
                'inference_pid': self.inference.pid if self.inference else None,
                'backend_restarts': self.restarts, 'foreground_active': self.active_foreground,
                'requests_completed': self.completed, 'requests_failed': self.failed,
                'background_configured': bool(self.c['BACKGROUND_COMMAND']),
                'background_running': bool(self.background), 'background_complete': self.background_done,
                'backup_configured': bool(self.c['BACKUP_COMMAND']), 'backup_running': bool(self.backup),
                'backup_last_exit_code': self.backup_last_exit_code,
                'storage_ok': self.storage_ok, 'gpu': self.gpu}

    def run(self):
        lockfile = open(self.root / 'state/runtime.lock', 'a')
        try:
            fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Runtime already running')
        gateway = Gateway(('127.0.0.1', int(self.c['GATEWAY_PORT'])), Handler)
        gateway.runtime = self
        save_json(self.root / 'state/pid.json', {'pid': os.getpid(), 'script': str(Path(__file__).resolve())})
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: self.stop.set())
        thread = threading.Thread(target=gateway.serve_forever, daemon=True)
        thread.start()
        self.log.info('runtime started; gateway listens only on loopback')
        try:
            while not self.stop.is_set():
                self.tick()
                self.stop.wait(float(self.c['POLL_SECONDS']))
        finally:
            self.stop.set()
            gateway.shutdown()
            gateway.server_close()
            with self.lock:
                self.preempt_background()
                self.terminate(self.backup, 2)
                self.terminate(self.inference, 10)
                self.inference = None
                self.backend_ready = False
                state = self.status()
                state['stopped'] = True
                save_json(self.root / 'state/status.json', state)
                (self.root / 'state/pid.json').unlink(missing_ok=True)
            lockfile.close()
            self.log.info('runtime stopped')


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
        if not runtime.backend_ready or runtime.stop.is_set():
            return self.reply(503, {'error': 'backend_unavailable'})
        foreground = self.command == 'POST' and not background
        slot = False
        connection = None
        deadline_timer = None
        upstream_socket = None
        canceled = threading.Event()
        try:
            with runtime.lock:
                if background and (runtime.active_foreground or runtime.background is None):
                    return self.reply(429, {'error': 'foreground_priority'})
                if foreground:
                    runtime.active_foreground += 1
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
                if foreground:
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(Path(__file__).resolve().parent / 'runtime.env'))
    parser.add_argument('action', choices=('run', 'start', 'stop', 'status', 'check', 'resume-background'))
    args = parser.parse_args()
    os.umask(0o077)
    config = read_config(args.config)
    root = Path(config['RUNTIME_DIR']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.action == 'check':
        print(json.dumps({'config_valid': True, 'inference_configured': bool(config['INFERENCE_COMMAND']),
                          'background_configured': bool(config['BACKGROUND_COMMAND']), 'gpu': gpu_snapshot()}))
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
        print('Runtime stopped')
        return
    if args.action == 'start':
        if verified_pid(root):
            print('Runtime already running')
            return
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--config', str(Path(args.config).resolve()), 'run'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise ValueError('Runtime failed to start; run in foreground to inspect configuration/bind error')
            if verified_pid(root):
                print('Runtime process started; use status to verify backend readiness')
                return
            time.sleep(0.1)
        raise ValueError('Runtime startup not confirmed; inspect status before retrying')
    Runtime(config).run()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
