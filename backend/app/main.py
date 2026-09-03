from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .models import (
    ReasonRequest,
    ReasonResponse,
    RelationsRequest,
    RelationsResponse,
    SceneResponse,
)
from .scene import default_scene, presets
from .security import PipelineValidationError
from .srpy_adapter import reason_scene, relations_for_object


app = FastAPI(
    title="Spatial Reasoner Workbench API",
    version="1.0.0",
    description="Local adapter for bounding-box-based symbolic spatial reasoning with SRpy.",
)
cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {
                "code": "invalid_request",
                "message": "The scene request did not match the API schema.",
                "details": exc.errors(),
            },
        },
    )


@app.exception_handler(PipelineValidationError)
async def pipeline_error_handler(_: Request, exc: PipelineValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"success": False, "error": {"code": "unsafe_pipeline", "message": str(exc)}},
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "engine": "SRpy", "reasoning": "bounding-box symbolic"}


@app.get("/api/scene/default", response_model=SceneResponse)
def get_default_scene() -> SceneResponse:
    return SceneResponse(objects=default_scene(), presets=presets(), defaultPresetId="left-of-laptop")


@app.post("/api/reason", response_model=ReasonResponse)
def reason(request: ReasonRequest) -> ReasonResponse:
    return reason_scene(request)


@app.post("/api/relations", response_model=RelationsResponse)
def relations(request: RelationsRequest) -> RelationsResponse:
    try:
        return relations_for_object(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_object", "message": str(exc)}) from exc


frontend_dist = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "dist"))
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
