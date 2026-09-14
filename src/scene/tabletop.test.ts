import { describe, expect, it } from "vitest";
import type { SpatialObjectData } from "../types";
import { withinSupport } from "./collision";
import { carriedTabletopObjects } from "./tabletop";

const box = (id: string, position: [number, number, number], width: number, height: number, depth: number): SpatialObjectData => ({
  id, label: id, type: "Object", supertype: "Object", position, width, height, depth, angle: 0, immobile: false,
});

describe("moving the study work table", () => {
  it("carries tabletop measurements through translation and Y-axis rotation", () => {
    const floor = box("floor", [0, -0.12, 0], 12.6, 0.12, 9.2);
    const table = box("table", [0.25, 0, -2.2], 2.4, 0.76, 1.35);
    const mug = box("mug", [0.55, 0.77, -2.2], 0.34, 0.4, 0.34);
    const nextTable = { ...table, position: [1.25, 0, -1.2] as [number, number, number], angle: Math.PI / 2 };
    const carried = carriedTabletopObjects([floor, table, mug], table, nextTable);
    expect(carried).toHaveLength(1);
    expect(carried[0].position[0]).toBeCloseTo(1.25);
    expect(carried[0].position[2]).toBeCloseTo(-0.9);
    expect(carried[0].angle).toBeCloseTo(Math.PI / 2);
    expect(withinSupport(carried[0], [floor, nextTable])).toBe(true);
  });
});
