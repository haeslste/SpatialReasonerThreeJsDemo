from __future__ import annotations

import math
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .scene import DEFAULT_OBJECTS, default_scene


AUTHORED_IDS = frozenset(item["id"] for item in DEFAULT_OBJECTS)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class ObjectGeometryInput(StrictModel):
    """The only object fields accepted from an anonymous visitor."""

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")
    position: List[float] = Field(min_length=3, max_length=3)
    width: float = Field(gt=0.001, le=20)
    height: float = Field(gt=0.001, le=20)
    depth: float = Field(gt=0.001, le=20)
    angle: float = Field(ge=-25.1328, le=25.1328)

    @field_validator("position")
    @classmethod
    def coordinates_are_finite_and_bounded(cls, value: List[float]) -> List[float]:
        if any(not math.isfinite(coordinate) or abs(coordinate) > 50 for coordinate in value):
            raise ValueError("position coordinates must be finite and within ±50 metres")
        return value


class ReasonSettings(StrictModel):
    nearbySchema: Literal["fixed", "circle", "sphere", "perimeter", "area"] = "circle"
    nearbyFactor: float = Field(default=1.25, ge=0.1, le=5.0)
    nearbyLimit: float = Field(default=2.5, ge=0.1, le=10.0)
    sectorFactor: float = Field(default=1.0, ge=0.1, le=3.0)
    maxGap: float = Field(default=0.035, ge=0.001, le=0.25)


def canonical_scene_objects(geometry: List[ObjectGeometryInput]) -> List[Dict[str, Any]]:
    by_id = {item.id: item for item in geometry}
    objects = default_scene()
    for obj in objects:
        pose = by_id[obj["id"]]
        obj.update(pose.model_dump(exclude={"id"}))
    return objects


class SceneRequest(StrictModel):
    objects: List[ObjectGeometryInput] = Field(min_length=2, max_length=48)
    settings: ReasonSettings = Field(default_factory=ReasonSettings)

    @field_validator("objects")
    @classmethod
    def exact_authored_scene(cls, value: List[ObjectGeometryInput]) -> List[ObjectGeometryInput]:
        ids = [item.id for item in value]
        if len(ids) != len(AUTHORED_IDS) or len(set(ids)) != len(ids) or set(ids) != AUTHORED_IDS:
            raise ValueError("objects must contain every authored scene ID exactly once")
        return value


class ReasonRequest(SceneRequest):
    pipeline: str = Field(min_length=1, max_length=800)
    focusObjectId: Optional[str] = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")

    @model_validator(mode="after")
    def focus_is_authored(self) -> "ReasonRequest":
        if self.focusObjectId is not None and self.focusObjectId not in AUTHORED_IDS:
            raise ValueError("focusObjectId must name an authored scene object")
        return self


class RelationsRequest(SceneRequest):
    objectId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")

    @field_validator("objectId")
    @classmethod
    def object_is_authored(cls, value: str) -> str:
        if value not in AUTHORED_IDS:
            raise ValueError("objectId must name an authored scene object")
        return value


class RelationOutput(StrictModel):
    subjectId: str
    predicate: str
    objectId: str
    description: str
    delta: float
    yaw: float


class RelationWarningOutput(StrictModel):
    subjectId: str
    referenceId: str
    category: Literal["similarity"]


class TraceOutput(StrictModel):
    operation: str
    inputIds: List[str]
    outputIds: List[str]
    succeeded: bool
    error: Optional[str] = None


class ReasonResponse(StrictModel):
    success: bool
    resultIds: List[str]
    objects: List[Dict[str, Any]]
    relations: List[RelationOutput]
    relationScopeIds: List[str] = Field(default_factory=list)
    relationWarnings: List[RelationWarningOutput] = Field(default_factory=list)
    trace: List[TraceOutput]
    timingMs: float
    error: Optional[str] = None


class SceneResponse(StrictModel):
    objects: List[Dict[str, Any]]
    presets: List[Dict[str, Any]]
    defaultPresetId: str


class RelationsResponse(StrictModel):
    success: bool
    objectId: str
    relations: List[RelationOutput]
    relationWarnings: List[RelationWarningOutput] = Field(default_factory=list)
    timingMs: float
