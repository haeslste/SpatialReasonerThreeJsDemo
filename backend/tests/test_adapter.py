from copy import deepcopy

import pytest

from app.models import ReasonRequest, ReasonSettings
from app.scene import PRESETS, default_scene
from app.security import PipelineValidationError, validate_pipeline
from app.srpy_adapter import reason_scene


def request_for(pipeline: str, objects=None) -> ReasonRequest:
    return ReasonRequest(objects=objects or default_scene(), pipeline=pipeline)


def test_default_scene_matches_spatial_object_schema() -> None:
    response = reason_scene(request_for("sort(volume >) | slice(1)"))
    assert response.success
    assert len(response.objects) == len(default_scene())
    assert response.resultIds == ["floor"]
    assert all("center" in obj and "yaw" in obj and "volume" in obj and "nearbyRadius" in obj for obj in response.objects)


def test_near_radius_parameters_are_evaluated_by_srpy() -> None:
    pipeline = "filter(id == 'mug')"
    fixed = reason_scene(
        ReasonRequest(
            objects=default_scene(),
            pipeline=pipeline,
            settings=ReasonSettings(nearbySchema="fixed", nearbyFactor=0.7, nearbyLimit=5),
        )
    )
    mug = next(obj for obj in fixed.objects if obj["id"] == "mug")
    assert mug["nearbyRadius"] == pytest.approx(0.7)

    capped = reason_scene(
        ReasonRequest(
            objects=default_scene(),
            pipeline=pipeline,
            settings=ReasonSettings(nearbySchema="circle", nearbyFactor=5, nearbyLimit=0.2),
        )
    )
    capped_mug = next(obj for obj in capped.objects if obj["id"] == "mug")
    assert capped_mug["nearbyRadius"] == pytest.approx(0.2)


def test_all_presets_execute_without_adapter_errors() -> None:
    for preset in PRESETS:
        response = reason_scene(request_for(preset["pipeline"]))
        assert response.success, f"{preset['id']}: {response.error}"
        assert response.trace


def test_unsafe_pipeline_is_rejected_before_srpy() -> None:
    with pytest.raises(PipelineValidationError):
        validate_pipeline("filter(id.__class__ == 'x')")
    with pytest.raises(PipelineValidationError):
        validate_pipeline("reload()")


def test_moving_object_changes_left_relation_result() -> None:
    pipeline = next(item["pipeline"] for item in PRESETS if item["id"] == "left-of-laptop")
    before_objects = default_scene()
    before = reason_scene(request_for(pipeline, before_objects))
    assert "mug" in before.resultIds

    after_objects = deepcopy(before_objects)
    mug = next(obj for obj in after_objects if obj["id"] == "mug")
    mug["position"][0] = -1.5
    after = reason_scene(request_for(pipeline, after_objects))
    assert "mug" not in after.resultIds
