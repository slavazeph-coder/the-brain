"""Preflight, gate and retry behavior without requiring CUDA or model weights."""

from fractions import Fraction
import importlib.util
from pathlib import Path
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/world-open4dgs/run_prepared_capture.py"
SPEC = importlib.util.spec_from_file_location("open4dgs_runner", SCRIPT)
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def prepared_files(path):
    folders = ["0001", "0002"]
    runner.write_json(path / "reference_export.json", {"cameras": [{"folder": camera} for camera in folders]})
    runner.write_json(path / "camera-setup.json", {
        "schema": "brainsnn.open4dgs.capture.v1",
        "alignment": "manual-shared-event",
        "fps": "30000/1001",
        "frame_count": 3,
        "cameras": [{"id": camera} for camera in folders],
    })
    model = path / "sparse" / "0"
    model.mkdir(parents=True)
    for name in ("cameras", "images", "points3D"):
        (model / f"{name}.bin").write_bytes(b"preflight-only shape")
    for camera in folders:
        for directory, extension in (("images", "jpg"), ("masks", "png")):
            folder = path / directory / camera
            folder.mkdir(parents=True)
            for frame in range(1, 4):
                (folder / f"{frame:06d}.{extension}").write_bytes(f"{camera}/{frame}".encode())


def test_receipt_drives_camera_ids_frame_count_and_fractional_fps(tmp_path):
    prepared_files(tmp_path)
    capture = runner.load_capture(tmp_path, 1, None, None)
    assert capture.count == 3
    assert capture.cameras == ("0001", "0002")
    assert capture.alignment == "manual-shared-event"
    assert capture.source_fps == Fraction(30000, 1001)
    assert capture.fps == pytest.approx(float(capture.source_fps), rel=1e-7)
    with pytest.raises(ValueError, match="disagrees"):
        runner.load_capture(tmp_path, 1, None, Fraction(30))


def test_changed_or_missing_capture_files_cannot_reuse_a_completed_run(tmp_path):
    prepared_files(tmp_path)
    before = runner.load_capture(tmp_path, 1, None, None)
    mask = tmp_path / "masks/0001/000002.png"
    mask.write_bytes(b"updated mask")
    assert runner.load_capture(tmp_path, 1, None, None).digest != before.digest
    mask.unlink()
    with pytest.raises(ValueError, match="Missing or empty file"):
        runner.load_capture(tmp_path, 1, None, None)


def test_untrusted_or_incomplete_visual_timing_is_never_accepted(tmp_path):
    prepared_files(tmp_path)
    capture = runner.load_capture(tmp_path, 1, None, None)
    report = tmp_path / "sync_pipeline_report.json"
    offsets = tmp_path / "sync.json"
    runner.write_json(report, {"trusted": False, "fallback_used": True, "output_mode": "timecode_only_zero"})
    runner.write_json(offsets, {"0001": 0, "0002": 0})
    with pytest.raises(ValueError, match="did not pass"):
        runner.check_timing(tmp_path, capture, None)

    runner.write_json(report, {"trusted": True, "fallback_used": False, "output_mode": "validated_visual"})
    runner.write_json(offsets, {"0001": 0})
    with pytest.raises(ValueError, match="cover every"):
        runner.check_timing(tmp_path, capture, None)
    runner.write_json(offsets, {"0001": 0, "0002": 0.001})
    runner.check_timing(tmp_path, capture, None)

    candidate = {"convention_id": "midpoint_v1", "trusted": True, "experimental": False, "waiver": None,
                 "readout_axis": "row", "fps": capture.fps, "readout_ms": 9,
                 "cameras": {"0001": {"status": "converted", "rs": True, "c_ms": 0},
                             "0002": {"status": "unresolved", "rs": True, "c_ms": 0}}}
    runner.write_json(tmp_path / "timing_candidate.json", candidate)
    with pytest.raises(ValueError, match="no fallback"):
        runner.check_timing(tmp_path, capture, 9)


def test_retry_uses_fresh_stage_and_rejects_modified_success(tmp_path):
    identity = {"capture_digest_sha256": "fixture"}
    with runner.lock_job(tmp_path) as lock:
        with pytest.raises(ValueError, match="running process"):
            with runner.lock_job(tmp_path):
                pass
        run = runner.Run(tmp_path, identity, False, lock, {})

        def fail(directory):
            (directory / "keyframes.npz").write_bytes(b"partial")
            raise ValueError("interrupted")

        def outputs(directory):
            return [directory / "keyframes.npz"]

        with pytest.raises(ValueError, match="interrupted"):
            run.stage("prepare", fail, outputs)
        assert runner.json_object(tmp_path / "run.json")["stages"] == {}

        resumed = runner.Run(tmp_path, identity, True, lock, {})
        complete = resumed.stage("prepare", lambda directory: outputs(directory)[0].write_bytes(b"complete"), outputs)
        assert complete.name == "prepare-0002"
        assert resumed.stage("prepare", fail, outputs) == complete
        outputs(complete)[0].write_bytes(b"modified")
        with pytest.raises(ValueError, match="changed"):
            resumed.stage("prepare", fail, outputs)


def test_ply_metadata_cannot_hide_a_truncated_frame(tmp_path):
    capture = runner.Capture(tmp_path, tmp_path, tmp_path, ("01", "02"), 1, 2, Fraction(30), "fixture")
    runner.write_json(tmp_path / "export_meta.json", {
        "start_frame": 0, "n_frames": 2, "fps": capture.fps,
        "config_source": "checkpoint", "per_frame_counts": [1, 1],
    })
    frame = b"ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float f_dc_0\nend_header\n" + b"\0" * 4
    (tmp_path / "frame_000000.ply").write_bytes(frame)
    (tmp_path / "frame_000001.ply").write_bytes(frame)
    assert len(runner.read_ply_exports(tmp_path, capture)) == 3
    (tmp_path / "frame_000001.ply").write_bytes(frame[:-1])
    with pytest.raises(ValueError, match="frame_000001"):
        runner.read_ply_exports(tmp_path, capture)
