from __future__ import annotations

import time
from typing import Any, Dict, Iterable, List, Optional, Sequence

from spatial_reasoner import NearbySchema, SectorSchema, SpatialObject, SpatialReasoner

from .models import (
    ReasonRequest,
    ReasonResponse,
    RelationOutput,
    RelationsRequest,
    RelationsResponse,
    TraceOutput,
)
from .security import validate_pipeline


def _build_reasoner(objects: Sequence[Any], settings: Any) -> SpatialReasoner:
    reasoner = SpatialReasoner()
    reasoner.adjustment.nearbySchema = NearbySchema.named(settings.nearbySchema) or NearbySchema.circle
    reasoner.adjustment.nearbyFactor = settings.nearbyFactor
    reasoner.adjustment.nearbyLimit = settings.nearbyLimit
    reasoner.adjustment.sectorSchema = SectorSchema.nearby
    reasoner.adjustment.sectorFactor = settings.sectorFactor
    reasoner.adjustment.maxGap = settings.maxGap

    spatial_objects: List[SpatialObject] = []
    for payload in objects:
        data = payload.model_dump(exclude_none=True)
        obj = SpatialObject(id=data["id"])
        obj.fromAny(data)
        spatial_objects.append(obj)
    reasoner.load(spatial_objects)
    return reasoner


def _relation_output(relation: Any) -> RelationOutput:
    return RelationOutput(
        subjectId=relation.subject_id,
        predicate=relation.predicate.value,
        objectId=relation.object_id,
        description=relation.desc(),
        delta=round(float(relation.delta), 6),
        yaw=round(float(relation.yaw), 4),
    )


def _all_relations(reasoner: SpatialReasoner, only_id: Optional[str] = None) -> List[RelationOutput]:
    output: List[RelationOutput] = []
    seen = set()
    for index, obj in enumerate(reasoner.objects):
        if only_id is not None and obj.id != only_id:
            continue
        for relation in reasoner.relations_of(index):
            key = (relation.subject_id, relation.predicate.value, relation.object_id)
            if key not in seen:
                seen.add(key)
                output.append(_relation_output(relation))
    output.sort(key=lambda item: (item.objectId, item.subjectId, item.predicate))
    return output


def _ids(indices: Iterable[int], object_ids: Sequence[str]) -> List[str]:
    return [object_ids[index] for index in indices if 0 <= index < len(object_ids)]


def _serialized_objects(reasoner: SpatialReasoner) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    for obj in reasoner.objects:
        data = obj.asDict()
        data["nearbyRadius"] = round(float(obj.nearbyRadius()), 6)
        output.append(data)
    return output


def _trace(reasoner: SpatialReasoner, operations: Sequence[str], original_ids: Sequence[str]) -> List[TraceOutput]:
    output: List[TraceOutput] = []
    inference_index = 0
    current_ids = list(original_ids)
    for operation in operations:
        if operation.startswith("deduce("):
            output.append(
                TraceOutput(
                    operation=operation,
                    inputIds=current_ids,
                    outputIds=current_ids,
                    succeeded=True,
                )
            )
            continue
        inference = reasoner.chain[inference_index] if inference_index < len(reasoner.chain) else None
        inference_index += 1
        if inference is None:
            output.append(
                TraceOutput(
                    operation=operation,
                    inputIds=current_ids,
                    outputIds=[],
                    succeeded=False,
                    error="Operation was not reached",
                )
            )
            current_ids = []
            continue
        input_ids = _ids(inference.input, original_ids)
        result_ids = _ids(inference.output, [obj.id for obj in reasoner.objects])
        output.append(
            TraceOutput(
                operation=operation,
                inputIds=input_ids,
                outputIds=result_ids,
                succeeded=not bool(inference.error),
                error=inference.error or None,
            )
        )
        current_ids = result_ids
    return output


def reason_scene(request: ReasonRequest) -> ReasonResponse:
    started = time.perf_counter()
    operations = validate_pipeline(request.pipeline)
    reasoner = _build_reasoner(request.objects, request.settings)
    original_ids = [obj.id for obj in reasoner.objects]
    reasoner.run(request.pipeline)
    result_ids = [obj.id for obj in reasoner.result()]
    trace = _trace(reasoner, operations, original_ids)
    failed = next((step.error for step in trace if step.error), None)

    # SpatialReasoner.run() syncs its fact base back to objects. Reload to restore
    # object contexts before collecting authoritative pairwise relations.
    reasoner.load(reasoner.objects)
    relations = _all_relations(reasoner)
    elapsed = (time.perf_counter() - started) * 1000.0
    return ReasonResponse(
        success=failed is None,
        resultIds=result_ids if failed is None else [],
        objects=_serialized_objects(reasoner),
        relations=relations,
        trace=trace,
        timingMs=round(elapsed, 3),
        error=failed,
    )


def relations_for_object(request: RelationsRequest) -> RelationsResponse:
    started = time.perf_counter()
    reasoner = _build_reasoner(request.objects, request.settings)
    reasoner.deduce_categories("topology connectivity comparability similarity visibility")
    if reasoner.index_of_id(request.objectId) is None:
        raise ValueError(f"Unknown object ID: {request.objectId}")
    relations = _all_relations(reasoner, only_id=request.objectId)
    return RelationsResponse(
        success=True,
        objectId=request.objectId,
        relations=relations,
        timingMs=round((time.perf_counter() - started) * 1000.0, 3),
    )
