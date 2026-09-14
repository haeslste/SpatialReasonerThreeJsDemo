from __future__ import annotations

import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from spatial_reasoner import NearbySchema, SectorSchema, SpatialObject, SpatialReasoner

from .models import (
    ReasonRequest,
    ReasonResponse,
    RelationOutput,
    RelationWarningOutput,
    RelationsRequest,
    RelationsResponse,
    TraceOutput,
    canonical_scene_objects,
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
    for data in objects:
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


def _relations_of_compatible(reasoner: SpatialReasoner, index: int) -> Tuple[List[Any], List[RelationWarningOutput]]:
    try:
        return reasoner.relations_of(index), []
    except AttributeError as exc:
        if "sameperimeter" not in str(exc):
            raise

    # SRpy 0.1.0 references SpatialPredicate.sameperimeter in similarities(),
    # but the enum does not define it. Retry only the affected subject pairs
    # without similarity; retain all other predicates rather than fabricating
    # a replacement relation or failing the entire graph request.
    reference = reasoner.objects[index]
    relations: List[Any] = []
    warnings: List[RelationWarningOutput] = []
    for subject in reasoner.objects:
        if subject == reference:
            continue
        try:
            relations.extend(reference.relate(subject=subject))
        except AttributeError as exc:
            if "sameperimeter" not in str(exc) or not reference.context or not reference.context.deduce.similarity:
                raise
            deduction = reference.context.deduce
            similarity_enabled = deduction.similarity
            deduction.similarity = False
            try:
                relations.extend(reference.relate(subject=subject))
            finally:
                deduction.similarity = similarity_enabled
            warnings.append(RelationWarningOutput(subjectId=subject.id, referenceId=reference.id, category="similarity"))
    return relations, warnings


def _all_relations(reasoner: SpatialReasoner, only_ids: Optional[Iterable[str]] = None) -> Tuple[List[RelationOutput], List[RelationWarningOutput]]:
    output: List[RelationOutput] = []
    warnings: List[RelationWarningOutput] = []
    seen = set()
    allowed_ids = set(only_ids) if only_ids is not None else None
    for index, obj in enumerate(reasoner.objects):
        if allowed_ids is not None and obj.id not in allowed_ids:
            continue
        raw_relations, skipped = _relations_of_compatible(reasoner, index)
        warnings.extend(skipped)
        for relation in raw_relations:
            key = (relation.subject_id, relation.predicate.value, relation.object_id)
            if key not in seen:
                seen.add(key)
                output.append(_relation_output(relation))
    output.sort(key=lambda item: (item.objectId, item.subjectId, item.predicate))
    return output, warnings


def _relation_scope_ids(trace: Sequence[TraceOutput], result_ids: Sequence[str], focus_id: Optional[str], object_ids: Sequence[str]) -> List[str]:
    scope: List[str] = []
    for index, stage in enumerate(trace):
        if stage.operation.startswith("pick(") and index > 0 and len(trace[index - 1].outputIds) == 1:
            scope.append(trace[index - 1].outputIds[0])
            break
    if not scope and result_ids:
        scope.append(result_ids[0])
    if focus_id in object_ids and focus_id not in scope:
        scope.append(focus_id)
    return scope


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
                error="Stage could not be evaluated" if inference.error else None,
            )
        )
        current_ids = result_ids
    return output


def reason_scene(request: ReasonRequest) -> ReasonResponse:
    started = time.perf_counter()
    operations = validate_pipeline(request.pipeline)
    reasoner = _build_reasoner(canonical_scene_objects(request.objects), request.settings)
    original_ids = [obj.id for obj in reasoner.objects]
    reasoner.run(" | ".join(operations))
    result_ids = [obj.id for obj in reasoner.result()]
    trace = _trace(reasoner, operations, original_ids)
    failed = next((step.error for step in trace if step.error), None)
    relation_scope_ids = _relation_scope_ids(trace, result_ids, request.focusObjectId, original_ids)

    # SpatialReasoner.run() syncs its fact base back to objects. Reload to restore
    # object contexts before collecting authoritative relations. A 42-object
    # global enumeration exceeds 8,000 relations; send only the query reference
    # and selected object's proofs. Other objects are available on demand.
    reasoner.load(reasoner.objects)
    relations, relation_warnings = _all_relations(reasoner, relation_scope_ids)
    elapsed = (time.perf_counter() - started) * 1000.0
    return ReasonResponse(
        success=failed is None,
        resultIds=result_ids if failed is None else [],
        objects=_serialized_objects(reasoner),
        relations=relations,
        relationScopeIds=relation_scope_ids,
        relationWarnings=relation_warnings,
        trace=trace,
        timingMs=round(elapsed, 3),
        error=failed,
    )


def relations_for_object(request: RelationsRequest) -> RelationsResponse:
    started = time.perf_counter()
    reasoner = _build_reasoner(canonical_scene_objects(request.objects), request.settings)
    reasoner.deduce_categories("topology connectivity comparability similarity visibility")
    if reasoner.index_of_id(request.objectId) is None:
        raise ValueError(f"Unknown object ID: {request.objectId}")
    relations, relation_warnings = _all_relations(reasoner, only_ids=[request.objectId])
    return RelationsResponse(
        success=True,
        objectId=request.objectId,
        relations=relations,
        relationWarnings=relation_warnings,
        timingMs=round((time.perf_counter() - started) * 1000.0, 3),
    )
