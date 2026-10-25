"""Run: uvicorn workers.arena.app:create_app --factory --host 127.0.0.1 --port 8081 --workers 1."""
from contextlib import asynccontextmanager, suppress
import asyncio
import secrets
import threading
from typing import Any, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .core import ArenaError
from .runtime import SessionManager, Settings
from .recording import RecordingError


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: Literal[1]
    profileId: str = Field(max_length=100)
    robotId: str = Field(max_length=50)
    modelId: str = Field(max_length=50)
    checkpoint: str = Field(max_length=500)
    task: str = Field(max_length=100)
    seed: int = Field(ge=0, le=2147483647)
    protocol: Literal["practice", "benchmark"]


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: Literal[1]
    type: Literal["run", "pause", "step", "reset", "intervene"]
    payload: dict[str, Any] = Field(default_factory=dict)
    requestId: str = Field(min_length=1, max_length=128)


class BodyLimitMiddleware:
    """Bound streamed input before the framework parses JSON, including chunked input."""
    def __init__(self, app, limit=65536):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        messages, total = [], 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] == "http.disconnect":
                return
            total += len(message.get("body", b""))
            if total > self.limit:
                response = JSONResponse(status_code=413, content={"version": 1, "error": {
                    "code": "request_too_large", "message": "Commands are limited to 64 KiB."}})
                await response(scope, receive, send)
                return
            if not message.get("more_body", False):
                break
        async def bounded_receive():
            if messages:
                return messages.pop(0)
            return await receive()
        await self.app(scope, bounded_receive, send)


class ArchiveDownloadMixin:
    """Keep a memory/download slot until ASGI finishes sending or disconnects."""
    release_slot = None

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            if self.release_slot is not None:
                release, self.release_slot = self.release_slot, None
                release()


class ArchiveJSONResponse(ArchiveDownloadMixin, JSONResponse):
    pass


class ArchiveBinaryResponse(ArchiveDownloadMixin, Response):
    pass


def create_app(settings=None, manager=None):
    settings = settings or Settings.from_env()
    settings.validate()
    manager = manager or SessionManager(settings)
    archive = getattr(manager, "archive", None) or settings.recording_archive()
    archive_slots = threading.BoundedSemaphore(2)

    @asynccontextmanager
    async def lifespan(app):
        async def retention():
            while True:
                await asyncio.to_thread(archive.prune)
                await asyncio.sleep(min(60, max(1, settings.recording_retention_seconds / 2)))
        sweep = asyncio.create_task(retention())
        try:
            yield
        finally:
            sweep.cancel()
            with suppress(asyncio.CancelledError):
                await sweep
            manager.close()

    app = FastAPI(title="BrainSNN LIBERO worker", version="1.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins),
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"],
                       allow_credentials=False, max_age=600)

    @app.exception_handler(ArenaError)
    async def arena_error(request, error):
        return JSONResponse(status_code=error.status, content={"version": 1, "error": error.as_dict()})

    @app.exception_handler(RecordingError)
    async def recording_error(request, error):
        return JSONResponse(status_code=error.status, content={"version": 1, "error": {
            "code": error.code, "message": error.message}}, headers={"Cache-Control": "no-store"})

    def check_auth(request, *, read_only=False):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            raise ArenaError("origin_rejected", "This browser origin is not allowed by the worker.", 403)
        supplied = request.headers.get("authorization", "")
        command_access = secrets.compare_digest(supplied, "Bearer " + settings.token)
        read_access = bool(settings.read_token) and secrets.compare_digest(supplied, "Bearer " + settings.read_token)
        if not command_access and not (read_only and read_access):
            raise ArenaError("authentication_required", "Connect using this worker's access token.", 401)

    async def authorize(request: Request):
        check_auth(request)

    async def authorize_read(request: Request):
        check_auth(request, read_only=True)

    @app.get("/v1/capabilities", dependencies=[Depends(authorize_read)])
    def capabilities():
        return manager.capabilities()

    @app.post("/v1/sessions", dependencies=[Depends(authorize)])
    def create_session(body: CreateSession):
        return manager.create(body.model_dump())

    @app.get("/v1/sessions/{session_id}/frame", dependencies=[Depends(authorize)])
    def frame(session_id: str):
        return manager.get(session_id).call("frame")

    @app.post("/v1/sessions/{session_id}/commands", dependencies=[Depends(authorize)])
    def command(session_id: str, body: Command):
        frame = manager.get(session_id).call("command", body.model_dump())
        return {"version": 1, "sessionId": session_id, "requestId": body.requestId, "status": frame["status"], "frame": frame}

    @app.get("/v1/sessions/{session_id}/evidence", dependencies=[Depends(authorize)])
    def evidence(session_id: str):
        return manager.get(session_id).call("evidence")

    @app.delete("/v1/sessions/{session_id}", dependencies=[Depends(authorize)])
    def close_session(session_id: str):
        manager.delete(session_id)
        return {"version": 1, "closed": True}

    @app.get("/v1/recordings", dependencies=[Depends(authorize_read)])
    def recordings(sessionId: str | None = None):
        return JSONResponse(archive.list(sessionId), headers={"Cache-Control": "no-store"})

    @app.get("/v1/recordings/{recording_id}", dependencies=[Depends(authorize_read)])
    def recording_manifest(recording_id: str):
        return JSONResponse(archive.manifest(recording_id), headers={"Cache-Control": "no-store"})

    @app.get("/v1/recordings/{recording_id}/events", dependencies=[Depends(authorize_read)])
    def recording_events(recording_id: str):
        manifest = archive.manifest(recording_id)
        return JSONResponse({"schema": "brainsnn.arena.recording-events.v1", "recordingId": recording_id,
                             "completion": manifest["completion"], "events": manifest["events"]},
                            headers={"Cache-Control": "no-store"})

    @app.get("/v1/recordings/{recording_id}/bundle", dependencies=[Depends(authorize_read)])
    def recording_bundle(recording_id: str):
        if not archive_slots.acquire(blocking=False):
            raise RecordingError("recording_busy", "Two archive downloads are already in progress.", 429)
        try:
            response = ArchiveJSONResponse(archive.bundle(recording_id), headers={"Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="brainsnn-{recording_id}.json"',
                "X-Content-Type-Options": "nosniff"})
            response.release_slot = archive_slots.release
            return response
        except Exception:
            archive_slots.release()
            raise

    @app.get("/v1/recordings/{recording_id}/artifacts/{artifact_id}", dependencies=[Depends(authorize_read)])
    def recording_artifact(recording_id: str, artifact_id: str):
        if not archive_slots.acquire(blocking=False):
            raise RecordingError("recording_busy", "Two archive downloads are already in progress.", 429)
        try:
            artifact, raw = archive.artifact(recording_id, artifact_id)
            response = ArchiveBinaryResponse(raw, media_type=artifact["mediaType"], headers={"Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="{artifact_id}"', "X-Content-Type-Options": "nosniff"})
            response.release_slot = archive_slots.release
            return response
        except Exception:
            archive_slots.release()
            raise

    return app
