"""Wrapper regressions. The real upstream audit is exercised separately on native MuJoCo."""

import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/world-mujoco/audit_scene.py"
MODULE_SPEC = importlib.util.spec_from_file_location("world_mujoco_audit", SCRIPT)
audit = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(audit)

SCENE = b'<mujoco model="block"><worldbody><body name="block"/></worldbody></mujoco>'
SCORE = {
    "passed": True,
    "errors": [],
    "warnings": ["a review note"],
    "mesh_topology": [],
}


def run_args(tmp_path):
    scene = tmp_path / "source.xml"
    scene.write_bytes(SCENE)
    upstream = tmp_path / "upstream.py"
    upstream.write_text("print('different script')\n")
    output = tmp_path / "audit"
    return scene, upstream, output, [
        "--scene", str(scene), "--upstream-script", str(upstream),
        "--output-dir", str(output),
    ]


def test_bad_upstream_and_existing_output_left_intact(tmp_path, monkeypatch):
    _, upstream, output, args = run_args(tmp_path)
    monkeypatch.setattr(audit, "dependencies", lambda: {})
    assert audit.main(args) == 2
    assert not output.exists()
    output.mkdir()
    marker = output / "keep.txt"
    marker.write_text("previous audit")
    monkeypatch.setattr(audit, "load_upstream", lambda _: pytest.fail("ran over an existing output"))
    assert audit.main(args) == 2
    assert marker.read_text() == "previous audit"
    assert upstream.read_text() == "print('different script')\n"


def test_snapshot_hash_unchanged_verbatim_output_and_no_cloud_key(tmp_path, monkeypatch):
    scene, upstream, output, args = run_args(tmp_path)
    stdout = (json.dumps(SCORE, indent=2) + "\n").encode()
    script = (
        "import os, sys\n"
        "assert 'GEMINI_API_KEY' not in os.environ\n"
        "assert '--static_only' in sys.argv\n"
        f"sys.stdout.buffer.write({stdout!r})\n"
    ).encode()
    original_hash = audit.sha256(SCENE)
    upstream.write_bytes(script)
    monkeypatch.setattr(audit, "UPSTREAM_SHA256", audit.sha256(script))
    monkeypatch.setattr(audit, "dependencies", lambda: {"mujoco": "4.0.1"})
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    assert audit.main(args) == 0
    assert scene.read_bytes() == SCENE
    assert (output / "official-static.json").read_bytes() == stdout
    receipt = json.loads((output / "audit-receipt.json").read_bytes())
    assert receipt["source"]["sha256"] == original_hash
    assert receipt["upstream"]["sha256"] == audit.sha256(script)
    assert receipt["static_findings"] == {"passed": True, "errors": 0, "warnings": 1}
    assert receipt["task_rollout_executed"] is False
    assert next(f for f in receipt["artifacts"] if f["name"] == "official-static.json")["sha256"] == audit.sha256(stdout)


def test_invalid_external_refs_and_task_dynamics_fail_closed(tmp_path, monkeypatch):
    scene, _, output, args = run_args(tmp_path)
    dependency_guard = lambda: pytest.fail("prepared runtime for rejected input")
    monkeypatch.setattr(audit, "dependencies", dependency_guard)
    scene.write_text('<mujoco><include file="isolated-other.xml"/></mujoco>')
    assert audit.main(args) == 2
    scene.write_text('<mujoco><worldbody><geom type="plane"/><body name="object"/></worldbody></mujoco>')
    assert audit.main(args + ["--object-scenarios", "1"]) == 2
    assert not output.exists()
