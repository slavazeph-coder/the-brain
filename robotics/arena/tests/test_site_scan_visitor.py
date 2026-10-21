"""Visitor uploads: website-signed single-use tickets and per-scan access keys. Command doubles; no reconstruction."""
from pathlib import Path
import asyncio
import hashlib
import hmac
import secrets
import sys
import tempfile
import time
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.site_scan.app import create_app
from workers.site_scan.core import ScanManager, Settings
from tests.test_site_scan_worker import ControlledPipeline

TOKEN = "test-token-" + "x" * 40
SECRET = "ticket-secret-" + "s" * 40
ORIGIN = "https://www.brainsnn.com"


def ticket(secret=SECRET, expires=None, nonce=None):
    body = f"v1.{int(expires or time.time() + 600)}.{nonce or secrets.token_hex(16)}"
    return body + "." + hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


class VisitorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings = Settings(TOKEN, Path(self.temp.name), enabled=True, max_upload_bytes=1024, max_job_bytes=2048,
                                 max_total_bytes=8192, sweep_seconds=10, ticket_secret=SECRET)
        self.pipeline = ControlledPipeline()
        self.manager = ScanManager(self.settings, pipeline=self.pipeline)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(self.settings, self.manager)), base_url="http://test")

    async def asyncTearDown(self):
        self.pipeline.release.set()
        self.manager.close()
        await self.client.aclose()
        self.temp.cleanup()

    async def upload(self, authorization, origin=ORIGIN):
        return await self.client.post("/v1/site-scans", content=b"walkthrough", headers={
            "Authorization": authorization, "Origin": origin, "Content-Type": "video/mp4", "X-Filename": "room.mp4"})

    async def finished(self, job_id, key):
        for _ in range(100):
            view = (await self.client.get(f"/v1/site-scans/{job_id}", headers={"Authorization": "Scan " + key, "Origin": ORIGIN})).json()
            if view["status"] in {"complete", "failed", "cancelled"}:
                return view
            await asyncio.sleep(.01)
        self.fail("Job did not finish")

    async def test_ticket_creates_a_scan_only_its_key_can_open(self):
        response = await self.upload("Ticket " + ticket())
        self.assertEqual(response.status_code, 202)
        job_id, key = response.json()["id"], response.json()["accessKey"]
        self.assertGreaterEqual(len(key), 40)
        self.assertNotIn(key, repr(self.manager.jobs[job_id]))
        view = await self.finished(job_id, key)
        self.assertEqual(view["status"], "complete")
        self.assertNotIn("accessKey", view)
        artifact = await self.client.get(f"/v1/site-scans/{job_id}/artifacts/scan.json", headers={"Authorization": "Scan " + key, "Origin": ORIGIN})
        self.assertEqual(artifact.status_code, 200)
        for authorization in ("Scan wrong-key", "Scan ", "Bearer " + key, "Ticket " + ticket()):
            self.assertEqual((await self.client.get(f"/v1/site-scans/{job_id}", headers={"Authorization": authorization})).status_code, 401, authorization)
        # A visitor key never reaches operator routes or another visitor's scan.
        self.assertEqual((await self.client.get("/v1/site-scans/capabilities", headers={"Authorization": "Scan " + key})).status_code, 401)
        other = (await self.upload("Ticket " + ticket())).json()
        self.assertEqual((await self.client.get(f"/v1/site-scans/{other['id']}", headers={"Authorization": "Scan " + key})).status_code, 401)
        # The operator still sees every scan; the visitor can delete their own.
        self.assertEqual((await self.client.get(f"/v1/site-scans/{job_id}", headers={"Authorization": "Bearer " + TOKEN})).status_code, 200)
        await self.finished(other["id"], other["accessKey"])
        deleted = await self.client.delete(f"/v1/site-scans/{job_id}", headers={"Authorization": "Scan " + key, "Origin": ORIGIN})
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual((await self.client.get(f"/v1/site-scans/{job_id}", headers={"Authorization": "Scan " + key})).status_code, 401)

    async def test_tickets_are_signed_single_use_and_short_lived(self):
        nonce = secrets.token_hex(16)
        good = ticket(nonce=nonce)
        self.assertEqual((await self.upload("Ticket " + good)).status_code, 202)
        replay = await self.upload("Ticket " + good)
        self.assertEqual((replay.status_code, replay.json()["error"]["code"]), (401, "ticket_used"))
        for bad, code in ((ticket(secret="other-secret-" + "o" * 40), "invalid_ticket"),
                          (ticket(expires=time.time() - 5), "ticket_expired"),
                          (ticket(expires=time.time() + 7200), "ticket_expired"),
                          ("v1.123.short.sig", "invalid_ticket"),
                          (good.replace("v1.", "v2.", 1), "invalid_ticket")):
            response = await self.upload("Ticket " + bad)
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (401, code), bad)
        self.assertEqual((await self.upload("Ticket " + ticket(), origin="https://evil.example")).status_code, 403)
        self.assertEqual(len(self.manager.jobs), 1)

    async def test_visitor_uploads_recycle_the_oldest_finished_visitor_scan(self):
        jobs = []
        for _ in range(self.settings.max_jobs + 1):
            response = (await self.upload("Ticket " + ticket())).json()
            await self.finished(response["id"], response["accessKey"])
            jobs.append(response["id"])
        self.assertNotIn(jobs[0], self.manager.jobs)
        self.assertEqual(set(self.manager.jobs), set(jobs[1:]))

    async def test_without_a_ticket_secret_only_the_operator_can_upload(self):
        self.settings.ticket_secret = ""
        response = await self.upload("Ticket " + ticket())
        self.assertEqual(response.status_code, 401)
        self.assertEqual((await self.upload("Bearer " + TOKEN)).status_code, 202)

    def test_ticket_secret_must_be_strong_and_distinct(self):
        for secret in ("short", TOKEN):
            with self.assertRaises(ValueError):
                Settings(TOKEN, Path(self.temp.name), ticket_secret=secret).validate()


if __name__ == "__main__":
    unittest.main()
