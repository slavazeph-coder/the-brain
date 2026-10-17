"""Real HTTP/recorder campaign contracts using CPU-injected physics/policy.

These tests execute the production archive, bundle verifier and HTTP client;
they do not claim GPU, LIBERO or pi05 model execution.
"""
from dataclasses import replace
import base64
import copy
import json
from pathlib import Path
import signal
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from inspection import campaign
from workers.arena.app import create_app
from workers.arena.core import ArenaError, MAX_STEPS, SETTLE_STEPS, profile_contract
from test_arena_probe import AsgiOpener, ProbeManager, ProbeSession
from test_arena_worker import episode, settings


def plan(total=2, seed=7, task="libero_spatial:0"):
    return {"schema": "brainsnn.campaign.plan.v1", "recipe": profile_contract(),
            "selection": {"profileId": "panda-pi05-libero", "robotId": "panda", "modelId": "pi05",
                          "taskId": task, "protocol": "benchmark"},
            "trials": {"total": total, "seeds": {"strategy": "consecutive", "first": seed,
                        "last": seed + total - 1, "count": total}, "attemptsPerSeed": 1},
            "scheduling": {"maxConcurrentWorkers": 1, "desiredEpisodeRetries": 0}}


class CampaignManager(ProbeManager):
    def __init__(self, config):
        super().__init__(config)
        self.cases, self.miss_seeds = [], set()

    def create(self, body):
        if self.session is not None:
            raise ArenaError("worker_busy", "Existing session belongs to another client.", 409)
        item = episode(body["protocol"])
        item.request = copy.deepcopy(body)
        item.initial_state_id = body["seed"] % 2
        item.session_id = "campaign-session-" + str(len(self.created) + 1)
        item.archive = self.archive
        item.reset()
        item.env.success_at = 100000 if body["seed"] in self.miss_seeds else SETTLE_STEPS + 3
        self.session = CampaignSession(item)
        self.created.append(item.session_id)
        self.cases.append((body["task"], body["seed"]))
        return {"version": 1, "sessionId": item.session_id, "profile": item.profile, "frame": item.frame()}


class CampaignSession(ProbeSession):
    def call(self, operation, data=None):
        value = super().call(operation, data)
        if operation == "command":
            self.await_recording()
            if data.get("type") == "reset":
                for writer in self.episode.previous_recorders:
                    if not writer.wait(5):
                        raise AssertionError("Fixture reset archive did not finalize.")
        return value


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.pilot = self.root / "accepted-pilot"
        self.pilot.mkdir()
        self.output = self.root / "campaign"
        self.config = replace(settings(), recording_dir=str(self.root / "archive"))
        self.manager = CampaignManager(self.config)
        self.client = TestClient(create_app(self.config, self.manager))
        self.addCleanup(self.client.close)
        self.addCleanup(self.manager.close)
        self.http = campaign.probe.ProbeHTTP("http://127.0.0.1:8081", self.config.origins[0], self.config.token)
        self.opener = AsgiOpener(self.client)
        self.http.opener = self.opener
        campaign.probe.run_probe(self.http, self.pilot, sleep=lambda _: time.sleep(0.001))
        self.manager.cases.clear()
        self.manager.created.clear()
        self.manager.deleted.clear()
        self.opener.requests.clear()

    def run_campaign(self, **kwargs):
        return campaign.run_campaign(self.http, self.output, self.pilot,
                                     sleep=lambda _: time.sleep(0.001), **kwargs)

    def test_default_ten_tasks_are_sequential_complete_bundles_and_private_report(self):
        report = self.run_campaign()
        self.assertEqual(report["schema"], "brainsnn.campaign.report.v1")
        self.assertEqual(report["state"], "complete")
        self.assertEqual(report["counts"]["task_success"], 10)
        self.assertEqual(self.manager.cases, [(f"libero_spatial:{i}", 7) for i in range(10)])
        self.assertEqual(len(self.manager.deleted), 10)
        self.assertEqual(report["coverage"]["distinctInitialConditions"], 10)
        for case in report["cases"]:
            bundle = json.loads((self.output / case["bundlePath"]).read_text())
            manifest = campaign.probe.verify_bundle(bundle)
            self.assertEqual(manifest["context"]["taskId"], case["taskId"])
            self.assertEqual(manifest["context"]["seed"], 7)
            deletion = self.opener.requests.index(("DELETE", "/v1/sessions/" + manifest["sessionId"]))
            self.assertIn(("GET", "/v1/recordings/" + case["recordingId"] + "/bundle"), self.opener.requests[deletion + 1:])
        raw = (self.output / "report.json").read_bytes()
        self.assertLessEqual(len(raw), 2 * 1024**2)
        self.assertNotIn(b"base64", raw)
        self.assertNotIn(self.config.token.encode(), raw)
        self.assertFalse(report["execution"]["budgetEnforced"])

    def test_full_horizon_miss_remains_completed_and_separate_from_success(self):
        self.manager.miss_seeds = {8}
        report = self.run_campaign(plan=plan())
        self.assertEqual(report["state"], "complete")
        self.assertEqual(report["completedEpisodes"], 2)
        self.assertEqual(report["counts"]["task_success"], 1)
        self.assertEqual(report["counts"]["task_miss"], 1)
        self.assertEqual(report["cases"][1]["steps"], MAX_STEPS)
        self.assertIs(report["cases"][1]["taskSuccess"], False)

    def test_resume_never_retries_interrupted_attempt_and_finishes_unattempted(self):
        original = self.opener.modify
        fired = False
        def interrupt(method, path, value):
            nonlocal fired
            if path.endswith("/frame") and not fired:
                fired = True
                raise KeyboardInterrupt()
            return value
        self.opener.modify = interrupt
        first = self.run_campaign(plan=plan(total=3))
        self.assertEqual([c["status"] for c in first["cases"]], ["interrupted", "unattempted", "unattempted"])
        self.assertIsNone(self.manager.session)
        self.opener.modify = original
        resumed = self.run_campaign(plan=plan(total=3), resume=True)
        self.assertEqual(self.manager.cases, [("libero_spatial:0", 7), ("libero_spatial:0", 8), ("libero_spatial:0", 9)])
        self.assertEqual(resumed["completedEpisodes"], 2)
        self.assertEqual(resumed["counts"]["interrupted"], 1)

    def test_crashed_inflight_case_is_marked_interrupted_without_replay(self):
        report = self.run_campaign(plan=plan())
        ledger = json.loads((self.output / "ledger.json").read_text())
        ledger["cases"][0]["status"] = "inflight"
        # Emulate a crash after a worker receipt, before committing a result.
        (self.output / "ledger.json").write_bytes(campaign.encoded(ledger))
        before = len(self.manager.created)
        report = self.run_campaign(plan=plan(), resume=True)
        self.assertEqual(len(self.manager.created), before)
        self.assertEqual(report["cases"][0]["status"], "interrupted")

    def assert_terminal_result_crash_recovers(self, *, after_atomic):
        class PowerLoss(BaseException):
            pass

        original = campaign.Store.atomic
        def crash(store, relative, raw):
            if relative == "cases/00/result.json":
                if after_atomic:
                    original(store, relative, raw)
                raise PowerLoss()
            return original(store, relative, raw)

        with patch.object(campaign.Store, "atomic", crash):
            with self.assertRaises(PowerLoss):
                self.run_campaign(plan=plan())
        ledger = json.loads((self.output / "ledger.json").read_text())
        self.assertEqual(ledger["cases"][0]["status"], "inflight")
        self.assertIsNone(ledger["cases"][0]["resultPath"])
        self.assertEqual(ledger["pendingWrite"]["path"], "cases/00/result.json")
        self.assertEqual((self.output / "cases/00/result.json").exists(), after_atomic)
        self.assertEqual(self.manager.cases, [("libero_spatial:0", 7)])

        resumed = self.run_campaign(plan=plan(), resume=True)
        self.assertEqual(self.manager.cases, [("libero_spatial:0", 7), ("libero_spatial:0", 8)])
        self.assertEqual([case["status"] for case in resumed["cases"]], ["interrupted", "task_success"])
        self.assertEqual(resumed["completedEpisodes"], 1)
        self.assertIsNone(resumed["cases"][0]["taskSuccess"])
        self.assertIsNone(self.manager.session)

    def test_crash_before_terminal_result_file_commit_resumes_without_replay(self):
        self.assert_terminal_result_crash_recovers(after_atomic=False)

    def test_crash_after_terminal_result_file_before_ack_resumes_without_replay(self):
        self.assert_terminal_result_crash_recovers(after_atomic=True)

    def test_partial_archive_is_never_counted_as_completed_and_later_cases_continue(self):
        def partial(method, path, value):
            if path.startswith("/v1/recordings/") and not path.endswith("/bundle"):
                value["completion"]["status"] = "partial"
            return value
        self.opener.modify = partial
        report = self.run_campaign(plan=plan())
        self.assertEqual(report["state"], "partial")
        self.assertEqual(report["counts"]["partial_recording"], 2)
        self.assertEqual(report["completedEpisodes"], 0)
        self.assertTrue(all(c["taskSuccess"] is None for c in report["cases"]))

    def test_corrupted_camera_bytes_and_action_chain_are_rejected(self):
        for mutation in ("camera", "action"):
            def corrupt(method, path, value):
                if path.endswith("/bundle"):
                    manifest = json.loads(value["manifestText"])
                    if mutation == "camera":
                        artifact = next(a for a in manifest["artifacts"] if a["mediaType"] == "image/png")
                        value["payloads"][artifact["path"]] = base64.b64encode(b"not the recorded camera").decode()
                    else:
                        action = next(e for e in manifest["events"] if e["kind"] == "controller-input")
                        action["data"]["vector"][0] += 0.25
                        raw = campaign.encoded(manifest).rstrip(b"\n")
                        value["manifestText"] = raw.decode()
                        value["manifestSha256"] = campaign.digest(raw)
                return value
            self.opener.modify = corrupt
            self.output = self.root / ("campaign-" + mutation)
            report = self.run_campaign(plan=plan(total=1))
            self.assertEqual(report["counts"]["infrastructure_error"], 1)
            self.assertEqual(report["completedEpisodes"], 0)
            self.assertIsNone(report["cases"][0]["taskSuccess"])

    def test_early_failed_terminal_does_not_count_as_horizon_miss(self):
        def early(method, path, value):
            if path.endswith("/frame"):
                value["status"] = "failed"
                value["metrics"]["success"] = False
            return value
        self.opener.modify = early
        report = self.run_campaign(plan=plan(total=1))
        self.assertEqual(report["counts"]["infrastructure_error"], 1)
        self.assertIsNone(self.manager.session)

    def test_pilot_and_current_worker_checkpoint_must_match_before_any_session(self):
        def mismatch(method, path, value):
            if path == "/v1/capabilities":
                value["profiles"][0]["checkpointRevision"] = "sha256:" + "f" * 64
            return value
        self.opener.modify = mismatch
        with self.assertRaisesRegex(campaign.CampaignError, "differs"):
            self.run_campaign()
        self.assertEqual(self.manager.created, [])
        self.assertFalse(self.output.exists())

    def test_user_entered_pilot_and_tampered_original_pilot_bundle_are_rejected(self):
        path = self.pilot / "summary.json"
        summary = json.loads(path.read_text())
        summary["durableRecordingsPassed"] = False
        path.write_bytes(campaign.encoded(summary))
        with self.assertRaises(campaign.CampaignError):
            self.run_campaign()
        self.assertEqual(self.manager.created, [])

    def test_pilot_original_bundle_digest_is_required_before_any_session(self):
        path = self.pilot / "benchmark-recording.json"
        bundle = json.loads(path.read_text())
        bundle["manifestSha256"] = "0" * 64
        path.write_bytes(campaign.encoded(bundle))
        with self.assertRaises(Exception):
            self.run_campaign()
        self.assertEqual(self.manager.created, [])

    def test_wall_timeout_closes_own_session_and_preserves_unattempted_cases(self):
        def stalled(method, path, value):
            if path.endswith("/frame"):
                time.sleep(2)
            return value
        self.opener.modify = stalled
        started = time.monotonic()
        report = self.run_campaign(plan=plan(), max_seconds=1)
        self.assertLess(time.monotonic() - started, 1.8)
        self.assertEqual(report["counts"]["interrupted"], 1)
        self.assertEqual(report["counts"]["unattempted"], 1)
        self.assertIsNone(self.manager.session)

    def test_resume_rejects_changed_plan_result_bundle_and_time_limits(self):
        self.run_campaign(plan=plan())
        for kwargs in ({"plan": plan(seed=8)}, {"plan": plan(), "max_seconds": 601}):
            with self.assertRaisesRegex(campaign.CampaignError, "identical"):
                self.run_campaign(resume=True, **kwargs)
        for path in (self.output / "cases/00/result.json", self.output / "cases/00/recording.json"):
            raw = path.read_bytes()
            path.write_bytes(raw + b" ")
            with self.assertRaisesRegex(campaign.CampaignError, "pinned file hash"):
                self.run_campaign(plan=plan(), resume=True)
            path.write_bytes(raw)
        self.assertEqual(len(self.manager.created), 2)

    def test_complete_resume_performs_no_mutation_and_checks_all_files(self):
        self.run_campaign(plan=plan(total=1))
        self.opener.requests.clear()
        report = self.run_campaign(plan=plan(total=1), resume=True)
        self.assertEqual(report["state"], "complete")
        self.assertEqual(self.opener.requests, [("GET", "/v1/capabilities")])

    def test_infrastructure_error_does_not_delete_unowned_session(self):
        unowned = self.manager.create({"protocol": "benchmark", "seed": 123, "task": "libero_spatial:0"})
        sid = unowned["sessionId"]
        report = self.run_campaign(plan=plan())
        self.assertEqual(report["counts"]["infrastructure_error"], 2)
        self.assertNotIn(sid, self.manager.deleted)
        self.assertEqual(self.manager.session.episode.session_id, sid)

    def test_output_cap_stops_attempts_but_preserves_error_result_report(self):
        original = campaign.Store.save
        def limited(store, path, value, **kwargs):
            if path.endswith("/recording.json"):
                raise campaign.OutputLimit("bounded test")
            return original(store, path, value, **kwargs)
        with patch.object(campaign.Store, "save", limited):
            report = self.run_campaign(plan=plan())
        self.assertEqual(report["counts"]["infrastructure_error"], 1)
        self.assertEqual(report["counts"]["unattempted"], 1)
        self.assertTrue((self.output / "cases/00/result.json").exists())
        self.assertIsNone(self.manager.session)

    def test_repeated_initial_state_ids_do_not_count_new_conditions(self):
        report = self.run_campaign(plan=plan(total=3))
        self.assertEqual(report["coverage"]["observedInitialConditions"], 3)
        self.assertEqual(report["coverage"]["distinctInitialConditions"], 2)
        self.assertEqual(report["coverage"]["repeatedInitialConditions"], 1)

    def test_interrupted_file_commit_recovers_only_expected_bytes(self):
        self.run_campaign(plan=plan(total=1))
        ledger_path = self.output / "ledger.json"
        ledger = json.loads(ledger_path.read_text())
        raw = campaign.encoded({"interrupted": "transaction"})
        path = "cases/00/pending.json"
        ledger["pendingWrite"] = {"path": path, "sha256": campaign.digest(raw), "bytes": len(raw)}
        ledger_path.write_bytes(campaign.encoded(ledger))
        (self.output / path).write_bytes(raw)
        report = self.run_campaign(plan=plan(total=1), resume=True)
        self.assertEqual(report["state"], "complete")
        self.assertIn(path, json.loads(ledger_path.read_text())["files"])


class CampaignValidationTests(unittest.TestCase):
    def test_larger_and_concurrent_retry_practice_or_wrong_recipe_plans_remain_plan_only(self):
        mutations = [lambda p: p["trials"].update(total=1000),
                     lambda p: p["scheduling"].update(maxConcurrentWorkers=2),
                     lambda p: p["scheduling"].update(desiredEpisodeRetries=1),
                     lambda p: p["selection"].update(protocol="practice"),
                     lambda p: p["recipe"]["cameras"][0].update(width=256),
                     lambda p: p["recipe"]["timing"].update(actionChunkSteps=10)]
        for mutate in mutations:
            value = plan()
            mutate(value)
            with self.assertRaises(campaign.CampaignError):
                campaign.normalize_plan(value)

    def test_output_inside_git_or_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / ".git").mkdir()
            with self.assertRaises(campaign.CampaignError):
                campaign.outside_git(root / "evidence")
            (root / ".git").rmdir()
            (root / "actual").mkdir()
            (root / "alias").symlink_to(root / "actual", target_is_directory=True)
            with self.assertRaises(campaign.CampaignError):
                campaign.outside_git(root / "alias" / "evidence")

    def test_actual_output_cap_rejects_bulk_bytes_before_writing(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve() / "private"
            store = campaign.Store(root, resume=False, maximum=8 * 1024**2)
            try:
                store.ledger = {"schema": campaign.LEDGER_SCHEMA, "files": {}}
                store.commit()
                with self.assertRaises(campaign.OutputLimit):
                    store.save("large.json", {"data": "x" * (5 * 1024**2)}, bulk=True)
                self.assertFalse((root / "large.json").exists())
                self.assertLess(sum(p.stat().st_size for p in root.iterdir()), 8 * 1024**2)
            finally:
                store.close()

    def test_symlink_lock_is_rejected_before_open_or_write(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            output = root / "output"
            output.mkdir()
            destination = root / "must-not-create"
            (output / ".campaign.lock").symlink_to(destination)
            with self.assertRaises(campaign.CampaignError):
                campaign.Store(output, resume=True, maximum=8 * 1024**2)
            self.assertFalse(destination.exists())

    def test_actual_wall_alarm_interrupts_stalled_operations(self):
        with self.assertRaises(campaign.WallLimit):
            with campaign.wall_alarm(0.02):
                time.sleep(1)

    def test_nested_wall_alarm_cannot_extend_parent_deadline(self):
        with self.assertRaises(campaign.WallLimit):
            with campaign.wall_alarm(0.12):
                with campaign.wall_alarm(1):
                    time.sleep(0.075)
                self.assertLess(signal.getitimer(signal.ITIMER_REAL)[0], 0.07)
                time.sleep(0.2)


if __name__ == "__main__":
    unittest.main()
