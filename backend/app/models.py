from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SpatialObjectInput(BaseModel):
    """Editable subset of SpatialObject.asDict(), plus display-only metadata."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")
    label: str = Field(default="", max_length=80)
    type: str = Field(default="", max_length=80)
    supertype: str = Field(default="", max_length=80)
    position: List[float] = Field(min_length=3, max_length=3)
    width: float = Field(gt=0.001, le=20)
    height: float = Field(gt=0.001, le=20)
    depth: float = Field(gt=0.001, le=20)
    angle: float = Field(default=0.0, ge=-25.1328, le=25.1328)
    existence: str = Field(default="real", max_length=32)
    cause: str = Field(default="unknown", max_length=32)
    immobile: bool = False
    shape: str = Field(default="unknown", max_length=32)
    look: str = Field(default="", max_length=160)
    visible: bool = False
    focused: bool = False
    confidence: Union[float, Dict[str, float]] = Field(default=0.9)

    @field_validator("position")
    @classmethod
    def coordinates_are_bounded(cls, value: List[float]) -> List[float]:
        if any(abs(coordinate) > 50 for coordinate in value):
            raise ValueError("position coordinates must be within ±50 metres")
        return value


class ReasonSettings(BaseModel):
    nearbySchema: Literal["fixed", "circle", "sphere", "perimeter", "area"] = "circle"
    nearbyFactor: float = Field(default=1.25, ge=0.1, le=5.0)
    nearbyLimit: float = Field(default=2.5, ge=0.1, le=10.0)
    sectorFactor: float = Field(default=1.0, ge=0.1, le=3.0)
    maxGap: float = Field(default=0.035, ge=0.001, le=0.25)


class ReasonRequest(BaseModel):
    objects: List[SpatialObjectInput] = Field(min_length=2, max_length=48)
    pipeline: str = Field(min_length=1, max_length=800)
    settings: ReasonSettings = Field(default_factory=ReasonSettings)
    focusObjectId: Optional[str] = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9:_-]+$")

    @field_validator("objects")
    @classmethod
    def ids_are_unique(cls, value: List[SpatialObjectInput]) -> List[SpatialObjectInput]:
        ids = [item.id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("object IDs must be unique")
        return value


class RelationsRequest(BaseModel):
    objects: List[SpatialObjectInput] = Field(min_length=2, max_length=48)
    objectId: str = Field(min_length=1, max_length=64)
    settings: ReasonSettings = Field(default_factory=ReasonSettings)


class RelationOutput(BaseModel):
    subjectId: str
    predicate: str
    objectId: str
    description: str
    delta: float
    yaw: float


class RelationWarningOutput(BaseModel):
    subjectId: str
    referenceId: str
    category: Literal["similarity"]


class TraceOutput(BaseModel):
    operation: str
    inputIds: List[str]
    outputIds: List[str]
    succeeded: bool
    error: Optional[str] = None


class ReasonResponse(BaseModel):
    success: bool
    resultIds: List[str]
    objects: List[Dict[str, Any]]
    relations: List[RelationOutput]
    relationScopeIds: List[str] = Field(default_factory=list)
    relationWarnings: List[RelationWarningOutput] = Field(default_factory=list)
    trace: List[TraceOutput]
    timingMs: float
    error: Optional[str] = None


class SceneResponse(BaseModel):
    objects: List[Dict[str, Any]]
    presets: List[Dict[str, Any]]
    defaultPresetId: str


class RelationsResponse(BaseModel):
    success: bool
    objectId: str
    relations: List[RelationOutput]
    relationWarnings: List[RelationWarningOutput] = Field(default_factory=list)
    timingMs: float
