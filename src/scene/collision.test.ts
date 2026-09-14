import { describe, expect, it } from "vitest";
import type { SpatialObjectData } from "../types";
import { boxesOverlap, clampToSupport, firstObserverObstacle, observerMoveGoal, sweepMove, withinSupport } from "./collision";

const box = (id: string, x: number, y: number, z: number, width: number, height: number, depth: number, angle = 0): SpatialObjectData => ({
  id, label: id, type: "Object", supertype: "Object", position: [x, y, z], width, height, depth, angle, immobile: false,
});

describe("measured-box interaction constraints", () => {
  const floor = box("floor", 0, -0.12, 0, 12.6, 0.12, 9.2);
  const table = box("table", 0.25, 0, -2.2, 2.4, 0.76, 1.35);
  const observer = box("observer", 0, 0, 0.8, 0.46, 1.72, 0.34, Math.PI);
  const studyWest = box("study_entry_west", -1.2, 0, 0.22, 1, 1.6, 0.12);
  const studyEast = box("study_entry_east", 1.45, 0, 0.22, 1.5, 1.6, 0.12);

  it("maps left and right keys to the observer's actual left and right", () => {
    const left = observerMoveGoal(observer.position, observer.angle, 0, -1, 1);
    const right = observerMoveGoal(observer.position, observer.angle, 0, 1, 1);
    expect(-left[0]).toBeCloseTo(-1);
    expect(-right[0]).toBeCloseTo(1);

    const turnedLeft = observerMoveGoal(observer.position, Math.PI / 2, 0, -1, 1);
    expect(turnedLeft[2]).toBeCloseTo(observer.position[2] - 1);
  });

  it("allows a supporting contact but detects real oriented-box intersection", () => {
    const laptop = box("laptop", -0.4, 0.76, -2.28, 0.92, 0.52, 0.58);
    expect(boxesOverlap(laptop, table)).toBe(false);
    const mug = box("mug", -0.2, 0.76, -2.3, 0.34, 0.4, 0.34, Math.PI / 4);
    expect(boxesOverlap(laptop, mug)).toBe(true);
  });

  it("passes through the study doorway but stops before the table on a large jump", () => {
    const obstacles = [floor, table, studyWest, studyEast, observer];
    const throughDoor = sweepMove(observer, [0, 0, -1], obstacles);
    expect(throughDoor[2]).toBeCloseTo(-1);
    const atTable = sweepMove({ ...observer, position: throughDoor }, [0, 0, -3.5], obstacles);
    expect(atTable[2]).toBeGreaterThan(-1.4);
    expect(firstObserverObstacle(observer, obstacles, atTable)).toBeNull();
  });

  it("lets the observer walk around the side of the table", () => {
    const obstacles = [floor, table, studyWest, studyEast, observer];
    const entered = sweepMove(observer, [0, 0, -1], obstacles);
    const beside = sweepMove({ ...observer, position: entered }, [-1.35, 0, -1], obstacles);
    const result = sweepMove({ ...observer, position: beside }, [-1.35, 0, -3.5], obstacles);
    expect(result[0]).toBeCloseTo(-1.35);
    expect(result[2]).toBeCloseTo(-3.5);
    expect(firstObserverObstacle(observer, obstacles, result)).toBeNull();
  });

  it("blocks solid wall piers and floor furniture", () => {
    const atPier = { ...observer, position: [-1.2, 0, 1.2] as [number, number, number] };
    const wallStop = sweepMove(atPier, [-1.2, 0, -1], [floor, studyWest, studyEast, atPier]);
    expect(wallStop[2]).toBeGreaterThan(0.4);
    const sofa = box("sofa", -4.4, 0, 1.85, 2.35, 0.82, 1.05);
    const bySofa = { ...observer, position: [-4.4, 0, 3.3] as [number, number, number] };
    const furnitureStop = sweepMove(bySofa, [-4.4, 0, 1.1], [floor, sofa, bySofa]);
    expect(furnitureStop[2]).toBeGreaterThan(2.5);
  });

  it("allows tabletop peers to overlap while keeping them on their support", () => {
    const laptop = box("laptop", -0.4, 0.77, -2.28, 0.92, 0.52, 0.58);
    const mug = box("mug", 1.11, 0.77, -1.89, 0.34, 0.4, 0.34);
    const goal: [number, number, number] = [-0.4, 0.77, -2.28];
    const result = sweepMove(mug, goal, [floor, table, laptop, mug]);
    expect(result[0]).toBeCloseTo(goal[0]);
    expect(result[1]).toBeCloseTo(goal[1]);
    expect(result[2]).toBeCloseTo(goal[2]);
    expect(boxesOverlap({ ...mug, position: result }, laptop)).toBe(true);
    expect(withinSupport({ ...mug, width: 4 }, [floor, table])).toBe(false);
    expect(clampToSupport(mug, [99, 0.77, 99], [floor, table])[0]).toBeLessThan(1.45);
  });

  it("keeps tabletop objects within a rotated work table", () => {
    const rotatedTable = { ...table, angle: Math.PI / 2 };
    const mug = box("mug", 1.15, 0.77, -2.2, 0.34, 0.4, 0.34);
    expect(withinSupport(mug, [floor, rotatedTable])).toBe(false);
    const position = clampToSupport(mug, mug.position, [floor, rotatedTable]);
    expect(position[0]).toBeLessThan(0.8);
    expect(withinSupport({ ...mug, position }, [floor, rotatedTable])).toBe(true);
  });

  it("allows package and bin overlap without special-case collision rules", () => {
    const bin = box("storage_bin", 0.49, 0.77, -1.91, 0.76, 0.46, 0.62);
    const parcel = box("package", 0.48, 0.82, -1.9, 0.3, 0.2, 0.24);
    expect(boxesOverlap(bin, parcel)).toBe(true);
    const goal: [number, number, number] = [0.6, 0.82, -1.9];
    expect(sweepMove(parcel, goal, [floor, table, bin, parcel])).toEqual(goal);
  });
});
