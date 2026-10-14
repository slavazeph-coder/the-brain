"""Contract tests with injected doubles. These do not execute MuJoCo or pi05."""
import copy
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

from workers.arena.checkpoint_manifest import canonical, contents, revision, verify
from workers.arena.core import (ArenaError, CHECKPOINT, Episode, OPENPI_REVISION,
                                PROFILE_ID, SETTLE_STEPS, prepare_observation, profile_contract)
from workers.arena.runtime import (SessionManager, SessionProcess, Settings, child_loop,
                                   validate_policy_metadata)
from workers.arena.serve_openpi import warm_up


class ModelWarmupTests(unittest.TestCase):
    def test_warmup_matches_native_libero_input_and_requires_valid_chunk(self):
        policy = FakePolicy()
        warm_up(policy)
        self.assertEqual(len(policy.inputs), 1)
        inputs = policy.inputs[0]
        self.assertEqual(inputs["observation/state"].shape, (8,))
        for key in ("observation/image", "observation/wrist_image"):
            self.assertEqual(inputs[key].shape, (224, 224, 3))
            self.assertEqual(inputs[key].dtype, np.uint8)
        self.assertEqual(policy.reset_count, 1)
        for actions in (np.zeros((4, 7)), np.zeros((5, 8)), np.full((5, 7), np.nan)):
            policy.actions = actions
            with self.assertRaises(RuntimeError):
                warm_up(policy)

    def test_default_policy_port_is_separate_from_production_text_backend(self):
        self.assertEqual(Settings(token="x" * 40, origins=("https://www.brainsnn.com",)).policy_url,
                         "ws://127.0.0.1:8010")


class Images:
    @staticmethod
    def resize_with_pad(image, height, width):
        return np.asarray(Image.fromarray(image).resize((width, height), Image.Resampling.NEAREST))

    @staticmethod
    def convert_to_uint8(image):
        return np.asarray(image, dtype=np.uint8)


class FakeEnvironment:
    def __init__(self):
        self.sim = SimpleNamespace(data=SimpleNamespace(time=0.0, body_xpos=np.zeros((2, 3)),
                                  body_xquat=np.asarray([[1, 0, 0, 0], [1, 0, 0, 0]])),
                                  model=SimpleNamespace(body_names=["world", "panda_link0"]))
        self.env = SimpleNamespace(action_spec=(np.full(7, -1), np.full(7, 1)))
        self.actions = []
        self.close_count = 0
        self.reset_count = 0
        self.success_at = 1000

    def seed(self, seed):
        self.last_seed = seed

    def reset(self):
        self.reset_count += 1
        self.sim.data.time = 0.0
        self.actions = []
        return self.observation()

    def set_init_state(self, state):
        self.last_initial_state = state.copy()
        return self.observation()

    def observation(self):
        pixels = np.asarray([[[10, 20, 30], [40, 50, 60]], [[70, 80, 90], [100, 110, 120]]], dtype=np.uint8)
        return {"agentview_image": pixels.copy(), "robot0_eye_in_hand_image": pixels.copy(),
                "frontview_image": pixels.copy(), "robot0_eef_pos": np.asarray([0.1, 0.2, 0.3]),
                "robot0_eef_quat": np.asarray([0., 0., 0., 1.]), "robot0_gripper_qpos": np.asarray([0.01, 0.02])}

    def step(self, action):
        self.actions.append(list(action))
        self.sim.data.time += 0.05
        return self.observation(), float(self.check_success()), self.check_success(), {}

    def check_success(self):
        return len(self.actions) >= self.success_at

    def get_sim_state(self):
        return np.asarray([self.sim.data.time, *self.actions[-1]])

    def close(self):
        self.close_count += 1


class FakePolicy:
    def __init__(self):
        self.inputs = []
        self.actions = np.full((5, 7), 0.1)
        self.reset_count = 0
        self.close_count = 0

    def infer(self, inputs):
        self.inputs.append(copy.deepcopy(inputs))
        return {"actions": self.actions.copy()}

    def reset(self):
        self.reset_count += 1

    def close(self):
        self.close_count += 1


def settings():
    return Settings(token="unit-test-" + "x" * 32, origins=("https://arena.example",),
                    checkpoint_revision="sha256:" + "a" * 64)


def request(protocol="practice"):
    return {"version": 1, "profileId": PROFILE_ID, "robotId": "panda", "modelId": "pi05", "checkpoint": CHECKPOINT,
            "task": "libero_spatial:0", "seed": 7, "protocol": protocol}


def episode(protocol="practice"):
    env, policy = FakeEnvironment(), FakePolicy()
    return Episode(env, policy, Images(), np.asarray([1., 2., 3.]), "put the bowl on the plate", request(protocol),
                   {**profile_contract(settings().checkpoint_revision), "ready": True}, "test-session")


def command(kind, index=1, payload=None):
    return {"version": 1, "type": kind, "payload": payload or {}, "requestId": f"request-{index}"}


class EpisodeTests(unittest.TestCase):
    def setUp(self):
        self.episode = episode()
        self.addCleanup(self.episode.close)

    def test_no_named_policy_execution_before_explicit_step(self):
        frame = self.episode.frame()
        self.assertFalse(frame["policyExecuted"])
        self.assertEqual(self.episode.policy.inputs, [])
        self.assertEqual(len(self.episode.env.actions), SETTLE_STEPS)
        self.assertEqual(frame["metrics"]["steps"], 0)
        self.assertEqual(self.episode.env.last_seed, 7)
        np.testing.assert_array_equal(self.episode.env.last_initial_state, [1, 2, 3])

    def test_native_preprocessing_two_cameras_eight_state_features(self):
        self.episode.command(command("step"))
        sent = self.episode.policy.inputs[0]
        self.assertEqual(sent["observation/image"].shape, (224, 224, 3))
        np.testing.assert_array_equal(sent["observation/image"][0, 0], [100, 110, 120])
        self.assertEqual(sent["observation/state"].shape, (8,))
        self.assertEqual(sent["prompt"], self.episode.prompt)
        np.testing.assert_array_equal(self.episode.obs["agentview_image"][0, 0], [10, 20, 30])

    def test_policy_actions_actually_step_environment_and_chunk_is_five(self):
        for index in range(6):
            frame = self.episode.command(command("step", index))
        self.assertEqual(len(self.episode.policy.inputs), 2)
        self.assertEqual(len(self.episode.env.actions), SETTLE_STEPS + 6)
        np.testing.assert_allclose(self.episode.env.actions[-1], np.full(7, 0.1))
        self.assertEqual(frame["metrics"]["steps"], 6)
        self.assertTrue(frame["policyExecuted"])
        self.assertAlmostEqual(frame["simTime"], 0.8)

    def test_retried_command_never_steps_twice(self):
        first = self.episode.command(command("step"))
        second = self.episode.command(command("step"))
        self.assertEqual(first["seq"], second["seq"])
        self.assertEqual(self.episode.steps, 1)
        with self.assertRaises(ArenaError) as caught:
            self.episode.command(command("reset"))
        self.assertEqual(caught.exception.code, "request_id_reused")

    def test_pause_does_not_step_and_manual_step_requires_pause(self):
        self.episode.command(command("run", 1))
        with self.assertRaises(ArenaError):
            self.episode.command(command("step", 2))
        self.episode.command(command("pause", 3))
        self.assertEqual(self.episode.steps, 0)
        self.episode.command(command("step", 4))
        self.assertEqual(self.episode.status, "paused")

    def test_practice_mask_changes_actual_policy_image_only(self):
        self.episode.command(command("step", 1))
        self.assertEqual(len(self.episode.action_plan), 4)
        spectator = self.episode.frame()["cameras"][0]["url"]
        self.episode.command(command("intervene", 2, {"kind": "camera-occlusion", "enabled": True, "fraction": 0.5}))
        self.assertEqual(len(self.episode.action_plan), 0)
        self.episode.command(command("step", 3))
        self.assertEqual(self.episode.frame()["cameras"][0]["url"], spectator)
        np.testing.assert_array_equal(self.episode.policy.inputs[-1]["observation/image"][:, 56:168], 0)
        self.assertTrue(np.any(self.episode.policy.inputs[-1]["observation/wrist_image"][:, 56:168]))
        self.assertEqual(self.episode.interventions, 1)

    def test_benchmark_locks_interventions_without_mutating_state(self):
        other = episode("benchmark")
        self.addCleanup(other.close)
        with self.assertRaises(ArenaError) as caught:
            other.command(command("intervene", payload={"kind": "camera-occlusion", "enabled": True}))
        self.assertEqual(caught.exception.code, "benchmark_locked")
        self.assertEqual(other.interventions, 0)
        self.assertEqual(other.occlusion, 0)

    def test_bad_actions_stop_before_physics_step(self):
        self.episode.policy.actions[0, 0] = np.nan
        with self.assertRaises(ArenaError):
            self.episode.command(command("step"))
        self.assertEqual(self.episode.status, "error")
        self.assertEqual(len(self.episode.env.actions), SETTLE_STEPS)
        self.assertFalse(self.episode.frame()["policyExecuted"])

    def test_success_uses_environment_checker_and_cannot_run_past_terminal(self):
        self.episode.env.success_at = SETTLE_STEPS + 1
        frame = self.episode.command(command("step"))
        self.assertEqual(frame["status"], "succeeded")
        self.assertTrue(frame["metrics"]["success"])
        with self.assertRaises(ArenaError):
            self.episode.command(command("run", 2))

    def test_reset_restores_initial_state_and_clears_queued_actions(self):
        old_frame = self.episode.command(command("step", 1))
        reset = self.episode.command(command("reset", 2))
        self.assertGreater(reset["seq"], old_frame["seq"])
        self.assertEqual(reset["status"], "paused")
        self.assertFalse(reset["policyExecuted"])
        self.assertEqual(self.episode.policy.reset_count, 2)
        self.assertEqual(len(self.episode.action_plan), 0)
        np.testing.assert_array_equal(self.episode.env.last_initial_state, [1, 2, 3])

    def test_evidence_records_real_applied_actions_and_authoritative_state(self):
        self.episode.command(command("step"))
        evidence = self.episode.evidence()
        self.assertEqual(len(evidence["steps"]), 1)
        self.assertEqual(len(evidence["steps"][0]["stateSha256"]), 64)
        self.assertEqual(evidence["steps"][0]["action"], self.episode.env.actions[-1])
        self.assertEqual(evidence["profile"]["checkpointRevision"], settings().checkpoint_revision)

    def test_close_releases_policy_and_renderer_once(self):
        self.episode.close()
        self.episode.close()
        self.assertEqual(self.episode.env.close_count, 1)
        self.assertEqual(self.episode.policy.close_count, 1)


class ProvenanceTests(unittest.TestCase):
    def test_profile_includes_exact_camera_controller_and_timing_contract(self):
        profile = profile_contract(settings().checkpoint_revision)
        self.assertEqual(profile["simulator"]["name"], "LIBERO")
        self.assertEqual(profile["timing"]["actionChunkSteps"], 5)
        self.assertEqual(profile["action"]["controller"], "OSC_POSE")
        self.assertTrue(all(c["width"] == 224 and c["sourceWidth"] == 256 for c in profile["cameras"]))

    def test_server_metadata_must_match_pinned_checkpoint_and_loader(self):
        manifest = {"brainsnn": {"profileId": PROFILE_ID, "checkpoint": CHECKPOINT,
                    "checkpointRevision": settings().checkpoint_revision, "config": "pi05_libero",
                    "openpiRevision": OPENPI_REVISION, "actionSize": 7}}
        validate_policy_metadata(manifest, settings())
        for key in manifest["brainsnn"]:
            wrong = copy.deepcopy(manifest)
            wrong["brainsnn"][key] = "wrong"
            with self.assertRaises(ArenaError):
                validate_policy_metadata(wrong, settings())
        with self.assertRaises(ArenaError):
            validate_policy_metadata({}, settings())

    def test_checkpoint_content_change_invalidates_the_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "weights"
            model.mkdir()
            weight = model / "weights.bin"
            weight.write_bytes(b"fixed-test-checkpoint")
            manifest = contents(model)
            path = root / "manifest.json"
            path.write_bytes(canonical(manifest))
            self.assertEqual(verify(model, path), revision(manifest))
            weight.write_bytes(b"different-checkpoint")
            with self.assertRaises(ValueError):
                verify(model, path)

    def test_worker_requires_secret_and_explicit_browser_origin(self):
        settings().validate()
        for configuration in (Settings(token="", origins=("https://arena.example",)),
                              Settings(token="x" * 40, origins=("*",)),
                              Settings(token="x" * 40, origins=("http://public.example",))):
            with self.assertRaises(ValueError):
                configuration.validate()


class FakeOwnedProcess:
    counter = 0

    def __init__(self, body, configuration):
        type(self).counter += 1
        self.id = f"owned-{self.counter}"
        self.closed = False
        self.process = SimpleNamespace(is_alive=lambda: not self.closed)
        self.profile = {**profile_contract(configuration.checkpoint_revision), "ready": True}
        self.initial_frame = {"policyExecuted": False}

    def close(self):
        self.closed = True


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.manager = SessionManager(settings(), process_factory=FakeOwnedProcess)
        self.dependencies = patch("workers.arena.runtime.dependencies_ready", return_value=[])
        self.policy = patch("workers.arena.runtime.connect_policy", return_value=FakePolicy())
        self.dependencies.start()
        self.policy.start()
        self.addCleanup(self.dependencies.stop)
        self.addCleanup(self.policy.stop)
        self.addCleanup(self.manager.close)

    def test_capability_and_session_return_identical_exact_profile(self):
        capability = self.manager.capabilities()["profiles"][0]
        created = self.manager.create(request())
        self.assertEqual(created["profile"], capability)
        self.assertFalse(created["frame"]["policyExecuted"])

    def test_mismatched_tuple_never_constructs_a_session(self):
        for key, value in (("profileId", "g1-sonic"), ("robotId", "g1"), ("modelId", "molmo"),
                           ("checkpoint", "other/checkpoint"), ("task", "unknown:0")):
            with self.assertRaises(ArenaError):
                self.manager.create({**request(), key: value})
            self.assertEqual(self.manager.sessions, {})

    def test_only_one_live_session_and_delete_releases_capacity(self):
        started = self.manager.create(request())
        first = self.manager.get(started["sessionId"])
        with self.assertRaises(ArenaError) as caught:
            self.manager.create(request())
        self.assertEqual(caught.exception.code, "worker_busy")
        self.manager.delete(started["sessionId"])
        self.assertTrue(first.closed)
        second = self.manager.create(request())
        self.assertNotEqual(second["sessionId"], started["sessionId"])

    def test_missing_dependencies_cannot_advertise_or_launch_ready_policy(self):
        with patch("workers.arena.runtime.dependencies_ready", return_value=["Install the pinned LIBERO runtime"]):
            capability = self.manager.capabilities()["profiles"][0]
            self.assertFalse(capability["ready"])
            with self.assertRaises(ArenaError) as caught:
                self.manager.create(request())
            self.assertEqual(caught.exception.code, "profile_not_ready")
            self.assertEqual(self.manager.sessions, {})

    def test_failed_policy_probe_is_explained_and_not_ready(self):
        with patch("workers.arena.runtime.connect_policy", side_effect=ConnectionError("private endpoint detail")):
            capability = self.manager.capabilities()["profiles"][0]
        self.assertFalse(capability["ready"])
        self.assertIn("unreachable", capability["reason"])
        self.assertNotIn("private endpoint detail", capability["reason"])

    def test_owner_loop_runs_policy_then_closes_renderer_and_socket(self):
        owned = episode()
        operations = [("command", command("run")), ("frame", None), ("close", None)]
        sent = []
        pipe = SimpleNamespace(send=sent.append, poll=lambda timeout: bool(operations),
                               recv=lambda: operations.pop(0), close=lambda: None)
        with patch("workers.arena.runtime.create_episode", return_value=owned):
            child_loop(pipe, request(), settings(), "test-session")
        self.assertFalse(sent[0]["frame"]["policyExecuted"])
        self.assertTrue(sent[2]["value"]["policyExecuted"])
        self.assertEqual(owned.env.close_count, 1)
        self.assertEqual(owned.policy.close_count, 1)


if __name__ == "__main__":
    unittest.main()
