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
    archive: Any = None
    recording_shutdown_timeout: float = 5.0

    def __post_init__(self):
        self.created_at = self.clock()
        self.episode_number = 0
        self.recorder = None
        self.previous_recorders = []
        self.current_chunk_id = self.current_observation_id = None
        self.chunk_index = 0
        self.inference_attempts = 0
        self.inference_completions = self.controller_submissions = 0
        self.reset()
        self.status = "ready"

    def emit(self, kind, **details):
        self.events.append({"type": kind, "step": self.steps, "simTime": self.sim_time(), **details})
        self.events = self.events[-200:]

    def sim_time(self):
        # Uses the simulator's own authoritative time, not browser animation time.
        return float(self.env.sim.data.time)

    def record(self, kind, **kwargs):
        if self.recorder is None:
            return None
        try:
            return self.recorder.record(kind, sim_time=self.sim_time(), **kwargs)
        except Exception:
            # Instrumentation failure cannot change the controller's action.
            self.recorder._lose("capture_failed")
            return None

    def discard_chunk(self, reason):
        if self.action_plan:
            self.record("chunk-discarded", refs=[self.current_chunk_id], data={
                "chunkId": self.current_chunk_id, "indices": list(range(self.chunk_index, self.chunk_index + len(self.action_plan))),
                "reason": reason})
        self.action_plan.clear()

    def finish_recording(self, reason):
        if self.recorder is None or not self.recorder.accepting:
            return
        self.discard_chunk(reason)
        outcome = {"status": self.status if self.status in ("succeeded", "failed") else "interrupted",
                   "reason": reason, "success": bool(getattr(self, "success", False)),
                   "judge": "LIBERO check_success", "judgeRevision": LIBERO_REVISION,
                   "controlSteps": self.steps, "inferenceAttempts": self.inference_attempts,
                   "controllerInputsSubmitted": self.controller_submissions,
                   "inferenceCompletions": self.inference_completions, "validActionChunks": self.inference_count}
        self.record("outcome", data=outcome)
        self.recorder.finish(outcome, reason)

    def record_observation(self, inputs, *, initial=False):
        return self.record("observation", arrays={
            "agentview": (inputs["observation/image"], True),
            "wrist": (inputs["observation/wrist_image"], True), "policy-state": inputs["observation/state"]},
            texts={"prompt": inputs["prompt"]}, data=lambda eid, artifacts: {
                "cameras": [{"id": camera, "artifactId": artifacts[camera]} for camera in ("agentview", "wrist")],
                "state": inputs["observation/state"].tolist(), "stateArtifactId": artifacts["policy-state"],
                "promptArtifactId": artifacts["prompt"], "controlStep": self.steps,
                "interface": "openpi-client-input", "initialOnly": initial,
                "boundary": "Prepared worker input, before policy-server internal transforms."})

    def reset(self):
        # At most two writers may own queued copies in this worker process.
        # Reject before changing the live episode if a slow disk still owns
        # both; retries can proceed once a previous prefix has finalized.
        self.previous_recorders = [writer for writer in self.previous_recorders if not writer.finished.is_set()]
        pending = len(self.previous_recorders) + int(self.recorder is not None and not self.recorder.finished.is_set())
        if self.archive is not None and pending >= 2:
            raise ArenaError("recording_busy", "Previous recording is still finalizing. Retry reset after it finishes.", 409)
        self.finish_recording("reset")
        if self.recorder is not None:
            self.previous_recorders.append(self.recorder)
        self.previous_recorders = [writer for writer in self.previous_recorders if not writer.finished.is_set()]
        self.recorder = None
        self.status = "paused"
        self.action_plan.clear()
        self.occlusion = 0.0
        self.steps = self.inference_count = self.interventions = 0
        self.inference_attempts = 0
        self.inference_completions = self.controller_submissions = 0
        self.current_chunk_id = self.current_observation_id = None
        self.chunk_index = 0
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
        if self.archive is not None:
            # This is the state after ten settling actions, not the suite state.
            state = np.asarray(self.env.get_sim_state(), dtype=np.float64).copy()
            self.recorder = self.archive.create({"sessionId": self.session_id,
                "episodeId": self.session_id + "-" + str(self.episode_number), "episode": self.episode_number,
                "source": {"kind": "simulator-policy", "identityStatus": "declared",
                           "producer": "brainsnn-libero-v1", "profile": copy.deepcopy(self.profile)},
                "context": {"taskId": self.request["task"], "taskRevision": LIBERO_REVISION,
                            "judgeRevision": LIBERO_REVISION, "judge": "LIBERO check_success",
                            "environment": copy.deepcopy(self.profile["simulator"]),
                            "actionSemantics": copy.deepcopy(self.profile["action"]),
                            "stateSemantics": {"policy": copy.deepcopy(self.profile["state"]),
                                               "simulator": "LIBERO flattened MuJoCo state; not controller or policy RNG state"},
                            "units": {"position": "metres", "orientation": "radians", "simTime": "seconds",
                                      "controllerInput": "OSC_POSE cartesian-delta-gripper input, before controller clipping/scaling"},
                            "preprocessingRevision": "brainsnn-libero-v1:" + OPENPI_REVISION,
                            "seed": self.request["seed"], "protocol": self.request["protocol"],
                            "initialState": {"suiteStateId": self.initial_state_id,
                                             "suiteStateSha256": hashlib.sha256(np.asarray(self.initial_state).tobytes()).hexdigest(),
                                             "policyStartStateSha256": hashlib.sha256(state.tobytes()).hexdigest(),
                                             "policyStart": "post-settling", "settleSteps": SETTLE_STEPS,
                                             "initializationCoverage": "Settling actions excluded; suite source and post-settling state retained."}},
                "clocks": [{"id": "simulator", "unit": "seconds", "epoch": "environment reset", "policyStart": self.sim_time()},
                           {"id": "host-monotonic", "unit": "nanoseconds", "epoch": "host boot", "mapping": "unknown"}],
                "limitations": ["Recorded worker-interface inputs and controller inputs, not motor execution.",
                                "Producer model identity is declared, not independently authenticated.",
                                "Initialization settling steps and internal policy transforms are outside coverage.",
                                "No policy RNG/controller restore state; inspection is not executable branching."]})
            self.record("episode-start", arrays={"policy-start-state": state, "suite-state": self.initial_state},
                        data=lambda eid, artifacts: {"state": state.tolist(),
                            "stateArtifactId": artifacts["policy-start-state"], "sourceStateArtifactId": artifacts["suite-state"],
                            "initialization": {"settleSteps": SETTLE_STEPS, "coverage": "excluded"}, "controlStep": 0})
            inputs, _ = prepare_observation(self.obs, self.prompt, self.image_tools)
            self.record_observation(inputs, initial=True)
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
                self.current_observation_id = self.record_observation(inputs)
                self.inference_attempts += 1
                attempt = f"attempt-{self.episode_number}-{self.inference_attempts}"
                start_id = self.record("inference-start", refs=[self.current_observation_id], data={
                    "observationId": self.current_observation_id, "attemptId": attempt,
                    "adapter": self.profile.get("adapter"), "modelId": self.profile.get("modelId"),
                    "checkpointRevision": self.profile.get("checkpointRevision")})
                start = self.clock()
                try:
                    result = self.policy.infer(inputs)
                except Exception:
                    self.record("inference-error", refs=[start_id, self.current_observation_id], data={
                        "attemptId": attempt, "observationId": self.current_observation_id,
                        "durationMs": (self.clock() - start) * 1000, "code": "policy_inference_failed"})
                    raise
                latency = (self.clock() - start) * 1000
                self.inference_completions += 1
                # Preserve the returned array before float64 controller coercion.
                returned = np.asarray(result.get("actions"))
                numeric = returned.dtype.kind in "biuf"
                recordable = numeric and 0 < returned.ndim <= 8 and all(size > 0 for size in returned.shape)
                finite = numeric and np.isfinite(returned).all()
                valid_shape = returned.ndim == 2 and returned.shape[0] >= REPLAN_STEPS and returned.shape[1] == 7
                self.current_chunk_id = self.record("inference-result", refs=[start_id, self.current_observation_id],
                    arrays={"returned-actions": returned} if recordable else {},
                    data=lambda eid, artifacts: {"observationId": self.current_observation_id, "attemptId": attempt,
                        "chunkId": eid, "actions": returned.tolist() if finite else None,
                        "actionsArtifactId": artifacts.get("returned-actions"), "durationMs": latency,
                        "queuedCount": REPLAN_STEPS if finite and valid_shape else 0,
                        "unusedCount": max(0, len(returned) - REPLAN_STEPS) if returned.ndim else 0,
                        "unusedReason": "Only the first five predictions are queued by the native evaluator.",
                        "artifactLimitation": None if recordable else "Malformed/non-array output has no numeric array artifact.",
                        "validShape": bool(valid_shape), "finite": bool(finite)})
                self.chunk_index = 0
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
            action_id = self.record("controller-input", refs=[self.current_chunk_id, self.current_observation_id],
                arrays={"controller-input": action}, data={"vector": action.tolist(), "controlStep": self.steps + 1,
                    "chunkId": self.current_chunk_id, "chunkIndex": self.chunk_index,
                    "observationId": self.current_observation_id, "boundary": "Argument to env.step; not measured motor output."})
            self.chunk_index += 1
            self.controller_submissions += 1
            control_started = self.clock()
            self.obs, reward, done, _ = self.env.step(action.tolist())
            control_duration = (self.clock() - control_started) * 1000
            self.steps += 1
            self.success = bool(self.env.check_success())
            state = np.asarray(self.env.get_sim_state(), dtype=np.float64)
            self.record("state", refs=[action_id], arrays={"simulator-state": state}, data={
                "state": state.tolist(), "controlStep": self.steps, "reward": float(reward),
                "success": self.success, "controllerInputId": action_id, "judge": "LIBERO check_success",
                "controlDurationMs": control_duration})
            self.trace.append({"step": self.steps, "simTime": self.sim_time(), "action": action.tolist(),
                               "state": state.tolist(), "stateSha256": hashlib.sha256(state.tobytes()).hexdigest(),
                               "reward": float(reward), "success": self.success})
            if self.success:
                self.status = "succeeded"
                self.discard_chunk("task_success")
                self.emit("task_success", evaluator="LIBERO check_success")
            elif done or self.steps >= MAX_STEPS:
                self.status = "failed"
                self.discard_chunk("episode_finished")
                self.emit("episode_finished", reason="environment_done" if done else "horizon_reached")
            self.seq += 1
            if self.status in ("succeeded", "failed"):
                self.finish_recording(self.status)
        except Exception as error:
            self.status = "error"
            self.discard_chunk("runtime_error")
            self.last_error = error.as_dict() if isinstance(error, ArenaError) else {
                "code": "runtime_failure", "message": "The physics or policy worker failed. Inspect the worker log and reset."}
            self.emit("runtime_error", **self.last_error)
            self.record("runtime-error", data=self.last_error)
            self.finish_recording("runtime_error")
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
            self.record("run", data={"controlStep": self.steps})
        elif kind == "pause":
            if self.status not in ("succeeded", "failed", "error"):
                self.status = "paused"
            self.emit("pause")
            self.record("pause", data={"controlStep": self.steps})
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
            self.discard_chunk("camera_occlusion")  # The changed sensor is observed on the next tick.
            self.interventions += 1
            self.emit("camera_occlusion", fraction=self.occlusion, changesPolicyObservation=True)
            self.record("intervention", data={"kind": "camera-occlusion", "fraction": self.occlusion,
                        "changesPolicyObservation": True, "controlStep": self.steps})
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
                   "inferenceAttempts": self.inference_attempts, "inferenceCompletions": self.inference_completions,
                   "controllerInputsSubmitted": self.controller_submissions,
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
                "recording": self.recorder.summary() if self.recorder else None,
                "error": self.last_error}

    def evidence(self):
        return {"version": 1, "sessionId": self.session_id, "profile": self.profile,
                "request": self.request, "taskInstruction": self.prompt, "episode": self.episode_number,
                "initialStateId": self.initial_state_id,
                "initialStateSha256": hashlib.sha256(np.asarray(self.initial_state).tobytes()).hexdigest(),
                "events": copy.deepcopy(self.events), "steps": copy.deepcopy(self.trace),
                "metrics": self.frame()["metrics"], "policyExecuted": self.inference_count > 0,
                "recording": self.recorder.summary() if self.recorder else None,
                "reproducibility": "Recorded action/state evidence; exact policy-RNG branching is not implemented.",
                "benchmarkClaim": "Single BrainSNN episode using the LIBERO success checker; not an official aggregate score."}

    def close(self):
        if self.closed:
            return
        self.finish_recording("session_closed")
        self.closed = True
        self.status = "closed"
        self.action_plan.clear()
        try:
            self.policy.close()
        finally:
            try:
                self.env.close()
            finally:
                deadline = time.monotonic() + self.recording_shutdown_timeout
                for recorder in self.previous_recorders + ([self.recorder] if self.recorder else []):
                    recorder.wait(max(0, deadline - time.monotonic()))
