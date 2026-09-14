from __future__ import annotations

import os
from pathlib import Path
from typing import Any, TypeVar

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from .models import ReasonRequest, ReasonResponse, RelationsRequest, RelationsResponse, SceneResponse
from .request_limits import error_response, limit_json_body
from .scene import default_scene, presets
from .security import PipelineValidationError, validate_pipeline
from .work_gate import WorkBusy, WorkGate


PRODUCTION = os.getenv("APP_ENV", "development") == "production"
WORKER_URL = os.getenv("REASONER_WORKER_URL", "http://reasoner-worker:8001").rstrip("/")
app = FastAPI(
    title="Spatial Reasoner Workbench API",
    version="1.0.0",
    description="Bounded public adapter for bounding-box-based symbolic spatial reasoning.",
    docs_url=None if PRODUCTION else "/docs",
    redoc_url=None if PRODUCTION else "/redoc",
    openapi_url=None if PRODUCTION else "/openapi.json",
)
app.state.work_gate = WorkGate()
cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
if PRODUCTION:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[os.getenv("PUBLIC_HOST", "spatial-reasoner.stevenhaesler.ch"), "127.0.0.1", "localhost"],
    )
app.middleware("http")(limit_json_body)


@app.middleware("http")
async def security_headers(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    if PRODUCTION:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
    return error_response(422, "invalid_request", "The scene request did not match the public API schema")


@app.exception_handler(PipelineValidationError)
async def pipeline_error_handler(_: Request, exc: PipelineValidationError) -> JSONResponse:
    return error_response(400, "unsafe_pipeline", str(exc))


@app.exception_handler(WorkBusy)
async def busy_error_handler(_: Request, __: WorkBusy) -> JSONResponse:
    response = error_response(429, "busy", "The reasoning service is busy; try again shortly")
    response.headers["Retry-After"] = "1"
    return response


class WorkerCallError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


@app.exception_handler(WorkerCallError)
async def worker_error_handler(_: Request, exc: WorkerCallError) -> JSONResponse:
    return error_response(exc.status, exc.code, exc.message)


T = TypeVar("T", bound=BaseModel)


async def call_worker(path: str, request: BaseModel | None, response_type: type[T]) -> T:
    try:
        async with httpx.AsyncClient(timeout=2.8, trust_env=False) as client:
            response = await (client.get(WORKER_URL + path) if request is None else
                              client.post(WORKER_URL + path, json=request.model_dump(mode="json")))
    except httpx.TimeoutException as exc:
        raise WorkerCallError(504, "reasoning_timeout", "Reasoning timed out") from exc
    except httpx.HTTPError as exc:
        raise WorkerCallError(503, "worker_unavailable", "Reasoning worker is unavailable") from exc
    if response.status_code == 504:
        raise WorkerCallError(504, "reasoning_timeout", "Reasoning timed out")
    if response.status_code == 400:
        raise WorkerCallError(400, "reasoning_rejected", "Reasoning request could not be evaluated")
    if response.status_code != 200:
        raise WorkerCallError(503, "worker_unavailable", "Reasoning worker is unavailable")
    try:
        return response_type.model_validate(response.json())
    except (ValueError, ValidationError) as exc:
        raise WorkerCallError(503, "worker_unavailable", "Reasoning worker returned an invalid response") from exc


@app.get("/api/health")
async def health() -> dict[str, str]:
    try:
        async with httpx.AsyncClient(timeout=1.0, trust_env=False) as client:
            response = await client.get(WORKER_URL + "/internal/health")
        if response.status_code != 200:
            raise WorkerCallError(503, "worker_unavailable", "Reasoning worker is unavailable")
    except httpx.HTTPError as exc:
        raise WorkerCallError(503, "worker_unavailable", "Reasoning worker is unavailable") from exc
    return {"status": "ok", "engine": "SRpy", "reasoning": "bounding-box symbolic"}


@app.get("/api/scene/default", response_model=SceneResponse)
def get_default_scene() -> SceneResponse:
    return SceneResponse(objects=default_scene(), presets=presets(), defaultPresetId="left-of-laptop")


@app.post("/api/reason", response_model=ReasonResponse)
async def reason(request: ReasonRequest) -> ReasonResponse:
    canonical = " | ".join(validate_pipeline(request.pipeline))
    validated = request.model_copy(update={"pipeline": canonical})
    async with app.state.work_gate.ticket():
        return await call_worker("/internal/reason", validated, ReasonResponse)


@app.post("/api/relations", response_model=RelationsResponse)
async def relations(request: RelationsRequest) -> RelationsResponse:
    async with app.state.work_gate.ticket():
        return await call_worker("/internal/relations", request, RelationsResponse)


frontend_dist = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "dist"))
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
