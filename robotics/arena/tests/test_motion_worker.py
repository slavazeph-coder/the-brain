"""Motion worker entry point: authentication, bundle parsing and startup guards. No model or GPU is loaded."""
import asyncio
import importlib.util
import os
import unittest
from unittest import mock

from workers.motion import app as worker

KEY = "motion-worker-test-key-".ljust(40, "k")


class Downstream:
    def __init__(self):
        self.calls = 0

    async def __call__(self, scope, receive, send):
        self.calls += 1
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})


def call(middleware, headers, chunks=(b"",)):
    sent, pending = [], list(chunks)

    async def receive():
        body = pending.pop(0)
        return {"type": "http.request", "body": body, "more_body": bool(pending)}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/generate-dense", "headers": headers}
    asyncio.run(middleware(scope, receive, send))
    return sent[0]["status"]


class MotionWorkerTests(unittest.TestCase):
    def test_bearer_key_is_required_when_configured(self):
        downstream = Downstream()
        middleware = worker.AuthMiddleware(downstream, KEY)
        self.assertEqual(call(middleware, []), 401)
        self.assertEqual(call(middleware, [(b"authorization", b"Bearer wrong")]), 401)
        self.assertEqual(call(middleware, [(b"authorization", ("Bearer " + KEY + "x").encode())]), 401)
        self.assertEqual(downstream.calls, 0)
        self.assertEqual(call(middleware, [(b"authorization", ("Bearer " + KEY).encode())]), 200)
        self.assertEqual(downstream.calls, 1)

    def test_oversized_bodies_are_refused_before_the_engine(self):
        downstream = Downstream()
        middleware = worker.AuthMiddleware(downstream, KEY)
        headers = [(b"authorization", ("Bearer " + KEY).encode())]
        # Chunked input carries no content-length, so the cap counts what actually arrives.
        self.assertEqual(call(middleware, headers, [b"x" * 9000, b"x" * 9000]), 413)
        self.assertEqual(downstream.calls, 0)
        self.assertEqual(call(middleware, headers, [b"{", b"}"]), 200)
        self.assertEqual(downstream.calls, 1)

    def test_loopback_worker_may_run_without_a_key(self):
        downstream = Downstream()
        self.assertEqual(call(worker.AuthMiddleware(downstream, ""), []), 200)
        for host in ("127.0.0.1", "::1", "localhost"):
            self.assertTrue(worker.is_loopback(host), host)
        for host in ("0.0.0.0", "192.168.1.20", "motion.example.test"):
            self.assertFalse(worker.is_loopback(host), host)

    def test_bundles_follow_the_upstream_effort_convention(self):
        self.assertEqual(worker.parse_bundles(["binhpham/reachy-mini-motion-planner-27b"]),
                         [("high", "binhpham/reachy-mini-motion-planner-27b")])
        self.assertEqual(worker.parse_bundles(["medium=binhpham/reachy-mini-motion-planner-4b@1b60d8f", "low=/models/low"]),
                         [("medium", "binhpham/reachy-mini-motion-planner-4b@1b60d8f"), ("low", "/models/low")])
        for bad in (["turbo=org/model"], ["medium="], ["low=a", "low=b"]):
            with self.assertRaises(SystemExit):
                worker.parse_bundles(bad)

    def test_startup_refuses_public_listening_without_a_key_or_with_a_weak_one(self):
        with mock.patch.dict(os.environ, {"MOTION_WORKER_KEY": ""}), mock.patch.object(worker, "build") as build:
            with self.assertRaises(SystemExit):
                worker.main(["--host", "0.0.0.0", "--bundle", "low=org/model"])
            build.assert_not_called()
        with mock.patch.dict(os.environ, {"MOTION_WORKER_KEY": "short"}), mock.patch.object(worker, "build") as build:
            with self.assertRaises(SystemExit):
                worker.main(["--host", "127.0.0.1", "--bundle", "low=org/model"])
            build.assert_not_called()
        with mock.patch.dict(os.environ, {"MOTION_WORKER_KEY": KEY}), mock.patch.object(worker, "build") as build:
            with self.assertRaises(SystemExit):
                worker.main(["--bundle", "low=org/model", "--gpu-memory-utilization", "0.99"])
            build.assert_not_called()

    @unittest.skipUnless(importlib.util.find_spec("huggingface_hub"), "huggingface_hub is not installed")
    def test_pinned_revisions_are_passed_to_the_hub(self):
        with mock.patch("huggingface_hub.snapshot_download", return_value="/cache/bundle") as download:
            self.assertEqual(worker.resolve_bundle("binhpham/reachy-mini-motion-planner-4b@1b60d8f"), "/cache/bundle")
            download.assert_called_once_with("binhpham/reachy-mini-motion-planner-4b", revision="1b60d8f")


if __name__ == "__main__":
    unittest.main()
