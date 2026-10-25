"""Sequential, operator-owned Arena campaigns, bounded to ten real episodes.

This controls an already provisioned worker. It does not allocate compute,
enforce a cloud spending limit, retry episodes, or independently attest models.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import time
import urllib.parse
import uuid

from workers.arena.core import CHECKPOINT, MAX_STEPS, PROFILE_ID, profile_contract
from workers.arena.recording import MAX_BUNDLE_BYTES, SCHEMA, RecordingError

_spec = importlib.util.spec_from_file_location("arena_campaign_probe", Path(__file__).resolve().parents[1] / "scripts/probe-worker.py")
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)

REPORT_SCHEMA = "brainsnn.campaign.report.v1"
LEDGER_SCHEMA = "brainsnn.campaign.ledger.v1"
PLAN_SCHEMA = "brainsnn.campaign.execution-plan.v1"
MAX_REPORT_BYTES = 2 * 1024 * 1024
DEFAULT_OUTPUT_BYTES = 512 * 1024 * 1024
RESERVE_BYTES = 2 * MAX_REPORT_BYTES
MAX_SEED = 2147483647
STATUSES = ("task_success", "task_miss", "infrastructure_error", "partial_recording", "interrupted", "unattempted")
COMPLETE = {"task_success", "task_miss"}
HEX = re.compile(r"[a-f0-9]{64}")
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}")


class CampaignError(ValueError):
    """A local validation or durable-output failure; no worker call is needed."""


class WallLimit(RuntimeError):
    pass


class OutputLimit(CampaignError):
    pass


class PartialRecording(CampaignError):
    pass


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path, maximum=MAX_REPORT_BYTES):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise CampaignError("Missing, symlinked or oversized campaign input.")
    raw = path.read_bytes()
    if len(raw) > maximum:
        raise CampaignError("Campaign input grew beyond its size limit.")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise CampaignError("Duplicate JSON key in campaign input.")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=pairs,
                           parse_constant=lambda _: (_ for _ in ()).throw(CampaignError("Nonfinite campaign JSON.")))
    except (UnicodeError, json.JSONDecodeError):
        raise CampaignError("Invalid campaign JSON.") from None
    if not isinstance(value, dict):
        raise CampaignError("Campaign inputs must be JSON objects.")
    return value, digest(raw)


def valid_profile(capabilities):
    profiles = [p for p in capabilities.get("profiles", []) if isinstance(p, dict) and p.get("id") == PROFILE_ID]
    if len(profiles) != 1:
        raise CampaignError("Worker must advertise exactly one matched Panda + pi05 profile.")
    profile = profiles[0]
    revision = profile.get("checkpointRevision", "")
    if (profile.get("ready") is not True or not isinstance(revision, str)
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", revision)
            or any(profile.get(key) != value for key, value in profile_contract(revision).items())):
        raise CampaignError("Worker readiness, checkpoint revision or pinned execution profile does not match.")
    recordings = capabilities.get("recordings", {})
    if recordings.get("schema") != SCHEMA or recordings.get("readOnly") is not True:
        raise CampaignError("Worker must support the current durable recording contract.")
    return profile


def load_pilot(directory):
    """Require the acceptance probe's actual summary, capabilities and bundle."""
    directory = Path(directory)
    summary, summary_sha = read_json(directory / "summary.json")
    capabilities, caps_sha = read_json(directory / "capabilities.json")
    bundle, bundle_sha = read_json(directory / "benchmark-recording.json", MAX_BUNDLE_BYTES)
    profile = valid_profile(capabilities)
    if any(summary.get(key) is not True for key in ("transportAndExecutionPassed", "durableRecordingsPassed",
                                                   "resetArchivePreserved", "archivesReadableAfterDeletion")):
        raise CampaignError("Pilot must have passed the real execution and durable-recording probe.")
    steps = summary.get("metrics", {}).get("steps")
    success = summary.get("taskSuccess")
    outcome = summary.get("episodeOutcome")
    if (type(steps) is not int or type(success) is not bool
            or not ((outcome == "succeeded" and success and 1 <= steps <= MAX_STEPS)
                    or (outcome == "failed" and not success and steps == MAX_STEPS))):
        raise CampaignError("Pilot did not finish a valid success or full-horizon task miss.")
    formal = summary.get("recordings", {}).get("formal", {})
    # Native bundles retain the original manifest as base64, not a parsed object.
    manifest = probe.verify_bundle(bundle)
    if (summary.get("checkpointRevision") != profile["checkpointRevision"]
            or formal.get("manifestSha256") != bundle.get("manifestSha256")
            or formal.get("id") != manifest.get("recordingId")):
        raise CampaignError("Pilot receipt, bundle and checkpoint revision disagree.")
    checked = probe.verify_execution_bundle(bundle, recording=formal["id"], session=manifest.get("sessionId"),
        profile=profile, protocol="benchmark", steps=steps, outcome=outcome)
    if checked["outcome"].get("success") is not success:
        raise CampaignError("Pilot archived outcome does not match its receipt.")
    proof = {"schema": "brainsnn.campaign.pilot.v1", "summaryFileSha256": summary_sha,
             "capabilitiesFileSha256": caps_sha, "bundleFileSha256": bundle_sha,
             "manifestSha256": bundle["manifestSha256"], "recordingId": formal["id"],
             "checkpointRevision": profile["checkpointRevision"], "taskSuccess": success,
             "executionAccepted": True}
    return profile, proof


def normalize_plan(plan=None):
    if plan is None:
        cases = [{"index": i, "taskId": f"libero_spatial:{i}", "seed": 7} for i in range(10)]
        source_sha = None
    else:
        if not isinstance(plan, dict) or plan.get("schema") != "brainsnn.campaign.plan.v1":
            raise CampaignError("Expected a brainsnn.campaign.plan.v1 export.")
        selection, trials, scheduling = (plan.get(k, {}) for k in ("selection", "trials", "scheduling"))
        recipe = plan.get("recipe", {})
        if (selection.get("profileId") != PROFILE_ID or selection.get("robotId") != "panda"
                or selection.get("modelId") != "pi05" or selection.get("protocol") != "benchmark"
                or recipe.get("id") != PROFILE_ID or recipe.get("checkpoint") != CHECKPOINT
                or recipe.get("robotId") != "panda" or recipe.get("modelId") != "pi05"
                or recipe.get("adapter") != "openpi-libero"):
            raise CampaignError("Only the exact Panda + pi05 LIBERO recipe and locked benchmark protocol can run.")
        # Static recipe metadata may omit worker-only fields; declared interface
        # fields must agree with the native profile, rather than just its label.
        contract = profile_contract()
        if (recipe.get("state", {}).get("size") != 8 or recipe.get("timing", {}).get("controlHz") != 20
                or recipe.get("timing", {}).get("actionChunkSteps") != 5
                or "benchmark" not in recipe.get("protocols", [])):
            raise CampaignError("Campaign recipe must declare the native state, timing and locked protocol.")
        for key in ("adapterVersion", "policyCodeRevision", "simulator"):
            if key in recipe and recipe[key] != contract[key]:
                raise CampaignError("Campaign declared policy or simulator revision does not match.")
        for key in ("cameras", "action"):
            if recipe.get(key) != contract[key]:
                raise CampaignError("Campaign recipe camera or controller contract does not match.")
        for key, value in recipe.get("state", {}).items():
            if contract["state"].get(key) != value:
                raise CampaignError("Campaign recipe state contract does not match.")
        for key, value in recipe.get("timing", {}).items():
            if contract["timing"].get(key) != value:
                raise CampaignError("Campaign recipe timing contract does not match.")
        task = selection.get("taskId")
        if task not in {f"libero_spatial:{i}" for i in range(10)}:
            raise CampaignError("Campaign task must be one of LIBERO Spatial tasks 0 through 9.")
        total, seeds = trials.get("total"), trials.get("seeds", {})
        first = seeds.get("first")
        if (type(total) is not int or not 1 <= total <= 10 or type(first) is not int or not 0 <= first <= MAX_SEED
                or first + total - 1 > MAX_SEED or seeds.get("strategy") != "consecutive"
                or seeds.get("last") != first + total - 1 or seeds.get("count") != total
                or trials.get("attemptsPerSeed") != 1 or scheduling.get("maxConcurrentWorkers") != 1
                or scheduling.get("desiredEpisodeRetries") != 0):
            raise CampaignError("Run plans require 1–10 consecutive seeds, one sequential worker and one attempt; larger plans stay plan-only.")
        cases = [{"index": i, "taskId": task, "seed": first + i} for i in range(total)]
        source_sha = digest(encoded(plan))
    return {"schema": PLAN_SCHEMA, "profileId": PROFILE_ID, "robotId": "panda", "modelId": "pi05",
            "checkpoint": CHECKPOINT, "protocol": "benchmark", "maxConcurrentWorkers": 1,
            "attemptsPerCase": 1, "cases": cases, "sourcePlanSha256": source_sha}


def outside_git(path):
    resolved = Path(path).expanduser().resolve()
    if resolved.is_relative_to(Path(__file__).resolve().parents[1]):
        raise CampaignError("Campaign output must stay outside the extracted worker kit.")
    if any((parent / ".git").exists() for parent in (resolved, *resolved.parents)):
        raise CampaignError("Campaign output must be a private directory outside a Git checkout.")
    # Resolve alone would silently accept a symlink supplied as the output.
    absolute = Path(path).expanduser().absolute()
    system_aliases = {Path("/tmp"), Path("/var"), Path("/etc")}
    if any(parent.is_symlink() and parent not in system_aliases for parent in (absolute, *absolute.parents)):
        raise CampaignError("Symlinked campaign output paths are unsupported.")
    return resolved


@contextmanager
def wall_alarm(seconds):
    """A real wall timer also bounds stalled HTTP bodies, not just poll loops."""
    def expired(signum, frame):
        raise WallLimit("Bounded campaign wall deadline reached.")
    previous = signal.signal(signal.SIGALRM, expired)
    old_timer = signal.getitimer(signal.ITIMER_REAL)
    started = time.monotonic()
    allowance = min(seconds, old_timer[0]) if old_timer[0] > 0 else seconds
    signal.setitimer(signal.ITIMER_REAL, max(0.001, allowance))
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if old_timer[0] > 0:
            remaining = max(0.001, old_timer[0] - (time.monotonic() - started))
            signal.setitimer(signal.ITIMER_REAL, remaining, old_timer[1])


@contextmanager
def durable_write():
    """Defer interrupt delivery until a short local journal transaction ends."""
    old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGALRM})
    try:
        yield
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)


class Store:
    """Atomic JSON files, an fsynced intent journal, and a single-process lock."""
    def __init__(self, root, *, resume, maximum):
        self.root, self.maximum = outside_git(root), maximum
        if type(maximum) is not int or not 8 * 1024 * 1024 <= maximum <= 2 * 1024**3:
            raise CampaignError("Output byte cap must be 8 MiB through 2 GiB.")
        if resume:
            if not self.root.is_dir():
                raise CampaignError("Resume requires an existing campaign output directory.")
        else:
            self.root.mkdir(parents=True, mode=0o700, exist_ok=False)
        lock_path = self.root / ".campaign.lock"
        if lock_path.is_symlink() or (lock_path.exists() and not lock_path.is_file()):
            raise CampaignError("Campaign lock must be an owned regular file.")
        self.lock = lock_path.open("a+b")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise CampaignError("Another runner owns this campaign directory.") from None
        self.ledger = None
        if resume:
            try:
                self.ledger = read_json(self.root / "ledger.json")[0]
                if self.ledger.get("schema") != LEDGER_SCHEMA or self.ledger.get("maxOutputBytes") != maximum:
                    raise CampaignError("Resume ledger schema or output byte cap does not match.")
                self.recover()
            except BaseException:
                self.lock.close()
                raise

    def close(self):
        self.lock.close()

    def atomic(self, relative, raw):
        target = self.root / relative
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = self.root / ".campaign-write.tmp"
        with temporary.open("wb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        for directory in {target.parent, self.root}:
            fd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)

    def commit(self):
        raw = encoded(self.ledger)
        if len(raw) > MAX_REPORT_BYTES:
            raise CampaignError("Campaign ledger exceeds its bounded size.")
        self.atomic("ledger.json", raw)

    def save(self, relative, value, *, bulk=False):
        if self.ledger.get("pendingWrite"):
            self.recover()
        raw = encoded(value)
        if not bulk and len(raw) > MAX_REPORT_BYTES:
            raise OutputLimit("Campaign metadata exceeds its bounded size.")
        files = self.ledger["files"]
        used = sum(item["bytes"] for name, item in files.items() if name != relative)
        allowance = self.maximum - RESERVE_BYTES if bulk else self.maximum
        if used + len(raw) + len(encoded(self.ledger)) > allowance:
            raise OutputLimit("Campaign output byte cap reached.")
        metadata = {"sha256": digest(raw), "bytes": len(raw)}
        with durable_write():
            self.ledger["pendingWrite"] = {"path": relative, **metadata}
            self.commit()
            self.atomic(relative, raw)
            files[relative] = metadata
            self.ledger.pop("pendingWrite")
            self.commit()

    def recover(self):
        files, pending = self.ledger.get("files", {}), self.ledger.get("pendingWrite")
        if not isinstance(files, dict) or len(files) > 128:
            raise CampaignError("Campaign file index exceeds its bounded contract.")
        for expected in [*files.values(), *([pending] if pending else [])]:
            if (not isinstance(expected, dict) or type(expected.get("bytes")) is not int
                    or not 0 <= expected["bytes"] <= MAX_BUNDLE_BYTES
                    or not isinstance(expected.get("sha256"), str) or not HEX.fullmatch(expected["sha256"])):
                raise CampaignError("Campaign file index has invalid size or digest metadata.")
        if sum(item["bytes"] for item in files.values()) > self.maximum:
            raise CampaignError("Saved campaign output exceeds its byte cap.")
        if pending:
            relative = pending.get("path")
            path = self.safe(relative)
            if path.exists():
                actual = {"sha256": digest(path.read_bytes()), "bytes": path.stat().st_size}
                expected = {k: pending[k] for k in ("sha256", "bytes")}
                if actual == expected:
                    files[relative] = expected
                elif actual != files.get(relative):
                    raise CampaignError("Interrupted campaign write has changed bytes.")
            elif relative in files:
                raise CampaignError("A committed campaign file is missing.")
            self.ledger.pop("pendingWrite")
        for relative, expected in files.items():
            path = self.safe(relative)
            if (not path.is_file() or path.stat().st_size != expected.get("bytes")
                    or digest(path.read_bytes()) != expected.get("sha256")):
                raise CampaignError("Saved campaign evidence failed its pinned file hash.")
        allowed = set(files) | {"ledger.json", ".campaign.lock", ".campaign-write.tmp"}
        if any(p.is_symlink() or (not p.is_dir() and p.relative_to(self.root).as_posix() not in allowed)
               for p in self.root.rglob("*")):
            raise CampaignError("Campaign output contains unexpected or symlinked files.")
        if sum(p.stat().st_size for p in self.root.rglob("*") if p.is_file()) > self.maximum:
            raise CampaignError("Saved campaign output exceeds its byte cap.")
        temporary = self.root / ".campaign-write.tmp"
        if temporary.exists():
            temporary.unlink()
        self.commit()

    def safe(self, relative):
        if (not isinstance(relative, str) or "\\" in relative or Path(relative).is_absolute()
                or ".." in Path(relative).parts or relative in ("", ".")):
            raise CampaignError("Invalid campaign evidence path.")
        path = self.root / relative
        if path.is_symlink() or any(p.is_symlink() for p in path.parents):
            raise CampaignError("Symlinked campaign evidence is unsupported.")
        return path


def empty_case(case):
    return {**case, "status": "unattempted", "steps": None, "taskSuccess": None,
            "recordingId": None, "manifestSha256": None, "bundlePath": None, "resultPath": None,
            "initialStateId": None, "initialStateSha256": None}


def build_report(ledger):
    cases = [{key: value for key, value in item.items() if key not in ("sessionId", "errorCode")}
             for item in ledger["cases"]]
    counts = {status: sum(c["status"] == status for c in cases) for status in STATUSES}
    completed = counts["task_success"] + counts["task_miss"]
    state = "complete" if completed == len(cases) else ("interrupted" if counts["unattempted"] or counts["interrupted"] else "partial")
    identities = [(c["taskId"], c["initialStateId"]) for c in cases
                  if c["initialStateId"] is not None and c["initialStateSha256"] is not None]
    return {"schema": REPORT_SCHEMA, "campaignId": ledger["campaignId"], "state": state,
            "planSha256": ledger["planSha256"], "profileId": PROFILE_ID,
            "checkpointRevision": ledger["checkpointRevision"], "protocol": "benchmark",
            "totalEpisodes": len(cases), "attemptedEpisodes": len(cases) - counts["unattempted"],
            "completedEpisodes": completed, "counts": counts, "cases": cases,
            "elapsedSeconds": round(ledger["elapsedSeconds"], 6),
            "execution": {"sequential": True, "maxConcurrentWorkers": 1, "attemptsPerCase": 1, "budgetEnforced": False},
            "coverage": {"observedInitialConditions": len(identities), "distinctInitialConditions": len(set(identities)),
                "repeatedInitialConditions": len(identities) - len(set(identities)),
                "identity": "taskId + initialStateId",
                "claim": "Consecutive seeds may select repeated initial states; seeds are not unique conditions."},
            "claim": "Bounded producer-reported worker-interface execution; task misses and infrastructure failures remain separate. No cloud spending limit or independent model attestation."}


def run_campaign(request, output, pilot, *, plan=None, resume=False, max_seconds=600,
                 campaign_max_seconds=7200, max_output_bytes=DEFAULT_OUTPUT_BYTES,
                 finalize_seconds=30, sleep=time.sleep, clock=time.monotonic):
    """Run once per case, serially; resume never replays an in-flight attempt."""
    if not 1 <= max_seconds <= 900 or not 1 <= campaign_max_seconds <= 10800 or not 0 < finalize_seconds <= 60:
        raise CampaignError("Episode/campaign/finalization time bounds are invalid.")
    started = clock()
    with wall_alarm(min(max_seconds, campaign_max_seconds)):
        normalized = normalize_plan(plan)
        profile, proof = load_pilot(pilot)
        current = valid_profile(request("GET", "/v1/capabilities"))
    if current != profile:
        raise CampaignError("Current worker profile or checkpoint differs from the accepted pilot.")
    if plan and plan.get("recipe", {}).get("checkpointRevision") not in (None, profile["checkpointRevision"]):
        raise CampaignError("Plan checkpoint revision differs from the accepted pilot.")
    store = Store(output, resume=resume, maximum=max_output_bytes)
    try:
        plan_sha, profile_sha, pilot_sha = (digest(encoded(v)) for v in (normalized, profile, proof))
        limits = {"episodeSeconds": max_seconds, "campaignSeconds": campaign_max_seconds, "finalizeSeconds": finalize_seconds}
        if resume:
            ledger = store.ledger
            if (ledger.get("planSha256") != plan_sha or ledger.get("profileSha256") != profile_sha
                    or ledger.get("pilotSha256") != pilot_sha or ledger.get("limits") != limits):
                raise CampaignError("Resume requires the identical plan, pilot, profile, checkpoint and time bounds.")
            for filename, expected in (("plan.json", normalized), ("profile.json", profile), ("pilot.json", proof)):
                if read_json(store.safe(filename))[0] != expected:
                    raise CampaignError("Pinned campaign metadata does not match its ledger.")
            if len(ledger.get("cases", [])) != len(normalized["cases"]):
                raise CampaignError("Resume case count does not match its pinned plan.")
            for case, planned in zip(ledger["cases"], normalized["cases"]):
                if any(case.get(k) != v for k, v in planned.items()) or case.get("status") not in (*STATUSES, "inflight"):
                    raise CampaignError("Resume cases do not match the pinned plan.")
                if case["status"] not in ("unattempted", "inflight"):
                    result_path = f"cases/{case['index']:02d}/result.json"
                    if case.get("resultPath") != result_path or result_path not in ledger["files"]:
                        raise CampaignError("A terminal case lacks its committed result receipt.")
                    result = read_json(store.safe(result_path))[0]
                    if result != {"schema": "brainsnn.campaign.case.v1", **case}:
                        raise CampaignError("Resume ledger and committed case result disagree.")
                if case["status"] in COMPLETE:
                    bundle_path = f"cases/{case['index']:02d}/recording.json"
                    if case.get("bundlePath") != bundle_path or bundle_path not in ledger["files"]:
                        raise CampaignError("A completed case lacks its pinned recording bundle.")
                    bundle = read_json(store.safe(bundle_path), MAX_BUNDLE_BYTES)[0]
                    manifest = probe.verify_bundle(bundle)
                    if (case.get("manifestSha256") != bundle["manifestSha256"]
                            or case.get("taskSuccess") is not (case["status"] == "task_success")):
                        raise CampaignError("Completed case result and recording digest disagree.")
                    probe.verify_execution_bundle(bundle, recording=case["recordingId"], session=manifest["sessionId"],
                        profile=profile, protocol="benchmark", steps=case["steps"],
                        outcome="succeeded" if case["taskSuccess"] else "failed", task=case["taskId"], seed=case["seed"])
        else:
            ledger = store.ledger = {"schema": LEDGER_SCHEMA, "campaignId": "campaign-" + uuid.uuid4().hex,
                "planSha256": plan_sha, "profileSha256": profile_sha, "pilotSha256": pilot_sha,
                "checkpointRevision": profile["checkpointRevision"], "limits": limits,
                "maxOutputBytes": max_output_bytes, "elapsedSeconds": 0, "files": {},
                "cases": [empty_case(c) for c in normalized["cases"]]}
            store.commit()
            for filename, value in (("plan.json", normalized), ("profile.json", profile), ("pilot.json", proof)):
                store.save(filename, value)
        previous_elapsed = ledger["elapsedSeconds"]

        def persist_report():
            ledger["elapsedSeconds"] = previous_elapsed + max(0, clock() - started)
            store.commit()
            report = build_report(ledger)
            store.save("report.json", report)
            return report

        def finish(case, status, code=None):
            final_case = {**case, "status": status,
                          "taskSuccess": (status == "task_success") if status in COMPLETE else None}
            if code:
                final_case["errorCode"] = code
            final_case["resultPath"] = f"cases/{case['index']:02d}/result.json"
            result = {"schema": "brainsnn.campaign.case.v1", **final_case}
            # Keep the durable case in-flight throughout the result write's
            # intent and file commits. A crash before the acknowledgement then
            # resumes as interrupted, without replaying the spent attempt.
            store.save(final_case["resultPath"], result)
            case.update(final_case)
            store.commit()
            return persist_report()

        def close_owned(case):
            sid = case.get("sessionId")
            if sid:
                if not isinstance(sid, str) or not SAFE_ID.fullmatch(sid):
                    raise CampaignError("Invalid owned session identity.")
                with wall_alarm(10):
                    request("DELETE", "/v1/sessions/" + urllib.parse.quote(sid, safe=""))
                case.pop("sessionId", None)
                store.commit()

        # A process may have died after sending create/run. Never repeat that
        # case, even if no session receipt reached this client.
        for case in ledger["cases"]:
            if case["status"] == "inflight":
                try:
                    close_owned(case)
                except Exception:
                    pass
                finish(case, "interrupted", "previous_process_interrupted")
        persist_report()
        if previous_elapsed >= campaign_max_seconds:
            return persist_report()
        for case in ledger["cases"]:
            if case["status"] != "unattempted":
                continue
            remaining = campaign_max_seconds - previous_elapsed - (clock() - started)
            if remaining <= 0:
                break
            case["status"] = "inflight"
            store.commit()  # The attempt is spent before any mutating request.
            stop = False
            terminal_status = None
            try:
                with wall_alarm(min(max_seconds, remaining)):
                    session = request("POST", "/v1/sessions", {"version": 1, "profileId": PROFILE_ID,
                        "robotId": "panda", "modelId": "pi05", "checkpoint": CHECKPOINT,
                        "task": case["taskId"], "seed": case["seed"], "protocol": "benchmark"})
                    sid = session.get("sessionId")
                    if not isinstance(sid, str) or not SAFE_ID.fullmatch(sid):
                        raise CampaignError("Worker returned an invalid session identity.")
                    case["sessionId"] = sid
                    store.commit()
                    if session.get("profile") != profile or session.get("frame", {}).get("policyExecuted") is not False:
                        raise CampaignError("Created session did not preserve the pinned unstepped profile.")
                    path = "/v1/sessions/" + urllib.parse.quote(sid, safe="")
                    request("POST", path + "/commands", {"version": 1, "type": "run", "payload": {}, "requestId": uuid.uuid4().hex})
                    deadline = clock() + min(max_seconds, remaining)
                    while True:
                        frame = request("GET", path + "/frame")
                        if frame.get("status") in ("succeeded", "failed", "error"):
                            break
                        if clock() >= deadline:
                            raise WallLimit()
                        sleep(min(1, max(0, deadline - clock())))
                    metrics = frame.get("metrics", {})
                    steps, success, outcome = metrics.get("steps"), metrics.get("success"), frame.get("status")
                    if type(steps) is int and 0 <= steps <= MAX_STEPS:
                        case["steps"] = steps
                    case["recordingId"] = probe.recording_id(frame)
                    evidence = request("GET", path + "/evidence")
                    store.save(f"cases/{case['index']:02d}/evidence.json", evidence, bulk=True)
                    valid_terminal = (type(steps) is int and type(success) is bool and frame.get("policyExecuted") is True
                        and ((outcome == "succeeded" and success and 1 <= steps <= MAX_STEPS)
                             or (outcome == "failed" and not success and steps == MAX_STEPS))
                        and len(evidence.get("steps", [])) == steps)
                    if not valid_terminal:
                        raise CampaignError("Episode did not complete valid terminal execution.")
                    close_owned(case)  # Retained archive must remain readable after deletion.
                    recording_path = "/v1/recordings/" + urllib.parse.quote(case["recordingId"], safe="")
                    finalize_deadline = clock() + finalize_seconds
                    while True:
                        archived = request("GET", recording_path)
                        status = archived.get("completion", {}).get("status")
                        if status != "recording" or clock() >= finalize_deadline:
                            break
                        sleep(0.1)
                    if status == "recording":
                        raise PartialRecording("Recording did not finalize.")
                    bundle = request("GET", recording_path + "/bundle", max_bytes=MAX_BUNDLE_BYTES)
                    # Store only a structurally valid, byte-verified native bundle.
                    archived = probe.verify_bundle(bundle)
                    case["manifestSha256"] = bundle["manifestSha256"]
                    bundle_path = f"cases/{case['index']:02d}/recording.json"
                    store.save(bundle_path, bundle, bulk=True)
                    case["bundlePath"] = bundle_path
                    if status != "complete" or archived["completion"]["status"] != "complete":
                        raise PartialRecording("Recording coverage is partial.")
                    manifest = probe.verify_execution_bundle(bundle, recording=case["recordingId"], session=sid,
                        profile=profile, protocol="benchmark", steps=steps, outcome=outcome,
                        task=case["taskId"], seed=case["seed"])
                    if manifest["outcome"].get("success") is not success:
                        raise CampaignError("Archived task result differs from terminal frame.")
                    initial = manifest["context"].get("initialState", {})
                    state_id, state_sha = initial.get("suiteStateId"), initial.get("policyStartStateSha256")
                    if type(state_id) is not int or state_id < 0 or not isinstance(state_sha, str) or not HEX.fullmatch(state_sha):
                        raise CampaignError("Recording lacks an identified initial condition.")
                    case["initialStateId"], case["initialStateSha256"] = state_id, state_sha
                    terminal_status = "task_success" if success else "task_miss"
            except PartialRecording:
                terminal_status, code = "partial_recording", "recording_incomplete"
            except (KeyboardInterrupt, WallLimit):
                terminal_status, code, stop = "interrupted", "wall_limit_or_operator_interrupt", True
            except OutputLimit:
                terminal_status, code, stop = "infrastructure_error", "output_byte_limit", True
            except Exception:
                # Exception strings and remote bodies are never persisted.
                terminal_status, code = "infrastructure_error", "execution_or_evidence_rejected"
            finally:
                try:
                    close_owned(case)
                except (Exception, KeyboardInterrupt):
                    terminal_status, code, stop = "infrastructure_error", "owned_session_cleanup_failed", True
            finish(case, terminal_status, None if terminal_status in COMPLETE else code)
            if stop:
                break
        return persist_report()
    finally:
        store.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8081")
    parser.add_argument("--origin", default="https://www.brainsnn.com")
    parser.add_argument("--pilot", required=True, help="Saved successful execution-probe directory")
    parser.add_argument("--out", required=True, help="Private output directory outside Git; new unless --resume")
    parser.add_argument("--plan", help="Optional exported single-task plan; 1–10 episodes only")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--max-seconds", type=int, default=600, help="Wall seconds per complete attempt, including evidence")
    parser.add_argument("--campaign-max-seconds", type=int, default=7200)
    parser.add_argument("--max-output-bytes", type=int, default=DEFAULT_OUTPUT_BYTES)
    args = parser.parse_args(argv)
    parsed = urllib.parse.urlsplit(args.url)
    if (parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")
            or (parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"))):
        parser.error("Use HTTPS or literal loopback HTTP, without credentials, paths or redirects.")
    try:
        plan = read_json(args.plan)[0] if args.plan else None
        http = probe.ProbeHTTP(args.url, args.origin, os.environ.get("ARENA_TOKEN", ""))
        report = run_campaign(http, args.out, args.pilot, plan=plan, resume=args.resume,
            max_seconds=args.max_seconds, campaign_max_seconds=args.campaign_max_seconds,
            max_output_bytes=args.max_output_bytes)
    except CampaignError as error:
        parser.exit(2, "Campaign rejected: " + str(error) + "\n")
    except (FileExistsError, OSError, RuntimeError, ValueError, RecordingError):
        # Do not print arbitrary request/JSON/credential values on failure.
        parser.exit(2, "Campaign rejected: verify the local plan, pilot, pinned worker, limits and private output files.\n")
    print(json.dumps(report, indent=2))
    return 0 if report["state"] == "complete" else 1
