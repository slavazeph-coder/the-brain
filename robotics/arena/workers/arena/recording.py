"""Bounded producer recordings; exact bytes, never an attestation of model truth.

The control thread only copies inputs into owned bytes and uses put_nowait. The
writer owns compression, hashing and fsync. On the first loss it stops accepting
records: the archive remains a contiguous committed prefix with an unknown tail.
No complete marker exists until every accepted artifact and event is durable.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import queue
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone

import numpy as np
from PIL import Image

SCHEMA = "brainsnn.arena.recording.v1"
BUNDLE_SCHEMA = "brainsnn.arena.bundle.v1"
MAX_MANIFEST_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 128 * 1024 * 1024
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
MAX_TOTAL_ARTIFACT_BYTES = 96 * 1024 * 1024
MAX_EVENTS = 20000
MAX_ARTIFACTS = 4096
MAX_JSON_NODES = 500000
FINALIZATION_RESERVE_BYTES = 64 * 1024
FINALIZATION_RESERVE_NODES = 2048
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class RecordingError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _json_safe(value, depth=0):
    stack, ancestors, nodes = [(value, depth, False)], set(), 0
    while stack:
        item, level, leaving = stack.pop()
        if leaving:
            ancestors.remove(id(item))
            continue
        nodes += 1
        if level > 32 or nodes > MAX_JSON_NODES:
            raise RecordingError("limit_exceeded", "JSON exceeds depth or element limits.")
        if isinstance(item, str):
            if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                raise RecordingError("invalid_unicode", "Strings must contain Unicode scalar values.")
        elif item is None or isinstance(item, bool):
            pass
        elif isinstance(item, (int, float)):
            if ((isinstance(item, int) and abs(item) > 9007199254740991)
                    or (isinstance(item, float) and (not math.isfinite(item)
                        or (item.is_integer() and abs(item) > 9007199254740991)))):
                raise RecordingError("unsafe_number", "Non-finite numbers and unsafe integers are unsupported.")
        elif isinstance(item, (list, dict)):
            if id(item) in ancestors:
                raise RecordingError("invalid_json", "Cyclic JSON is unsupported.")
            ancestors.add(id(item))
            stack.append((item, level, True))
            if isinstance(item, dict):
                if any(not isinstance(key, str) or key in ("__proto__", "constructor", "prototype")
                       or any(0xD800 <= ord(char) <= 0xDFFF for char in key) for key in item):
                    raise RecordingError("unsafe_key", "Unsupported JSON object key.")
                children = item.values()
            else:
                children = item
            stack.extend((child, level + 1, False) for child in children)
        else:
            raise RecordingError("invalid_json", "Recording values must be plain JSON data.")
    return nodes


def canonical_json(value):
    """Producer serialization only. Consumers hash these exact bytes, not a re-encoding."""
    _json_safe(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _parse_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RecordingError("invalid_recording", "Duplicate JSON keys are unsupported.")
            result[key] = value
        return result
    try:
        result = json.loads(raw, object_pairs_hook=pairs)
        _json_safe(result)
        return result
    except (ValueError, UnicodeError, TypeError, RecursionError) as error:
        raise RecordingError("invalid_recording", "Invalid recording JSON.") from error


def _path_name(value):
    if (not isinstance(value, str) or len(value) > 240 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", value)
            or any(part in ("", ".", "..") or part.endswith((".", " "))
                   or re.match(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", part, re.I)
                   for part in value.split("/"))):
        raise RecordingError("invalid_recording_path", "Artifact paths must be relative, unambiguous and contained.")
    return value


def _identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise RecordingError("invalid_recording_id", "Invalid recording identifier.")
    return value


def _count(value):
    return (not isinstance(value, bool) and ((isinstance(value, int) and 0 <= value <= 9007199254740991)
            or (isinstance(value, float) and math.isfinite(value) and value.is_integer()
                and 0 <= value <= 9007199254740991)))


def validate_manifest(manifest):
    """Same bounded contract as arena-recording.js; bookkeeping is not truth."""
    _json_safe(manifest)
    def require(condition, message):
        if not condition:
            raise RecordingError("invalid_recording", message)
    def bounded(value, count, name):
        require(isinstance(value, list) and len(value) <= count, name + " must be a bounded array.")
    def references(value):
        bounded(value, MAX_EVENTS, "References")
        require(all(isinstance(x, str) and IDENTIFIER.fullmatch(x) for x in value)
                and len(set(value)) == len(value), "Invalid or duplicate evidence references.")
    require(isinstance(manifest, dict) and manifest.get("schema") == SCHEMA, "Unsupported recording schema.")
    _identifier(manifest.get("recordingId"))
    source = manifest.get("source")
    require(isinstance(source, dict) and source.get("kind") in
            ("scripted-practice", "simulator-policy", "robot-observed", "imported")
            and source.get("identityStatus") == "declared", "Declared source identity is required.")
    require(isinstance(manifest.get("context"), dict) and isinstance(manifest.get("outcome"), dict)
            and manifest["outcome"].get("status") in ("succeeded", "failed", "interrupted", "unknown"),
            "Context and explicit outcome are required.")
    clocks = manifest.get("clocks")
    bounded(clocks, 256, "Clocks")
    clock_ids = set()
    for clock in clocks:
        require(isinstance(clock, dict), "Clock must be an object.")
        if "id" in clock:
            cid = _identifier(clock["id"])
            require(cid not in clock_ids, "Clock IDs must be unique.")
            clock_ids.add(cid)
    events, artifacts, findings = (manifest.get(key) for key in ("events", "artifacts", "findings"))
    bounded(events, MAX_EVENTS, "Events")
    bounded(artifacts, MAX_ARTIFACTS, "Artifacts")
    bounded(findings, 4000, "Findings")
    all_ids, event_ids, artifact_ids, paths, graph = set(), set(), set(), set(), {}
    def add_id(value):
        _identifier(value)
        require(value not in all_ids, "Evidence IDs must be globally unique.")
        all_ids.add(value)
    dtype_bytes = {"uint8": 1, "int8": 1, "uint16": 2, "int16": 2, "uint32": 4, "int32": 4,
                   "uint64": 8, "int64": 8, "float16": 2, "float32": 4, "float64": 8, "bool": 1}
    total = 0
    for artifact in artifacts:
        require(isinstance(artifact, dict), "Artifact must be an object.")
        aid, path = artifact.get("id"), _path_name(artifact.get("path"))
        add_id(aid)
        artifact_ids.add(aid)
        require(path.lower() not in paths, "Artifact paths must not collide, including letter case.")
        paths.add(path.lower())
        length, mime = artifact.get("byteLength"), artifact.get("mediaType")
        require(isinstance(artifact.get("sha256"), str) and SHA256.fullmatch(artifact["sha256"])
                and _count(length), "Artifact needs full SHA256 and safe integer byteLength.")
        require(isinstance(mime, str) and re.fullmatch(r"[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9= .+-]+)?", mime, re.I),
                "Artifact needs a valid media type.")
        require(artifact.get("retention") in ("included", "omitted"), "Artifact retention must be explicit.")
        included = artifact["retention"] == "included"
        require(not included or length <= MAX_ARTIFACT_BYTES, "Included artifact exceeds byte limit.")
        require(artifact.get("kind") not in ("symlink", "hardlink", "executable")
                and "linkTarget" not in artifact and "url" not in artifact, "Artifacts cannot instruct remote fetch or link execution.")
        total += length if included else 0
        if any(key in artifact for key in ("shape", "dtype", "endianness")):
            shape, dtype = artifact.get("shape"), artifact.get("dtype")
            require(isinstance(shape, list) and 0 < len(shape) <= 8 and all(_count(n) and n > 0 for n in shape),
                    "Arrays require positive bounded dimensions.")
            require(isinstance(dtype, str) and dtype in dtype_bytes
                    and artifact.get("endianness") in ("little", "big", "not-applicable"), "Invalid array dtype or endianness.")
            size = math.prod(shape) * dtype_bytes[dtype]
            require(_count(size) and (not included or size <= MAX_TOTAL_ARTIFACT_BYTES), "Decoded array exceeds its limit.")
            require(mime != "application/octet-stream" or size == length, "Array shape/dtype does not match byteLength.")
        if "derivedFrom" in artifact:
            references(artifact["derivedFrom"])
            graph[aid] = artifact["derivedFrom"]
    require(total <= MAX_TOTAL_ARTIFACT_BYTES, "Included artifacts exceed total byte limit.")
    last = 0
    for event in events:
        require(isinstance(event, dict), "Event must be an object.")
        eid, seq = event.get("id"), event.get("seq")
        add_id(eid)
        event_ids.add(eid)
        require(_count(seq) and seq > last and isinstance(event.get("kind"), str)
                and IDENTIFIER.fullmatch(event["kind"]) and isinstance(event.get("data"), dict), "Invalid event sequence, kind or data.")
        last = seq
        references(event.get("refs"))
        references(event.get("artifactIds"))
        graph[eid] = event["refs"]
        if "simTime" in event:
            value = event["simTime"]
            require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0,
                    "Simulation time must be nonnegative.")
        if "monotonicNs" in event:
            require(isinstance(event["monotonicNs"], str) and re.fullmatch(r"[0-9]{1,30}", event["monotonicNs"]),
                    "Nanoseconds must be decimal strings.")
    for finding in findings:
        require(isinstance(finding, dict), "Finding must be an object.")
        add_id(finding.get("id"))
        require(finding.get("origin") in ("fact", "rule", "hypothesis", "human")
                and isinstance(finding.get("summary"), str) and 0 < len(finding["summary"]) <= 10000,
                "Finding needs an origin and bounded summary.")
        references(finding.get("refs"))
        require(len(finding["refs"]) > 0, "Every finding must cite evidence.")
        graph[finding["id"]] = finding["refs"]
    for event in events:
        require(set(event["refs"]).issubset(event_ids) and set(event["artifactIds"]).issubset(artifact_ids), "Missing event/artifact reference.")
        data = event["data"]
        if "cameras" in data:
            require(isinstance(data["cameras"], list), "Camera references must be an array.")
            for camera in data["cameras"]:
                require(isinstance(camera, dict), "Camera reference must be an object.")
                if camera.get("artifactId") is not None:
                    require(camera["artifactId"] in event["artifactIds"], "Camera artifact is not declared by the event.")
                else:
                    require(camera.get("available") is False, "Missing camera evidence must be explicit.")
        for key in ("stateArtifactId", "sourceStateArtifactId", "promptArtifactId", "actionsArtifactId"):
            if data.get(key) is not None:
                require(data[key] in event["artifactIds"], "Typed artifact reference is not declared by the event.")
        for key in ("observationId", "controllerInputId", "chunkId", "discardedChunkId"):
            if data.get(key) is not None:
                require(isinstance(data[key], str) and data[key] in event_ids, "Typed event reference does not resolve.")
    for artifact in artifacts:
        require(set(artifact.get("derivedFrom", [])).issubset(artifact_ids), "Missing artifact lineage reference.")
    for finding in findings:
        require(set(finding["refs"]).issubset(all_ids), "Missing finding evidence reference.")
    visited, active = set(), set()
    for node in all_ids:
        if node in visited:
            continue
        stack = [(node, False)]
        while stack:
            current, leaving = stack.pop()
            if leaving:
                active.remove(current)
                visited.add(current)
                continue
            require(current not in active, "Evidence references contain a cycle.")
            if current in visited:
                continue
            active.add(current)
            stack.append((current, True))
            stack.extend((ref, False) for ref in graph.get(current, []))
    completion = manifest.get("completion")
    require(isinstance(completion, dict) and completion.get("status") in ("recording", "complete", "partial"), "Invalid completion status.")
    observed, committed, gaps = (completion.get(key) for key in ("lastObservedSequence", "committedSequence", "gapCount"))
    require(all(_count(x) for x in (observed, committed, gaps)) and type(completion.get("unknownTail")) is bool
            and last <= committed <= observed, "Invalid recording coverage.")
    if completion["status"] == "complete":
        require(not gaps and not completion["unknownTail"] and last == committed == observed
                and all(event["seq"] == index + 1 for index, event in enumerate(events))
                and all(a["retention"] == "included" for a in artifacts), "Incomplete evidence cannot be labeled complete.")
    return manifest


def seal_bundle(manifest, artifacts):
    """Create a portable bundle from a manifest and {relative_path: exact bytes}."""
    validate_manifest(manifest)
    if not isinstance(artifacts, dict) or set(artifacts) != {a["path"] for a in manifest["artifacts"] if a["retention"] == "included"}:
        raise RecordingError("invalid_recording", "Payload paths must match all included artifacts exactly.")
    text = canonical_json(manifest)
    if len(text) > MAX_MANIFEST_BYTES:
        raise RecordingError("recording_too_large", "Manifest exceeds its size limit.", 413)
    payloads = {}
    size = len(text)
    for item in manifest["artifacts"]:
        if item["retention"] == "omitted":
            continue
        raw = artifacts.get(item["path"])
        if not isinstance(raw, bytes) or len(raw) != item["byteLength"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise RecordingError("artifact_integrity_failed", "An original artifact is missing or changed.", 409)
        size += 4 * ((len(raw) + 2) // 3)
        if size > MAX_BUNDLE_BYTES - MAX_MANIFEST_BYTES:
            raise RecordingError("recording_too_large", "Use individual artifact downloads for this recording.", 413)
        payloads[item["path"]] = base64.b64encode(raw).decode("ascii")
    return {"schema": BUNDLE_SCHEMA, "manifestText": text.decode("utf-8"),
            "manifestSha256": hashlib.sha256(text).hexdigest(), "payloads": payloads}


def verify_bundle(bundle):
    if (not isinstance(bundle, dict) or bundle.get("schema") != BUNDLE_SCHEMA
            or set(bundle) != {"schema", "manifestText", "manifestSha256", "payloads"}):
        raise RecordingError("unsupported_recording", "Unsupported recording bundle.")
    text, payloads = bundle.get("manifestText"), bundle.get("payloads")
    if not isinstance(text, str) or not isinstance(payloads, dict):
        raise RecordingError("invalid_recording", "A manifest and payload map are required.")
    raw = text.encode("utf-8")
    if len(raw) > MAX_MANIFEST_BYTES or hashlib.sha256(raw).hexdigest() != bundle.get("manifestSha256"):
        raise RecordingError("manifest_integrity_failed", "The recording manifest is oversized or changed.", 409)
    manifest = validate_manifest(_parse_json(raw))
    included = {a["path"]: a for a in manifest["artifacts"] if a["retention"] == "included"}
    if set(payloads) != set(included):
        raise RecordingError("invalid_recording", "Payload paths do not match included artifacts.")
    size = len(raw)
    for path, encoded in payloads.items():
        if not isinstance(encoded, str):
            raise RecordingError("invalid_recording", "Artifact payloads must be base64 strings.")
        size += len(encoded)
        if size > MAX_BUNDLE_BYTES or len(encoded) > 4 * ((MAX_ARTIFACT_BYTES + 2) // 3):
            raise RecordingError("recording_too_large", "Recording exceeds its size limit.", 413)
        try:
            data = base64.b64decode(encoded, validate=True)
            if base64.b64encode(data).decode("ascii") != encoded:
                raise ValueError("Noncanonical base64")
        except (ValueError, TypeError) as error:
            raise RecordingError("invalid_recording", "Invalid base64 artifact.") from error
        item = included[path]
        if len(data) != item["byteLength"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise RecordingError("artifact_integrity_failed", "An original artifact is missing or changed.", 409)
    return manifest


def _fsync_dir(path):
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic(path, raw):
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        _fsync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _owned_array(value, *, image=False):
    array = np.asarray(value)
    if array.dtype.kind not in "biuf" or array.nbytes > MAX_ARTIFACT_BYTES:
        raise RecordingError("invalid_recording_array", "Only bounded numeric arrays can be recorded.")
    if image and (array.dtype != np.uint8 or array.ndim != 3 or array.shape[2] != 3):
        raise RecordingError("invalid_recording_array", "Policy images must be uint8 RGB arrays.")
    endian = array.dtype.byteorder
    return {"raw": array.tobytes(order="C"), "shape": list(array.shape), "dtype": array.dtype.name,
            "numpyDtype": array.dtype.str, "endianness": "not-applicable" if array.dtype.itemsize == 1
            else ("little" if endian == "<" or (endian == "=" and np.little_endian) else "big"),
            "image": image}


class RecordingWriter:
    def __init__(self, archive, manifest, queue_size=64, max_bytes=64 * 1024 * 1024):
        self.archive = archive
        self.manifest = copy.deepcopy(manifest)
        self.header_bytes = canonical_json(self.manifest)
        self.manifest_nodes = _json_safe(self.manifest)
        self.journal_bytes = 0
        if (len(self.header_bytes) + FINALIZATION_RESERVE_BYTES > MAX_MANIFEST_BYTES
                or self.manifest_nodes + FINALIZATION_RESERVE_NODES > MAX_JSON_NODES
                or 2 * len(self.header_bytes) + FINALIZATION_RESERVE_BYTES + 8192 > max_bytes):
            raise RecordingError("recording_too_large", "Recording metadata leaves no room for a durable manifest.")
        self.id = _identifier(manifest["recordingId"])
        self.directory = archive.root / self.id
        self.directory.mkdir(mode=0o700)
        (self.directory / "artifacts").mkdir(mode=0o700)
        self.queue = queue.Queue(maxsize=queue_size)
        self.max_bytes = max_bytes
        self.observed = self.committed = self.gaps = self.total_bytes = 0
        self.queued_bytes = 0
        self.queue_byte_limit = min(max_bytes, 32 * 1024 * 1024)
        self.capture_ns = self.writer_ns = self.peak_queued_bytes = 0
        self.events, self.artifacts = [], []
        self.loss = False
        self.accepting = True
        self.finished = threading.Event()
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.outcome = {"status": "unknown"}
        self.reason = None
        self.error = None
        try:
            # Publish ownership before the header so another finishing writer's
            # retention sweep cannot mistake this new directory for an archive.
            _atomic(self.directory / "active.json", canonical_json({"pid": os.getpid()}))
            _atomic(self.directory / "header.json", self.header_bytes)
            _atomic(self.directory / "progress.json", canonical_json({"committedSequence": 0, "gapCount": 0}))
            _fsync_dir(archive.root)
        except OSError:
            (self.directory / "active.json").unlink(missing_ok=True)
            raise
        self.thread = threading.Thread(target=self._run, name="arena-recording-" + self.id[:8], daemon=True)
        self.thread.start()

    def record(self, kind, *, data=None, refs=(), arrays=None, texts=None, sim_time=None, episode_id=None):
        """Copies mutable data before returning; never waits on disk or queue capacity."""
        capture_started = time.monotonic_ns()
        with self.lock:
            if not self.accepting:
                return None
            self.observed += 1
            seq = self.observed
            if self.loss:
                self.gaps += 1
                return None
        eid = "e" + str(seq)
        try:
            owned, descriptions = [], {}
            for name, specification in (arrays or {}).items():
                _identifier(name)
                value, image = specification if isinstance(specification, tuple) else (specification, False)
                item = _owned_array(value, image=image)
                item.update({"id": eid + "-" + name, "name": name})
                descriptions[name] = item["id"]
                owned.append(item)
            for name, value in (texts or {}).items():
                _identifier(name)
                raw = str(value).encode("utf-8")
                if len(raw) > MAX_ARTIFACT_BYTES:
                    raise RecordingError("recording_too_large", "Text artifact exceeds its size limit.")
                item = {"id": eid + "-" + name, "name": name, "raw": raw, "text": True}
                descriptions[name] = item["id"]
                owned.append(item)
            payload = data(eid, descriptions) if callable(data) else (data or {})
            event = {"id": eid, "seq": seq, "kind": str(kind), "episodeId": episode_id or self.manifest["episodeId"],
                     "monotonicNs": str(time.monotonic_ns()),
                     "refs": list(dict.fromkeys(ref for ref in refs if ref)),
                     "artifactIds": [item["id"] for item in owned], "data": copy.deepcopy(payload)}
            if sim_time is not None:
                event["simTime"] = sim_time
            event_bytes = canonical_json(event)
            if seq > MAX_EVENTS:
                raise RecordingError("recording_too_large", "Event count exceeds its limit.")
            size = len(event_bytes) + sum(len(item["raw"]) for item in owned)
            with self.lock:
                if self.queued_bytes + size > self.queue_byte_limit:
                    raise RecordingError("recording_too_large", "Recording queue byte limit reached.")
                self.queued_bytes += size
                self.peak_queued_bytes = max(self.peak_queued_bytes, self.queued_bytes)
            try:
                self.queue.put_nowait((event, owned, size))
            except queue.Full:
                with self.lock:
                    self.queued_bytes -= size
                raise
            return eid
        except Exception:
            self._lose("capture_or_queue_limit")
            return None
        finally:
            with self.lock:
                self.capture_ns += time.monotonic_ns() - capture_started

    def _lose(self, reason):
        with self.lock:
            self.loss = True
            self.gaps += 1
            self.error = reason

    def finish(self, outcome, reason="episode_finished"):
        # Reserve final metadata before committing any event. Even a caller's
        # unexpectedly large outcome cannot make the durable prefix unreadable.
        try:
            footer = {"outcome": outcome, "reason": reason}
            if (len(canonical_json(footer)) > FINALIZATION_RESERVE_BYTES // 2
                    or _json_safe(footer, depth=1) > FINALIZATION_RESERVE_NODES // 2):
                raise RecordingError("recording_too_large", "Final outcome exceeds its reserved size.")
        except Exception:
            self._lose("outcome_limit")
            outcome, reason = {"status": "unknown"}, "outcome_limit"
        with self.lock:
            if not self.accepting:
                return
            self.accepting = False
            self.outcome = copy.deepcopy(outcome)
            self.reason = reason
        self.stop.set()

    def wait(self, timeout=5):
        return self.finished.wait(timeout)

    def summary(self):
        return {"recordingId": self.id, "status": "partial" if self.loss else
                ("complete" if self.finished.is_set() else "finalizing" if self.stop.is_set() else "recording"),
                "manifestPath": f"/v1/recordings/{self.id}", "bundlePath": f"/v1/recordings/{self.id}/bundle"}

    def _write_item(self, event, owned, journal):
        if len(self.artifacts) + len(owned) > MAX_ARTIFACTS:
            raise RecordingError("recording_too_large", "Recording artifact count limit reached.")
        descriptions, payloads = [], []
        for item in owned:
            raw = item["raw"]
            if item.get("image"):
                array = np.frombuffer(raw, dtype=item["numpyDtype"]).reshape(item["shape"])
                stream = io.BytesIO()
                Image.fromarray(array).save(stream, format="PNG", compress_level=1)
                raw = stream.getvalue()
            extension = "png" if item.get("image") else "txt" if item.get("text") else "bin"
            path = "artifacts/" + item["id"] + "." + extension
            if len(raw) > MAX_ARTIFACT_BYTES:
                raise RecordingError("recording_too_large", "Recording storage limit reached.")
            description = {"id": item["id"], "path": path, "sha256": hashlib.sha256(raw).hexdigest(),
                           "byteLength": len(raw), "mediaType": "image/png" if item.get("image") else
                           "text/plain; charset=utf-8" if item.get("text") else "application/octet-stream",
                           "retention": "included"}
            for key in ("shape", "dtype", "endianness"):
                if key in item:
                    description[key] = item[key]
            descriptions.append(description)
            payloads.append((path, raw))
        entry_value = {"event": event, "artifacts": descriptions}
        entry_nodes = _json_safe(entry_value, depth=1)
        entry = canonical_json(entry_value) + b"\n"
        next_journal_bytes = self.journal_bytes + len(entry)
        next_artifact_bytes = self.total_bytes + sum(len(raw) for _, raw in payloads)
        # The JSONL entry includes more punctuation than its final manifest
        # representation. This conservative cumulative bound protects both
        # finalization and crash recovery before acknowledging a watermark.
        if (len(self.header_bytes) + next_journal_bytes + FINALIZATION_RESERVE_BYTES > MAX_MANIFEST_BYTES
                or self.manifest_nodes + entry_nodes + FINALIZATION_RESERVE_NODES > MAX_JSON_NODES
                or next_artifact_bytes + 2 * next_journal_bytes + 2 * len(self.header_bytes)
                   + FINALIZATION_RESERVE_BYTES + 8192 > self.max_bytes):
            raise RecordingError("recording_too_large", "Recording journal or total storage limit reached.")
        for path, raw in payloads:
            _atomic(self.directory / path, raw)
        journal.write(entry)
        journal.flush()
        os.fsync(journal.fileno())
        # The watermark is acknowledged only after both artifacts and journal.
        _atomic(self.directory / "progress.json", canonical_json({"committedSequence": event["seq"],
                                                                 "gapCount": self.gaps}))
        self.events.append(event)
        self.artifacts.extend(descriptions)
        self.total_bytes = next_artifact_bytes
        self.journal_bytes = next_journal_bytes
        self.manifest_nodes += entry_nodes
        self.committed = event["seq"]

    def _run(self):
        storage_failed = False
        try:
            with (self.directory / "events.jsonl").open("ab") as journal:
                while not self.stop.is_set() or not self.queue.empty():
                    try:
                        item = self.queue.get(timeout=0.05)
                    except queue.Empty:
                        continue
                    try:
                        if not storage_failed:
                            write_started = time.monotonic_ns()
                            self._write_item(item[0], item[1], journal)
                            self.writer_ns += time.monotonic_ns() - write_started
                    except Exception:
                        storage_failed = True
                        self._lose("storage_write_failed")
                    finally:
                        with self.lock:
                            self.queued_bytes -= item[2]
                        self.queue.task_done()
            with self.lock:
                manifest = copy.deepcopy(self.manifest)
                manifest.update({"events": self.events, "artifacts": self.artifacts, "outcome": self.outcome,
                                 "completion": {"status": "partial" if self.loss else "complete",
                                                "committedSequence": self.committed,
                                                "lastObservedSequence": self.observed,
                                                "gapCount": max(self.gaps, self.observed - self.committed),
                                                "unknownTail": self.loss, "reason": self.reason,
                                                "durability": "artifact+event+manifest fsync before final marker",
                                                "recordingMetrics": {"captureNanoseconds": str(self.capture_ns),
                                                    "writerNanoseconds": str(self.writer_ns), "peakQueuedBytes": self.peak_queued_bytes,
                                                    "artifactBytes": self.total_bytes}}})
            validate_manifest(manifest)
            text = canonical_json(manifest)
            if len(text) > MAX_MANIFEST_BYTES:
                raise RecordingError("recording_too_large", "Manifest exceeds limit.")
            _atomic(self.directory / "manifest.json", text)
            _atomic(self.directory / "finalized.json", canonical_json({"manifestSha256": hashlib.sha256(text).hexdigest()}))
        except Exception:
            self._lose("finalization_failed")
        finally:
            try:
                (self.directory / "active.json").unlink(missing_ok=True)
                _fsync_dir(self.directory)
            except OSError:
                pass
            try:
                self.archive.prune()
            finally:
                self.finished.set()


class RecordingArchive:
    """Filesystem reads never call the simulation process or acquire its command lock."""
    def __init__(self, root, *, max_recordings=50, max_bytes=1024 * 1024 * 1024,
                 retention_seconds=7 * 86400, recording_max_bytes=64 * 1024 * 1024, queue_size=64):
        self.root = Path(root).expanduser().resolve()
        self.max_recordings, self.max_bytes = max_recordings, max_bytes
        self.retention_seconds, self.recording_max_bytes = retention_seconds, recording_max_bytes
        self.queue_size = queue_size
        self.prune_lock = threading.Lock()

    def create(self, metadata):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.prune()
        recording_id = uuid.uuid4().hex
        manifest = {"schema": SCHEMA, "recordingId": recording_id,
                    "createdAt": datetime.now(timezone.utc).isoformat(), **copy.deepcopy(metadata),
                    "events": [], "artifacts": [], "findings": [], "clocks": metadata.get("clocks", []),
                    "completion": {"status": "recording", "committedSequence": 0, "lastObservedSequence": 0,
                                   "gapCount": 0, "unknownTail": True}, "outcome": {"status": "unknown"}}
        validate_manifest(manifest)
        try:
            return RecordingWriter(self, manifest, self.queue_size, self.recording_max_bytes)
        except OSError as error:
            raise RecordingError("recording_unavailable", "Recording storage is unavailable; the session was not started.", 503) from error

    def _directory(self, recording_id):
        directory = self.root / _identifier(recording_id)
        if directory.is_symlink() or not directory.is_dir():
            raise RecordingError("recording_not_found", "Recording is unavailable or expired by retention.", 404)
        if not self._active(directory) and time.time() - directory.stat().st_mtime > self.retention_seconds:
            raise RecordingError("recording_not_found", "Recording expired by retention.", 404)
        return directory

    @staticmethod
    def _read(path, limit=MAX_MANIFEST_BYTES):
        if path.is_symlink():
            raise RecordingError("invalid_recording_path", "Symlinks are unsupported in recordings.")
        try:
            with path.open("rb") as source:
                raw = source.read(limit + 1)
        except FileNotFoundError as error:
            raise RecordingError("recording_not_found", "Recording artifact is unavailable.", 404) from error
        if len(raw) > limit:
            raise RecordingError("recording_too_large", "Recording file exceeds its size limit.", 413)
        return raw

    @staticmethod
    def _active(directory):
        try:
            pid = _parse_json(RecordingArchive._read(directory / "active.json", 1024))["pid"]
            if type(pid) is not int or pid <= 0:
                return False
            os.kill(pid, 0)
            return True
        except (OSError, RecordingError, KeyError, TypeError):
            return False

    def manifest(self, recording_id):
        directory = self._directory(recording_id)
        if (directory / "finalized.json").is_file():
            marker = _parse_json(self._read(directory / "finalized.json", 1024))
            text = self._read(directory / "manifest.json")
            if hashlib.sha256(text).hexdigest() != marker.get("manifestSha256"):
                raise RecordingError("manifest_integrity_failed", "The stored manifest changed.", 409)
            return validate_manifest(_parse_json(text))
        manifest = _parse_json(self._read(directory / "header.json"))
        progress = _parse_json(self._read(directory / "progress.json", 1024))
        committed = progress.get("committedSequence", 0)
        events, artifacts = [], []
        journal = directory / "events.jsonl"
        if journal.is_file():
            for line in self._read(journal).splitlines():
                try:
                    item = _parse_json(line)
                except RecordingError:
                    break
                if item["event"]["seq"] > committed:
                    break
                events.append(item["event"])
                artifacts.extend(item["artifacts"])
        last = events[-1]["seq"] if events else 0
        if last != committed:
            raise RecordingError("recording_integrity_failed", "Committed journal records are missing.", 409)
        manifest.update({"events": events, "artifacts": artifacts,
                         "completion": {"status": "recording" if self._active(directory) else "partial",
                                        "committedSequence": last, "lastObservedSequence": last,
                                        "gapCount": progress.get("gapCount", 0), "unknownTail": True,
                                        "reason": "No durable final marker; uncommitted tail is unknown."},
                         "outcome": {"status": "unknown"}})
        return validate_manifest(manifest)

    def artifact(self, recording_id, artifact_id, manifest=None):
        _identifier(artifact_id)
        manifest = manifest or self.manifest(recording_id)
        item = next((a for a in manifest["artifacts"] if a["id"] == artifact_id), None)
        if item is None or item["retention"] != "included":
            raise RecordingError("artifact_not_found", "Original artifact is not retained.", 404)
        directory = self._directory(recording_id)
        path = directory / _path_name(item["path"])
        if any(parent.is_symlink() for parent in path.parents if parent != self.root and self.root in parent.parents):
            raise RecordingError("invalid_recording_path", "Symlinked artifact paths are unsupported.")
        raw = self._read(path, MAX_ARTIFACT_BYTES)
        if len(raw) != item["byteLength"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise RecordingError("artifact_integrity_failed", "The stored artifact changed.", 409)
        return item, raw

    def bundle(self, recording_id):
        manifest = self.manifest(recording_id)
        payloads = {item["path"]: self.artifact(recording_id, item["id"], manifest)[1]
                    for item in manifest["artifacts"] if item["retention"] == "included"}
        return seal_bundle(manifest, payloads)

    def list(self, session_id=None):
        results = []
        if self.root.is_dir():
            for directory in sorted(self.root.iterdir(), key=lambda p: p.name):
                if directory.is_symlink() or not directory.is_dir() or not IDENTIFIER.fullmatch(directory.name):
                    continue
                try:
                    manifest = self.manifest(directory.name)
                    if session_id and manifest.get("sessionId") != session_id:
                        continue
                    results.append({"recordingId": directory.name, "sessionId": manifest.get("sessionId"),
                                    "episodeId": manifest.get("episodeId"), "createdAt": manifest.get("createdAt"),
                                    "completion": manifest["completion"], "outcome": manifest["outcome"],
                                    "source": manifest["source"], "context": manifest.get("context", {}),
                                    "manifestPath": f"/v1/recordings/{directory.name}",
                                    "bundlePath": f"/v1/recordings/{directory.name}/bundle"})
                except RecordingError:
                    continue
        results.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
        return {"schema": "brainsnn.arena.recording-list.v1", "recordings": results[:self.max_recordings]}

    def prune(self):
        """Retention is independent of live session TTL; never delete an active writer."""
        with self.prune_lock:
            self._prune()

    def _prune(self):
        try:
            if not self.root.is_dir():
                return
            entries = []
            for directory in self.root.iterdir():
                if directory.is_symlink() or not directory.is_dir() or not IDENTIFIER.fullmatch(directory.name):
                    continue
                if self._active(directory):
                    continue
                if not (directory / "header.json").exists() and time.time() - directory.stat().st_mtime < 60:
                    continue  # A producer can be atomically publishing its first ownership file.
                files = [p for p in directory.rglob("*") if p.is_file() and not p.is_symlink()]
                entries.append((directory.stat().st_mtime, directory, sum(p.stat().st_size for p in files)))
            entries.sort()
            total, count, now = sum(x[2] for x in entries), len(entries), time.time()
            for modified, directory, size in entries:
                if now - modified > self.retention_seconds or count > self.max_recordings or total > self.max_bytes:
                    shutil.rmtree(directory)
                    total -= size
                    count -= 1
        except OSError:
            # A read/export or another writer may race retention. It cannot block control.
            return
