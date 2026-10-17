"""Pinned LIBERO/OpenPI adapter and bounded, process-isolated sessions."""
from __future__ import annotations

import importlib.metadata
import importlib.util
import logging
import multiprocessing
import os
import pathlib
import re
import threading
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

from .core import (ArenaError, CHECKPOINT, CONTROL_HZ, Episode, LIBERO_REVISION,
                   OPENPI_REVISION, PROFILE_ID, profile_contract)
from .recording import RecordingArchive, SCHEMA, MAX_BUNDLE_BYTES

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    token: str
    origins: tuple[str, ...]
    policy_url: str = "ws://127.0.0.1:8010"
    checkpoint_revision: str = ""
    policy_api_key: str = ""
    session_ttl: int = 900
    idle_ttl: int = 120
    inference_timeout: float = 20.0
    startup_timeout: float = 90.0
    read_token: str = ""
    recording_dir: str = "~/.local/share/brainsnn-arena/recordings"
    recording_queue_size: int = 64
    recording_max_bytes: int = 64 * 1024 * 1024
    recording_max_count: int = 50
    recording_total_bytes: int = 1024 * 1024 * 1024
    recording_retention_seconds: int = 7 * 86400
    recording_shutdown_timeout: float = 5.0

    @classmethod
    def from_env(cls):
        return cls(token=os.getenv("ARENA_TOKEN", ""),
                   origins=tuple(x.strip() for x in os.getenv("ARENA_ALLOWED_ORIGINS", "").split(",") if x.strip()),
                   policy_url=os.getenv("ARENA_POLICY_URL", "ws://127.0.0.1:8010"),
                   checkpoint_revision=os.getenv("ARENA_CHECKPOINT_REVISION", ""),
                   policy_api_key=os.getenv("ARENA_POLICY_API_KEY", ""),
                   session_ttl=int(os.getenv("ARENA_SESSION_TTL", "900")),
                   idle_ttl=int(os.getenv("ARENA_IDLE_TTL", "120")),
                   read_token=os.getenv("ARENA_READ_TOKEN", ""),
                   recording_dir=os.getenv("ARENA_RECORDING_DIR", "~/.local/share/brainsnn-arena/recordings"),
                   recording_queue_size=int(os.getenv("ARENA_RECORDING_QUEUE_SIZE", "64")),
                   recording_max_bytes=int(os.getenv("ARENA_RECORDING_MAX_BYTES", str(64 * 1024 * 1024))),
                   recording_max_count=int(os.getenv("ARENA_RECORDING_MAX_COUNT", "50")),
                   recording_total_bytes=int(os.getenv("ARENA_RECORDING_TOTAL_BYTES", str(1024 * 1024 * 1024))),
                   recording_retention_seconds=int(os.getenv("ARENA_RECORDING_RETENTION_SECONDS", str(7 * 86400))),
                   recording_shutdown_timeout=float(os.getenv("ARENA_RECORDING_SHUTDOWN_TIMEOUT", "5")))

    def validate(self):
        if len(self.token) < 32:
            raise ValueError("ARENA_TOKEN must be a secret of at least 32 characters.")
        if self.read_token and (len(self.read_token) < 32 or self.read_token == self.token):
            raise ValueError("ARENA_READ_TOKEN must be a distinct secret of at least 32 characters.")
        if (not self.recording_dir or not 1 <= self.recording_queue_size <= 512
                or not 1024 * 1024 <= self.recording_max_bytes <= 80 * 1024 * 1024
                or not 1 <= self.recording_max_count <= 1000
                or not self.recording_max_bytes <= self.recording_total_bytes <= 100 * 1024 ** 3
                or not 60 <= self.recording_retention_seconds <= 365 * 86400
                or not 0.1 <= self.recording_shutdown_timeout <= 30):
            raise ValueError("Recording storage, retention and shutdown limits are outside their supported bounds.")
        if not self.origins:
            raise ValueError("Set ARENA_ALLOWED_ORIGINS to the exact HTTPS arena origin.")
        for origin in self.origins:
            parts = urlparse(origin)
            if (parts.scheme not in ("https", "http") or not parts.hostname or parts.path not in ("", "/")
                    or parts.query or parts.fragment or parts.username or "*" in origin):
                raise ValueError("ARENA_ALLOWED_ORIGINS must contain explicit HTTP(S) origins, never wildcard origins.")
            if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
                raise ValueError("Non-local browser origins must use HTTPS.")
        parts = urlparse(self.policy_url)
        if parts.scheme not in ("ws", "wss") or not parts.hostname or parts.username or parts.password:
            raise ValueError("ARENA_POLICY_URL must be an operator-configured ws:// or wss:// endpoint without embedded credentials.")
        if self.checkpoint_revision and not re.fullmatch(r"sha256:[a-f0-9]{64}", self.checkpoint_revision):
            raise ValueError("ARENA_CHECKPOINT_REVISION must be sha256:<checkpoint manifest digest>.")
        if not 30 <= self.session_ttl <= 3600 or not 15 <= self.idle_ttl <= 600:
            raise ValueError("Session TTL must be 30–3600 seconds and idle TTL 15–600 seconds.")

    def recording_archive(self):
        return RecordingArchive(self.recording_dir, queue_size=self.recording_queue_size,
                                recording_max_bytes=self.recording_max_bytes, max_recordings=self.recording_max_count,
                                max_bytes=self.recording_total_bytes, retention_seconds=self.recording_retention_seconds)


def dependencies_ready(settings):
    reasons = []
    for module in ("libero", "openpi_client", "mujoco", "robosuite", "torch"):
        if importlib.util.find_spec(module) is None:
            reasons.append(f"Install the pinned {module} runtime")
    for package, expected in (("mujoco", "3.2.3"), ("robosuite", "1.4.1")):
        try:
            if importlib.metadata.version(package) != expected:
                reasons.append(f"{package} must be {expected}")
        except importlib.metadata.PackageNotFoundError:
            pass
    if os.getenv("ARENA_LIBERO_REVISION") != LIBERO_REVISION:
        reasons.append("Install the pinned LIBERO source revision")
    if os.getenv("ARENA_OPENPI_REVISION") != OPENPI_REVISION:
        reasons.append("Install the pinned OpenPI client revision")
    config = pathlib.Path(os.getenv("LIBERO_CONFIG_PATH", str(pathlib.Path.home() / ".libero"))) / "config.yaml"
    if not config.is_file():
        reasons.append("Create LIBERO config.yaml with BDDL, asset and initial-state paths")
    if not settings.checkpoint_revision:
        reasons.append("Pin ARENA_CHECKPOINT_REVISION to the verified policy checkpoint manifest")
    return reasons


def validate_policy_metadata(metadata, settings):
    attestation = metadata.get("brainsnn", {}) if isinstance(metadata, dict) else {}
    expected = {"profileId": PROFILE_ID, "checkpoint": CHECKPOINT,
                "checkpointRevision": settings.checkpoint_revision, "config": "pi05_libero",
                "openpiRevision": OPENPI_REVISION, "actionSize": 7}
    if any(attestation.get(key) != value for key, value in expected.items()):
        raise ArenaError("policy_identity_mismatch", "The policy server has not attested the pinned pi05 LIBERO checkpoint. Start it with serve_openpi.py and the matching manifest.", 503)


def connect_policy(settings):
    from openpi_client import msgpack_numpy
    from openpi_client.websocket_client_policy import WebsocketClientPolicy
    from websockets.sync.client import connect

    class BoundedOpenPIPolicy(WebsocketClientPolicy):
        # Upstream retries refused connections forever. A browser-facing worker
        # instead bounds connection/inference time and closes on protocol failure.
        def _wait_for_server(self):
            headers = {"Authorization": f"Api-Key {self._api_key}"} if self._api_key else None
            connection = connect(self._uri, compression=None, max_size=16 * 1024 * 1024,
                                 additional_headers=headers, open_timeout=5, close_timeout=2)
            try:
                metadata = msgpack_numpy.unpackb(connection.recv(timeout=5))
                validate_policy_metadata(metadata, settings)
                return connection, metadata
            except Exception:
                connection.close()
                raise

        def infer(self, observation):
            self._ws.send(self._packer.pack(observation))
            reply = self._ws.recv(timeout=settings.inference_timeout)
            if isinstance(reply, str):
                raise ArenaError("policy_inference_failed", "OpenPI rejected the observation. Inspect the private policy-server log.", 502)
            result = msgpack_numpy.unpackb(reply)
            if not isinstance(result, dict):
                raise ArenaError("policy_protocol_error", "OpenPI returned an invalid response.", 502)
            return result

        def close(self):
            self._ws.close()

    return BoundedOpenPIPolicy(host=settings.policy_url, port=None, api_key=settings.policy_api_key or None)


def create_episode(request, settings, session_id):
    # Called exclusively inside the session process. Importing LIBERO can prompt
    # for dataset paths, so preflight requires its config file before import.
    from libero.libero import benchmark, get_libero_path
    from libero.libero.envs import OffScreenRenderEnv
    from openpi_client import image_tools

    policy = connect_policy(settings)
    env = None
    try:
        suite = benchmark.get_benchmark_dict()["libero_spatial"]()
        task_index = int(request["task"].split(":")[1])
        task = suite.get_task(task_index)
        initial_states = suite.get_task_init_states(task_index)
        # Deterministic suite-provided initial state, explicit in exported evidence.
        state_id = request["seed"] % len(initial_states)
        bddl = pathlib.Path(get_libero_path("bddl_files")) / task.problem_folder / task.bddl_file
        env = OffScreenRenderEnv(bddl_file_name=str(bddl), robots=["Panda"], controller="OSC_POSE",
                                 camera_names=["agentview", "robot0_eye_in_hand", "frontview"],
                                 camera_heights=256, camera_widths=256, control_freq=CONTROL_HZ,
                                 horizon=1000, ignore_done=False)
        profile = profile_contract(settings.checkpoint_revision)
        profile["ready"] = True
        return Episode(env, policy, image_tools, initial_states[state_id], str(task.language), request,
                       profile, session_id, initial_state_id=state_id, archive=settings.recording_archive(),
                       recording_shutdown_timeout=settings.recording_shutdown_timeout)
    except Exception:
        policy.close()
        if env is not None:
            env.close()
        raise


def child_loop(pipe, request, settings, session_id):
    episode = None
    try:
        episode = create_episode(request, settings, session_id)
        pipe.send({"ok": True, "profile": episode.profile, "frame": episode.frame()})
        created = last_access = time.monotonic()
        next_step = created
        while True:
            now = time.monotonic()
            if now - created > settings.session_ttl or now - last_access > settings.idle_ttl:
                episode.finish_recording("session_expired")
                break
            running = episode.status == "running"
            wait = max(0, min(0.1, next_step - now)) if running else 0.1
            if pipe.poll(wait):
                operation, data = pipe.recv()
                last_access = time.monotonic()
                try:
                    if operation == "close":
                        episode.close()
                        pipe.send({"ok": True, "closed": True})
                        break
                    if operation == "frame":
                        value = episode.frame()
                    elif operation == "command":
                        value = episode.command(data)
                    elif operation == "evidence":
                        value = episode.evidence()
                    else:
                        raise ArenaError("invalid_operation", "Unknown worker operation.")
                    pipe.send({"ok": True, "value": value})
                except ArenaError as error:
                    pipe.send({"ok": False, "error": error.as_dict(), "status": error.status})
                except Exception:
                    LOGGER.exception("Session operation failed")
                    pipe.send({"ok": False, "error": {"code": "runtime_failure", "message": "Physics or policy operation failed. Inspect the worker log."}, "status": 502})
            if episode.status == "running" and time.monotonic() >= next_step:
                try:
                    episode.advance()
                except Exception:
                    LOGGER.exception("Episode stopped after a runtime error")
                # The simulation clock waits for policy inference. No catch-up
                # action bursts pretend to meet a real-time deployment deadline.
                next_step = time.monotonic() + 1.0 / CONTROL_HZ
    except (EOFError, BrokenPipeError):
        pass
    except Exception as error:
        LOGGER.exception("Session startup failed")
        try:
            details = error.as_dict() if isinstance(error, ArenaError) else {
                "code": "session_start_failed", "message": "Could not initialize the pinned policy and LIBERO renderer. Check EGL, assets, and the worker log."}
            pipe.send({"ok": False, "error": details, "status": 503})
        except (EOFError, BrokenPipeError):
            pass
    finally:
        if episode is not None:
            episode.close()
        pipe.close()


class SessionProcess:
    def __init__(self, request, settings):
        self.id = uuid.uuid4().hex
        self.settings = settings
        self.lock = threading.RLock()
        self.closed = False
        context = multiprocessing.get_context("spawn")
        self.pipe, child = context.Pipe()
        self.process = context.Process(target=child_loop, args=(child, request, settings, self.id), daemon=True)
        self.process.start()
        child.close()
        try:
            initial = self.receive(settings.startup_timeout)
            self.profile, self.initial_frame = initial["profile"], initial["frame"]
        except Exception:
            self.close()
            raise

    def receive(self, timeout):
        if not self.pipe.poll(timeout):
            self.close()
            raise ArenaError("worker_timeout", "The worker exceeded its time limit and the session was stopped.", 504)
        try:
            result = self.pipe.recv()
        except EOFError:
            self.close()
            raise ArenaError("session_expired", "The session expired or its worker stopped. Create a new session.", 410)
        if not result.get("ok"):
            error = result["error"]
            raise ArenaError(error["code"], error["message"], result.get("status", 502))
        return result

    def call(self, operation, data=None):
        with self.lock:
            if self.closed or not self.process.is_alive():
                raise ArenaError("session_expired", "The session expired. Create a new session.", 410)
            try:
                self.pipe.send((operation, data))
                return self.receive(self.settings.inference_timeout + 15)["value"]
            except (BrokenPipeError, OSError):
                self.close()
                raise ArenaError("session_expired", "The worker stopped. Create a new session.", 410)

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            if self.process.is_alive():
                try:
                    self.pipe.send(("close", None))
                    # The child can be inside bounded inference. Give it that
                    # budget plus the recorder's explicit durability barrier.
                    # If it still fails to exit, missing final markers recover
                    # as unknown-tail partial recordings, never complete ones.
                    self.process.join(timeout=self.settings.inference_timeout + self.settings.recording_shutdown_timeout + 3)
                except (BrokenPipeError, OSError):
                    pass
            if self.process.is_alive():
                self.process.terminate()
                self.process.join(timeout=2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=1)
            self.pipe.close()


class SessionManager:
    """One authoritative session per worker. Scale by routing to more workers."""
    def __init__(self, settings, process_factory=SessionProcess):
        settings.validate()
        self.settings = settings
        self.process_factory = process_factory
        self.sessions = {}
        self.lock = threading.RLock()
        self.probe_at = 0.0
        self.probe_result = None
        self.archive = settings.recording_archive()

    def capabilities(self):
        profile = profile_contract(self.settings.checkpoint_revision or None)
        reasons = dependencies_ready(self.settings)
        # This verifies actual policy identity, not a guessed URL or generic LLM.
        # EGL/task initialization is performed at session creation and may fail.
        if not reasons:
            with self.lock:
                if time.monotonic() - self.probe_at > 5:
                    try:
                        policy = connect_policy(self.settings)
                        policy.close()
                        self.probe_result = None
                    except ArenaError as error:
                        self.probe_result = error.message
                    except Exception:
                        self.probe_result = "The pinned OpenPI policy server is unreachable. Start serve_openpi.py before creating a session."
                    self.probe_at = time.monotonic()
                if self.probe_result:
                    reasons.append(self.probe_result)
        profile["ready"] = not reasons
        if reasons:
            profile["reason"] = "; ".join(reasons) + "."
        return {"version": 1, "wireProtocol": "brainsnn.arena.v1", "server": {"name": "BrainSNN LIBERO worker", "version": "1.0.0"},
                "profiles": [profile], "limits": {"maxSessions": 1, "sessionTtlSeconds": self.settings.session_ttl,
                                                     "idleTtlSeconds": self.settings.idle_ttl},
                "recordings": {"schema": SCHEMA, "readOnly": True, "listPath": "/v1/recordings",
                               "bundlePath": "/v1/recordings/{id}/bundle", "maxBundleBytes": MAX_BUNDLE_BYTES,
                               "retentionSeconds": self.settings.recording_retention_seconds,
                               "maxRecordings": self.settings.recording_max_count,
                               "maxRecordingBytes": self.settings.recording_max_bytes,
                               "coverage": "Post-settling policy interface, controller inputs and observed states; no policy internals."},
                "validation": "Dependencies and policy identity checked; renderer/task initialization checked when creating the session."}

    def create(self, request):
        with self.lock:
            for key, process in list(self.sessions.items()):
                if process.closed or not process.process.is_alive():
                    process.close()
                    del self.sessions[key]
            if self.sessions:
                raise ArenaError("worker_busy", "This worker already owns a session. Close it before opening another.", 409)
            profile = self.capabilities()["profiles"][0]
            if not profile["ready"]:
                raise ArenaError("profile_not_ready", profile["reason"], 503)
            for key, expected in (("profileId", PROFILE_ID), ("robotId", "panda"), ("modelId", "pi05")):
                if request.get(key) != expected:
                    raise ArenaError("profile_mismatch", "This worker supports the Panda + pi05 LIBERO profile only.", 409)
            if request.get("checkpoint", "").rstrip("/") != CHECKPOINT.rstrip("/"):
                raise ArenaError("checkpoint_mismatch", "The requested checkpoint does not match this worker.", 409)
            if request.get("task") not in {task["id"] for task in profile["tasks"]}:
                raise ArenaError("task_mismatch", "Choose one of this worker's LIBERO Spatial tasks.", 409)
            process = self.process_factory(request, self.settings)
            self.sessions[process.id] = process
            return {"version": 1, "sessionId": process.id, "profileId": PROFILE_ID, "robotId": "panda", "modelId": "pi05",
                    "checkpoint": CHECKPOINT, "status": "ready", "profile": process.profile, "frame": process.initial_frame}

    def get(self, session_id):
        with self.lock:
            if session_id not in self.sessions:
                raise ArenaError("session_not_found", "This worker does not own that session.", 404)
            return self.sessions[session_id]

    def delete(self, session_id):
        with self.lock:
            process = self.sessions.pop(session_id, None)
            if process:
                process.close()

    def close(self):
        with self.lock:
            for process in self.sessions.values():
                process.close()
            self.sessions.clear()
