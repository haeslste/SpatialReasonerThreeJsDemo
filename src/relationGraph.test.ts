import { describe, expect, it } from "vitest";
import type { SpatialObjectData, SpatialRelationData } from "./types";
import { graphPredicateOptions, layoutGraphNodes, selectedObjectGraphEdges } from "./relationGraph";

const relation = (subjectId: string, predicate: string, objectId: string): SpatialRelationData => ({
  subjectId, predicate, objectId, description: "", delta: 1, yaw: 0,
});
const object = (id: string, x: number, z: number): SpatialObjectData => ({
  id, label: id, type: "Object", supertype: "Object", position: [x, 0, z], width: 0.5, height: 0.5, depth: 0.5, angle: 0, immobile: false,
});

describe("selected-object relation graph", () => {
  const relations = [
    relation("chair", "left", "lamp"), relation("chair", "far", "lamp"),
    relation("bed", "right", "lamp"), relation("sofa", "right", "lamp"),
  ];

  it("keeps all peer objects visible while collapsing predicates to one edge per peer", () => {
    const edges = selectedObjectGraphEdges(relations, "lamp");
    expect(edges.map((edge) => edge.peerId)).toEqual(["bed", "chair", "sofa"]);
    expect(edges.find((edge) => edge.peerId === "chair")?.predicates).toEqual(["far", "left"]);
    expect(graphPredicateOptions(relations, "lamp")).toEqual(["far", "left", "right"]);
  });

  it("shows why a left-only view excludes right-side bedroom and living furniture", () => {
    expect(selectedObjectGraphEdges(relations, "lamp", "left").map((edge) => edge.peerId)).toEqual(["chair"]);
    expect(selectedObjectGraphEdges(relations, "lamp", "right").map((edge) => edge.peerId)).toEqual(["bed", "sofa"]);
  });

  it("separates clustered tabletop nodes in the spatial graph layout", () => {
    const objects = [object("floor", 0, 0), object("lamp", 0.2, -2.2), object("mug", 0.22, -2.19), object("book", 0.21, -2.21)];
    const points = layoutGraphNodes(objects, ["lamp", "mug", "book"]);
    const values = [...points.values()];
    expect(points.size).toBe(3);
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        expect(Math.abs(values[i].x - values[j].x) >= 90 || Math.abs(values[i].y - values[j].y) >= 25).toBe(true);
      }
    }
  });
});
