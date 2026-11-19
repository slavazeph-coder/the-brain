#!/usr/bin/env python3
"""Operator-run Open4DGS v0.1.0 pipeline for a trusted, prepared capture."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys


CORE_REV = "3cac7ba62d930e3ce56cb532bb60870e4ebf6db5"
TRIGS_REV = "ed7a84aff1aeccd18dfb48d2806e521255ccf9ef"
ROMA_REV = "95c9968145c8906b7b59383258e9f73b02853d89"
MEMFOF_REV = "a51de9fc59c6fe20ba08e079372c7b583d58a712"
IMAGE_PATTERN = "{frame:06d}.jpg"
MASK_PATTERN = "{frame:06d}.png"
TEMPORAL_THRESHOLD = 0.01  # Pinned trainer's active-row threshold; also pass to the timeline packager.
STATE_SCHEMA = "brainsnn.open4dgs.run.v1"
HEADER = struct.Struct("<8sIIQQQQQQ")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def parse_fps(value):
    try:
        result = Fraction(value)
        require(1 <= result <= 240, "FPS must be between 1 and 240.")
        return result
    except (ValueError, ZeroDivisionError) as error:
        raise argparse.ArgumentTypeError("Use an FPS such as 30 or 30000/1001, between 1 and 240.") from error


def json_object(path):
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream)
    require(isinstance(value, dict), f"Expected a JSON object in {path.name}.")
    return value


def write_json(path, value):
    temporary = path.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def file_digest(path):
    require(path.is_file() and path.stat().st_size > 0, f"Missing or empty file: {path}")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


@dataclass(frozen=True)
class Capture:
    path: Path
    reference: Path
    model: Path
    cameras: tuple
    first: int
    last: int
    source_fps: Fraction
    digest: str
    alignment: str = "external-prepared-frames"

    @property
    def count(self):
        return self.last - self.first + 1

    @property
    def fps(self):
        # Open4DGS stores FPS as float32 in its preparation NPZ. Use the same
        # clock in every stage, retaining the original rational in the receipt.
        return struct.unpack("<f", struct.pack("<f", float(self.source_fps)))[0]


def load_capture(path, frame_start, frame_end, fps):
    reference = path / "reference_export.json"
    items = json_object(reference).get("cameras")
    require(isinstance(items, list) and 2 <= len(items) <= 99, "Use a reference export with 2–99 cameras.")
    cameras = tuple(item["folder"] for item in items)
    require(all(isinstance(name, str) and re.fullmatch(r"[0-9]{2}|[0-9]{4}", name)
                and 1 <= int(name) <= 99 for name in cameras), "Camera folders must be numbered 01–99 or 0001–0099.")
    require(len({int(name) for name in cameras}) == len(cameras), "Camera IDs must be unique.")
    # The upstream image parser sorts lexically, while mask/timing lookup sorts
    # numerically. Mixed widths can silently map images to the wrong masks.
    require(len({len(name) for name in cameras}) == 1, "Use the same number of digits in every camera folder.")
    require({folder.name for folder in (path / "images").iterdir() if folder.is_dir()} == set(cameras),
            "The image directory must contain exactly the calibrated camera folders.")
    sources = [reference]
    setup_path = path / "camera-setup.json"
    if setup_path.is_file():
        setup = json_object(setup_path)
        require(setup.get("schema") == "brainsnn.open4dgs.capture.v1" and
                setup.get("alignment") == "manual-shared-event", "Unsupported camera-setup.json receipt.")
        setup_fps = parse_fps(setup["fps"])
        require(fps is None or fps == setup_fps, "--fps disagrees with camera-setup.json.")
        fps = setup_fps
        count = setup["frame_count"]
        require(type(count) is int and 2 <= count <= 999_999, "Invalid frame_count in camera-setup.json.")
        require(sorted(row["id"] for row in setup["cameras"]) == sorted(cameras),
                "Prepared calibration camera folders do not match camera-setup.json.")
        frame_end = count if frame_end is None else frame_end
        require(frame_end <= count, "The requested last frame exceeds camera-setup.json.")
        sources.append(setup_path)

    require(fps is not None and frame_end is not None, "Provide --fps and --frame-end without camera-setup.json.")
    require(1 <= frame_start < frame_end <= 999_999, "Select at least two consecutive source frames.")
    model = path / "sparse" / "0"
    extension = next((suffix for suffix in ("bin", "txt") if all(
        (model / f"{name}.{suffix}").is_file() for name in ("cameras", "images", "points3D"))), None)
    require(extension is not None, "Provide one complete COLMAP model under sparse/0/.")
    for name in ("cameras", "images", "points3D", "rigs", "frames"):
        candidate = model / f"{name}.{extension}"
        if candidate.exists():
            sources.append(candidate)
    for camera in cameras:
        for frame in range(frame_start, frame_end + 1):
            sources.append(path / "images" / camera / IMAGE_PATTERN.format(frame=frame))
            sources.append(path / "masks" / camera / MASK_PATTERN.format(frame=frame))

    digest = hashlib.sha256()
    for source in sorted(sources):
        digest.update(f"{source.relative_to(path).as_posix()}\t{file_digest(source)}\n".encode())
    alignment = "manual-shared-event" if setup_path.is_file() else "external-prepared-frames"
    return Capture(path, reference, model, cameras, frame_start, frame_end, fps, digest.hexdigest(), alignment)


def check_checkout(path, revision):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()

    require(Path(git("rev-parse", "--show-toplevel")) == path, f"Use the checkout root: {path}")
    require(git("rev-parse", "HEAD") == revision, f"Use official revision {revision} in {path}.")
    require(not git("status", "--porcelain", "--untracked-files=all"), f"Use a clean source checkout: {path}")


def environment(trigs):
    return {
        **os.environ,
        "OPEN4DGS_TRIGS": str(trigs),
        "PYTHONPATH": str(trigs / "src"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONUNBUFFERED": "1",
    }


def probe_runtime(python, env, job, capture):
    command = [str(python), str(Path(__file__).with_name("check_runtime.py")), str(capture.reference),
               str(capture.model), str(capture.first), str(capture.last), ROMA_REV, MEMFOF_REV]
    result = subprocess.check_output(command, cwd=job, env=env, text=True)
    return json.loads(result)


def check_timing(directory, capture, readout):
    pipeline = json_object(directory / "sync_pipeline_report.json")
    require(pipeline.get("trusted") is True and pipeline.get("fallback_used") is False and
            pipeline.get("output_mode") == "validated_visual", "Timing solve did not pass all ASU visual gates.")
    wanted = {f"{int(name):04d}" for name in capture.cameras}
    offsets = json_object(directory / "sync.json")
    require(set(offsets) == wanted and all(math.isfinite(offset) for offset in offsets.values()),
            "Visual timing must cover every calibrated camera.")
    if readout is None:
        return
    candidate = json_object(directory / "timing_candidate.json")
    require(candidate.get("convention_id") == "midpoint_v1" and candidate.get("trusted") is True and
            candidate.get("experimental") is False and candidate.get("waiver") is None and
            candidate.get("readout_axis") == "row" and candidate.get("fps") == capture.fps and
            candidate.get("readout_ms") == readout, "Timing candidate is untrusted or its clock/readout differs.")
    cameras = candidate.get("cameras", {})
    require(set(cameras) == wanted and all(
        row.get("status") in {"measured", "converted"} and row.get("rs") is True and
        math.isfinite(row.get("c_ms", math.nan)) for row in cameras.values()),
        "Timing candidate must resolve every prepared camera; no fallback is allowed.")


def read_trigsbin(path, capture):
    with path.open("rb") as stream:
        raw = stream.read(HEADER.size)
        require(len(raw) == HEADER.size, "TRIGSBIN header is incomplete.")
        magic, version, size, offset, length, payload, payload_length, alignment, reserved = HEADER.unpack(raw)
        require((magic, version, size, offset, alignment, reserved) == (b"TRIGSBIN", 1, 64, 64, 256, 0)
                and 0 < length <= 16 * 1024**2 and payload >= offset + length and payload % alignment == 0
                and payload_length > 0 and payload + payload_length == path.stat().st_size,
                "TRIGSBIN has inconsistent container bounds.")
        manifest = json.loads(stream.read(length))
    timeline = manifest.get("timeline", {})
    clips = manifest.get("clips", [])
    require(manifest.get("format") == "trigs.runtime" and manifest.get("version") == 1 and
            timeline.get("totalFrames") == capture.count and timeline.get("frameRate") == capture.fps and
            len(clips) == 1, "TRIGSBIN must contain one clip at the requested frame count and rate.")
    core = clips[0].get("global", {})
    require(core.get("coreFrameStart") == 0 and core.get("coreFrameEndExclusive") == capture.count,
            "TRIGSBIN clip does not cover the requested frames.")


def read_ply_exports(directory, capture):
    meta = directory / "export_meta.json"
    export = json_object(meta)
    names = [f"frame_{frame:06d}.ply" for frame in range(capture.count)]
    counts = export.get("per_frame_counts", [])
    require(sorted(path.name for path in directory.glob("*.ply")) == names and
            export.get("start_frame") == 0 and export.get("n_frames") == capture.count and
            export.get("fps") == capture.fps and export.get("config_source") == "checkpoint" and
            len(counts) == capture.count and all(type(count) is int and count > 0 for count in counts),
            "PLY exports are incomplete or have an inconsistent clock or training config.")
    for name, count in zip(names, counts):
        path = directory / name
        with path.open("rb") as stream:
            header, separator, _ = stream.read(65_536).partition(b"end_header\n")
        lines = header.splitlines()
        elements = [line for line in lines if line.startswith(b"element ")]
        properties = [line for line in lines if line.startswith(b"property ")]
        require(separator and lines[:2] == [b"ply", b"format binary_little_endian 1.0"] and
                elements == [f"element vertex {count}".encode()] and b"property float f_dc_0" in properties and
                all(line.startswith(b"property float ") for line in properties) and
                path.stat().st_size == len(header) + len(separator) + count * len(properties) * 4,
                f"{name} is missing its Gaussian PLY header or expected vertex count.")
    return [meta, *(directory / name for name in names)]


@contextmanager
def lock_job(path):
    with (path / ".run.lock").open("a+b") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("This output directory already has a running process.") from error
        yield stream.fileno()


class Run:
    def __init__(self, root, identity, resume, lock, env):
        self.root, self.lock, self.env = root, lock, env
        self.state_path = root / "run.json"
        if resume:
            self.state = json_object(self.state_path)
            require(self.state.get("schema") == STATE_SCHEMA and self.state.get("identity") == identity,
                    "Prepared files, runtime or settings changed. Start a new output directory.")
        else:
            require(not any(path.name != ".run.lock" for path in root.iterdir()),
                    "Use an empty output directory, or --resume with the original arguments.")
            self.state = {"schema": STATE_SCHEMA, "identity": identity, "stages": {}}
            write_json(self.state_path, self.state)

    def command(self, stage, name, args, cwd):
        log_path = stage / f"{name}.log"
        print(f"{name}: {log_path}", flush=True)
        with log_path.open("x", encoding="utf-8") as log:
            log.write(json.dumps([str(value) for value in args]) + "\n")
            log.flush()
            try:
                subprocess.run([str(value) for value in args], cwd=cwd, env=self.env,
                               stdout=log, stderr=subprocess.STDOUT, check=True, pass_fds=(self.lock,))
            except subprocess.CalledProcessError as error:
                raise ValueError(f"{name} failed (exit {error.returncode}). See {log_path}.") from error

    def stage(self, name, action, files):
        record = self.state["stages"].get(name)
        if record:
            stage = (self.root / record["directory"]).resolve()
            require(stage.parent == self.root / "attempts" and stage.name.startswith(f"{name}-"),
                    f"Invalid saved directory for {name}.")
            current = self.fingerprints(files(stage))
            require(current == record["files"], f"Completed {name} artifacts changed. Start a new output directory.")
            return stage
        attempts = self.root / "attempts"
        attempts.mkdir(exist_ok=True)
        index = len(tuple(attempts.glob(f"{name}-*"))) + 1
        stage = attempts / f"{name}-{index:04d}"
        stage.mkdir()
        action(stage)
        record = {"directory": str(stage.relative_to(self.root)), "files": self.fingerprints(files(stage))}
        self.state["stages"][name] = record
        write_json(self.state_path, self.state)
        return stage

    def fingerprints(self, paths):
        return {str(path.relative_to(self.root)): file_digest(path) for path in paths}


def final_snapshot(directory):
    snapshots = list((directory / "viewer_snapshots").glob("snap_s*.pt"))
    require(len(snapshots) == 1 and re.fullmatch(r"snap_s[0-9]{7,}\.pt", snapshots[0].name),
            "Expected the final viewer snapshot with its original training configuration.")
    return snapshots[0], int(snapshots[0].stem.removeprefix("snap_s"))


def check_evaluation(path, trained, step):
    report = json_object(path)
    entry = report.get("runs", {}).get(str(trained), {})
    score = entry.get("eval_full")
    count = entry.get("eval_pairs")
    require(report.get("step") == step and entry.get("snapshot_step") == step and
            entry.get("shutter") == "captured" and type(score) in (int, float) and math.isfinite(score) and
            type(count) is int and count > 0, "Expected finite whole-photo evaluation for the final captured-shutter snapshot.")


def run_pipeline(args, capture, core, trigs, root, python, env, runtime, lock):
    identity = {
        "upstream": {"core": CORE_REV, "trigs": TRIGS_REV}, "runtime": runtime,
        "capture": str(capture.path), "capture_digest_sha256": capture.digest,
        "cameras": list(capture.cameras), "first_frame": capture.first, "last_frame": capture.last,
        "source_fps": str(capture.source_fps), "runtime_fps": capture.fps,
        "frame_step": args.frame_step, "steps": args.steps, "chunk_seconds": args.chunk_seconds,
        "readout_ms": args.sync_readout_ms, "global_shutter_sync": args.visual_sync_global_shutter,
        "source_alignment": capture.alignment, "python": str(python),
        "runner_sha256": file_digest(Path(__file__)),
    }
    run = Run(root, identity, args.resume, lock, env)
    # Give the trainer the exact required inputs without picking up a stale
    # sync.json or frame_timestamps.json from the operator's capture directory.
    data = root / "prepared-input"
    data.mkdir(exist_ok=True)
    for name in ("images", "masks", "sparse", "reference_export.json"):
        link = data / name
        source = capture.path / name
        if not link.is_symlink():
            link.symlink_to(source, target_is_directory=source.is_dir())
        require(link.readlink() == source, f"Prepared input link changed: {name}")
    expected_inputs = {"images", "masks", "sparse", "reference_export.json"}
    if args.visual_sync_global_shutter and (data / "sync.json").is_symlink():
        expected_inputs.add("sync.json")
    require({path.name for path in data.iterdir()} == expected_inputs,
            "Unexpected files in prepared-input. Start a new output directory.")

    core_cmd = lambda script, *rest: [python, core / script, *rest]
    trigs_cmd = lambda module, *rest: [python, "-m", f"trigs.cli.{module}", *rest]
    frames = ["--frame-start", capture.first, "--frame-end", capture.last]
    inputs = ["--reference-json", data / "reference_export.json", "--images-root", data / "images",
              "--image-pattern", IMAGE_PATTERN, "--fps", capture.fps, *frames]
    prep_timing = []
    train_timing = []
    timing_mode = "nominal-frames"
    if args.sync_readout_ms is not None or args.visual_sync_global_shutter:
        rolling = args.sync_readout_ms is not None
        def solve(stage):
            rs = ["--rs-mode", "fixed", "--rs-readout-ms", args.sync_readout_ms] if rolling else ["--rs-mode", "off"]
            run.command(stage, "solve-sync", core_cmd("prep/sync/calculate-sync.py", *inputs,
                "--out-dir", stage, "--output-sync", stage / "sync.json", "--device", "cuda",
                "--camera-neighbors", min(12, len(capture.cameras) - 1), "--phase-estimator", "direct",
                "--disable-zero-fallback", *rs), root)
            if rolling:
                run.command(stage, "export-timing", core_cmd("prep/sync/make_timing_candidate.py",
                    "--resolve-dir", stage, "--readout-ms", args.sync_readout_ms, "--fps", capture.fps,
                    "--weak-cameras", "--out", stage / "timing_candidate.json"), root)

        def timing_files(stage):
            check_timing(stage, capture, args.sync_readout_ms)
            reports = ["sync.json", "sync_pipeline_report.json", "sync_robust_report.json"]
            if rolling:
                reports.extend(["timing_candidate.json", "timing_candidate.report.json"])
            return [stage / name for name in reports]

        timing = run.stage("timing", solve, timing_files)
        if rolling:
            timing_mode = "visual-sync-measured-rolling-shutter"
            prep_timing = train_timing = ["--timing-json", timing / "timing_candidate.json"]
        else:
            timing_mode = "visual-sync-global-shutter"
            sync = timing / "sync.json"
            link = data / "sync.json"
            if not link.is_symlink():
                link.symlink_to(sync)
            require(link.readlink() == sync, "Prepared input timing link changed.")
            # The trainer reads <data_dir>/sync.json; preparation takes an explicit flag.
            prep_timing = ["--sync-json", sync]

    def prepare(stage):
        run.command(stage, "prepare-points", core_cmd("prep/init/prep-roma-trigs-memory.py", *inputs,
            "--input-frame-start", capture.first, "--input-frame-end", capture.last,
            "--frame-step", args.frame_step, "--masks-root", data / "masks", "--mask-pattern", MASK_PATTERN,
            "--cache-dir", stage / "cache", "--output-path", stage / "keyframes.npz",
            "--device", "cuda", *prep_timing), root)

    init = run.stage("prepare", prepare, lambda stage: [stage / "keyframes.npz"])

    def train(stage):
        chunks = [] if args.chunk_seconds is None else ["--config.temporal-chunk-len-s", args.chunk_seconds,
                                                         "--config.temporal-chunk-visit-steps", 1000]
        run.command(stage, "train", trigs_cmd("train_from_colmap", "--data-dir", data, "--output-dir", stage,
            "--reference-colmap", data / "sparse" / "0", "--npz-path", init / "keyframes.npz",
            "--start-frame", capture.first, "--end-frame", capture.last, "--keyframe-step", args.frame_step,
            "--masks-root", data / "masks", "--mask-pattern", MASK_PATTERN, "--device", "cuda",
            "--config.fps", capture.fps, "--config.n-steps", args.steps,
            "--config.temporal-active-threshold", TEMPORAL_THRESHOLD,
            # Force the final config-bearing snapshot without intermediate GPU-to-host copies.
            "--config.viewer-snapshot-every", 1_000_000_000, "--config.viewer-snapshot-keep-last", 1,
            *chunks, *train_timing), root)

    trained = run.stage("train", train, lambda stage: [stage / "run_args.json", stage / "trigs_ckpt.pt",
                                                       final_snapshot(stage)[0]])
    checkpoint, step = final_snapshot(trained)

    def evaluate(stage):
        run.command(stage, "evaluate", trigs_cmd("eval_colmap", "--data-dir", data, "--runs", trained,
            "--reference-colmap", data / "sparse" / "0", "--out-dir", stage, "--device", "cuda",
            "--step", step, "--shutter", "captured"), root)

    def evaluation_files(stage):
        report = stage / "eval.json"
        check_evaluation(report, trained, step)
        return [report]

    evaluated = run.stage("evaluate", evaluate, evaluation_files)

    def export(stage):
        local_checkpoint = os.path.relpath(checkpoint, stage)
        run.command(stage, "export-ply", trigs_cmd("export_plys", "--ckpt-path", local_checkpoint,
            "--output-dir", "ply", "--n-frames", capture.count, "--fps", capture.fps,
            "--start-frame", 0, "--device", "cuda"), stage)
        run.command(stage, "export-timeline", core_cmd("deliver/make-trigs-timeline.py", "from-checkpoint",
            "--checkpoint", local_checkpoint, "--output", "capture.trigsbin", "--frame-rate", capture.fps,
            "--total-frames", capture.count, "--chunk-duration-seconds", (capture.count + 1) / capture.fps,
            "--chunk-overlap-seconds", 0, "--tensor-dtype", "motion32", "--tensor-hashes",
            "--temporal-threshold", TEMPORAL_THRESHOLD, "--fade-frames", 0, "--name", "Prepared capture"), stage)

    def export_files(stage):
        timeline = stage / "capture.trigsbin"
        read_trigsbin(timeline, capture)
        return [timeline, *read_ply_exports(stage / "ply", capture)]

    exported = run.stage("export", export, export_files)
    current = load_capture(capture.path, capture.first, capture.last, capture.source_fps)
    require(current.digest == capture.digest, "Prepared capture changed during processing. Start a new output directory.")
    receipt = {
        "schema": "brainsnn.open4dgs.export.v1", "timing": timing_mode, "source_alignment": capture.alignment,
        "rolling_shutter_readout_ms": args.sync_readout_ms,
        "capture_digest_sha256": capture.digest, "source_fps": str(capture.source_fps), "fps": capture.fps,
        "source_first_frame": capture.first, "frame_count": capture.count, "checkpoint_step": step,
        "evaluation": str((evaluated / "eval.json").relative_to(root)),
        "trigsbin": str((exported / "capture.trigsbin").relative_to(root)),
        "ply_directory": str((exported / "ply").relative_to(root)),
        "export_sha256": run.state["stages"]["export"]["files"], "upstream": identity["upstream"],
    }
    write_json(root / "exports.json", receipt)
    print(f"Export receipt: {root / 'exports.json'}", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("capture-dir", "output-dir", "upstream-core", "upstream-trigs", "python"):
        parser.add_argument(f"--{argument}", type=Path, required=True)
    parser.add_argument("--fps", type=parse_fps)
    parser.add_argument("--frame-start", type=int, default=1)
    parser.add_argument("--frame-end", type=int)
    parser.add_argument("--frame-step", type=int, default=5)
    parser.add_argument("--steps", type=int, default=30_000)
    parser.add_argument("--chunk-seconds", type=float, help="Optional upstream training window; default unchunked.")
    timing = parser.add_mutually_exclusive_group()
    timing.add_argument("--sync-readout-ms", type=float, help="Measured row readout for every unrotated camera in this mode.")
    timing.add_argument("--visual-sync-global-shutter", action="store_true", help="Estimate phase offsets for confirmed global shutter cameras.")
    parser.add_argument("--confirm-sensor-rows", action="store_true", help="Confirm all images preserve the raw sensor row direction.")
    parser.add_argument("--resume", action="store_true", help="Reuse checked stages; rerun the first incomplete stage.")
    args = parser.parse_args(argv)
    try:
        require(sys.platform == "linux", "Run the full pipeline on a prepared Linux NVIDIA CUDA host.")
        capture = load_capture(args.capture_dir.resolve(strict=True), args.frame_start, args.frame_end, args.fps)
        require(1 <= args.frame_step < capture.count and 1 <= args.steps <= 1_000_000,
                "Use an initialization stride shorter than the capture and 1–1,000,000 training steps.")
        require(args.chunk_seconds is None or 0.5 < args.chunk_seconds <= capture.count / capture.fps,
                "Training windows must exceed the 0.5 s overlap and fit inside the capture.")
        if args.sync_readout_ms is not None:
            require(args.confirm_sensor_rows and len(capture.cameras) >= 4 and
                    0 < args.sync_readout_ms <= 1000 / capture.fps,
                    "Visual timing requires at least four cameras, measured readout within one frame and confirmed sensor rows.")
        if args.visual_sync_global_shutter:
            require(len(capture.cameras) >= 4, "The visual timing graph needs at least four cameras.")
        core, trigs = args.upstream_core.resolve(strict=True), args.upstream_trigs.resolve(strict=True)
        check_checkout(core, CORE_REV)
        check_checkout(trigs, TRIGS_REV)
        # Keep the virtual environment's symlink spelling so Python finds its packages.
        python = args.python.absolute()
        require(python.is_file() and os.access(python, os.X_OK), "Use the configured Open4DGS environment's Python executable.")
        root = args.output_dir.resolve()
        for safe_root in (capture.path, core, trigs):
            require(root != safe_root and not root.is_relative_to(safe_root), "Keep outputs outside the capture and upstream checkouts.")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        env = environment(trigs)
        with lock_job(root) as lock:
            runtime = probe_runtime(python, env, root, capture)
            run_pipeline(args, capture, core, trigs, root, python, env, runtime, lock)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Open4DGS: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
