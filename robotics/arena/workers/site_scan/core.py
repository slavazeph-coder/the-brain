"""Bounded, private, single-process capture jobs. Linux worker; no URL ingestion."""
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from concurrent.futures import ThreadPoolExecutor
import hashlib
import fcntl
import json
import math
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import threading
import time
import warnings
import zipfile

from PIL import Image, ImageOps, ImageStat

Image.MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_TYPES = {"video/mp4": ".mp4", "video/quicktime": ".mov", "application/zip": ".zip"}
TERMINAL = {"complete", "failed", "cancelled"}
JOB_ID = re.compile(r"^[a-f0-9]{32}$")
ARTIFACT_TYPES = {"scan.json": "application/json", "point-cloud.json": "application/json",
                  "sparse.ply": "application/octet-stream", "visual.ply": "application/octet-stream",
                  "visual.usdz": "model/vnd.usdz+zip"}


class ScanError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)

    def as_dict(self):
        return {"code": self.code, "message": self.message}


@dataclass
class Settings:
    token: str
    data_dir: Path
    origins: tuple = ("https://www.brainsnn.com", "https://brainsnn.com")
    enabled: bool = False
    colmap: str = "colmap"
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    colmap_revision: str = ""
    visual_adapter: str = ""
    visual_adapter_sha256: str = ""
    max_upload_bytes: int = 256 * 1024 * 1024
    max_job_bytes: int = 3 * 1024 * 1024 * 1024
    max_total_bytes: int = 5 * 1024 * 1024 * 1024
    max_jobs: int = 3
    max_images: int = 120
    max_video_seconds: int = 180
    max_points: int = 50_000
    job_timeout: int = 1800
    upload_timeout: int = 180
    ttl_seconds: int = 24 * 3600
    sweep_seconds: float = 30

    @classmethod
    def from_env(cls):
        return cls(token=os.environ.get("BRAIN_SITE_TOKEN", ""),
                   data_dir=Path(os.environ.get("BRAIN_SITE_DATA", "./private-site-scans")).resolve(),
                   origins=tuple(x.strip() for x in os.environ.get("BRAIN_SITE_ORIGINS", "https://www.brainsnn.com,https://brainsnn.com").split(",") if x.strip()),
                   enabled=os.environ.get("BRAIN_SITE_ENABLED") == "1",
                   colmap=os.environ.get("BRAIN_SITE_COLMAP", "colmap"),
                   ffmpeg=os.environ.get("BRAIN_SITE_FFMPEG", "ffmpeg"),
                   ffprobe=os.environ.get("BRAIN_SITE_FFPROBE", "ffprobe"),
                   colmap_revision=os.environ.get("BRAIN_SITE_COLMAP_REVISION", ""),
                   visual_adapter=os.environ.get("BRAIN_SITE_VISUAL_ADAPTER", ""),
                   visual_adapter_sha256=os.environ.get("BRAIN_SITE_VISUAL_ADAPTER_SHA256", ""))

    def validate(self):
        if len(self.token) < 32 or len(self.token) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in self.token):
            raise ValueError("BRAIN_SITE_TOKEN must contain 32–512 printable, non-space characters.")
        if not self.origins or any(not re.fullmatch(r"https://(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+(?::[0-9]{1,5})?|http://(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?", x) for x in self.origins):
            raise ValueError("Configure exact HTTPS browser origins; wildcards are forbidden.")
        if self.data_dir.is_symlink():
            raise ValueError("Private data directory must not be a symlink.")
        if not (0 < self.max_upload_bytes <= self.max_job_bytes <= self.max_total_bytes):
            raise ValueError("Invalid storage limits.")


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def disk_size(path):
    total = 0
    for entry in Path(path).rglob("*"):
        try:
            info = entry.lstat()
        except FileNotFoundError:
            continue  # Job cleanup may run concurrently with a quota check.
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
    return total


@dataclass
class Job:
    id: str
    path: Path
    media_type: str
    filename: str
    created: float = field(default_factory=time.time)
    status: str = "uploading"
    stage: str = "Uploading capture"
    progress: float = 0
    error: dict | None = None
    artifacts: list = field(default_factory=list)
    cancelled: threading.Event = field(default_factory=threading.Event)
    process: subprocess.Popen | None = None
    uploaded_bytes: int = 0
    source_sha256: str = ""
    future: object = None


class ScanManager:
    def __init__(self, settings, pipeline=None):
        self.settings = settings
        settings.validate()
        settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        marker = settings.data_dir / ".brainsnn-site-scan-store"
        marker_content = "brainsnn-private-site-scan-v1\n"
        if marker.is_symlink() or (marker.exists() and marker.read_text() != marker_content):
            raise ValueError("Private scan storage marker is invalid.")
        if not marker.exists() and any(settings.data_dir.iterdir()):
            raise ValueError("Use an empty dedicated directory for private site scans.")
        lock_path = settings.data_dir / ".worker.lock"
        if lock_path.is_symlink():
            raise ValueError("Worker lock must not be a symlink.")
        self.storage_lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self.storage_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self.storage_lock)
            raise ValueError("Another site scan worker owns this private storage directory.")
        marker.write_text(marker_content)
        os.chmod(settings.data_dir, 0o700)
        # This dedicated directory is ephemeral by contract. Restart discards old captures.
        for old in settings.data_dir.iterdir():
            if JOB_ID.fullmatch(old.name) and old.is_dir() and not old.is_symlink():
                shutil.rmtree(old)
        self.jobs = {}
        self.active_future = None
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="site-scan")
        self.pipeline = pipeline or ReconstructionPipeline(settings)
        self.closed = threading.Event()
        self.sweeper = threading.Thread(target=self._sweep_loop, daemon=True)
        self.sweeper.start()

    def capabilities(self):
        missing = self.pipeline.missing()
        return {"version": 1, "pipeline": "colmap-sparse", "available": not missing,
                "missing": missing, "acceptedTypes": list(ALLOWED_TYPES),
                "maxUploadBytes": self.settings.max_upload_bytes, "maxImages": self.settings.max_images,
                "maxVideoSeconds": self.settings.max_video_seconds, "maxConcurrentJobs": 1,
                "retentionSeconds": self.settings.ttl_seconds, "requiresReview": True,
                "outputs": ["scan.json", "point-cloud.json", "sparse.ply"],
                "visualAdapterConfigured": bool(self.settings.visual_adapter),
                "geometry": "Unscaled visual points; no automatic floor, collision mesh or robot policy.",
                "privacy": "Private worker storage; deleted on request, expiry or worker restart."}

    def reserve(self, media_type, filename):
        with self.lock:
            self.sweep()
            if self.closed.is_set():
                raise ScanError("worker_closed", "The scan worker is stopping.", 503)
            missing = self.pipeline.missing()
            if missing:
                raise ScanError("pipeline_unavailable", "Configure the scan worker: " + "; ".join(missing), 503)
            if media_type not in ALLOWED_TYPES:
                raise ScanError("unsupported_capture", "Upload an MP4/MOV walkthrough or ZIP containing JPEG/PNG photos.", 415)
            if len(filename) > 160 or not filename or any(ord(c) < 32 for c in filename) or any(c in filename for c in ("/", "\\")):
                raise ScanError("invalid_filename", "Use a short filename without directories.")
            if (self.active_future and not self.active_future.done()) or any(j.status not in TERMINAL for j in self.jobs.values()):
                raise ScanError("worker_busy", "A capture is already uploading or reconstructing. Wait for it or delete it first.", 409)
            if len(self.jobs) >= self.settings.max_jobs:
                raise ScanError("job_limit", "Delete an older scan before uploading another.", 429)
            if disk_size(self.settings.data_dir) + self.settings.max_upload_bytes > self.settings.max_total_bytes:
                raise ScanError("storage_limit", "Delete older scans to free private worker storage.", 507)
            job_id = secrets.token_hex(16)
            path = self.settings.data_dir / job_id
            path.mkdir(mode=0o700)
            job = Job(job_id, path, media_type, filename)
            self.jobs[job.id] = job
            return job

    def get(self, job_id):
        with self.lock:
            self.sweep()
            if not JOB_ID.fullmatch(job_id) or job_id not in self.jobs:
                raise ScanError("scan_not_found", "This scan expired, was deleted or does not exist.", 404)
            return self.jobs[job_id]

    def view(self, job):
        with self.lock:
            return {"version": 1, "id": job.id, "status": job.status, "stage": job.stage,
                    "progress": job.progress, "createdAt": job.created,
                    "expiresAt": job.created + self.settings.ttl_seconds, "error": job.error,
                    "requiresReview": True, "artifacts": list(job.artifacts)}

    def submit(self, job):
        with self.lock:
            if job.cancelled.is_set() or job.id not in self.jobs:
                raise ScanError("scan_cancelled", "This upload was cancelled.", 409)
            job.source_sha256 = file_hash(job.path / ("capture" + ALLOWED_TYPES[job.media_type]))
            job.status, job.stage, job.progress = "queued", "Waiting for reconstruction", 0.05
            job.future = self.executor.submit(self._run, job)
            self.active_future = job.future
            return self.view(job)

    def _run(self, job):
        try:
            self.update(job, "Preparing capture", 0.1)
            artifacts = self.pipeline.run(job, self.update)
            self.update(job, "Checking reconstruction artifacts", .98)
            with self.lock:
                if job.cancelled.is_set():
                    return
                job.artifacts = artifacts
                job.status, job.stage, job.progress = "complete", "Ready for measurement and geometry review", 1.0
        except ScanError as error:
            with self.lock:
                job.status = "cancelled" if job.cancelled.is_set() else "failed"
                job.error = error.as_dict()
                job.stage = "Cancelled" if job.cancelled.is_set() else "Reconstruction needs attention"
        except Exception:
            with self.lock:
                job.status, job.stage = "failed", "Reconstruction failed"
                job.error = {"code": "reconstruction_failed", "message": "The worker could not reconstruct this capture. Check private worker logs and try a slower, well-lit overlapping capture."}
        finally:
            if job.cancelled.is_set():
                shutil.rmtree(job.path, ignore_errors=True)

    def update(self, job, stage, progress):
        if job.cancelled.is_set():
            raise ScanError("scan_cancelled", "This scan was cancelled.", 409)
        if time.time() - job.created > self.settings.job_timeout + self.settings.upload_timeout:
            raise ScanError("job_timeout", "The reconstruction exceeded this worker's time budget.", 408)
        if disk_size(job.path) > self.settings.max_job_bytes or disk_size(self.settings.data_dir) > self.settings.max_total_bytes:
            raise ScanError("storage_limit", "The capture exceeded this worker's reconstruction storage limit.", 507)
        with self.lock:
            job.status, job.stage, job.progress = "running", stage, progress

    def delete(self, job_id):
        with self.lock:
            job = self.jobs.pop(job_id, None)
            if not job:
                return
            job.cancelled.set()
            if job.future:
                job.future.cancel()
            self._stop_process(job)
            # Active worker owns final removal. Do not allow a new job before it exits.
            if not job.future or job.future.done():
                shutil.rmtree(job.path, ignore_errors=True)

    @staticmethod
    def _stop_process(job):
        process = job.process
        if process and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def sweep(self):
        with self.lock:
            now = time.time()
            for job in list(self.jobs.values()):
                if now - job.created > self.settings.ttl_seconds:
                    self.delete(job.id)
                elif job.status == "running" and disk_size(job.path) > self.settings.max_job_bytes:
                    self._stop_process(job)

    def _sweep_loop(self):
        while not self.closed.wait(self.settings.sweep_seconds):
            try:
                self.sweep()
            except FileNotFoundError:
                continue  # A concurrently deleted artifact must not stop TTL cleanup.

    def artifact(self, job_id, name):
        job = self.get(job_id)
        if job.status != "complete" or name not in {a["name"] for a in job.artifacts} or name not in ARTIFACT_TYPES:
            raise ScanError("artifact_not_found", "This artifact is not available.", 404)
        path = job.path / "artifacts" / name
        if not path.is_file() or path.is_symlink() or path.resolve().parent != (job.path / "artifacts").resolve():
            raise ScanError("artifact_not_found", "This artifact is not available.", 404)
        return path, ARTIFACT_TYPES[name]

    def close(self):
        self.closed.set()
        with self.lock:
            for job_id in list(self.jobs):
                self.delete(job_id)
        self.executor.shutdown(wait=True, cancel_futures=True)
        if self.storage_lock is not None:
            fcntl.flock(self.storage_lock, fcntl.LOCK_UN)
            os.close(self.storage_lock)
            self.storage_lock = None


class ReconstructionPipeline:
    def __init__(self, settings):
        self.settings = settings

    def missing(self):
        missing = []
        if not self.settings.enabled:
            missing.append("Set BRAIN_SITE_ENABLED=1 after validating the reconstruction tools")
        for label, executable in (("COLMAP", self.settings.colmap), ("FFmpeg", self.settings.ffmpeg), ("FFprobe", self.settings.ffprobe)):
            if not shutil.which(executable):
                missing.append("Install " + label)
        if not re.fullmatch(r"[a-f0-9]{40}", self.settings.colmap_revision):
            missing.append("Set BRAIN_SITE_COLMAP_REVISION to the installed source commit")
        adapter = self.settings.visual_adapter
        if adapter and (not Path(adapter).is_absolute() or not Path(adapter).is_file() or
                        not re.fullmatch(r"[a-f0-9]{64}", self.settings.visual_adapter_sha256) or file_hash(adapter) != self.settings.visual_adapter_sha256):
            missing.append("Verify the optional visual adapter path and SHA-256")
        return missing

    def command(self, job, args, timeout=600, cwd=None, stdout_path=None):
        """Only server-authored argv. No shell; process group killed on timeout/cancel."""
        if job.cancelled.is_set():
            raise ScanError("scan_cancelled", "This scan was cancelled.", 409)
        environment = {k: v for k, v in os.environ.items() if not any(x in k.upper() for x in ("TOKEN", "SECRET", "PASSWORD", "API_KEY"))}
        environment["QT_QPA_PLATFORM"] = "offscreen"
        log = stdout_path or job.path / "pipeline.log"
        with log.open("wb" if stdout_path else "ab") as output:
            process = subprocess.Popen([str(x) for x in args], cwd=cwd or job.path, stdout=output, stderr=subprocess.STDOUT,
                                       stdin=subprocess.DEVNULL, env=environment, start_new_session=True)
            job.process = process
            started = time.monotonic()
            try:
                while process.poll() is None:
                    if job.cancelled.wait(0.25):
                        raise ScanError("scan_cancelled", "This scan was cancelled.", 409)
                    if time.monotonic() - started > timeout or time.time() - job.created > self.settings.job_timeout + self.settings.upload_timeout:
                        raise ScanError("job_timeout", "Reconstruction exceeded its time budget. Try a shorter capture.", 408)
                    if disk_size(job.path) > self.settings.max_job_bytes or disk_size(self.settings.data_dir) > self.settings.max_total_bytes:
                        raise ScanError("storage_limit", "Reconstruction exceeded its storage limit.", 507)
                if disk_size(job.path) > self.settings.max_job_bytes or disk_size(self.settings.data_dir) > self.settings.max_total_bytes:
                    raise ScanError("storage_limit", "Reconstruction exceeded its storage limit.", 507)
                if process.returncode:
                    raise ScanError("pipeline_failed", "A reconstruction stage failed. Check the private pipeline log; try a well-lit capture with more overlap.", 422)
            finally:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.wait(timeout=5)
                job.process = None

    def _photo(self, source, target):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(source) as original:
                    if original.format not in {"JPEG", "PNG"}:
                        raise ValueError("Unsupported image content")
                    original.verify()
                with Image.open(source) as original:
                    photo = ImageOps.exif_transpose(original).convert("RGB")
                    if min(photo.size) < 256:
                        raise ValueError("Photo too small")
                    photo.thumbnail((1600, 1600))
                    # Reject blank / near-black frames, strip metadata by re-encoding.
                    gray = photo.convert("L")
                    stats = ImageStat.Stat(gray)
                    if stats.mean[0] < 5 or stats.stddev[0] < 2:
                        raise ValueError("Photo is blank or too dark")
                    photo.save(target, "JPEG", quality=92)
        except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise ScanError("invalid_photo", "Photos must be readable JPEG/PNG images, at least 256 pixels wide, with visible detail.", 422) from error

    def photos_from_zip(self, job, capture, image_dir):
        try:
            with zipfile.ZipFile(capture) as archive:
                members = archive.infolist()
                if len(members) > self.settings.max_images + 20:
                    raise ScanError("photo_limit", f"Use at most {self.settings.max_images} photos.", 413)
                files = []
                total = 0
                for info in members:
                    name = PurePosixPath(info.filename)
                    mode = info.external_attr >> 16
                    if (mode and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)) and stat.S_IFMT(mode)) or name.is_absolute() or ".." in name.parts or "\\" in info.filename or "\x00" in info.filename or stat.S_ISLNK(mode) or info.flag_bits & 1:
                        raise ScanError("invalid_archive", "ZIP entries must be regular, unencrypted photo files without parent paths.")
                    if info.is_dir():
                        continue
                    if name.name.startswith(".") or "__MACOSX" in name.parts:
                        continue
                    if name.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                        raise ScanError("invalid_archive", "The ZIP may contain only JPEG and PNG photos.")
                    total += info.file_size
                    if info.file_size > 20 * 1024 * 1024 or total > self.settings.max_upload_bytes or info.file_size > max(1, info.compress_size) * 100:
                        raise ScanError("archive_limit", "The photo archive exceeds safe extraction limits.", 413)
                    files.append(info)
                if not 8 <= len(files) <= self.settings.max_images:
                    raise ScanError("photo_count", f"Use 8 to {self.settings.max_images} overlapping photos of one space.")
                for index, info in enumerate(sorted(files, key=lambda item: item.filename)):
                    if job.cancelled.is_set():
                        raise ScanError("scan_cancelled", "This scan was cancelled.", 409)
                    with archive.open(info) as source:
                        self._photo(source, image_dir / f"image_{index:04d}.jpg")
        except (zipfile.BadZipFile, RuntimeError) as error:
            raise ScanError("invalid_archive", "The uploaded ZIP could not be read.") from error

    def video_frames(self, job, capture, image_dir):
        # The decoder accepts only local file/pipe protocols; playlists cannot fetch URLs.
        probe = job.path / "probe.json"
        probe_args = [self.settings.ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", capture]
        self.command(job, probe_args, timeout=15, stdout_path=probe)
        try:
            metadata = json.loads(probe.read_text())
            duration = float(metadata["format"]["duration"])
            streams = [s for s in metadata["streams"] if s.get("codec_type") == "video"]
            if not math.isfinite(duration) or not 2 <= duration <= self.settings.max_video_seconds or not streams or max(s.get("width", 0) * s.get("height", 0) for s in streams) > 40_000_000:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise ScanError("video_limit", f"Use a video between 2 and {self.settings.max_video_seconds} seconds, up to 40 megapixels per frame.", 422)
        raw = job.path / "frames"
        raw.mkdir(mode=0o700)
        fps = min(2, self.settings.max_images / duration)
        self.command(job, [self.settings.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0", "-i", capture,
                           "-map", "0:v:0", "-an", "-sn", "-vf", f"fps={fps:.6f},scale=1600:1600:force_original_aspect_ratio=decrease", "-frames:v", str(self.settings.max_images), "-q:v", "3", raw / "frame_%04d.jpg"], timeout=90)
        count = 0
        for path in sorted(raw.glob("*.jpg")):
            try:
                self._photo(path, image_dir / f"image_{count:04d}.jpg")
                count += 1
            except ScanError as error:
                if error.code != "invalid_photo":
                    raise
        shutil.rmtree(raw)
        if count < 8:
            raise ScanError("insufficient_frames", "Fewer than 8 useful frames were found. Walk slowly in good light and keep views overlapping.", 422)

    def run(self, job, update):
        settings = self.settings
        capture = job.path / ("capture" + ALLOWED_TYPES[job.media_type])
        dataset, artifacts = job.path / "dataset", job.path / "artifacts"
        image_dir = dataset / "images"
        image_dir.mkdir(parents=True, mode=0o700)
        artifacts.mkdir(mode=0o700)
        update(job, "Selecting clear, overlapping images", .15)
        if job.media_type == "application/zip":
            self.photos_from_zip(job, capture, image_dir)
        else:
            self.video_frames(job, capture, image_dir)
        database, sparse = dataset / "database.db", dataset / "sparse"
        sparse.mkdir()
        update(job, "Finding image features", .3)
        self.command(job, [settings.colmap, "feature_extractor", "--database_path", database, "--image_path", image_dir, "--ImageReader.camera_model", "SIMPLE_RADIAL"])
        update(job, "Matching overlapping views", .45)
        matcher = "sequential_matcher" if job.media_type.startswith("video/") else "exhaustive_matcher"
        self.command(job, [settings.colmap, matcher, "--database_path", database])
        update(job, "Reconstructing camera positions and geometry", .6)
        self.command(job, [settings.colmap, "mapper", "--database_path", database, "--image_path", image_dir, "--output_path", sparse])
        models = [p for p in sparse.iterdir() if p.is_dir() and (p / "images.bin").is_file()]
        if not models:
            raise ScanError("no_reconstruction", "The views could not be aligned. Recapture with more overlap and visible stationary detail.", 422)
        model = max(models, key=lambda p: (p / "images.bin").stat().st_size)
        text_dir = job.path / "colmap-text"
        text_dir.mkdir()
        self.command(job, [settings.colmap, "model_converter", "--input_path", model, "--output_path", text_dir, "--output_type", "TXT"], timeout=60)
        cameras_file, points_file = text_dir / "images.txt", text_dir / "points3D.txt"
        camera_lines = [line for line in cameras_file.read_text().splitlines() if not line.startswith("#")]
        registered = len(camera_lines) // 2
        if registered < 3:
            raise ScanError("too_few_cameras", "Fewer than 3 camera positions aligned. A more complete capture is needed.", 422)
        update(job, "Preparing visual geometry for review", .8)
        self.command(job, [settings.colmap, "model_converter", "--input_path", model, "--output_path", artifacts / "sparse.ply", "--output_type", "PLY"], timeout=60)
        points, total = [], 0
        # Two passes keep deterministic, evenly sampled points without loading a huge model.
        with points_file.open() as source:
            total = sum(1 for line in source if line.strip() and not line.startswith("#"))
        stride = max(1, math.ceil(total / settings.max_points))
        with points_file.open() as source:
            index = 0
            for line in source:
                if not line.strip() or line.startswith("#"):
                    continue
                if index % stride == 0:
                    columns = line.split()
                    xyz = [float(v) for v in columns[1:4]]
                    rgb = [int(v) for v in columns[4:7]]
                    if len(xyz) == 3 and len(rgb) == 3 and all(math.isfinite(v) for v in xyz) and all(0 <= v <= 255 for v in rgb):
                        points.append(xyz + rgb)
                index += 1
        if not points:
            raise ScanError("no_points", "No usable 3D points were reconstructed.", 422)
        (artifacts / "point-cloud.json").write_text(json.dumps({"version": 1, "kind": "colmap-sparse-point-cloud", "units": "arbitrary", "coordinateFrame": "colmap", "points": points}, separators=(",", ":")))
        names = ["point-cloud.json", "sparse.ply"]
        if settings.visual_adapter:
            update(job, "Training the configured visual reconstruction", .85)
            if file_hash(settings.visual_adapter) != settings.visual_adapter_sha256:
                raise ScanError("adapter_changed", "The configured visual adapter changed. The operator must verify its checksum.", 503)
            import sys
            self.command(job, [sys.executable, settings.visual_adapter, str(dataset), str(artifacts)], timeout=settings.job_timeout)
            for name in ("visual.ply", "visual.usdz"):
                candidate = artifacts / name
                if candidate.is_file() and not candidate.is_symlink() and candidate.stat().st_size > 0:
                    names.append(name)
        manifest = {"version": 1, "schema": "brainsnn.site-scan.v1", "id": job.id,
                    "pipeline": "colmap-sparse", "source": {"filename": job.filename, "sha256": job.source_sha256, "mediaType": job.media_type},
                    "provenance": {"colmapRevisionOperatorAttested": settings.colmap_revision,
                                   "colmapBinarySha256": file_hash(shutil.which(settings.colmap)),
                                   "visualAdapterSha256": settings.visual_adapter_sha256 or None},
                    "capture": {"images": len(list(image_dir.glob("*.jpg"))), "registeredCameras": registered, "reconstructedPoints": total, "previewPoints": len(points),
                                "registrationFraction": registered / max(1, len(list(image_dir.glob("*.jpg"))))},
                    "units": "arbitrary", "coordinateFrame": "colmap", "requiresReview": True,
                    "reviewRequired": ["Confirm metric scale using a measured distance", "Align the floor plane and up axis", "Review the floor boundary and obstacles", "Author collision geometry and navigation map", "Validate the robot sensor and policy integration"],
                    "physicsReady": False, "policyExecuted": False, "artifacts": names,
                    "warnings": (["Less than half the submitted images aligned. This reconstruction is incomplete; recapture missing areas."] if registered < len(list(image_dir.glob("*.jpg"))) / 2 else []),
                    "limitations": ["Visual reconstruction does not infer reliable mass, friction, joints or safe robot operation.", "Sparse geometry can miss glass, plain walls, moving people and reflective surfaces.", "Gaussian visual exports are not collision meshes."]}
        (artifacts / "scan.json").write_text(json.dumps(manifest, indent=2))
        names.insert(0, "scan.json")
        return [{"name": name, "mediaType": ARTIFACT_TYPES[name], "sizeBytes": (artifacts / name).stat().st_size,
                 "sha256": file_hash(artifacts / name), "url": f"/v1/site-scans/{job.id}/artifacts/{name}"} for name in names]
