"""Native authenticated download regression tests, without a GPU or large RAM use."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import asyncio
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.site_scan.app import ArtifactDownloadTickets, DownloadFileResponse, create_app
from workers.site_scan.core import ScanError, ScanManager, Settings

TOKEN = "download-test-" + "x" * 40
ORIGIN = "https://www.brainsnn.com"


class AvailablePipeline:
    def missing(self):
        return []


class TicketTests(unittest.TestCase):
    def test_expiry_capacity_cleanup_and_revocation(self):
        now = [100.0]
        tickets = ArtifactDownloadTickets(clock=lambda: now[0])
        tickets.max_pending = 2
        first = tickets.issue("job-a", "sparse.ply")["ticket"]
        second = tickets.issue("job-b", "sparse.ply")["ticket"]
        self.assertNotEqual(first, second)
        with self.assertRaises(ScanError) as error:
            tickets.issue("job-c", "sparse.ply")
        self.assertEqual(error.exception.status, 429)
        tickets.revoke("job-b")
        tickets.issue("job-c", "sparse.ply")
        with self.assertRaises(ScanError):
            tickets.consume(second, "job-b", "sparse.ply")
        now[0] += 60
        with self.assertRaises(ScanError):
            tickets.consume(first, "job-a", "sparse.ply")
        self.assertFalse(tickets.pending)
        self.assertEqual(tickets.issue("job-d", "sparse.ply")["expiresInSeconds"], 60)

    def test_concurrent_redemption_is_atomic(self):
        tickets = ArtifactDownloadTickets()
        ticket = tickets.issue("job-a", "sparse.ply")["ticket"]

        def consume(_):
            try:
                tickets.consume(ticket, "job-a", "sparse.ply")
                return "accepted"
            except ScanError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(consume, range(20)))
        self.assertEqual(results.count("accepted"), 1)
        self.assertEqual(results.count("download_unavailable"), 19)


class NativeDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(TOKEN, Path(self.temp.name), enabled=True)
        self.manager = ScanManager(self.settings, pipeline=AvailablePipeline())
        self.app = create_app(self.settings, self.manager)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.headers = {"Authorization": "Bearer " + TOKEN, "Origin": ORIGIN}
        self.job = self.manager.reserve("video/mp4", "room.mp4")
        self.job.status = "complete"
        artifacts = self.job.path / "artifacts"
        artifacts.mkdir()
        self.path = artifacts / "sparse.ply"
        self.path.write_bytes(b"ply\nfixture\n")
        self.job.artifacts = [{"name": "sparse.ply", "sizeBytes": self.path.stat().st_size}]
        self.url = f"/v1/site-scans/{self.job.id}/artifacts/sparse.ply"

    async def asyncTearDown(self):
        await self.client.aclose()
        self.manager.close()
        self.temp.cleanup()

    async def ticket(self, url=None):
        response = await self.client.post((url or self.url) + "/download-ticket", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(set(result), {"version", "ticket", "expiresInSeconds"})
        self.assertNotIn(TOKEN, response.text)
        return result["ticket"]

    async def redeem(self, ticket, url=None, headers=None):
        return await self.client.post((url or self.url) + "/download", data={"ticket": ticket},
                                      headers={"Origin": ORIGIN, **(headers or {})})

    async def test_capability_and_authentication_before_artifact_lookup(self):
        result = await self.client.get("/v1/site-scans/capabilities", headers=self.headers)
        self.assertEqual(result.json()["artifactDownloads"], {"nativePost": True, "maxArtifactBytes": 3 * 1024 ** 3})
        self.assertIn("Content-Encoding", result.headers["access-control-expose-headers"])
        for url in (self.url, "/v1/site-scans/missing/artifacts/sparse.ply"):
            for headers in ({}, {"Authorization": "Bearer wrong"}):
                result = await self.client.post(url + "/download-ticket", headers=headers)
                self.assertEqual(result.status_code, 401)
            result = await self.client.post(url + "/download-ticket", headers={**self.headers, "Origin": "https://evil.example"})
            self.assertEqual(result.status_code, 403)
        self.assertEqual((await self.client.post(self.url + "/download", data={"ticket": TOKEN})).status_code, 404)
        self.assertEqual((await self.client.post(self.url + "/download", data={"ticket": "x" * 43}, headers=self.headers)).status_code, 404)

    async def test_native_attachment_single_use_and_get_stays_authenticated(self):
        ticket = await self.ticket()
        result = await self.redeem(ticket)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.content, b"ply\nfixture\n")
        self.assertIn('attachment; filename="sparse.ply"', result.headers["content-disposition"])
        self.assertEqual(result.headers["cache-control"], "private, no-store")
        self.assertEqual(result.headers["referrer-policy"], "no-referrer")
        self.assertEqual(result.headers["x-content-type-options"], "nosniff")
        self.assertEqual((await self.redeem(ticket)).status_code, 404)
        self.assertEqual((await self.client.get(self.url)).status_code, 401)
        self.assertEqual((await self.client.get(self.url, headers=self.headers)).status_code, 200)
        self.assertEqual((await self.client.get(self.url + "/download", params={"ticket": ticket})).status_code, 405)

    async def test_origin_rejection_does_not_consume_ticket_and_absent_origin_works(self):
        ticket = await self.ticket()
        for origin in ("https://evil.example", "null"):
            result = await self.redeem(ticket, headers={"Origin": origin})
            self.assertEqual(result.status_code, 403)
        result = await self.client.post(self.url + "/download", data={"ticket": ticket})
        self.assertEqual(result.status_code, 200)

    async def test_scope_and_invalid_tickets_do_not_leak_job_existence(self):
        missing = "/v1/site-scans/" + "e" * 32 + "/artifacts/sparse.ply"
        for url in (self.url, missing):
            result = await self.redeem("invalid", url=url)
            self.assertEqual(result.status_code, 404)
            self.assertEqual(result.json()["error"]["code"], "download_unavailable")
        for url in (missing, self.url.replace("sparse.ply", "scan.json")):
            ticket = await self.ticket()
            result = await self.redeem(ticket, url=url)
            self.assertEqual(result.status_code, 404)
            self.assertEqual((await self.redeem(ticket)).status_code, 404)

    async def test_deleted_expired_or_removed_artifact_is_not_downloadable(self):
        ticket = await self.ticket()
        self.path.unlink()
        result = await self.redeem(ticket)
        self.assertEqual(result.status_code, 404)
        self.assertEqual(result.json()["error"]["code"], "download_unavailable")
        self.path.write_bytes(b"ply")
        ticket = await self.ticket()
        self.job.created -= self.settings.ttl_seconds + 1
        result = await self.redeem(ticket)
        self.assertEqual(result.status_code, 404)
        self.assertEqual(result.json()["error"]["code"], "download_unavailable")
        self.assertFalse(self.path.exists())

    async def test_delete_route_revokes_ticket(self):
        ticket = await self.ticket()
        result = await self.client.delete(f"/v1/site-scans/{self.job.id}", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        result = await self.redeem(ticket)
        self.assertEqual(result.status_code, 404)
        self.assertEqual(result.json()["error"]["code"], "download_unavailable")

    async def test_form_size_media_type_and_duplicate_field_limits(self):
        ticket = await self.ticket()
        endpoint = self.url + "/download"
        for body in (b"x" * 1025, b"ticket=x"):
            result = await self.client.post(endpoint, content=body, headers={
                "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "1025"})
            self.assertEqual(result.status_code, 413)

        async def chunks():
            yield b"x" * 600
            yield b"x" * 600

        result = await self.client.post(endpoint, content=chunks(), headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(result.status_code, 413)
        result = await self.client.post(endpoint, json={"ticket": ticket})
        self.assertEqual(result.status_code, 415)
        for body in (f"ticket={ticket}&ticket={ticket}", f"ticket={ticket}&token={TOKEN}", "ticket=%ff", "ticket"):
            result = await self.client.post(endpoint, content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
            self.assertEqual(result.status_code, 404)
        self.assertEqual((await self.redeem(ticket)).status_code, 200)

    async def test_three_gibibyte_sparse_artifact_streams_range_without_buffering_file(self):
        size = 3 * 1024 ** 3
        with self.path.open("r+b") as artifact:
            artifact.truncate(size)
            artifact.seek(size - 4)
            artifact.write(b"TAIL")
        ticket = await self.ticket()
        result = await self.redeem(ticket, headers={"Range": "bytes=-4"})
        self.assertEqual(result.status_code, 206)
        self.assertEqual(result.content, b"TAIL")
        self.assertEqual(result.headers["content-length"], "4")
        self.assertEqual(result.headers["content-range"], f"bytes {size - 4}-{size - 1}/{size}")
        self.assertEqual((await self.redeem(ticket, headers={"Range": "bytes=0-3"})).status_code, 404)

    async def test_native_size_limit_is_checked_when_issued_and_again_when_redeemed(self):
        size = 3 * 1024 ** 3 + 1
        with self.path.open("r+b") as artifact:
            artifact.truncate(size)
        result = await self.client.post(self.url + "/download-ticket", headers=self.headers)
        self.assertEqual(result.status_code, 413)
        self.assertEqual(result.json()["error"]["code"], "artifact_download_limit")
        self.path.write_bytes(b"ply")
        ticket = await self.ticket()
        with self.path.open("r+b") as artifact:
            artifact.truncate(size)
        result = await self.redeem(ticket)
        self.assertEqual(result.status_code, 404)
        self.assertEqual(result.json()["error"]["code"], "download_unavailable")
        self.path.write_bytes(b"ply")
        self.assertEqual((await self.redeem(ticket)).status_code, 404)

    async def test_native_size_limit_respects_smaller_configured_job_budget(self):
        self.settings.max_upload_bytes = 512
        self.settings.max_job_bytes = 1024
        self.app = create_app(self.settings, self.manager)
        await self.client.aclose()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        result = await self.client.get("/v1/site-scans/capabilities", headers=self.headers)
        self.assertEqual(result.json()["artifactDownloads"]["maxArtifactBytes"], 1024)
        with self.path.open("r+b") as artifact:
            artifact.truncate(1025)
        result = await self.client.post(self.url + "/download-ticket", headers=self.headers)
        self.assertEqual(result.status_code, 413)
        self.path.write_bytes(b"ply")
        ticket = await self.ticket()
        with self.path.open("r+b") as artifact:
            artifact.truncate(1025)
        self.assertEqual((await self.redeem(ticket)).status_code, 404)

    async def test_native_client_disconnect_stops_large_response(self):
        await self.assert_large_response_cancellation("POST")

    async def test_authenticated_get_disconnect_stops_large_response(self):
        await self.assert_large_response_cancellation("GET")

    async def test_completion_disconnect_waits_for_async_file_cleanup(self):
        final_body = asyncio.Event()
        cleanup_finished = False

        async def file_response(response, scope, receive, send):
            nonlocal cleanup_finished
            await send({"type": "http.response.body", "body": b"done", "more_body": False})
            # FileResponse closes its file asynchronously after the final send.
            await asyncio.sleep(.01)
            cleanup_finished = True

        async def send(message):
            final_body.set()

        async def receive():
            await final_body.wait()
            return {"type": "http.disconnect"}

        with patch("workers.site_scan.app.FileResponse.__call__", file_response):
            await DownloadFileResponse(self.path)({}, receive, send)
        self.assertTrue(cleanup_finished, "Response completion must not cancel file cleanup")

    async def assert_large_response_cancellation(self, method):
        size = 3 * 1024 ** 3
        with self.path.open("r+b") as artifact:
            artifact.truncate(size)
        ticket = await self.ticket() if method == "POST" else None
        body = ("ticket=" + ticket).encode("ascii") if ticket else b""
        path = self.url + "/download" if ticket else self.url
        disconnected = asyncio.Event()
        sent_request = False
        received_bytes = 0
        largest_chunk = 0
        response_headers = {}

        async def receive():
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            nonlocal received_bytes, largest_chunk, response_headers
            if message["type"] == "http.response.start":
                self.assertEqual(message["status"], 200)
                response_headers = dict(message["headers"])
            elif message["type"] == "http.response.body":
                chunk_size = len(message.get("body", b""))
                received_bytes += chunk_size
                largest_chunk = max(largest_chunk, chunk_size)
                if chunk_size:
                    disconnected.set()

        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.0"},
                 "method": method, "scheme": "http", "http_version": "1.1", "root_path": "",
                 "path": path, "raw_path": path.encode(),
                 "query_string": b"", "server": ("test", 80), "client": ("127.0.0.1", 1234),
                 "headers": [(b"content-type", b"application/x-www-form-urlencoded"),
                             (b"content-length", str(len(body)).encode()), (b"origin", ORIGIN.encode())]}
        if not ticket:
            scope["headers"].append((b"authorization", ("Bearer " + TOKEN).encode()))
        await asyncio.wait_for(self.app(scope, receive, send), timeout=5)
        self.assertEqual(response_headers[b"content-length"], str(size).encode())
        self.assertGreater(received_bytes, 0)
        self.assertLessEqual(largest_chunk, 64 * 1024)
        self.assertLess(received_bytes, 1024 * 1024)
        self.assertTrue(self.path.exists(), "Cancelling a download must preserve the scan")
        if ticket:
            self.assertEqual((await self.redeem(ticket)).status_code, 404)


if __name__ == "__main__":
    unittest.main()
