from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .engine_pool import EnginePool, EngineRejected, EngineTimeout, EngineUnavailable
from .models import ReasonRequest, ReasonResponse, RelationsRequest, RelationsResponse
from .request_limits import error_response, limit_json_body
from .security import PipelineValidationError, validate_pipeline


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine_pool = EnginePool(size=2)
    try:
        yield
    finally:
        app.state.engine_pool.close()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.middleware("http")(limit_json_body)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
    return error_response(422, "invalid_request", "Invalid internal scene request")


@app.exception_handler(PipelineValidationError)
async def pipeline_error_handler(_: Request, __: PipelineValidationError) -> JSONResponse:
    return error_response(400, "unsafe_pipeline", "Invalid internal pipeline")


@app.exception_handler(EngineTimeout)
async def timeout_error_handler(_: Request, __: EngineTimeout) -> JSONResponse:
    return error_response(504, "reasoning_timeout", "Reasoning timed out")


@app.exception_handler(EngineUnavailable)
async def unavailable_error_handler(_: Request, __: EngineUnavailable) -> JSONResponse:
    return error_response(503, "worker_unavailable", "Reasoning child is unavailable")


@app.exception_handler(EngineRejected)
async def rejected_error_handler(_: Request, __: EngineRejected) -> JSONResponse:
    return error_response(400, "reasoning_rejected", "Reasoning request could not be evaluated")


@app.get("/internal/health", response_model=None)
def health() -> JSONResponse | dict[str, str]:
    if not app.state.engine_pool.healthy():
        return error_response(503, "worker_unavailable", "Reasoning child is unavailable")
    return {"status": "ok"}


@app.post("/internal/reason", response_model=ReasonResponse)
def reason(request: ReasonRequest) -> dict[str, Any]:
    canonical = " | ".join(validate_pipeline(request.pipeline))
    validated = request.model_copy(update={"pipeline": canonical})
    return app.state.engine_pool.run("reason", validated.model_dump(mode="json"))


@app.post("/internal/relations", response_model=RelationsResponse)
def relations(request: RelationsRequest) -> dict[str, Any]:
    return app.state.engine_pool.run("relations", request.model_dump(mode="json"))
