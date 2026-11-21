#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = [
#     "mujoco==4.0.1",
#     "absl-py==2.5.1",
#     "numpy==2.5.5",
#     "Pillow==13.0.0",
#     "scipy==1.18.1",
#     "trimesh==5.2.1",
# ]
# ///
"""Run Google's pinned MuJoCo audit against an exported MJCF scene."""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

REPOSITORY = "https://github.com/google-deepmind/robotics-antigravity-plugin"
REVISION = "9cb7f624c4d7c50859a39f1d49d088990429a83d"
UPSTREAM_PATH = "plugins/robotics/skills/mujoco-audit/scripts/audit_scenarios.py"
UPSTREAM_URL = (
    "https://raw.githubusercontent.com/google-deepmind/robotics-antigravity-plugin/"
    f"{REVISION}/{UPSTREAM_PATH}"
)
UPSTREAM_SHA256 = "6a0660ed45826efab75fbfbedab1c64f6975dd00777270c51e73b404a470eb8f"
PACKAGES = ("mujoco", "mujoco-core", "absl-py", "numpy", "Pillow", "scipy", "trimesh")
MAX_SCENE_BYTES = 8 * 1024**2
MAX_SCRIPT_BYTES = 512 * 1024


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def load_upstream(path):
    if path is None:
        with urllib.request.urlopen(UPSTREAM_URL, timeout=30) as response:
            raw = response.read(MAX_SCRIPT_BYTES + 1)
    else:
        with path.open("rb") as file:
            raw = file.read(MAX_SCRIPT_BYTES + 1)
    if sha256(raw) != UPSTREAM_SHA256:
        raise ValueError("The Google audit script differs from the pinned SHA-256.")
    return raw


def load_scene(path, object_scenarios):
    if path.suffix.lower() != ".xml" or not path.is_file():
        raise ValueError("Choose a self-contained MJCF .xml export.")
    with path.open("rb") as file:
        raw = file.read(MAX_SCENE_BYTES + 1)
    if len(raw) > MAX_SCENE_BYTES:
        raise ValueError("This audit accepts MJCF exports up to 8 MiB.")
    if re.search(rb"<!DOCTYPE|<!ENTITY", raw, re.IGNORECASE):
        raise ValueError("Use an MJCF export without document or entity declarations.")
    try:
        data = ET.fromstring(raw.decode("utf-8-sig"))
    except (ET.ParseError, UnicodeError) as error:
        raise ValueError(f"Read the MJCF XML as UTF-8. {error}") from error
    if data.tag != "mujoco":
        raise ValueError("The root of an MJCF export must be <mujoco>.")
    for element in data.iter():
        if element.tag in ("include", "extension", "plugin") or any(key.lower().startswith("file") for key in element.attrib):
            raise ValueError("Use a self-contained MJCF export with embedded geometry and no external files or plugins.")
    if object_scenarios:
        world = data.find("worldbody")
        if world is None or len(world.findall("body")) != 1 or world.find("geom") is not None:
            raise ValueError("Object scenarios need one standalone prop and its body geometry. Use the default static audit for a task scene.")
    return raw


def dependencies():
    try:
        result = {name: importlib.metadata.version(name) for name in PACKAGES}
    except importlib.metadata.PackageNotFoundError as error:
        raise ValueError("Start the pinned environment using uv run --python 3.12 scripts/world-mujoco/audit_scene.py.") from error
    if result["mujoco"] != "4.0.1" or result["mujoco-core"] != "4.0.1":
        raise ValueError("This audit uses MuJoCo 4.0.1. Start the pinned environment through uv run.")
    return result


def runtime_environment():
    # Preserve the operator's normal graphics configuration and exclude cloud,
    # hardware and Python injection settings from the child process.
    local = {
        "PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR",
        "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR",
        "MUJOCO_GL", "PYOPENGL_PLATFORM", "MUJOCO_EGL_DEVICE_ID", "LD_LIBRARY_PATH",
    }
    return {key: value for key, value in os.environ.items() if key in local}


def audit_files(args, raw, script, run_versions):
    with tempfile.TemporaryDirectory(prefix="world-mujoco-audit-") as scratch_name:
        scratch = Path(scratch_name)
        upstream = scratch / "audit_scenarios.py"
        scene = scratch / "scene.xml"
        output = scratch / "out"
        output.mkdir()
        upstream.write_bytes(script)
        scene.write_bytes(raw)
        command = [sys.executable, "-I", str(upstream), f"--xml_path={scene}"]
        if args.object_scenarios:
            command += [f"--out_dir={output}", f"--scenarios={args.object_scenarios}", "--label=object-audit"]
        else:
            command.append("--static_only")
        try:
            run = subprocess.run(command, cwd=scratch, env=runtime_environment(), capture_output=True,
                                 timeout=args.timeout, check=False)
            stdout, stderr, returncode = run.stdout, run.stderr, run.returncode
            status = "upstream-error" if returncode else "completed"
        except subprocess.TimeoutExpired as error:
            stdout, stderr, returncode = error.stdout or b"", error.stderr or b"", None
            status = "timed-out"
        (output / "upstream.stdout.log").write_bytes(stdout)
        (output / "upstream.stderr.log").write_bytes(stderr)
        findings = None
        if status == "completed" and not args.object_scenarios:
            try:
                parsed = json.loads(stdout)
                if (type(parsed.get("passed")) is not bool
                    or not all(isinstance(parsed.get(key), list) for key in ("errors", "warnings", "mesh_topology"))):
                    raise ValueError("Unexpected audit fields.")
            except (AttributeError, ValueError):
                status = "invalid-report"
            else:
                (output / "official-static.json").write_bytes(stdout)
                findings = {
                    "passed": parsed["passed"], "errors": len(parsed["errors"]),
                    "warnings": len(parsed["warnings"]),
                }
                if not parsed["passed"]:
                    status = "findings-require-review"
        if status == "completed" and args.object_scenarios:
            if not any(output.glob("*_scenarios.json")) or not any(output.glob("*_scenarios.png")):
                status = "invalid-report"
            else:
                status = "diagnostics-produced"
        if sha256(scene.read_bytes()) != sha256(raw):
            raise ValueError("The audit changed its scratch copy of the scene.")
        artifacts = []
        for file in sorted(output.iterdir()):
            if file.is_file() and not file.is_symlink():
                artifacts.append({"name": file.name, "bytes": file.stat().st_size,
                                  "sha256": sha256(file.read_bytes())})
        report = {
            "schema": "brainsnn.world.mujoco-audit.v1",
            "source": {"name": args.scene.name, "bytes": len(raw), "sha256": sha256(raw)},
            "upstream": {"repository": REPOSITORY, "revision": REVISION, "path": UPSTREAM_PATH,
                         "sha256": UPSTREAM_SHA256, "license": "Apache-2.0"},
            "runtime": {"python": platform.python_version(), **run_versions},
            "profile": "standalone-object-diagnostics" if args.object_scenarios else "static-mjcf-compile-and-hygiene",
            "scenarios": args.object_scenarios,
            "status": status,
            "upstream_exit_code": returncode,
            "static_findings": findings,
            "physical_hardware_validated": False,
            "task_rollout_executed": False,
            "artifacts": artifacts,
        }
        # Exclusive reservation prevents concurrent runs from replacing reports.
        args.output_dir.mkdir()
        for record in artifacts:
            shutil.copyfile(output / record["name"], args.output_dir / record["name"])
        (args.output_dir / "audit-receipt.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def scenario_selector(value):
    if value == "all" or re.fullmatch(r"(?:10|[1-9])(?:,(?:10|[1-9]))*", value):
        return value
    raise argparse.ArgumentTypeError("Choose all or comma-separated scenario numbers from 1 to 10.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Pinned environment: uv run --python 3.12 scripts/world-mujoco/audit_scene.py --help
Use a new output directory with an existing parent. The default profile compiles
the self-contained export and saves Google's unchanged static report and provenance.
Copy a previously verified upstream script and pass --upstream-script for offline use.
The static profile is CPU-only. Object diagnostics optionally render via MuJoCo.
On headless Linux use MUJOCO_GL=egl with a working EGL driver or MUJOCO_GL=osmesa
with OSMesa installed. Diagnostics apply to standalone objects, and task rollouts
are separate. This command uses local files and needs no Google key or robot.""",
    )
    parser.add_argument("--scene", type=Path, required=True, help="Self-contained MJCF XML export, up to 8 MiB.")
    parser.add_argument("--output-dir", type=Path, required=True, help="New directory for the audit and receipt.")
    parser.add_argument("--upstream-script", type=Path, help="Offline copy of the exact pinned Google script.")
    parser.add_argument("--object-scenarios", type=scenario_selector, help="Optional standalone object diagnostics, e.g. 1,4 or all.")
    parser.add_argument("--timeout", type=int, default=120, help="Local subprocess limit in seconds, default 120.")
    args = parser.parse_args(argv)
    try:
        if args.timeout <= 0:
            raise ValueError("Use a positive audit timeout.")
        if not args.output_dir.parent.is_dir() or os.path.lexists(args.output_dir):
            raise ValueError("Choose a new audit output directory with an existing parent.")
        raw = load_scene(args.scene, args.object_scenarios)
        versions = dependencies()
        script = load_upstream(args.upstream_script)
        report = audit_files(args, raw, script, versions)
    except (OSError, ValueError) as error:
        print(f"Audit stopped: {error}", file=sys.stderr)
        return 2
    print(f"{report['status']} · {args.output_dir / 'audit-receipt.json'}")
    return 0 if report["status"] in ("completed", "diagnostics-produced") else 1


if __name__ == "__main__":
    raise SystemExit(main())
