from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response


MAX_JSON_BYTES = 64 * 1024


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "error": {"code": code, "message": message}})


async def limit_json_body(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if request.method != "POST" or request.url.path not in {
        "/api/reason", "/api/relations", "/internal/reason", "/internal/relations"
    }:
        return await call_next(request)
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        return error_response(415, "unsupported_media_type", "Send application/json")
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            length = int(declared)
            if length < 0:
                return error_response(400, "invalid_request", "Invalid Content-Length")
            if length > MAX_JSON_BYTES:
                return error_response(413, "payload_too_large", "Scene request exceeds 64 KiB")
        except ValueError:
            return error_response(400, "invalid_request", "Invalid Content-Length")
    total = 0
    chunks: list[bytes] = []
    try:
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_JSON_BYTES:
                    return error_response(413, "payload_too_large", "Scene request exceeds 64 KiB")
                chunks.append(chunk)
    except TimeoutError:
        return error_response(408, "request_timeout", "Scene request took too long to upload")
    # Starlette's downstream request receives the bounded, cached body.
    request._body = b"".join(chunks)
    return await call_next(request)
