"""Actual ASGI routes/auth/CORS, with the physics subprocess injected."""
import unittest

from fastapi.testclient import TestClient

from workers.arena.app import create_app
from workers.arena.core import ArenaError
from test_arena_worker import command, episode, request, settings


class TestSession:
    def __init__(self, protocol):
        self.episode = episode(protocol)

    def call(self, operation, data=None):
        if operation == "frame":
            return self.episode.frame()
        if operation == "command":
            return self.episode.command(data)
        if operation == "evidence":
            return self.episode.evidence()
        raise AssertionError(operation)


class TestManager:
    def __init__(self):
        self.session = None
        self.closed = False

    def capabilities(self):
        return {"version": 1, "profiles": []}

    def create(self, body):
        self.session = TestSession(body["protocol"])
        result = {key: body[key] for key in ("profileId", "robotId", "modelId", "checkpoint")}
        result.update({"version": 1, "sessionId": "test-session", "status": "ready", "profile": self.session.episode.profile,
                       "frame": self.session.episode.frame()})
        return result

    def get(self, session_id):
        if session_id != "test-session" or self.session is None:
            raise ArenaError("session_not_found", "This worker does not own that session.", 404)
        return self.session

    def delete(self, session_id):
        if self.session:
            self.session.episode.close()
        self.session = None

    def close(self):
        self.closed = True
        self.delete("test-session")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.manager = TestManager()
        self.client = TestClient(create_app(settings(), self.manager))
        self.headers = {"Authorization": "Bearer " + settings().token, "Origin": settings().origins[0]}
        self.addCleanup(self.client.close)
        self.addCleanup(self.manager.close)

    def test_capabilities_require_bearer_auth(self):
        response = self.client.get("/v1/capabilities")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "authentication_required")
        self.assertEqual(self.client.get("/v1/capabilities", headers=self.headers).status_code, 200)

    def test_disallowed_browser_origin_is_rejected_even_with_valid_token(self):
        headers = {**self.headers, "Origin": "https://other.example"}
        self.assertEqual(self.client.get("/v1/capabilities", headers=headers).status_code, 403)

    def test_preflight_only_allows_configured_site(self):
        headers = {"Origin": settings().origins[0], "Access-Control-Request-Method": "POST",
                   "Access-Control-Request-Headers": "authorization,content-type"}
        result = self.client.options("/v1/sessions", headers=headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["access-control-allow-origin"], settings().origins[0])
        headers["Origin"] = "https://other.example"
        self.assertEqual(self.client.options("/v1/sessions", headers=headers).status_code, 400)

    def test_full_http_session_step_reset_and_delete(self):
        started = self.client.post("/v1/sessions", headers=self.headers, json=request())
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["profile"]["timing"]["actionChunkSteps"], 5)
        initial = self.client.get("/v1/sessions/test-session/frame", headers=self.headers).json()
        self.assertFalse(initial["policyExecuted"])
        stepped = self.client.post("/v1/sessions/test-session/commands", headers=self.headers, json=command("step")).json()
        self.assertTrue(stepped["frame"]["policyExecuted"])
        self.assertEqual(stepped["requestId"], "request-1")
        evidence = self.client.get("/v1/sessions/test-session/evidence", headers=self.headers).json()
        self.assertEqual(len(evidence["steps"]), 1)
        reset = self.client.post("/v1/sessions/test-session/commands", headers=self.headers, json=command("reset", 2)).json()
        self.assertGreater(reset["frame"]["seq"], stepped["frame"]["seq"])
        self.assertFalse(reset["frame"]["policyExecuted"])
        self.assertTrue(self.client.delete("/v1/sessions/test-session", headers=self.headers).json()["closed"])
        self.assertEqual(self.client.get("/v1/sessions/test-session/frame", headers=self.headers).status_code, 404)

    def test_benchmark_intervention_returns_explanatory_conflict(self):
        self.client.post("/v1/sessions", headers=self.headers, json=request("benchmark"))
        response = self.client.post("/v1/sessions/test-session/commands", headers=self.headers,
                                    json=command("intervene", payload={"kind": "camera-occlusion", "enabled": True}))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "benchmark_locked")

    def test_unknown_fields_and_boolean_seed_are_rejected(self):
        for invalid in ({**request(), "policyUrl": "ws://attacker.example"}, {**request(), "seed": True}):
            self.assertEqual(self.client.post("/v1/sessions", headers=self.headers, json=invalid).status_code, 422)

    def test_body_is_limited_before_json_parse(self):
        response = self.client.post("/v1/sessions", headers=self.headers, content=b"x" * 65537)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["code"], "request_too_large")

    def test_chunked_body_is_also_limited(self):
        def chunks():
            yield b"x" * 40000
            yield b"y" * 40000
        response = self.client.post("/v1/sessions", headers=self.headers, content=chunks())
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
