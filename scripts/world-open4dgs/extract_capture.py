"""Extract the shared scene marked in World Builder into ASU Open4DGS camera folders."""
import argparse
from collections import Counter
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

RATES = {"24", "25", "30", "50", "60", "24000/1001", "30000/1001", "60000/1001"}
EDGE_BYTES = 65536


def validate(setup):
    if not isinstance(setup, dict) or setup.get("schema") != "brainsnn.open4dgs.capture.v1" or setup.get("alignment") != "manual-shared-event":
        raise ValueError("Choose a camera setup saved in World Builder.")
    rate = setup.get("fps")
    if not isinstance(rate, str) or rate not in RATES:
        raise ValueError("Unsupported output frame rate.")
    frames = setup.get("frame_count")
    if type(frames) is not int or not 2 <= frames <= Fraction(rate) * 600:
        raise ValueError("The marked interval must cover at least two frames and at most ten minutes.")
    cameras = setup.get("cameras")
    if not isinstance(cameras, list) or not 2 <= len(cameras) <= 99:
        raise ValueError("Choose 2 to 99 cameras.")
    seen = set()
    for camera in cameras:
        if not isinstance(camera, dict):
            raise ValueError("Invalid camera entry.")
        cid, name, start = camera.get("id"), camera.get("file"), camera.get("start_seconds")
        if not isinstance(cid, str) or not re.fullmatch(r"[0-9]{4}", cid) or cid in seen or not 1 <= int(cid) <= 99:
            raise ValueError("Each camera needs a distinct four-digit ID.")
        seen.add(cid)
        if not isinstance(name, str) or not name or name in {".", ".."} or any(c in name for c in ("/", "\\", "\0")):
            raise ValueError("Each camera entry must contain a filename without a path.")
        if type(start) not in (float, int) or not math.isfinite(start) or start < 0:
            raise ValueError(f"Invalid mark for {cid}.")
        if type(camera.get("bytes")) is not int or camera["bytes"] <= 0 or not re.fullmatch(r"[a-f0-9]{64}", str(camera.get("edge_sha256", ""))):
            raise ValueError(f"Invalid source identifier for {cid}.")
    return cameras


def locate_sources(cameras, videos):
    counts = Counter(c["file"] for c in cameras)
    for camera in cameras:
        name, cid = camera["file"], camera["id"]
        source = videos / cid / name
        if not source.is_file() and counts[name] == 1:
            source = videos / name
        source = source.resolve()
        if not source.is_relative_to(videos) or not source.is_file():
            raise ValueError(f"Place camera {cid}'s original video in {cid}/{name}.")
        size = source.stat().st_size
        with source.open("rb") as stream:
            first = stream.read(EDGE_BYTES)
            stream.seek(max(len(first), size - EDGE_BYTES))
            fingerprint = hashlib.sha256(first + stream.read(EDGE_BYTES)).hexdigest()
        if size != camera["bytes"] or fingerprint != camera["edge_sha256"]:
            raise ValueError(f"Size or file fingerprint differs for camera {cid}.")
        yield source


def extract(setup_path, videos, destination):
    if setup_path.stat().st_size > 1024 * 1024:
        raise ValueError("Camera setup is too large.")
    setup = json.loads(setup_path.read_text(encoding="utf-8"))
    cameras = validate(setup)
    sources = list(locate_sources(cameras, videos.resolve(strict=True)))
    if len(set(sources)) != len(sources):
        raise ValueError("Two camera entries refer to the same source video.")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("Install FFmpeg and put ffmpeg on your PATH.")
    destination = destination.absolute()
    destination.parent.mkdir(exist_ok=True, parents=True)
    count, rate = setup["frame_count"], setup["fps"]
    # A sibling directory keeps incomplete images invisible. A successful run can be reused as-is.
    with tempfile.TemporaryDirectory(dir=destination.parent, prefix=".open4d-") as tmp:
        ready = Path(tmp) / "capture"
        ready.mkdir()
        if destination.exists():
            raise ValueError(f"Output already exists: {destination}")
        for camera, source in zip(cameras, sources):
            folder = ready / "images" / camera["id"]
            folder.mkdir(parents=True)
            filters = f"trim=start={camera['start_seconds']:.9f},setpts=PTS-STARTPTS,fps={rate}"
            subprocess.run([ffmpeg, "-nostdin", "-loglevel", "error", "-xerror", "-protocol_whitelist", "file,pipe",
                            "-i", str(source), "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", filters,
                            "-frames:v", str(count), "-q:v", "2", "-start_number", "1", str(folder / "%06d.jpg")], check=True)
            if len(list(folder.glob("*.jpg"))) != count:
                raise ValueError(f"Camera {camera['id']} ended before the marked interval. Shorten the interval in World Builder.")
        (ready / "camera-setup.json").write_text(json.dumps(setup, indent=2) + "\n", encoding="utf-8")
        if destination.exists():
            raise ValueError(f"Output already exists: {destination}")
        os.rename(ready, destination)
    print(f"Extracted {len(cameras)} views, each with {count} frames at {rate} fps, into {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup", type=Path, required=True)
    parser.add_argument("--videos", type=Path, required=True, help="Folder containing your original videos")
    parser.add_argument("--output-dir", type=Path, required=True, help="New capture directory")
    args = parser.parse_args()
    try:
        extract(args.setup, args.videos, args.output_dir)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Capture extraction stopped: {error}\n")


if __name__ == "__main__":
    main()
