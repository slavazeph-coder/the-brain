"""Run: uvicorn workers.arena.app:create_app --factory --host 127.0.0.1 --port 8081 --workers 1."""
from contextlib import asynccontextmanager
import secrets
from typing import Any, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .core import ArenaError
from .runtime import SessionManager, Settings


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


def create_app(settings=None, manager=None):
    settings = settings or Settings.from_env()
    settings.validate()
    manager = manager or SessionManager(settings)

    @asynccontextmanager
    async def lifespan(app):
        yield
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

    async def authorize(request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            raise ArenaError("origin_rejected", "This browser origin is not allowed by the worker.", 403)
        supplied = request.headers.get("authorization", "")
        if not secrets.compare_digest(supplied, "Bearer " + settings.token):
            raise ArenaError("authentication_required", "Connect using this worker's access token.", 401)

    @app.get("/v1/capabilities", dependencies=[Depends(authorize)])
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

    return app
