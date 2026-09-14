import importlib
import json

import pytest
from fastapi.testclient import TestClient

from app.main import WorkerCallError, app
from app.scene import default_scene
from app.work_gate import WorkGate


client = TestClient(app)
main_module = importlib.import_module("app.main")


def geometry():
    return [
        {key: obj[key] for key in ("id", "position", "width", "height", "depth", "angle")}
        for obj in default_scene()
    ]


def reason_body(pipeline="sort(volume >) | slice(1)"):
    return {"objects": geometry(), "pipeline": pipeline}


def test_default_scene_and_bounded_public_requests(monkeypatch) -> None:
    scene = client.get("/api/scene/default")
    assert scene.status_code == 200
    assert scene.json()["defaultPresetId"] == "left-of-laptop"

    calls = []

    async def fake_worker(path, request, response_type):
        calls.append((path, request))
        if path == "/internal/reason":
            return response_type.model_validate({
                "success": True, "resultIds": ["floor"], "objects": [], "relations": [],
                "trace": [], "timingMs": 1.0,
            })
        return response_type.model_validate({
            "success": True, "objectId": request.objectId, "relations": [], "timingMs": 1.0,
        })

    monkeypatch.setattr(main_module, "call_worker", fake_worker)
    response = client.post("/api/reason", json=reason_body())
    assert response.status_code == 200
    assert response.json()["resultIds"] == ["floor"]
    assert calls[0][1].pipeline == "sort(volume >) | slice(1)"
    assert set(calls[0][1].objects[0].model_dump()) == {"id", "position", "width", "height", "depth", "angle"}

    relations = client.post("/api/relations", json={"objects": geometry(), "objectId": "laptop"})
    assert relations.status_code == 200
    assert relations.json()["objectId"] == "laptop"


@pytest.mark.parametrize("mutation", ["extra", "missing", "duplicate", "unknown", "wrong_type", "huge", "nonfinite"])
def test_rejects_malformed_scene(mutation: str) -> None:
    request = reason_body()
    if mutation == "extra":
        request["objects"][0]["label"] = "Injected label"
    elif mutation == "missing":
        request["objects"].pop()
    elif mutation == "duplicate":
        request["objects"][0]["id"] = request["objects"][1]["id"]
    elif mutation == "unknown":
        request["objects"][0]["id"] = "visitor_added"
    elif mutation == "wrong_type":
        request["objects"][0]["width"] = "1"
    elif mutation == "huge":
        request["objects"][0]["position"][0] = 1_000_000
    else:
        request["objects"][0]["position"][0] = float("nan")
    if mutation == "nonfinite":
        response = client.post("/api/reason", content=json.dumps(request), headers={"Content-Type": "application/json"})
    else:
        response = client.post("/api/reason", json=request)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert "Injected label" not in response.text


def test_rejects_unknown_settings_and_reference() -> None:
    request = reason_body()
    request["settings"] = {"nearbyFactor": 99}
    assert client.post("/api/reason", json=request).status_code == 422
    request = reason_body()
    request["focusObjectId"] = "not_authored"
    assert client.post("/api/reason", json=request).status_code == 422
    assert client.post("/api/relations", json={"objects": geometry(), "objectId": "not_authored"}).status_code == 422


@pytest.mark.parametrize("pipeline", [
    "filter(__import__('os'))",
    "filter(id.__class__ == 'x')",
    "filter(width > 2**1000000)",
    "filter(id == 'x' * 1000000)",
    "map(volumeLitres = width ** 1000000)",
    "filter(width > 1e999)",
])
def test_rejects_unrestricted_execution_surface(pipeline: str) -> None:
    response = client.post("/api/reason", json=reason_body(pipeline))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsafe_pipeline"
    assert "Traceback" not in response.text


def test_rejects_oversized_content_length_and_streamed_body() -> None:
    oversized = b"x" * (64 * 1024 + 1)
    response = client.post("/api/reason", content=oversized, headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
    streamed = client.post(
        "/api/reason",
        content=iter([b" " * 40_000, b" " * 30_000]),
        headers={"Content-Type": "application/json"},
    )
    assert streamed.status_code == 413


def test_busy_timeout_and_worker_offline_are_distinct(monkeypatch) -> None:
    monkeypatch.setattr(app.state, "work_gate", WorkGate(rate=0, burst=0))
    busy = client.post("/api/reason", json=reason_body())
    assert busy.status_code == 429
    assert busy.headers["retry-after"] == "1"
    assert busy.json()["error"]["code"] == "busy"

    monkeypatch.setattr(app.state, "work_gate", WorkGate())

    async def timed_out(*_):
        raise WorkerCallError(504, "reasoning_timeout", "Reasoning timed out")

    monkeypatch.setattr(main_module, "call_worker", timed_out)
    timeout = client.post("/api/reason", json=reason_body())
    assert timeout.status_code == 504
    assert timeout.json()["error"]["code"] == "reasoning_timeout"

    async def unavailable(*_):
        raise WorkerCallError(503, "worker_unavailable", "Reasoning worker is unavailable")

    monkeypatch.setattr(main_module, "call_worker", unavailable)
    offline = client.post("/api/reason", json=reason_body())
    assert offline.status_code == 503
    assert offline.json()["error"]["code"] == "worker_unavailable"
