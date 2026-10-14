"""The environment/policy loop, independent of HTTP and injectable for contract tests.

All methods on an Episode are called by the same process/thread. This matters for
MuJoCo EGL contexts. Native OpenPI's LIBERO preprocessing/action cadence is kept
explicit here, rather than treating all seven-dimensional actions as compatible.
"""
from __future__ import annotations

import base64
import collections
import copy
import hashlib
import io
import math
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from PIL import Image

LIBERO_REVISION = "8f1084e3132a39270c3a13ebe37270a43ece2a01"
OPENPI_REVISION = "215abfb217dbac7d5f1273282331b9b1866c0479"
CHECKPOINT = "gs://openpi-assets/checkpoints/pi05_libero/"
PROFILE_ID = "panda-pi05-libero"
CONTROL_HZ = 20
REPLAN_STEPS = 5
MAX_STEPS = 220
SETTLE_STEPS = 10
DUMMY_ACTION = [0.0] * 6 + [-1.0]


class ArenaError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def as_dict(self):
        return {"code": self.code, "message": self.message}


def profile_contract(revision: str | None = None) -> dict:
    return {
        "id": PROFILE_ID, "robotId": "panda", "modelId": "pi05",
        "checkpoint": CHECKPOINT, "checkpointRevision": revision,
        "adapter": "openpi-libero", "adapterVersion": "brainsnn-libero-v1",
        "simulator": {"id": "libero", "name": "LIBERO", "version": LIBERO_REVISION,
                      "engine": "mujoco", "engineVersion": "3.2.3", "robosuiteVersion": "1.4.1"},
        "policyCodeRevision": OPENPI_REVISION,
        "cameras": [{"id": name, "role": "policy", "width": 224, "height": 224,
                     "sourceWidth": 256, "sourceHeight": 256, "rotation": 180}
                    for name in ("agentview", "wrist")],
        "state": {"size": 8, "features": ["eef_position_xyz", "eef_axis_angle_xyz", "gripper_qpos_2"]},
        "action": {"size": 7, "space": "cartesian-delta-gripper", "controller": "OSC_POSE"},
        "timing": {"controlHz": CONTROL_HZ, "replanSteps": REPLAN_STEPS, "actionChunkSteps": REPLAN_STEPS,
                   "settleSteps": SETTLE_STEPS, "maxSteps": MAX_STEPS,
                   "protocol": "stepped-evaluation", "physicsWaitsForInference": True},
        "tasks": [{"id": f"libero_spatial:{i}", "label": f"LIBERO Spatial · task {i + 1}"} for i in range(10)],
        "protocols": ["practice", "benchmark"],
        "commands": ["run", "pause", "step", "reset", "intervene"],
        "interventions": [{"kind": "camera-occlusion", "camera": "agentview", "maxFraction": 0.7,
                           "changesPolicyObservation": True}],
        "supportsBranch": False, "supportsBatch": False,
    }


def quaternion_axis_angle(quaternion):
    """LIBERO's quaternion is xyzw, while streamed MuJoCo body poses are wxyz."""
    q = np.asarray(quaternion, dtype=np.float64).copy()
    if q.shape != (4,) or not np.isfinite(q).all():
        raise ArenaError("invalid_observation", "The environment returned an invalid orientation.", 502)
    w = float(np.clip(q[3], -1.0, 1.0))
    denominator = math.sqrt(max(0.0, 1.0 - w * w))
    return np.zeros(3) if math.isclose(denominator, 0.0, abs_tol=1e-8) else q[:3] * 2 * math.acos(w) / denominator


def image_data_url(image):
    stream = io.BytesIO()
    Image.fromarray(np.asarray(image, dtype=np.uint8)).save(stream, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def prepare_observation(obs, prompt, image_tools, occlusion=0.0):
    # These are the exact native OpenPI LIBERO image keys/orientation/resize.
    images = {}
    for name, key in (("agentview", "agentview_image"), ("wrist", "robot0_eye_in_hand_image")):
        raw = np.ascontiguousarray(obs[key][::-1, ::-1])
        images[name] = image_tools.convert_to_uint8(image_tools.resize_with_pad(raw, 224, 224)).copy()
    if occlusion:
        width = int(images["agentview"].shape[1] * occlusion)
        start = (images["agentview"].shape[1] - width) // 2
        images["agentview"][:, start:start + width] = 0
    state = np.concatenate((obs["robot0_eef_pos"], quaternion_axis_angle(obs["robot0_eef_quat"]),
                            obs["robot0_gripper_qpos"]))
    if state.shape != (8,) or not np.isfinite(state).all():
        raise ArenaError("invalid_observation", "Expected eight finite Panda state features.", 502)
    return {"observation/image": images["agentview"], "observation/wrist_image": images["wrist"],
            "observation/state": state, "prompt": str(prompt)}, images


@dataclass
class Episode:
    env: Any
    policy: Any
    image_tools: Any
    initial_state: Any
    prompt: str
    request: dict
    profile: dict
    session_id: str
    initial_state_id: int = 0
    clock: Any = time.monotonic
    seq: int = 0
    status: str = "ready"
    steps: int = 0
    inference_count: int = 0
    interventions: int = 0
    action_plan: Any = field(default_factory=collections.deque)
    latencies: list = field(default_factory=list)
    events: list = field(default_factory=list)
    trace: list = field(default_factory=list)
    request_cache: Any = field(default_factory=collections.OrderedDict)
    occlusion: float = 0.0
    closed: bool = False

    def __post_init__(self):
        self.created_at = self.clock()
        self.episode_number = 0
        self.reset()
        self.status = "ready"

    def emit(self, kind, **details):
        self.events.append({"type": kind, "step": self.steps, "simTime": self.sim_time(), **details})
        self.events = self.events[-200:]

    def sim_time(self):
        # Uses the simulator's own authoritative time, not browser animation time.
        return float(self.env.sim.data.time)

    def reset(self):
        self.status = "paused"
        self.action_plan.clear()
        self.occlusion = 0.0
        self.steps = self.inference_count = self.interventions = 0
        self.latencies = []
        self.trace = []
        self.events = []
        self.last_inference_step = None
        self.last_inference_images = None
        self.last_error = None
        self.episode_number += 1
        # Reset the policy and the exact suite-provided state. Seed never becomes
        # an index into a made-up random initial pose.
        self.policy.reset()
        self.env.seed(self.request["seed"])
        self.env.reset()
        self.obs = self.env.set_init_state(np.asarray(self.initial_state).copy())
        for _ in range(SETTLE_STEPS):
            self.obs, _, _, _ = self.env.step(DUMMY_ACTION)
        self.started_at = self.clock()
        self.sim_started_at = self.sim_time()
        self.success = bool(self.env.check_success())
        self.emit("reset", episode=self.episode_number, seed=self.request["seed"],
                  initialStateId=self.initial_state_id, settleSteps=SETTLE_STEPS)
        self.seq += 1

    def advance(self):
        if self.closed:
            raise ArenaError("session_closed", "The session is closed.", 410)
        if self.status in ("succeeded", "failed", "error"):
            raise ArenaError("episode_finished", "Reset the episode before stepping again.", 409)
        try:
            if not self.action_plan:
                inputs, images = prepare_observation(self.obs, self.prompt, self.image_tools, self.occlusion)
                start = self.clock()
                result = self.policy.infer(inputs)
                latency = (self.clock() - start) * 1000
                actions = np.asarray(result.get("actions"), dtype=np.float64)
                if actions.ndim != 2 or actions.shape[0] < REPLAN_STEPS or actions.shape[1] != 7:
                    raise ArenaError("invalid_actions", "The policy must return at least five seven-dimensional actions.", 502)
                if not np.isfinite(actions).all():
                    raise ArenaError("invalid_actions", "The policy returned non-finite actuator actions.", 502)
                # Match the native OpenPI evaluator: pass finite policy actions
                # directly to LIBERO. The pinned OSC_POSE controller performs its
                # own input clipping/scaling; no second adapter normalization.
                self.action_plan.extend(actions[:REPLAN_STEPS].copy())
                self.latencies.append(latency)
                self.inference_count += 1
                self.last_inference_step = self.steps
                self.last_inference_images = {k: v.copy() for k, v in images.items()}
            action = self.action_plan.popleft()
            self.obs, reward, done, _ = self.env.step(action.tolist())
            self.steps += 1
            self.success = bool(self.env.check_success())
            state = np.asarray(self.env.get_sim_state(), dtype=np.float64)
            self.trace.append({"step": self.steps, "simTime": self.sim_time(), "action": action.tolist(),
                               "state": state.tolist(), "stateSha256": hashlib.sha256(state.tobytes()).hexdigest(),
                               "reward": float(reward), "success": self.success})
            if self.success:
                self.status = "succeeded"
                self.action_plan.clear()
                self.emit("task_success", evaluator="LIBERO check_success")
            elif done or self.steps >= MAX_STEPS:
                self.status = "failed"
                self.action_plan.clear()
                self.emit("episode_finished", reason="environment_done" if done else "horizon_reached")
            self.seq += 1
        except Exception as error:
            self.status = "error"
            self.action_plan.clear()
            self.last_error = error.as_dict() if isinstance(error, ArenaError) else {
                "code": "runtime_failure", "message": "The physics or policy worker failed. Inspect the worker log and reset."}
            self.emit("runtime_error", **self.last_error)
            self.seq += 1
            raise

    def command(self, command):
        request_id = command.get("requestId")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise ArenaError("invalid_request_id", "A requestId of 1–128 characters is required.")
        fingerprint = repr((command.get("type"), sorted(command.get("payload", {}).items())))
        if request_id in self.request_cache:
            if self.request_cache[request_id] != fingerprint:
                raise ArenaError("request_id_reused", "Use a new requestId for a different command.", 409)
            return self.frame()  # Idempotent retries never step/reset the physics twice.
        kind, payload = command["type"], command.get("payload", {})
        if kind in ("run", "pause", "step", "reset") and payload:
            raise ArenaError("invalid_payload", f"The {kind} command has no payload.")
        if kind == "run":
            if self.status in ("succeeded", "failed", "error"):
                raise ArenaError("episode_finished", "Reset the episode before starting again.", 409)
            self.status = "running"
            self.emit("run")
        elif kind == "pause":
            if self.status not in ("succeeded", "failed", "error"):
                self.status = "paused"
            self.emit("pause")
        elif kind == "step":
            if self.status == "running":
                raise ArenaError("pause_required", "Pause before stepping one control tick.", 409)
            self.advance()
            if self.status not in ("succeeded", "failed", "error"):
                self.status = "paused"
        elif kind == "reset":
            self.reset()
        elif kind == "intervene":
            if self.request["protocol"] != "practice":
                raise ArenaError("benchmark_locked", "Benchmark observations are locked. Open a practice session to intervene.", 409)
            if payload.get("kind") != "camera-occlusion" or set(payload) - {"kind", "enabled", "fraction"}:
                raise ArenaError("unsupported_intervention", "This profile supports only camera-occlusion.")
            if not isinstance(payload.get("enabled"), bool):
                raise ArenaError("invalid_intervention", "enabled must be a boolean.")
            fraction = payload.get("fraction", 0.35)
            if isinstance(fraction, bool) or not isinstance(fraction, (float, int)) or not math.isfinite(fraction) or not 0 <= fraction <= 0.7:
                raise ArenaError("invalid_intervention", "Occlusion fraction must be between 0 and 0.7.")
            self.occlusion = float(fraction) if payload["enabled"] else 0.0
            self.action_plan.clear()  # The changed sensor is observed on the next tick.
            self.interventions += 1
            self.emit("camera_occlusion", fraction=self.occlusion, changesPolicyObservation=True)
        else:
            raise ArenaError("unsupported_command", "This worker does not support that command.")
        self.request_cache[request_id] = fingerprint
        if len(self.request_cache) > 512:
            self.request_cache.popitem(last=False)
        self.seq += 1
        return self.frame()

    def frame(self):
        _, current_images = prepare_observation(self.obs, self.prompt, self.image_tools, self.occlusion)
        cameras = [{"id": "spectator", "role": "spectator", "width": 256, "height": 256,
                    "url": image_data_url(self.obs["frontview_image"][::-1]), "capturedStep": self.steps}]
        # Show exactly what the last inference consumed once one exists. Never
        # label a spectator rendering as the policy's observation.
        images = self.last_inference_images or current_images
        for name in ("agentview", "wrist"):
            cameras.append({"id": name, "role": "policy", "width": 224, "height": 224,
                            "url": image_data_url(images[name]), "capturedStep": self.last_inference_step,
                            "consumedByPolicy": self.last_inference_images is not None})
        bodies = []
        for index, name in enumerate(self.env.sim.model.body_names):
            if index and name:
                bodies.append({"id": str(name), "position": np.asarray(self.env.sim.data.body_xpos[index]).tolist(),
                               "quaternion": np.asarray(self.env.sim.data.body_xquat[index]).tolist()})
        latencies = np.asarray(self.latencies)
        metrics = {"steps": self.steps, "success": self.success, "inferenceCount": self.inference_count,
                   "interventions": self.interventions, "wallTime": round(self.clock() - self.started_at, 3),
                   "episodeSimTime": self.sim_time() - self.sim_started_at,
                   "actionQueueDepth": len(self.action_plan), "controlHz": CONTROL_HZ}
        if len(latencies):
            metrics.update({"latencyMs": float(latencies[-1]), "latencyP50Ms": float(np.percentile(latencies, 50)),
                            "latencyP95Ms": float(np.percentile(latencies, 95))})
        return {"version": 1, "sessionId": self.session_id, "profileId": self.profile["id"],
                "seq": self.seq, "status": self.status, "simTime": self.sim_time(),
                "policyExecuted": self.steps > 0 and self.inference_count > 0, "cameras": cameras,
                "bodies": bodies, "metrics": metrics, "events": copy.deepcopy(self.events),
                "task": {"id": self.request["task"], "instruction": self.prompt},
                "protocol": self.request["protocol"], "episode": self.episode_number,
                "intervention": {"kind": "camera-occlusion", "fraction": self.occlusion},
                "error": self.last_error}

    def evidence(self):
        return {"version": 1, "sessionId": self.session_id, "profile": self.profile,
                "request": self.request, "taskInstruction": self.prompt, "episode": self.episode_number,
                "initialStateId": self.initial_state_id,
                "initialStateSha256": hashlib.sha256(np.asarray(self.initial_state).tobytes()).hexdigest(),
                "events": copy.deepcopy(self.events), "steps": copy.deepcopy(self.trace),
                "metrics": self.frame()["metrics"], "policyExecuted": self.inference_count > 0,
                "reproducibility": "Recorded action/state evidence; exact policy-RNG branching is not implemented.",
                "benchmarkClaim": "Single BrainSNN episode using the LIBERO success checker; not an official aggregate score."}

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.status = "closed"
        self.action_plan.clear()
        try:
            self.policy.close()
        finally:
            self.env.close()
