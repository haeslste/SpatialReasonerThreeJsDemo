from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_and_default_scene() -> None:
    assert client.get("/api/health").json()["engine"] == "SRpy"
    scene = client.get("/api/scene/default")
    assert scene.status_code == 200
    assert scene.json()["defaultPresetId"] == "left-of-laptop"


def test_reason_and_relations_endpoints() -> None:
    scene = client.get("/api/scene/default").json()
    response = client.post(
        "/api/reason",
        json={"objects": scene["objects"], "pipeline": scene["presets"][0]["pipeline"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["trace"]
    assert body["relations"]

    relations = client.post(
        "/api/relations", json={"objects": scene["objects"], "objectId": "laptop"}
    )
    assert relations.status_code == 200
    assert relations.json()["objectId"] == "laptop"


def test_rejects_unrestricted_execution_surface() -> None:
    scene = client.get("/api/scene/default").json()
    response = client.post(
        "/api/reason",
        json={"objects": scene["objects"], "pipeline": "filter(__import__('os'))"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsafe_pipeline"

