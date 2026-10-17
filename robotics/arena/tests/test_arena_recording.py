"""Recording contracts with injected CPU fixtures; no MuJoCo, policy weights or robot."""
import base64
import asyncio
import copy
from dataclasses import replace
import hashlib
import io
import json
import multiprocessing
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

from workers.arena.app import create_app
from workers.arena.recording import (RecordingArchive, RecordingError, RecordingWriter,
                                     canonical_json, seal_bundle, verify_bundle)
from workers.arena.runtime import SessionProcess, child_loop
from test_arena_worker import command, episode, request, settings, SETTLE_STEPS
from test_arena_worker_http import TestManager as FixtureManager


def metadata():
    return {"episodeId": "fixture-1", "sessionId": "fixture", "source": {"kind": "imported", "identityStatus": "declared"},
            "context": {"taskId": "injected-test", "initialState": {"coverage": "fixture"}}, "clocks": []}


def crash_writer(path, connection):
    writer = RecordingArchive(path).create(metadata())
    writer.record("fixture", arrays={"values": np.asarray([1., 2., 3.])})
    writer.queue.join()
    connection.send(writer.id)
    connection.close()
    # Deliberately skip all Python finally/close paths.
    os._exit(0)


class RecordingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.archive = RecordingArchive(self.temporary.name)

    def recorded_episode(self):
        item = episode()
        item.archive = self.archive
        item.reset()
        self.addCleanup(item.close)
        return item

    def finish(self, writer):
        writer.finish({"status": "interrupted"}, "test")
        self.assertTrue(writer.wait(5))
        return self.archive.manifest(writer.id)

    def test_manifest_finalizing_between_marker_and_active_checks_stays_complete(self):
        writer = self.archive.create(metadata())
        self.addCleanup(writer.finish, {"status": "interrupted"}, "cleanup")
        original_active = self.archive._active
        checks = 0

        def finish_during_read(directory):
            nonlocal checks
            checks += 1
            if checks == 2:
                # _directory already checked activity and manifest() observed
                # no final marker. Publish it before the fallback activity read.
                writer.finish({"status": "interrupted"}, "test")
                self.assertTrue(writer.wait(5))
            return original_active(directory)

        with patch.object(self.archive, "_active", side_effect=finish_during_read):
            manifest = self.archive.manifest(writer.id)
        self.assertEqual(manifest["completion"]["status"], "complete")
        self.assertFalse(manifest["completion"]["unknownTail"])
        self.assertEqual(manifest["outcome"]["status"], "interrupted")

    def test_exact_policy_inputs_all_chunk_elements_and_controller_inputs(self):
        item = self.recorded_episode()
        item.policy.actions = np.arange(49, dtype=np.float32).reshape(7, 7) / 100
        item.command(command("step"))
        expected = copy.deepcopy(item.policy.inputs[0])
        item.close()
        manifest = verify_bundle(self.archive.bundle(item.recorder.id))
        self.assertEqual(manifest["completion"]["status"], "complete")
        self.assertFalse(manifest["completion"]["unknownTail"])
        start = manifest["events"][0]
        self.assertEqual(start["kind"], "episode-start")
        self.assertAlmostEqual(start["data"]["state"][0], SETTLE_STEPS / 20)
        self.assertNotEqual(start["data"]["state"], item.initial_state.tolist())
        self.assertEqual(start["data"]["initialization"]["coverage"], "excluded")
        obs = next(event for event in manifest["events"] if event["kind"] == "observation" and not event["data"]["initialOnly"])
        for camera in obs["data"]["cameras"]:
            descriptor, raw = self.archive.artifact(item.recorder.id, camera["artifactId"])
            pixels = np.asarray(Image.open(io.BytesIO(raw)))
            key = "observation/image" if camera["id"] == "agentview" else "observation/wrist_image"
            np.testing.assert_array_equal(pixels, expected[key])
            self.assertEqual(descriptor["mediaType"], "image/png")
        chunk = next(event for event in manifest["events"] if event["kind"] == "inference-result")
        self.assertEqual(len(chunk["data"]["actions"]), 7)
        self.assertEqual(chunk["data"]["queuedCount"], 5)
        self.assertEqual(chunk["data"]["unusedCount"], 2)
        descriptor, raw = self.archive.artifact(item.recorder.id, chunk["data"]["actionsArtifactId"])
        self.assertEqual(descriptor["dtype"], "float32")
        np.testing.assert_array_equal(np.frombuffer(raw, dtype=np.float32).reshape(7, 7), item.policy.actions)
        action = next(event for event in manifest["events"] if event["kind"] == "controller-input")
        self.assertEqual(action["data"]["vector"], item.env.actions[-1])
        self.assertIn(chunk["id"], action["refs"])
        self.assertEqual(manifest["outcome"]["inferenceAttempts"], 1)
        self.assertEqual(manifest["outcome"]["inferenceCompletions"], 1)
        self.assertEqual(manifest["outcome"]["controllerInputsSubmitted"], 1)

    def test_reset_preserves_previous_episode_and_intervention_discards_queue(self):
        item = self.recorded_episode()
        item.command(command("step", 1))
        item.command(command("intervene", 2, {"kind": "camera-occlusion", "enabled": True, "fraction": 0.5}))
        item.command(command("step", 3))
        previous = item.recorder
        item.command(command("reset", 4))
        self.assertTrue(previous.wait(5))
        self.assertNotEqual(item.recorder.id, previous.id)
        before = self.archive.manifest(previous.id)
        self.assertEqual(before["completion"]["status"], "complete")
        self.assertEqual(before["outcome"]["reason"], "reset")
        discards = [e for e in before["events"] if e["kind"] == "chunk-discarded"]
        self.assertEqual(discards[0]["data"]["indices"], [1, 2, 3, 4])
        self.assertEqual(discards[0]["data"]["reason"], "camera_occlusion")
        observations = [e for e in before["events"] if e["kind"] == "observation"]
        aid = observations[-1]["data"]["cameras"][0]["artifactId"]
        _, raw = self.archive.artifact(previous.id, aid)
        self.assertTrue(np.all(np.asarray(Image.open(io.BytesIO(raw)))[:, 56:168] == 0))
        item.close()
        self.assertEqual(len(self.archive.list("test-session")["recordings"]), 2)

    def test_inference_error_and_invalid_output_remain_inspectable(self):
        item = self.recorded_episode()
        item.policy.actions[0, 0] = np.nan
        with self.assertRaises(Exception):
            item.command(command("step"))
        self.assertTrue(item.recorder.wait(5))
        manifest = verify_bundle(self.archive.bundle(item.recorder.id))
        self.assertEqual(manifest["outcome"]["inferenceCompletions"], 1)
        self.assertEqual(manifest["outcome"]["validActionChunks"], 0)
        self.assertEqual(manifest["outcome"]["controllerInputsSubmitted"], 0)
        chunk = next(e for e in manifest["events"] if e["kind"] == "inference-result")
        self.assertIsNone(chunk["data"]["actions"])
        self.assertFalse(chunk["data"]["finite"])
        self.assertTrue(any(e["kind"] == "runtime-error" for e in manifest["events"]))

    def test_failed_inference_preserves_attempt_and_input_without_claiming_completion(self):
        item = self.recorded_episode()
        with patch.object(item.policy, "infer", side_effect=TimeoutError("private endpoint secret")):
            with self.assertRaises(TimeoutError):
                item.command(command("step"))
        self.assertTrue(item.recorder.wait(5))
        bundle = self.archive.bundle(item.recorder.id)
        manifest = verify_bundle(bundle)
        self.assertEqual(manifest["outcome"]["inferenceAttempts"], 1)
        self.assertEqual(manifest["outcome"]["inferenceCompletions"], 0)
        self.assertEqual(manifest["outcome"]["controllerInputsSubmitted"], 0)
        self.assertTrue(any(event["kind"] == "inference-error" for event in manifest["events"]))
        self.assertNotIn("private endpoint secret", bundle["manifestText"])

    def test_input_arrays_are_owned_before_async_writer_runs(self):
        entered, release = threading.Event(), threading.Event()
        original = RecordingWriter._write_item
        def blocked(writer, *args):
            entered.set()
            self.assertTrue(release.wait(5))
            return original(writer, *args)
        with patch.object(RecordingWriter, "_write_item", blocked):
            writer = self.archive.create(metadata())
            source = np.asarray([1., 2., 3.])
            writer.record("fixture", arrays={"values": source})
            self.assertTrue(entered.wait(2))
            source[:] = 99
            release.set()
            manifest = self.finish(writer)
        _, raw = self.archive.artifact(writer.id, manifest["artifacts"][0]["id"])
        np.testing.assert_array_equal(np.frombuffer(raw, dtype=np.float64), [1., 2., 3.])

    def test_queue_overflow_is_nonblocking_and_leaves_contiguous_partial_prefix(self):
        entered, release = threading.Event(), threading.Event()
        original = RecordingWriter._write_item
        def blocked(writer, *args):
            entered.set()
            release.wait(5)
            return original(writer, *args)
        self.archive.queue_size = 1
        with patch.object(RecordingWriter, "_write_item", blocked):
            writer = self.archive.create(metadata())
            writer.record("first")
            self.assertTrue(entered.wait(2))
            writer.record("second", refs=["e1"])
            started = time.monotonic()
            self.assertIsNone(writer.record("lost", refs=["e2"]))
            self.assertIsNone(writer.record("later", refs=["e3"]))
            self.assertLess(time.monotonic() - started, 0.1)
            writer.finish({"status": "interrupted"})
            self.assertFalse(writer.wait(0.01))
            release.set()
            self.assertTrue(writer.wait(5))
        manifest = verify_bundle(self.archive.bundle(writer.id))
        self.assertEqual([e["seq"] for e in manifest["events"]], [1, 2])
        self.assertEqual(manifest["completion"]["lastObservedSequence"], 4)
        self.assertEqual(manifest["completion"]["gapCount"], 2)
        self.assertTrue(manifest["completion"]["unknownTail"])
        self.assertEqual(manifest["completion"]["status"], "partial")

    def test_journal_and_manifest_limits_preserve_readable_prefix_before_commit(self):
        from workers.arena import recording
        for limit, value in (("MAX_MANIFEST_BYTES", "x" * (110 * 1024)),
                             ("MAX_JSON_NODES", [0] * 2500)):
            with self.subTest(limit=limit), patch.object(recording, limit, 256 * 1024 if limit == "MAX_MANIFEST_BYTES" else 6000):
                writer = self.archive.create(metadata())
                writer.record("durable", data={"large": value})
                writer.queue.join()
                self.assertEqual(writer.committed, 1)
                writer.record("over-limit", data={"large": value}, refs=["e1"])
                writer.queue.join()
                final = self.finish(writer)
                self.assertEqual(final["completion"]["status"], "partial")
                self.assertEqual(final["completion"]["committedSequence"], 1)
                self.assertEqual(final["completion"]["lastObservedSequence"], 2)
                self.assertTrue(final["completion"]["unknownTail"])
                self.assertTrue((writer.directory / "finalized.json").is_file())
                verify_bundle(self.archive.bundle(writer.id))
                # Simulate dying before the final marker: the same watermark
                # and bounded journal must remain readable by recovery too.
                (writer.directory / "finalized.json").unlink()
                recovered = verify_bundle(self.archive.bundle(writer.id))
                self.assertEqual([e["seq"] for e in recovered["events"]], [1])
                self.assertTrue(recovered["completion"]["unknownTail"])

    def test_descriptor_limit_rejects_whole_event_before_writing_its_artifacts(self):
        from workers.arena import recording
        with patch.object(recording, "MAX_ARTIFACTS", 2):
            writer = self.archive.create(metadata())
            writer.record("durable", arrays={"one": np.asarray([1]), "two": np.asarray([2])})
            writer.queue.join()
            writer.record("over-limit", arrays={"three": np.asarray([3])})
            writer.queue.join()
            final = self.finish(writer)
            self.assertEqual(final["completion"]["committedSequence"], 1)
            self.assertEqual(final["completion"]["status"], "partial")
            self.assertEqual(len(final["artifacts"]), 2)
            self.assertEqual(len(list((writer.directory / "artifacts").iterdir())), 2)
            verify_bundle(self.archive.bundle(writer.id))

    def test_total_recording_budget_includes_journal_manifest_and_artifacts(self):
        self.archive.recording_max_bytes = 128 * 1024
        writer = self.archive.create(metadata())
        writer.record("durable", data={"large": "x" * (20 * 1024)})
        writer.queue.join()
        writer.record("over-limit", data={"large": "x" * (20 * 1024)})
        writer.queue.join()
        manifest = self.finish(writer)
        self.assertEqual(manifest["completion"]["committedSequence"], 1)
        self.assertEqual(manifest["completion"]["status"], "partial")
        size = sum(path.stat().st_size for path in writer.directory.rglob("*") if path.is_file())
        self.assertLessEqual(size, self.archive.recording_max_bytes)
        verify_bundle(self.archive.bundle(writer.id))

    def test_reset_limits_pending_writers_and_refuses_before_changing_episode(self):
        entered, release = threading.Event(), threading.Event()
        original = RecordingWriter._write_item
        def blocked(writer, *args):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("fixture release timed out")
            return original(writer, *args)
        with patch.object(RecordingWriter, "_write_item", blocked):
            item = self.recorded_episode()
            try:
                self.assertTrue(entered.wait(2))
                first = item.recorder
                item.command(command("reset", 1))
                current = item.recorder
                before = (item.episode_number, item.seq, item.status, item.sim_time(), len(item.env.actions))
                with self.assertRaises(Exception) as rejected:
                    item.command(command("reset", 2))
                self.assertEqual(rejected.exception.code, "recording_busy")
                self.assertEqual(rejected.exception.status, 409)
                self.assertEqual((item.episode_number, item.seq, item.status, item.sim_time(), len(item.env.actions)), before)
                self.assertIs(item.recorder, current)
                self.assertTrue(current.accepting)
                self.assertEqual(item.previous_recorders, [first])
                release.set()
                self.assertTrue(first.wait(5))
                item.command(command("reset", 2))  # Rejected command was not cached.
                self.assertNotEqual(item.recorder.id, current.id)
            finally:
                release.set()
                item.close()
        self.assertEqual(len(self.archive.list()["recordings"]), 3)

    def test_large_final_outcome_cannot_invalidate_durable_prefix(self):
        writer = self.archive.create(metadata())
        writer.record("durable")
        writer.queue.join()
        writer.finish({"status": "interrupted", "details": "x" * (64 * 1024)})
        self.assertTrue(writer.wait(5))
        manifest = verify_bundle(self.archive.bundle(writer.id))
        self.assertEqual(manifest["completion"]["committedSequence"], 1)
        self.assertEqual(manifest["completion"]["status"], "partial")
        self.assertEqual(manifest["completion"]["reason"], "outcome_limit")
        self.assertEqual(manifest["outcome"]["status"], "unknown")
        self.assertTrue((writer.directory / "finalized.json").is_file())

    def test_full_disk_including_failure_to_write_final_counter_never_means_complete(self):
        from workers.arena import recording
        writer = self.archive.create(metadata())
        writer.record("durable")
        writer.queue.join()
        with patch.object(recording, "_atomic", side_effect=OSError(28, "No space left")):
            writer.record("cannot-commit", arrays={"state": np.asarray([1.])})
            writer.queue.join()
            writer.finish({"status": "interrupted"})
            self.assertTrue(writer.wait(5))
        recovered = self.archive.manifest(writer.id)
        self.assertEqual(recovered["completion"]["committedSequence"], 1)
        self.assertTrue(recovered["completion"]["unknownTail"])
        self.assertEqual(recovered["completion"]["status"], "partial")
        self.assertFalse((writer.directory / "finalized.json").exists())

    def test_process_death_without_finally_recovers_unknown_tail(self):
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(target=crash_writer, args=(self.temporary.name, child))
        process.start()
        child.close()
        self.assertTrue(parent.poll(10))
        recording_id = parent.recv()
        process.join(5)
        self.assertFalse(process.is_alive())
        parent.close()
        manifest = verify_bundle(self.archive.bundle(recording_id))
        self.assertEqual(manifest["completion"]["status"], "partial")
        self.assertEqual(manifest["completion"]["committedSequence"], 1)
        self.assertTrue(manifest["completion"]["unknownTail"])

    def test_tampered_artifact_manifest_and_paths_are_rejected(self):
        writer = self.archive.create(metadata())
        writer.record("fixture", texts={"input": "retained original"})
        manifest = self.finish(writer)
        bundle = self.archive.bundle(writer.id)
        changed = copy.deepcopy(bundle)
        path = manifest["artifacts"][0]["path"]
        changed["payloads"][path] = base64.b64encode(b"changed").decode()
        with self.assertRaises(RecordingError):
            verify_bundle(changed)
        changed = copy.deepcopy(bundle)
        changed["manifestText"] += " "
        with self.assertRaises(RecordingError):
            verify_bundle(changed)
        invalid = copy.deepcopy(manifest)
        invalid["artifacts"][0]["path"] = "../outside"
        with self.assertRaises(RecordingError):
            seal_bundle(invalid, {"../outside": b"retained original"})
        (writer.directory / path).write_bytes(b"changed")
        with self.assertRaises(RecordingError):
            self.archive.bundle(writer.id)

    def test_retention_preserves_active_writer_and_completed_archives_outlive_session(self):
        self.archive.max_recordings = 1
        first = self.archive.create(metadata())
        self.finish(first)
        active = self.archive.create(metadata())
        self.archive.prune()
        self.assertTrue(first.directory.is_dir())
        self.assertTrue(active.directory.is_dir())
        self.finish(active)
        self.archive.prune()
        self.assertFalse(first.directory.exists())
        self.assertTrue(active.directory.exists())
        self.assertEqual(verify_bundle(self.archive.bundle(active.id))["outcome"]["status"], "interrupted")

    def test_expired_archives_are_unreadable_even_before_next_sweep(self):
        writer = self.archive.create(metadata())
        self.finish(writer)
        old = time.time() - self.archive.retention_seconds - 1
        os.utime(writer.directory, (old, old))
        with self.assertRaises(RecordingError) as caught:
            self.archive.bundle(writer.id)
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(self.archive.list()["recordings"], [])

    def test_idle_ttl_finalizes_outside_session_lifetime(self):
        item = self.recorded_episode()
        item.command(command("step"))
        config = replace(settings(), idle_ttl=0, session_ttl=0)
        sent = []
        pipe = SimpleNamespace(send=sent.append, poll=lambda timeout: False, close=lambda: None)
        with patch("workers.arena.runtime.create_episode", return_value=item):
            child_loop(pipe, request(), config, "test-session")
        manifest = verify_bundle(self.archive.bundle(item.recorder.id))
        self.assertEqual(manifest["outcome"]["reason"], "session_expired")
        self.assertEqual(manifest["completion"]["status"], "complete")
        self.assertTrue(item.closed)

    def test_download_slots_survive_slow_sends_and_release_after_disconnect(self):
        writer = self.archive.create(metadata())
        writer.record("fixture", texts={"text": "bounded body"})
        self.finish(writer)
        manager = FixtureManager()
        manager.archive = self.archive
        config = replace(settings(), recording_dir=self.temporary.name)
        app = create_app(config, manager)
        async def exercise():
            release = asyncio.Event()
            entered = [asyncio.Event(), asyncio.Event()]
            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
                     "scheme": "http", "path": f"/v1/recordings/{writer.id}/bundle", "query_string": b"",
                     "headers": [(b"authorization", ("Bearer " + config.token).encode())],
                     "server": ("localhost", 80), "client": ("test", 1), "root_path": ""}
            async def receive(): return {"type": "http.request", "body": b"", "more_body": False}
            async def slow_send(index, message):
                if message["type"] == "http.response.body":
                    entered[index].set()
                    await release.wait()
            tasks = [asyncio.create_task(app(dict(scope), receive, lambda message, index=index: slow_send(index, message)))
                     for index in range(2)]
            await asyncio.wait_for(asyncio.gather(*(event.wait() for event in entered)), 3)
            third = []
            async def send(message): third.append(message)
            await app(dict(scope), receive, send)
            self.assertEqual(third[0]["status"], 429)
            release.set()
            await asyncio.gather(*tasks)
            async def disconnected(message):
                if message["type"] == "http.response.body":
                    raise ConnectionError("disconnected client fixture")
            with self.assertRaises(ConnectionError):
                await app(dict(scope), receive, disconnected)
            third.clear()
            await app(dict(scope), receive, send)
            self.assertEqual(third[0]["status"], 200)
        asyncio.run(exercise())

    def test_readonly_archive_token_cannot_create_control_or_delete_sessions(self):
        config = replace(settings(), recording_dir=self.temporary.name, read_token="readonly-" + "y" * 32)
        manager = FixtureManager()
        manager.archive = self.archive
        writer = self.archive.create(metadata())
        writer.record("fixture", texts={"input": "safe fixture"})
        self.finish(writer)
        headers = {"Authorization": "Bearer " + config.read_token, "Origin": config.origins[0]}
        with TestClient(create_app(config, manager)) as client:
            self.assertEqual(client.get("/v1/capabilities", headers=headers).status_code, 200)
            self.assertEqual(client.get("/v1/recordings", headers=headers).status_code, 200)
            result = client.get(f"/v1/recordings/{writer.id}/bundle", headers=headers)
            self.assertEqual(result.status_code, 200)
            verify_bundle(result.json())
            self.assertNotIn(config.token, result.text)
            self.assertNotIn(config.read_token, result.text)
            for method, path, body in [("post", "/v1/sessions", {}), ("post", "/v1/sessions/missing/commands", command("step")),
                                       ("delete", "/v1/sessions/missing", None)]:
                response = client.request(method, path, headers=headers, json=body)
                self.assertEqual(response.status_code, 401)
            command_headers = {"Authorization": "Bearer " + config.token}
            self.assertEqual(client.get(f"/v1/recordings/{writer.id}/bundle", headers=command_headers).status_code, 200)
            self.assertEqual(client.get(f"/v1/recordings/{writer.id}/bundle").status_code, 401)
            self.assertEqual(client.get(f"/v1/recordings/{writer.id}", headers={**headers, "Origin": "https://other.example"}).status_code, 403)

    def test_parent_shutdown_budgets_inference_and_recorder_before_forcing(self):
        configuration = replace(settings(), inference_timeout=0.5, recording_shutdown_timeout=0.2)
        process = object.__new__(SessionProcess)
        process.lock, process.closed, process.settings = threading.RLock(), False, configuration
        calls = []
        class Pipe:
            def send(self, value): calls.append(("send", value))
            def close(self): calls.append(("pipe-close",))
        class Process:
            alive = True
            def is_alive(self): return self.alive
            def join(self, timeout): calls.append(("join", timeout))
            def terminate(self): calls.append(("terminate",)); self.alive = False
        process.pipe, process.process = Pipe(), Process()
        process.close()
        self.assertEqual(calls[1], ("join", 3.7))
        self.assertIn(("terminate",), calls)
        self.assertTrue(process.closed)

    def test_actual_worker_episode_bundle_is_accepted_by_browser_verifier(self):
        item = self.recorded_episode()
        item.command(command("run", 1))
        item.command(command("pause", 2))
        item.command(command("step", 3))
        item.command(command("intervene", 4, {"kind": "camera-occlusion", "enabled": True, "fraction": 0.35}))
        item.command(command("step", 5))
        item.close()
        bundle = self.archive.bundle(item.recorder.id)
        source = Path(self.temporary.name) / "bundle.json"
        source.write_bytes(canonical_json(bundle))
        invalid_item = self.recorded_episode()
        invalid_item.policy.actions = np.asarray(0.1)
        with self.assertRaises(Exception):
            invalid_item.command(command("step"))
        self.assertTrue(invalid_item.recorder.wait(5))
        invalid_source = Path(self.temporary.name) / "invalid-policy-output.json"
        invalid_source.write_bytes(canonical_json(self.archive.bundle(invalid_item.recorder.id)))
        script = """const fs=require('node:fs'),vm=require('node:vm');
const ctx={crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),ctx);
Promise.all(process.argv.slice(2).map(path=>ctx.BrainSNNArenaRecording.verifyBundle(fs.readFileSync(path,'utf8')))).then(results=>{
 if(results.some(result=>!result.ok)){console.error(JSON.stringify(results));process.exit(1);}
 console.log(JSON.stringify({count:results.length,complete:results.every(result=>result.verification.complete)}));
});"""
        js = Path(__file__).resolve().parents[3] / "brainsnn-r3f-app/public/arena/arena-recording.js"
        if not js.is_file():
            js = Path(__file__).resolve().parents[1] / "viewer/arena-recording.js"
        self.assertTrue(js.is_file(), "The cross-language test requires the repository or kit browser verifier.")
        result = subprocess.run(["node", "-e", script, str(js), str(source), str(invalid_source)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)["complete"])
        self.assertEqual(json.loads(result.stdout)["count"], 2)

    def test_import_validation_preserves_omitted_large_original_and_rejects_bad_graphs(self):
        writer = self.archive.create(metadata())
        writer.record("fixture")
        manifest = self.finish(writer)
        partial = copy.deepcopy(manifest)
        partial["completion"].update(status="partial", unknownTail=True)
        partial["artifacts"] = [{"id": "large-original", "path": "original.mcap", "sha256": "a" * 64,
                                "byteLength": 1024 ** 3, "mediaType": "application/octet-stream", "retention": "omitted"}]
        self.assertEqual(verify_bundle(seal_bundle(partial, {}))["artifacts"][0]["byteLength"], 1024 ** 3)
        for change in (lambda m: m["source"].update(identityStatus="authenticated"),
                       lambda m: m["events"][0].update(artifactIds=["missing"]),
                       lambda m: m["events"][0].update(refs=[m["events"][0]["id"]]),
                       lambda m: m["events"][0].update(simTime=None),
                       lambda m: m.update(findings=[{"id": "claim", "origin": "hypothesis", "summary": "unsupported", "refs": ["missing"]}])):
            invalid = copy.deepcopy(manifest)
            change(invalid)
            with self.assertRaises(RecordingError):
                seal_bundle(invalid, {})


if __name__ == "__main__":
    unittest.main()
