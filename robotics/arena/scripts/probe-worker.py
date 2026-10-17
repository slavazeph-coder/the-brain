"""Bounded acceptance probe for an operator-owned real Arena worker.

ARENA_TOKEN is supplied privately. This probe controls two test sessions and
exports private camera/recording evidence. It never loads a model itself. A
valid 220-step task miss can pass execution acceptance; it is not task success.
"""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

# The same command works from a source checkout and an extracted worker kit.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from workers.arena.core import CHECKPOINT, MAX_STEPS, PROFILE_ID, profile_contract
from workers.arena.recording import MAX_BUNDLE_BYTES, SCHEMA, verify_bundle


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ProbeHTTP:
    def __init__(self, url, origin, token):
        if len(token) < 32 or any(not 33 <= ord(char) <= 126 for char in token):
            raise ValueError("ARENA_TOKEN must contain at least 32 printable ASCII characters without whitespace.")
        self.base, self.origin, self.token = url.rstrip("/"), origin, token
        self.opener = urllib.request.build_opener(NoRedirect)

    def __call__(self, method, path, data=None, *, auth=True, origin=None, expected=200,
                 max_bytes=10 * 1024 * 1024):
        headers = {"Origin": origin or self.origin}
        if auth:
            headers["Authorization"] = "Bearer " + self.token
        if data is not None:
            headers["Content-Type"] = "application/json"
        encoded = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(self.base + path, data=encoded, headers=headers, method=method)
        def read_bounded(response):
            deadline = time.monotonic() + 60
            chunks, size = [], 0
            # read1 returns available bytes instead of waiting to fill the
            # entire allowance, so a trickled body cannot renew our deadline.
            read = getattr(response, "read1", response.read)
            while size <= max_bytes:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Response body deadline exceeded")
                chunk = read(min(65536, max_bytes + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
            return b"".join(chunks)
        try:
            with self.opener.open(req, timeout=100 if method == "POST" and path == "/v1/sessions" else 60) as response:
                status, raw = response.status, read_bounded(response)
        except urllib.error.HTTPError as error:
            status, raw = error.code, read_bounded(error)
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError("Worker request failed; inspect the configured endpoint and private logs.") from None
        if status != expected:
            raise RuntimeError(f"{method} {path}: expected HTTP {expected}, received {status}; inspect private worker logs.")
        if len(raw) > max_bytes:
            raise RuntimeError("Worker response exceeded its bounded size limit.")
        # A worker must never echo the supplied credential into saved evidence.
        if self.token.encode() in raw:
            raise RuntimeError("Worker response contained the access credential; evidence was not saved.")
        value = json.loads(raw)
        pending = [value]
        while pending:
            item = pending.pop()
            if isinstance(item, str) and self.token in item:
                raise RuntimeError("Worker response contained the access credential; evidence was not saved.")
            if isinstance(item, dict):
                pending.extend(item.keys())
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)
        return value


def recording_id(frame):
    value = (frame.get("recording") or {}).get("recordingId")
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", value):
        raise RuntimeError("Worker frame did not identify a durable recording.")
    return value


def verify_execution_bundle(bundle, *, recording, session, profile, protocol, steps, outcome,
                            task="libero_spatial:0", seed=7):
    """Verify original bytes and the claimed worker-interface execution chain."""
    manifest = verify_bundle(bundle)
    if (manifest["recordingId"] != recording or manifest.get("sessionId") != session
            or manifest["completion"]["status"] != "complete"
            or manifest["source"]["kind"] != "simulator-policy"
            or manifest["source"].get("profile") != profile):
        raise RuntimeError("Recording identity, complete coverage or worker profile did not match this session.")
    context = manifest["context"]
    if context.get("taskId") != task or context.get("seed") != seed or context.get("protocol") != protocol:
        raise RuntimeError("Recording task, seed or protocol did not match this probe.")
    events = manifest["events"]
    by_id = {event["id"]: event for event in events}
    artifacts = {item["id"]: item for item in manifest["artifacts"]}
    actions = [event for event in events if event["kind"] == "controller-input"]
    states = [event for event in events if event["kind"] == "state"]
    chunks = [event for event in events if event["kind"] == "inference-result"]
    attempts = [event for event in events if event["kind"] == "inference-start"]
    expected_chunks = (steps + 4) // 5
    actual_outcome = manifest["outcome"]
    if (len(actions) != steps or len(states) != steps or actual_outcome.get("controlSteps") != steps
            or actual_outcome.get("controllerInputsSubmitted") != steps or actual_outcome.get("status") != outcome
            or any(event["kind"] in ("runtime-error", "inference-error", "gap") for event in events)):
        raise RuntimeError("Recording step coverage, outcome or runtime errors failed acceptance.")
    if (len(chunks) != expected_chunks or len(attempts) != expected_chunks
            or any(actual_outcome.get(key) != expected_chunks for key in
                   ("inferenceAttempts", "inferenceCompletions", "validActionChunks"))):
        raise RuntimeError("Recording inference counts do not match five-step replanning.")
    if not any(event["kind"] == "outcome" and event["data"] == actual_outcome for event in events):
        raise RuntimeError("Recording lacks the bound final outcome event.")
    starts = [event for event in events if event["kind"] == "episode-start"]
    if len(starts) != 1 or artifacts.get(starts[0]["data"].get("stateArtifactId"), {}).get("sha256") != context.get("initialState", {}).get("policyStartStateSha256"):
        raise RuntimeError("Recording lacks the bound post-settling initial state.")
    for index, action in enumerate(actions, 1):
        data = action["data"]
        obs = by_id.get(data.get("observationId"), {})
        chunk = by_id.get(data.get("chunkId"), {})
        attempt = attempts[(index - 1) // 5]
        state = states[index - 1]
        if (data.get("controlStep") != index or state["data"].get("controlStep") != index
                or state["data"].get("controllerInputId") != action["id"]
                or action["id"] not in state["refs"]
                or obs.get("kind") != "observation" or obs["data"].get("initialOnly") is not False
                or chunk.get("kind") != "inference-result" or chunk["data"].get("observationId") != obs["id"]
                or obs["id"] not in action["refs"] or chunk["id"] not in action["refs"]
                or obs["id"] not in chunk["refs"] or attempt["id"] not in chunk["refs"]
                or obs["id"] not in attempt["refs"] or attempt["data"].get("observationId") != obs["id"]
                or chunk["data"].get("attemptId") != attempt["data"].get("attemptId")
                or chunk != chunks[(index - 1) // 5]
                or not obs["seq"] < attempt["seq"] < chunk["seq"] < action["seq"] < state["seq"]):
            raise RuntimeError("Recording does not link each chosen input to consumed observation, inference and next state.")
        predicted = chunk["data"].get("actions")
        chunk_index = data.get("chunkIndex")
        if (not isinstance(predicted, list) or len(predicted) < 5 or type(chunk_index) is not int
                or chunk_index != (index - 1) % 5 or data.get("vector") != predicted[chunk_index]
                or len(data.get("vector", [])) != 7 or chunk["data"].get("queuedCount") != 5
                or chunk["data"].get("actionsArtifactId") not in artifacts):
            raise RuntimeError("Returned chunk and chosen controller inputs do not agree.")
        camera_list = obs["data"].get("cameras", [])
        cameras = {item.get("id"): item for item in camera_list}
        if set(cameras) != {"agentview", "wrist"} or len(camera_list) != 2 or len(obs["data"].get("state", [])) != 8:
            raise RuntimeError("Recording lacks the two policy cameras or eight-state input.")
        if any(obs["data"].get(key) not in artifacts for key in ("stateArtifactId", "promptArtifactId")):
            raise RuntimeError("Recording lacks original state or prompt bytes.")
        for camera in cameras.values():
            artifact = artifacts.get(camera.get("artifactId"), {})
            if artifact.get("mediaType") != "image/png" or artifact.get("shape") != [224, 224, 3] or artifact.get("dtype") != "uint8":
                raise RuntimeError("Recording camera is not the lossless policy-interface image.")
            raw = base64.b64decode(bundle["payloads"][artifact["path"]], validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != "PNG" or image.size != (224, 224) or image.mode != "RGB":
                    raise RuntimeError("Recorded camera dimensions do not match the worker contract.")
                image.verify()
    return manifest


def run_probe(request, output, max_seconds=600, *, finalize_seconds=30, sleep=time.sleep, clock=time.monotonic):
    output = Path(output)
    def save(name, value):
        with (output / (name + ".json")).open("x", encoding="utf-8") as destination:
            json.dump(value, destination, indent=2)
            destination.write("\n")

    def save_frame(name, frame):
        save(name, frame)
        if {camera.get("id") for camera in frame.get("cameras", [])} != {"spectator", "agentview", "wrist"}:
            raise RuntimeError("Expected three distinct worker camera views.")
        for camera in frame["cameras"]:
            prefix, encoded = camera.get("url", "").split(",", 1)
            if prefix != "data:image/jpeg;base64":
                raise RuntimeError("Expected actual worker JPEG preview frames.")
            pixels = base64.b64decode(encoded, validate=True)
            with Image.open(io.BytesIO(pixels)) as image:
                if image.format != "JPEG" or image.width > 4096 or image.height > 4096:
                    raise RuntimeError("Worker preview is not a bounded JPEG image.")
                image.verify()
            (output / (name + "-" + camera["id"] + ".jpg")).write_bytes(pixels)

    def completed_bundle(recording):
        path = "/v1/recordings/" + urllib.parse.quote(recording, safe="")
        deadline = clock() + finalize_seconds
        while True:
            manifest = request("GET", path)
            status = manifest.get("completion", {}).get("status")
            if status == "complete":
                return request("GET", path + "/bundle", max_bytes=MAX_BUNDLE_BYTES)
            if status != "recording" or clock() >= deadline:
                raise RuntimeError("Recording is partial or failed to finalize before the bounded deadline.")
            sleep(0.1)

    request("GET", "/v1/capabilities", auth=False, expected=401)
    request("GET", "/v1/capabilities", origin="https://rejected-origin.invalid", expected=403)
    capabilities = request("GET", "/v1/capabilities")
    profile = next((item for item in capabilities.get("profiles", []) if item.get("id") == PROFILE_ID), {})
    revision = profile.get("checkpointRevision", "")
    expected_profile = profile_contract(revision)
    if (profile.get("ready") is not True or not re.fullmatch(r"sha256:[a-f0-9]{64}", revision)
            or any(profile.get(key) != value for key, value in expected_profile.items())):
        raise RuntimeError("Worker readiness or pinned Panda + pi05 LIBERO profile failed acceptance.")
    recording_capability = capabilities.get("recordings", {})
    if recording_capability.get("schema") != SCHEMA or recording_capability.get("readOnly") is not True:
        raise RuntimeError("Worker does not advertise the current durable recording contract.")
    save("capabilities", capabilities)
    session_id = None

    def create(protocol):
        return request("POST", "/v1/sessions", {"version": 1, "profileId": PROFILE_ID,
                       "robotId": "panda", "modelId": "pi05", "checkpoint": CHECKPOINT,
                       "task": "libero_spatial:0", "seed": 7, "protocol": protocol})

    def command(kind, payload=None, expected=200):
        return request("POST", f"/v1/sessions/{session_id}/commands", {"version": 1, "type": kind,
                       "payload": payload or {}, "requestId": uuid.uuid4().hex}, expected=expected)

    try:
        session = create("practice")
        session_id = session["sessionId"]
        initial = session["frame"]
        if initial.get("policyExecuted") is not False:
            raise RuntimeError("An unstepped session claimed to have executed the policy.")
        save_frame("practice-initial", initial)
        stepped = command("step")["frame"]
        policy_cameras = [camera for camera in stepped.get("cameras", []) if camera.get("role") == "policy"]
        if (stepped.get("policyExecuted") is not True or stepped["metrics"]["steps"] != 1
                or stepped["metrics"]["inferenceCount"] != 1 or stepped["simTime"] <= initial["simTime"]
                or {camera.get("id") for camera in policy_cameras} != {"agentview", "wrist"}
                or len(policy_cameras) != 2 or any(camera.get("consumedByPolicy") is not True for camera in policy_cameras)):
            raise RuntimeError("The real step did not establish physics, inference and consumed policy cameras.")
        save_frame("practice-step", stepped)
        save("practice-evidence", request("GET", f"/v1/sessions/{session_id}/evidence"))
        practice_id, practice_session = recording_id(stepped), session_id
        practice_outcome = stepped["status"] if stepped["status"] in ("succeeded", "failed") else "interrupted"
        reset = command("reset")["frame"]
        if recording_id(reset) == practice_id or reset.get("policyExecuted") is not False or reset["metrics"]["steps"] != 0:
            raise RuntimeError("Reset did not start a distinct unstepped episode.")
        # Reset finalizes the prior recording. Deletion must not remove it.
        before_delete = completed_bundle(practice_id)
        verify_execution_bundle(before_delete, recording=practice_id, session=practice_session, profile=profile,
                                protocol="practice", steps=1, outcome=practice_outcome)
        request("DELETE", f"/v1/sessions/{session_id}")
        session_id = None
        after_delete = completed_bundle(practice_id)
        verify_execution_bundle(after_delete, recording=practice_id, session=practice_session, profile=profile,
                                protocol="practice", steps=1, outcome=practice_outcome)
        if before_delete["manifestSha256"] != after_delete["manifestSha256"]:
            raise RuntimeError("The finalized recording changed after session deletion.")
        save("practice-recording", after_delete)

        session = create("benchmark")
        session_id = session["sessionId"]
        command("intervene", {"kind": "camera-occlusion", "enabled": True, "fraction": 0.35}, expected=409)
        command("run")
        deadline = clock() + max_seconds
        while clock() < deadline:
            frame = request("GET", f"/v1/sessions/{session_id}/frame")
            if frame["status"] in ("succeeded", "failed", "error"):
                break
            sleep(1)
        else:
            raise RuntimeError("Formal episode exceeded the bounded deadline; session will be closed.")
        save_frame("benchmark-final", frame)
        evidence = request("GET", f"/v1/sessions/{session_id}/evidence")
        save("benchmark-evidence", evidence)
        steps, success = frame["metrics"]["steps"], frame["metrics"]["success"]
        terminal = ((frame["status"] == "succeeded" and success is True and 1 <= steps <= MAX_STEPS)
                    or (frame["status"] == "failed" and success is False and steps == MAX_STEPS))
        if not terminal or frame.get("policyExecuted") is not True or len(evidence.get("steps", [])) != steps:
            raise RuntimeError("Formal episode did not end at check_success or the exact 220-step horizon.")
        formal_id, formal_session = recording_id(frame), session_id
        request("DELETE", f"/v1/sessions/{session_id}")
        session_id = None
        bundle = completed_bundle(formal_id)
        manifest = verify_execution_bundle(bundle, recording=formal_id, session=formal_session, profile=profile,
                                           protocol="benchmark", steps=steps, outcome=frame["status"])
        if manifest["outcome"].get("success") is not success:
            raise RuntimeError("Archived task result does not match the terminal frame.")
        save("benchmark-recording", bundle)
        summary = {"transportAndExecutionPassed": True, "durableRecordingsPassed": True,
                   "resetArchivePreserved": True, "archivesReadableAfterDeletion": True,
                   "episodeOutcome": frame["status"], "taskSuccess": success, "metrics": frame["metrics"],
                   "checkpointRevision": revision, "recordings": {
                       "practice": {"id": practice_id, "manifestSha256": after_delete["manifestSha256"]},
                       "formal": {"id": formal_id, "manifestSha256": bundle["manifestSha256"]}},
                   "claim": "One bounded LIBERO Spatial episode; producer-reported execution, not independent attestation, aggregate score, or container-restart persistence."}
        save("summary", summary)
        return summary
    finally:
        if session_id:
            request("DELETE", f"/v1/sessions/{session_id}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8081")
    parser.add_argument("--origin", default="https://www.brainsnn.com")
    parser.add_argument("--out", required=True, help="New private directory for previews and verified recording bundles")
    parser.add_argument("--max-seconds", type=int, default=600)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.url)
    if (parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/")
            or (parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"))):
        parser.error("Use an HTTPS base URL, or literal loopback HTTP; no credentials, paths or redirects.")
    if not 30 <= args.max_seconds <= 900:
        parser.error("--max-seconds must be 30 through 900.")
    token = os.environ.get("ARENA_TOKEN", "")
    if len(token) < 32:
        parser.error("Set the private ARENA_TOKEN environment value, at least 32 characters.")
    output = Path(args.out)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    summary = run_probe(ProbeHTTP(args.url, args.origin, token), output, args.max_seconds)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
