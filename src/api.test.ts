import { describe, expect, it } from "vitest";

import { canonicalSceneInputs, normalizeReasonResponse, toEditableObjects } from "./api";
import type { ReasonResponse, SpatialObjectData } from "./types";

const object: SpatialObjectData = {
  id: "mug",
  label: "Mug",
  type: "Mug",
  supertype: "Container",
  position: [0, 0.77, 0],
  width: 0.3,
  height: 0.4,
  depth: 0.3,
  angle: 0,
  immobile: false,
  visualKind: "mug",
};

describe("API response mapping", () => {
  it("preserves client display metadata while accepting backend geometry", () => {
    const response: ReasonResponse = {
      success: true,
      resultIds: ["mug", "missing"],
      objects: [{ ...object, position: [1, 0.77, 0], visualKind: undefined }],
      relations: [
        { subjectId: "mug", predicate: "left", objectId: "mug", description: "demo", delta: 1, yaw: 0 },
        { subjectId: "missing", predicate: "near", objectId: "mug", description: "bad", delta: 1, yaw: 0 },
      ],
      relationScopeIds: ["mug"],
      trace: [],
      timingMs: 1,
      error: null,
    };
    const normalized = normalizeReasonResponse(response, [object]);
    expect(normalized.objects[0].visualKind).toBe("mug");
    expect(normalized.objects[0].position[0]).toBe(1);
    expect(normalized.resultIds).toEqual(["mug"]);
    expect(normalized.relations).toHaveLength(1);
  });

  it("sends only geometry and stable IDs", () => {
    const editable = toEditableObjects([{ ...object, volume: 99, center: [0, 1, 0] }]);
    expect(editable[0]).toEqual({ id: "mug", position: [0, 0.77, 0], width: 0.3, height: 0.4, depth: 0.3, angle: 0 });
  });

  it("keeps edited geometry but does not carry deductions from one query into the next", () => {
    const baseline = { ...object, visible: false, focused: false, cause: "authored" };
    const afterReasoning = {
      ...object,
      position: [2, 0.77, 1] as [number, number, number],
      width: 0.45,
      angle: Math.PI / 2,
      visible: true,
      focused: true,
      cause: "inferred",
      nearbyRadius: 4,
    };
    const input = canonicalSceneInputs([afterReasoning], [baseline])[0];
    expect(input).toMatchObject({ position: [2, 0.77, 1], width: 0.45, angle: Math.PI / 2, visible: false, focused: false, cause: "authored" });
    expect(input).not.toHaveProperty("nearbyRadius");
  });
});
