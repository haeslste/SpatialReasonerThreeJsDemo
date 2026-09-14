import type { ObjectGeometryInput, ReasonResponse, ReasonSettings, RelationsResponse, SceneResponse, SpatialObjectData } from "./types";

const API_ROOT = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const rawError = payload.error;
    const message =
      typeof rawError === "object" && rawError && "message" in rawError
        ? String((rawError as { message: unknown }).message)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function getHealth(signal?: AbortSignal): Promise<{ status: string; engine: string }> {
  return jsonRequest("/api/health", { signal });
}

export function getDefaultScene(signal?: AbortSignal): Promise<SceneResponse> {
  return jsonRequest("/api/scene/default", { signal });
}

export function reason(
  objects: SpatialObjectData[],
  pipeline: string,
  settings: ReasonSettings,
  focusObjectId?: string | null,
  signal?: AbortSignal,
): Promise<ReasonResponse> {
  return jsonRequest("/api/reason", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objects: toEditableObjects(objects), pipeline, settings, focusObjectId }),
    signal,
  });
}

export function relationsForObject(
  objects: SpatialObjectData[],
  objectId: string,
  settings: ReasonSettings,
  signal?: AbortSignal,
): Promise<RelationsResponse> {
  return jsonRequest("/api/relations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objects: toEditableObjects(objects), objectId, settings }),
    signal,
  });
}

export function toEditableObjects(objects: SpatialObjectData[]): ObjectGeometryInput[] {
  return objects.map((object) => ({
    id: object.id,
    position: [...object.position] as [number, number, number],
    width: object.width,
    height: object.height,
    depth: object.depth,
    angle: object.angle,
  }));
}

/** Reuse authored scene semantics while preserving the user's current geometry. */
export function canonicalSceneInputs(currentObjects: SpatialObjectData[], initialObjects: SpatialObjectData[]): SpatialObjectData[] {
  const initialById = new Map(initialObjects.map((object) => [object.id, object]));
  return currentObjects.map((current) => {
    const baseline = initialById.get(current.id) ?? current;
    return {
      ...baseline,
      position: [...current.position] as [number, number, number],
      width: current.width,
      height: current.height,
      depth: current.depth,
      angle: current.angle,
      immobile: current.immobile,
    };
  });
}

export function normalizeReasonResponse(
  response: ReasonResponse,
  currentObjects: SpatialObjectData[],
): ReasonResponse {
  const currentById = new Map(currentObjects.map((object) => [object.id, object]));
  const objects = response.objects.map((object) => {
    const current = currentById.get(object.id);
    return {
      ...current,
      ...object,
      visualKind: object.visualKind ?? current?.visualKind,
      color: object.color ?? current?.color,
      position: [...object.position] as [number, number, number],
    };
  });
  const ids = new Set(objects.map((object) => object.id));
  return {
    ...response,
    objects,
    resultIds: response.resultIds.filter((id) => ids.has(id)),
    relations: response.relations.filter((relation) => ids.has(relation.subjectId) && ids.has(relation.objectId)),
  };
}
