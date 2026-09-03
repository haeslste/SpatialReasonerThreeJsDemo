import { describe, expect, it } from "vitest";

import { normalizeReasonResponse, toEditableObjects } from "./api";
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

  it("sends only editable SRpy inputs and display metadata", () => {
    const editable = toEditableObjects([{ ...object, volume: 99, center: [0, 1, 0] }]);
    expect(editable[0]).not.toHaveProperty("volume");
    expect(editable[0]).not.toHaveProperty("center");
    expect(editable[0].visualKind).toBe("mug");
  });
});
