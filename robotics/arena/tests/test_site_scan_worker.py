"""CPU tests exercise boundaries and real COLMAP output parsing with command doubles.
These tests do not claim a GPU reconstruction or learned policy run.
"""
from pathlib import Path
import asyncio
import io
import json
import os
import stat
import sys
import tempfile
import threading
import time
import unittest
import zipfile

import httpx
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.site_scan.app import create_app
from workers.site_scan.core import Job, ReconstructionPipeline, ScanError, ScanManager, Settings

TOKEN = "test-token-" + "x" * 40
ORIGIN = "https://www.brainsnn.com"


class ControlledPipeline:
    def __init__(self, hold=False, error=False):
        self.release = threading.Event()
        if not hold:
            self.release.set()
        self.started = threading.Event()
        self.error = error

    def missing(self):
        return []

    def run(self, job, update):
        self.started.set()
        while not self.release.wait(.01):
            if job.cancelled.is_set():
                raise ScanError("scan_cancelled", "Cancelled", 409)
        if self.error:
            raise ScanError("no_reconstruction", "No cameras aligned", 422)
        path = job.path / "artifacts"
        path.mkdir()
        (path / "scan.json").write_text('{"requiresReview":true,"physicsReady":false}')
        return [{"name": "scan.json", "mediaType": "application/json", "sizeBytes": 44,
                 "url": f"/v1/site-scans/{job.id}/artifacts/scan.json"}]


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(TOKEN, Path(self.temp.name), enabled=True, max_upload_bytes=1024,
                                 max_job_bytes=2048, max_total_bytes=4096, sweep_seconds=10)
        self.pipeline = ControlledPipeline()
        self.manager = ScanManager(self.settings, pipeline=self.pipeline)
        self.app = create_app(self.settings, self.manager)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.headers = {"Authorization": "Bearer " + TOKEN, "Origin": ORIGIN}

    async def asyncTearDown(self):
        self.pipeline.release.set()
        self.manager.close()
        await self.client.aclose()
        self.temp.cleanup()

    async def upload(self, content=b"test", headers=None):
        return await self.client.post("/v1/site-scans", content=content,
                                      headers={**self.headers, "Content-Type": "video/mp4", "X-Filename": "room.mp4", **(headers or {})})

    async def completed(self, job_id):
        for _ in range(100):
            response = await self.client.get(f"/v1/site-scans/{job_id}", headers=self.headers)
            if response.json()["status"] in {"complete", "failed", "cancelled"}:
                return response.json()
            await asyncio.sleep(.01)
        self.fail("Job did not finish")

    async def test_second_worker_cannot_purge_live_store(self):
        response = await self.upload()
        job_id = response.json()["id"]
        await self.completed(job_id)
        with self.assertRaises(ValueError):
            ScanManager(self.settings, pipeline=ControlledPipeline())
        self.assertTrue((Path(self.temp.name) / job_id).exists())

    async def test_nonempty_unmarked_storage_is_untouched(self):
        with tempfile.TemporaryDirectory() as other:
            path = Path(other)
            content = path / ("c" * 32)
            content.mkdir()
            (content / "keep.txt").write_text("do not delete")
            with self.assertRaises(ValueError):
                ScanManager(Settings(TOKEN, path), pipeline=ControlledPipeline())
            self.assertEqual((content / "keep.txt").read_text(), "do not delete")

    async def test_auth_origin_and_private_cache(self):
        self.assertEqual((await self.client.get("/v1/site-scans/capabilities")).status_code, 401)
        bad = await self.client.get("/v1/site-scans/capabilities", headers={**self.headers, "Origin": "https://evil.example"})
        self.assertEqual(bad.status_code, 403)
        response = await self.client.get("/v1/site-scans/capabilities", headers=self.headers)
        self.assertTrue(response.json()["available"])
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(response.headers["access-control-allow-origin"], ORIGIN)

    async def test_unconfigured_returns_actionable_503(self):
        self.manager.pipeline = ReconstructionPipeline(Settings(TOKEN, Path(self.temp.name)))
        capabilities = (await self.client.get("/v1/site-scans/capabilities", headers=self.headers)).json()
        self.assertFalse(capabilities["available"])
        response = await self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "pipeline_unavailable")
        self.assertFalse(self.manager.jobs)

    async def test_upload_artifact_auth_and_delete(self):
        response = await self.upload()
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["id"]
        result = await self.completed(job_id)
        self.assertEqual(result["status"], "complete")
        url = f"/v1/site-scans/{job_id}/artifacts/scan.json"
        self.assertEqual((await self.client.get(url)).status_code, 401)
        artifact = await self.client.get(url, headers=self.headers)
        self.assertTrue(artifact.json()["requiresReview"])
        self.assertFalse(artifact.json()["physicsReady"])
        self.assertEqual((await self.client.get(f"/v1/site-scans/{job_id}/artifacts/pipeline.log", headers=self.headers)).status_code, 404)
        self.assertEqual((await self.client.delete(f"/v1/site-scans/{job_id}", headers=self.headers)).status_code, 200)
        self.assertFalse((Path(self.temp.name) / job_id).exists())
        self.assertEqual((await self.client.get(url, headers=self.headers)).status_code, 404)

    async def test_streamed_overflow_without_content_length_is_removed(self):
        async def chunks():
            yield b"x" * 800
            yield b"x" * 800
        response = await self.upload(chunks())
        self.assertEqual(response.status_code, 413)
        self.assertFalse(self.manager.jobs)
        self.assertFalse([p for p in Path(self.temp.name).iterdir() if not p.name.startswith(".")])

    async def test_empty_declared_oversized_and_filename_rejected(self):
        self.assertEqual((await self.upload(b"")).status_code, 413)
        self.assertEqual((await self.upload(b"x" * 2048)).status_code, 413)
        self.assertEqual((await self.upload(headers={"X-Filename": "%2e%2e%2fsecret"})).status_code, 400)
        self.assertFalse(self.manager.jobs)

    async def test_busy_and_cancellation(self):
        self.pipeline.release.clear()
        first = await self.upload()
        job_id = first.json()["id"]
        self.assertEqual((await self.upload()).status_code, 409)
        await self.client.delete(f"/v1/site-scans/{job_id}", headers=self.headers)
        for _ in range(100):
            if not (Path(self.temp.name) / job_id).exists():
                break
            await asyncio.sleep(.01)
        self.assertFalse((Path(self.temp.name) / job_id).exists())

    async def test_failure_is_visible_and_does_not_offer_artifacts(self):
        self.pipeline.error = True
        response = await self.upload()
        result = await self.completed(response.json()["id"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"]["code"], "no_reconstruction")
        self.assertEqual(result["artifacts"], [])

    async def test_expiry_removes_private_capture(self):
        response = await self.upload()
        job_id = response.json()["id"]
        await self.completed(job_id)
        self.manager.jobs[job_id].created = time.time() - self.settings.ttl_seconds - 1
        self.manager.sweep()
        self.assertFalse((Path(self.temp.name) / job_id).exists())
        self.assertEqual((await self.client.get(f"/v1/site-scans/{job_id}", headers=self.headers)).status_code, 404)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = Settings(TOKEN, self.root, enabled=True)
        self.pipeline = ReconstructionPipeline(self.settings)
        self.job = Job("a" * 32, self.root, "application/zip", "photos.zip")
        self.images = self.root / "images"
        self.images.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def make_zip(self, entries):
        path = self.root / "capture.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries:
                archive.writestr(name, data)
        return path

    def photo(self):
        output = io.BytesIO()
        image = Image.effect_noise((320, 320), 60).convert("RGB")
        image.save(output, "JPEG")
        return output.getvalue()

    def test_valid_photos_are_reencoded_under_generated_names(self):
        photo = self.photo()
        capture = self.make_zip([(f"room/photo{i}.jpg", photo) for i in range(8)])
        self.pipeline.photos_from_zip(self.job, capture, self.images)
        self.assertEqual(len(list(self.images.glob("image_*.jpg"))), 8)
        self.assertFalse((self.images / "room").exists())

    def test_zip_traversal_and_zip_bomb_rejected(self):
        for entries in [[("../outside.jpg", b"x")], [("photo.jpg", b"x" * 1_000_000)]]:
            capture = self.make_zip(entries)
            with self.assertRaises(ScanError):
                self.pipeline.photos_from_zip(self.job, capture, self.images)
        self.assertFalse((self.root.parent / "outside.jpg").exists())

    def test_zip_symlink_and_non_image_rejected(self):
        capture = self.root / "capture.zip"
        with zipfile.ZipFile(capture, "w") as archive:
            info = zipfile.ZipInfo("photo.jpg")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "/etc/passwd")
        with self.assertRaises(ScanError):
            self.pipeline.photos_from_zip(self.job, capture, self.images)
        capture = self.make_zip([("instructions.html", b"<html>")])
        with self.assertRaises(ScanError):
            self.pipeline.photos_from_zip(self.job, capture, self.images)

    def test_real_command_cancellation_and_timeout_kill_process(self):
        with self.assertRaises(ScanError) as error:
            self.pipeline.command(self.job, [sys.executable, "-c", "import time;time.sleep(5)"], timeout=.05)
        self.assertEqual(error.exception.code, "job_timeout")
        self.assertIsNone(self.job.process)
        self.job.cancelled.set()
        with self.assertRaises(ScanError) as error:
            self.pipeline.command(self.job, [sys.executable, "-c", "pass"])
        self.assertEqual(error.exception.code, "scan_cancelled")

    def test_command_enforces_total_disk_budget(self):
        self.settings.max_total_bytes = 10
        (self.root / "retained-private-file").write_bytes(b"x" * 100)
        with self.assertRaises(ScanError) as error:
            self.pipeline.command(self.job, [sys.executable, "-c", "import time;time.sleep(5)"])
        self.assertEqual(error.exception.code, "storage_limit")

    def test_fast_command_still_checks_final_storage_usage(self):
        self.settings.max_job_bytes = 10
        with self.assertRaises(ScanError) as error:
            self.pipeline.command(self.job, [sys.executable, "-c", "open('too-large','wb').write(b'x'*1000)"])
        self.assertEqual(error.exception.code, "storage_limit")

    def test_settings_refuses_weak_token_and_wildcard_origin(self):
        with self.assertRaises(ValueError):
            Settings("short", self.root).validate()
        with self.assertRaises(ValueError):
            Settings(TOKEN, self.root, origins=("*",)).validate()

    def test_sparse_output_parser_preserves_unscaled_review_boundary(self):
        photo = self.photo()
        self.make_zip([(f"photo{i}.jpg", photo) for i in range(8)])
        self.settings.colmap = sys.executable
        self.settings.colmap_revision = "b" * 40
        def command(job, args, timeout=600, cwd=None):
            operation = args[1]
            if operation == "mapper":
                model = Path(args[args.index("--output_path") + 1]) / "0"
                model.mkdir()
                (model / "images.bin").write_bytes(b"actual fixture")
            elif operation == "model_converter":
                output = Path(args[args.index("--output_path") + 1])
                if args[-1] == "TXT":
                    # Identity orientation at t=(1,2,3); a 180° turn about Y at t=(0,0,4); and an unparsable line.
                    (output / "images.txt").write_text("# cameras\n1 1 0 0 0 1 2 3 1 image_0001.jpg\npoints\n"
                                                       "2 0 0 1 0 0 0 4 1 image_0000.jpg\npoints\n3 pose\npoints\n")
                    (output / "points3D.txt").write_text("# points\n1 1.5 2 3 4 5 6 0 1 1\n2 3 4 5 6 7 8 0 2 2\n")
                else:
                    output.write_text("ply\nformat ascii 1.0\nend_header\n")
        self.pipeline.command = command
        artifacts = self.pipeline.run(self.job, lambda *args: None)
        manifest = json.loads((self.root / "artifacts/scan.json").read_text())
        cloud = json.loads((self.root / "artifacts/point-cloud.json").read_text())
        self.assertFalse(manifest["physicsReady"])
        self.assertFalse(manifest["policyExecuted"])
        self.assertEqual(manifest["capture"]["registeredCameras"], 3)
        self.assertEqual(cloud["units"], "arbitrary")
        self.assertEqual(cloud["points"][0], [1.5, 2, 3, 4, 5, 6])
        self.assertEqual({a["name"] for a in artifacts}, {"scan.json", "point-cloud.json", "cameras.json", "sparse.ply"})
        path = json.loads((self.root / "artifacts/cameras.json").read_text())
        self.assertEqual(path["units"], "arbitrary")
        self.assertEqual([c["frame"] for c in path["cameras"]], ["image_0000.jpg", "image_0001.jpg"])
        turned, identity = path["cameras"]
        self.assertEqual(identity["centre"], [-1, -2, -3])
        self.assertEqual(identity["forward"], [0, 0, 1])
        self.assertEqual(identity["down"], [0, 1, 0])
        for actual, expected in zip(turned["centre"] + turned["forward"], [0, 0, 4, 0, 0, -1]):
            self.assertAlmostEqual(actual, expected)

    def test_split_video_walk_is_rejoined_with_exhaustive_matching(self):
        self.job.media_type = "video/mp4"
        image_dir = self.root / "dataset/images"
        self.pipeline.video_frames = lambda job, capture, target: [
            (target / f"image_{i:04d}.jpg").write_bytes(self.photo()) for i in range(10)]
        self.settings.colmap = sys.executable
        self.settings.colmap_revision = "b" * 40
        calls, maps = [], iter([(4, 3), (10,)])
        def command(job, args, timeout=600, cwd=None):
            calls.append(args[1:3] if args[1] == "feature_extractor" else args[1])
            if args[1] == "mapper":
                for index, count in enumerate(next(maps)):
                    model = Path(args[args.index("--output_path") + 1]) / str(index)
                    model.mkdir()
                    (model / "images.bin").write_bytes(count.to_bytes(8, "little") + b"rest")
            elif args[1] == "model_converter" and args[-1] == "TXT":
                output = Path(args[args.index("--output_path") + 1])
                self.assertEqual(int.from_bytes((Path(args[args.index("--input_path") + 1]) / "images.bin").read_bytes()[:8], "little"), 10)
                (output / "images.txt").write_text("".join(f"{i} 1 0 0 0 0 0 {i} 1 image_{i:04d}.jpg\npoints\n" for i in range(10)))
                (output / "points3D.txt").write_text("1 1 2 3 4 5 6 0 1 1\n")
            elif args[1] == "model_converter":
                Path(args[args.index("--output_path") + 1]).write_text("ply\n")
        stages = []
        self.pipeline.command = command
        self.pipeline.run(self.job, lambda job, stage, progress: stages.append(stage))
        self.assertEqual(calls[:6], [["feature_extractor", "--database_path"], "sequential_matcher", "mapper", "exhaustive_matcher", "mapper", "model_converter"])
        self.assertIn("Connecting the rest of the walk", stages)
        manifest = json.loads((self.root / "artifacts/scan.json").read_text())
        self.assertEqual(manifest["capture"]["registeredCameras"], 10)
        self.assertTrue(image_dir.is_dir())


if __name__ == "__main__":
    unittest.main()
