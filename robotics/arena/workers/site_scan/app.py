"""uvicorn workers.site_scan.app:create_app --factory --host 127.0.0.1 --port 8082 --workers 1"""
from contextlib import asynccontextmanager
import asyncio
import os
import re
import secrets
import threading
import time
from urllib.parse import parse_qsl, unquote

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.requests import ClientDisconnect

from .core import ALLOWED_TYPES, ScanError, ScanManager, Settings


class DownloadFileResponse(FileResponse):
    """Keep FileResponse's bounded chunks/ranges, but stop disk reads on disconnect.

    Uvicorn's send becomes a no-op after disconnect, and FileResponse itself does
    not listen for it. Separate asyncio tasks allow the file context's async
    close to finish after cancellation, without a cancelled AnyIO level scope.
    """
    async def __call__(self, scope, receive, send):
        response_complete = False

        async def forward(message):
            nonlocal response_complete
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                response_complete = True
            await send(message)

        async def disconnected():
            while (await receive())["type"] != "http.disconnect":
                pass

        transfer = asyncio.create_task(super().__call__(scope, receive, forward))
        disconnect = asyncio.create_task(disconnected())
        try:
            done, _ = await asyncio.wait((transfer, disconnect), return_when=asyncio.FIRST_COMPLETED)
            if transfer in done:
                await transfer
            else:
                await disconnect  # Propagate receive failures, if any.
                if response_complete:
                    # ASGI receive can report disconnect immediately after the
                    # last body. Let the in-progress async file close finish.
                    await transfer
        finally:
            for task in (transfer, disconnect):
                if not task.done():
                    task.cancel()
            await asyncio.gather(transfer, disconnect, return_exceptions=True)


class ArtifactDownloadTickets:
    """Bounded, process-local credentials for a single native browser download.

    The private worker already requires one process per data directory. Tickets
    intentionally disappear on restart and cannot be reused to resume a download.
    """
    ttl_seconds = 60
    max_pending = 128

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.pending = {}
        self.lock = threading.Lock()

    def _prune(self):
        now = self.clock()
        self.pending = {key: value for key, value in self.pending.items() if value[2] > now}

    def issue(self, job_id, name):
        with self.lock:
            self._prune()
            if len(self.pending) >= self.max_pending:
                raise ScanError("download_busy", "Too many pending downloads. Wait a minute and try again.", 429)
            ticket = secrets.token_urlsafe(32)
            self.pending[ticket] = (job_id, name, self.clock() + self.ttl_seconds)
            return {"version": 1, "ticket": ticket, "expiresInSeconds": self.ttl_seconds}

    def consume(self, ticket, job_id, name):
        with self.lock:
            self._prune()
            entry = self.pending.pop(ticket, None)
            if entry is None or entry[:2] != (job_id, name):
                raise download_unavailable()

    def revoke(self, job_id):
        with self.lock:
            self._prune()
            self.pending = {key: value for key, value in self.pending.items() if value[0] != job_id}


def download_unavailable():
    # Do not reveal job existence to someone without a valid scoped ticket.
    return ScanError("download_unavailable", "This download expired or is unavailable. Start the download again from Arena.", 404)


async def read_download_ticket(request):
    """Parse only the tiny native form body, never an unbounded multipart body."""
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/x-www-form-urlencoded":
        raise ScanError("invalid_download_form", "Send a URL-encoded download ticket.", 415)
    limit = 1024
    length = request.headers.get("content-length")
    if length is not None:
        try:
            if not 0 < int(length) <= limit:
                raise ValueError()
        except ValueError:
            raise ScanError("download_form_limit", "The download form is empty or too large.", 413)
    body = bytearray()
    try:
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                if len(body) + len(chunk) > limit:
                    raise ScanError("download_form_limit", "The download form is too large.", 413)
                body.extend(chunk)
    except TimeoutError:
        raise ScanError("download_form_timeout", "The download request took too long. Try again.", 408)
    except ClientDisconnect:
        raise ScanError("download_cancelled", "The download request was cancelled.", 400)
    try:
        fields = parse_qsl(body.decode("ascii"), strict_parsing=True, max_num_fields=1)
    except (ValueError, UnicodeDecodeError):
        raise download_unavailable()
    if len(fields) != 1 or fields[0][0] != "ticket" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", fields[0][1]):
        raise download_unavailable()
    return fields[0][1]


def create_app(settings=None, manager=None):
    settings = settings or Settings.from_env()
    settings.validate()
    manager = manager or ScanManager(settings)
    downloads = ArtifactDownloadTickets()
    max_artifact_bytes = min(settings.max_job_bytes, 3 * 1024 ** 3)

    def downloadable_artifact(job_id, name):
        path, media_type = manager.artifact(job_id, name)
        try:
            size = path.stat().st_size
        except OSError:
            raise download_unavailable()
        if size > max_artifact_bytes:
            raise ScanError("artifact_download_limit", "This artifact exceeds the worker's download size limit.", 413)
        return path, media_type

    @asynccontextmanager
    async def lifespan(app):
        yield
        manager.close()

    app = FastAPI(title="BrainSNN private site scan worker", version="1.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins),
                       allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "X-Filename"],
                       expose_headers=["Content-Disposition", "Content-Encoding"], allow_credentials=False, max_age=600)

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(ScanError)
    async def scan_error(request, error):
        return JSONResponse(status_code=error.status, content={"version": 1, "error": error.as_dict()})

    def authorize_origin(request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            raise ScanError("origin_rejected", "This browser origin is not allowed by the worker.", 403)

    async def authorize(request: Request):
        authorize_origin(request)
        if not secrets.compare_digest(request.headers.get("authorization", "").encode("utf-8"), ("Bearer " + settings.token).encode("ascii")):
            raise ScanError("authentication_required", "Connect using this private worker's access token.", 401)

    @app.get("/v1/site-scans/capabilities", dependencies=[Depends(authorize)])
    def capabilities():
        return {**manager.capabilities(), "artifactDownloads": {
            "nativePost": True, "maxArtifactBytes": max_artifact_bytes}}

    @app.post("/v1/site-scans", status_code=202, dependencies=[Depends(authorize)])
    async def create_scan(request: Request):
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        length = request.headers.get("content-length")
        if length is not None:
            try:
                if not 0 < int(length) <= settings.max_upload_bytes:
                    raise ValueError()
            except ValueError:
                raise ScanError("upload_limit", "The capture is empty or larger than the worker's upload limit.", 413)
        job = manager.reserve(media_type, unquote(request.headers.get("x-filename", "capture" + ALLOWED_TYPES.get(media_type, ""))))
        path = job.path / ("capture" + ALLOWED_TYPES[media_type])
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as target:
                async with asyncio.timeout(settings.upload_timeout):
                    async for chunk in request.stream():
                        job.uploaded_bytes += len(chunk)
                        if job.cancelled.is_set():
                            raise ScanError("scan_cancelled", "This upload was cancelled.", 409)
                        if job.uploaded_bytes > settings.max_upload_bytes:
                            raise ScanError("upload_limit", "The capture exceeds the worker's upload limit.", 413)
                        target.write(chunk)
            if not job.uploaded_bytes:
                raise ScanError("empty_capture", "Upload a non-empty capture file.")
            return manager.submit(job)
        except TimeoutError:
            manager.delete(job.id)
            raise ScanError("upload_timeout", "Upload took too long. Try a smaller capture.", 408)
        except (ClientDisconnect, ScanError):
            manager.delete(job.id)
            raise
        except BaseException:
            manager.delete(job.id)
            raise

    @app.get("/v1/site-scans/{job_id}", dependencies=[Depends(authorize)])
    def get_scan(job_id: str):
        return manager.view(manager.get(job_id))

    @app.get("/v1/site-scans/{job_id}/artifacts/{name}", dependencies=[Depends(authorize)])
    def artifact(job_id: str, name: str):
        path, media_type = manager.artifact(job_id, name)
        return DownloadFileResponse(path, media_type=media_type, filename=name)

    @app.post("/v1/site-scans/{job_id}/artifacts/{name}/download-ticket", dependencies=[Depends(authorize)])
    def download_ticket(job_id: str, name: str):
        downloadable_artifact(job_id, name)
        return downloads.issue(job_id, name)

    @app.post("/v1/site-scans/{job_id}/artifacts/{name}/download")
    async def download_artifact(job_id: str, name: str, request: Request):
        authorize_origin(request)
        ticket = await read_download_ticket(request)
        downloads.consume(ticket, job_id, name)
        try:
            # A ticket never keeps deleted/expired captures alive. Revalidate
            # after consuming it rather than retaining an artifact path.
            path, media_type = downloadable_artifact(job_id, name)
        except ScanError:
            raise download_unavailable()
        return DownloadFileResponse(path, media_type=media_type, filename=name)

    @app.delete("/v1/site-scans/{job_id}", dependencies=[Depends(authorize)])
    def delete_scan(job_id: str):
        manager.delete(job_id)
        downloads.revoke(job_id)
        return {"version": 1, "deleted": True}

    return app
