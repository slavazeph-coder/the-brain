"""Run a bounded, real worker acceptance probe; never loads a model itself.

ARENA_TOKEN must be supplied privately in the environment. Outputs contain no
token. A completed episode may be unsuccessful: transport validation is not a
policy quality score. Run only against your configured, trusted arena worker.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8081")
    parser.add_argument("--origin", default="https://www.brainsnn.com")
    parser.add_argument("--out", required=True, help="New directory for evidence and camera images")
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
    opener = urllib.request.build_opener(NoRedirect)
    base = args.url.rstrip("/")

    def request(method, path, data=None, *, auth=True, origin=None, expected=200):
        headers = {"Origin": origin or args.origin}
        if auth:
            headers["Authorization"] = "Bearer " + token
        if data is not None:
            headers["Content-Type"] = "application/json"
        encoded = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(base + path, data=encoded, headers=headers, method=method)
        try:
            with opener.open(req, timeout=100 if method == "POST" and path == "/v1/sessions" else 45) as response:
                status, raw = response.status, response.read(10 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read(10 * 1024 * 1024 + 1)
        if status != expected:
            raise RuntimeError(f"{method} {path}: expected HTTP {expected}, received {status}; inspect private worker logs.")
        if len(raw) > 10 * 1024 * 1024:
            raise RuntimeError("Worker response exceeded 10 MiB.")
        return json.loads(raw)

    def save(name, value):
        (output / (name + ".json")).write_text(json.dumps(value, indent=2) + "\n")

    def save_frame(name, frame):
        save(name, frame)
        for camera in frame.get("cameras", []):
            if camera.get("id") not in ("spectator", "agentview", "wrist"):
                continue
            prefix, encoded = camera.get("url", "").split(",", 1)
            if prefix != "data:image/jpeg;base64":
                raise RuntimeError("Expected actual worker JPEG camera frames.")
            pixels = base64.b64decode(encoded, validate=True)
            if not pixels.startswith(b"\xff\xd8"):
                raise RuntimeError("Worker camera payload is not a JPEG image.")
            (output / (name + "-" + camera["id"] + ".jpg")).write_bytes(pixels)

    request("GET", "/v1/capabilities", auth=False, expected=401)
    request("GET", "/v1/capabilities", origin="https://rejected-origin.invalid", expected=403)
    capabilities = request("GET", "/v1/capabilities")
    profile = next((item for item in capabilities.get("profiles", []) if item.get("id") == "panda-pi05-libero"), {})
    if profile.get("ready") is not True:
        raise RuntimeError("Panda + pi05 LIBERO is not ready; inspect capabilities privately.")
    save("capabilities", capabilities)
    session_id = None

    def create(protocol):
        return request("POST", "/v1/sessions", {"version": 1, "profileId": "panda-pi05-libero",
                       "robotId": "panda", "modelId": "pi05",
                       "checkpoint": "gs://openpi-assets/checkpoints/pi05_libero/",
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
                or len(policy_cameras) != 2 or any(camera.get("consumedByPolicy") is not True for camera in policy_cameras)):
            raise RuntimeError("The real step did not establish physics, inference and consumed policy cameras.")
        save_frame("practice-step", stepped)
        save("practice-evidence", request("GET", f"/v1/sessions/{session_id}/evidence"))
        request("DELETE", f"/v1/sessions/{session_id}")
        session_id = None

        session = create("benchmark")
        session_id = session["sessionId"]
        command("intervene", {"kind": "camera-occlusion", "enabled": True, "fraction": 0.35}, expected=409)
        command("run")
        deadline = time.monotonic() + args.max_seconds
        while time.monotonic() < deadline:
            frame = request("GET", f"/v1/sessions/{session_id}/frame")
            if frame["status"] in ("succeeded", "failed", "error"):
                break
            time.sleep(1)
        else:
            raise RuntimeError("Benchmark exceeded the bounded acceptance deadline; session will be closed.")
        save_frame("benchmark-final", frame)
        evidence = request("GET", f"/v1/sessions/{session_id}/evidence")
        save("benchmark-evidence", evidence)
        if frame["status"] == "error" or not frame.get("policyExecuted") or not evidence.get("steps"):
            raise RuntimeError("Benchmark did not finish valid policy execution; inspect saved evidence.")
        summary = {"transportAndExecutionPassed": True, "episodeOutcome": frame["status"],
                   "taskSuccess": frame["metrics"]["success"], "metrics": frame["metrics"],
                   "checkpointRevision": profile.get("checkpointRevision"),
                   "claim": "One bounded LIBERO Spatial episode; not an aggregate benchmark or availability guarantee."}
        save("summary", summary)
        print(json.dumps(summary, indent=2))
    finally:
        if session_id:
            request("DELETE", f"/v1/sessions/{session_id}")


if __name__ == "__main__":
    main()
