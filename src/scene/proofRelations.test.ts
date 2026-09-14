import { describe, expect, it } from "vitest";
import type { ReasonResponse, SpatialRelationData, TraceStage } from "../types";
import { pipelineProofRelations } from "./proofRelations";

const relation = (subjectId: string, predicate: string, objectId: string): SpatialRelationData => ({
  subjectId, predicate, objectId, description: "", delta: 1, yaw: 0,
});
const stage = (operation: string, inputIds: string[], outputIds: string[]): TraceStage => ({
  operation, inputIds, outputIds, succeeded: true, error: null,
});
const query = (resultIds: string[], trace: TraceStage[], relations: SpatialRelationData[]): Pick<ReasonResponse, "success" | "resultIds" | "trace" | "relations"> => ({
  success: true, resultIds, trace, relations,
});

describe("pipeline proof selection", () => {
  it("does not leak a selected lamp's unrelated room relations into left-of-laptop proofs", () => {
    const response = query(
      ["lamp", "mug"],
      [stage("filter(id == 'laptop')", ["lamp", "mug", "laptop"], ["laptop"]), stage("pick(left)", ["laptop"], ["lamp", "mug", "bath_sink"]), stage("filter(supertype != 'Furniture')", ["lamp", "mug", "bath_sink"], ["lamp", "mug"])],
      [relation("bath_sink", "left", "lamp"), relation("bed", "right", "lamp"), relation("lamp", "left", "laptop"), relation("mug", "left", "laptop"), relation("bath_sink", "left", "laptop")],
    );
    expect(pipelineProofRelations(response)).toEqual({
      relations: [relation("lamp", "left", "laptop"), relation("mug", "left", "laptop")],
      referenceIds: ["laptop"], operation: "pick(left)",
    });
  });

  it("matches both predicates in a compound pick, but only for retained results", () => {
    const response = query(
      ["book", "package"],
      [stage("filter(id == 'storage_bin')", ["storage_bin"], ["storage_bin"]), stage("pick(inside OR fitting)", ["storage_bin"], ["book", "package", "mug"])],
      [relation("book", "fitting", "storage_bin"), relation("package", "inside", "storage_bin"), relation("mug", "inside", "storage_bin")],
    );
    expect(pipelineProofRelations(response).relations.map((item) => item.subjectId)).toEqual(["book", "package"]);
  });

  it("prefers the first predicate named by a compound pick when both prove a result", () => {
    const response = query(
      ["package"],
      [stage("filter(id == 'storage_bin')", ["storage_bin"], ["storage_bin"]), stage("pick(inside OR fitting)", ["storage_bin"], ["package"])],
      [relation("package", "fitting", "storage_bin"), relation("package", "inside", "storage_bin")],
    );
    expect(pipelineProofRelations(response).relations.map((item) => item.predicate)).toEqual(["inside"]);
  });

  it("connects meeting results only to objects in the select stage's input set", () => {
    const response = query(
      ["floor", "wall_a", "wall_b"],
      [stage("filter(supertype == 'Building Element')", ["floor", "wall_a", "wall_b", "chair"], ["floor", "wall_a", "wall_b"]), stage("select(meeting)", ["floor", "wall_a", "wall_b"], ["floor", "wall_a", "wall_b"])],
      [relation("chair", "meeting", "floor"), relation("wall_a", "meeting", "floor"), relation("wall_b", "meeting", "floor")],
    );
    expect(pipelineProofRelations(response).relations.map((item) => item.subjectId)).toEqual(["wall_a", "wall_b"]);
  });

  it("does not invent relation edges for scalar sort-and-slice queries", () => {
    expect(pipelineProofRelations(query(["bed"], [stage("sort(volume >)", ["bed", "sofa"], ["bed", "sofa"]), stage("slice(1)", ["bed", "sofa"], ["bed"])], [relation("bed", "bigger", "sofa")])).relations).toEqual([]);
  });
});
