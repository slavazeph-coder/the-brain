"""uvicorn workers.site_scan.app:create_app --factory --host 127.0.0.1 --port 8082 --workers 1"""
from contextlib import asynccontextmanager
import asyncio
import os
import secrets
from urllib.parse import unquote

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.requests import ClientDisconnect

from .core import ALLOWED_TYPES, ScanError, ScanManager, Settings


def create_app(settings=None, manager=None):
    settings = settings or Settings.from_env()
    settings.validate()
    manager = manager or ScanManager(settings)

    @asynccontextmanager
    async def lifespan(app):
        yield
        manager.close()

    app = FastAPI(title="BrainSNN private site scan worker", version="1.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins),
                       allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "X-Filename"],
                       expose_headers=["Content-Disposition"], allow_credentials=False, max_age=600)

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(ScanError)
    async def scan_error(request, error):
        return JSONResponse(status_code=error.status, content={"version": 1, "error": error.as_dict()})

    async def authorize(request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            raise ScanError("origin_rejected", "This browser origin is not allowed by the worker.", 403)
        if not secrets.compare_digest(request.headers.get("authorization", "").encode("utf-8"), ("Bearer " + settings.token).encode("ascii")):
            raise ScanError("authentication_required", "Connect using this private worker's access token.", 401)

    @app.get("/v1/site-scans/capabilities", dependencies=[Depends(authorize)])
    def capabilities():
        return manager.capabilities()

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
        return FileResponse(path, media_type=media_type, filename=name)

    @app.delete("/v1/site-scans/{job_id}", dependencies=[Depends(authorize)])
    def delete_scan(job_id: str):
        manager.delete(job_id)
        return {"version": 1, "deleted": True}

    return app
