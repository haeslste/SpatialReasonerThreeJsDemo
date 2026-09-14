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
    assert body["relationScopeIds"] == ["laptop"]
    assert len(body["relations"]) < 500

    focused = client.post(
        "/api/reason",
        json={"objects": scene["objects"], "pipeline": scene["presets"][0]["pipeline"], "focusObjectId": "bed"},
    )
    assert focused.status_code == 200
    assert focused.json()["relationScopeIds"] == ["laptop", "bed"]

    relations = client.post(
        "/api/relations", json={"objects": scene["objects"], "objectId": "laptop"}
    )
    assert relations.status_code == 200
    assert relations.json()["objectId"] == "laptop"


def test_relations_survive_srpy_missing_sameperimeter_predicate() -> None:
    objects = [
        {"id": "reference", "label": "Reference", "type": "Box", "supertype": "Object", "position": [0, 0, 0], "width": 1, "height": 1, "depth": 1},
        {"id": "subject", "label": "Subject", "type": "Box", "supertype": "Object", "position": [4, 0, 0], "width": 1, "height": 1, "depth": 2},
    ]
    response = client.post("/api/relations", json={"objects": objects, "objectId": "reference"})
    assert response.status_code == 200
    body = response.json()
    assert body["relations"]
    assert not any(relation["predicate"] == "same perimeter" for relation in body["relations"])
    assert body["relationWarnings"] == [{"subjectId": "subject", "referenceId": "reference", "category": "similarity"}]

    pipeline = client.post("/api/reason", json={"objects": objects, "pipeline": "deduce(similarity) | slice(1)"})
    assert pipeline.status_code == 200
    assert pipeline.json()["resultIds"] == ["reference"]
    assert pipeline.json()["relationWarnings"] == body["relationWarnings"]


def test_rejects_unrestricted_execution_surface() -> None:
    scene = client.get("/api/scene/default").json()
    response = client.post(
        "/api/reason",
        json={"objects": scene["objects"], "pipeline": "filter(__import__('os'))"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsafe_pipeline"
