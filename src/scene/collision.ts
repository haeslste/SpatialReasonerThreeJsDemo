import type { SpatialObjectData } from "../types";

const GAP = 0.012;
const EPSILON = 1e-6;

type Position = [number, number, number];

export function observerMoveGoal(position: Position, angle: number, forward: number, strafe: number, step: number): Position {
  // SRpy's x axis is mirrored by the renderer. Positive strafe is the
  // observer's right, not the camera's or the unmirrored coordinate frame's.
  return [
    position[0] + (-Math.sin(angle) * forward + Math.cos(angle) * strafe) * step,
    position[1],
    position[2] + (Math.cos(angle) * forward + Math.sin(angle) * strafe) * step,
  ];
}

function footprint(object: SpatialObjectData, position: Position = object.position): [number, number][] {
  // Match WorkbenchScene's mirrored x axis and its Three.js yaw convention.
  const c = Math.cos(object.angle);
  const s = Math.sin(object.angle);
  const halfWidth = object.width / 2;
  const halfDepth = object.depth / 2;
  return ([[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]] as [number, number][])
    .map(([x, z]) => [-position[0] + x * c + z * s, position[2] - x * s + z * c]);
}

function projected(points: [number, number][], axis: [number, number]): [number, number] {
  const values = points.map(([x, z]) => x * axis[0] + z * axis[1]);
  return [Math.min(...values), Math.max(...values)];
}

export function boxesOverlap(a: SpatialObjectData, b: SpatialObjectData, aPosition: Position = a.position): boolean {
  const aBottom = aPosition[1];
  const aTop = aBottom + a.height;
  const bBottom = b.position[1];
  const bTop = bBottom + b.height;
  // Face contact is allowed: e.g. a laptop resting on the table.
  if (aTop <= bBottom + EPSILON || bTop <= aBottom + EPSILON) return false;

  const aPoints = footprint(a, aPosition);
  const bPoints = footprint(b);
  for (const points of [aPoints, bPoints]) {
    for (let index = 0; index < 2; index++) {
      const p = points[index];
      const q = points[index + 1];
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const axis: [number, number] = [-dz, dx];
      const [aMin, aMax] = projected(aPoints, axis);
      const [bMin, bMax] = projected(bPoints, axis);
      const separation = GAP * Math.hypot(axis[0], axis[1]);
      if (aMax + separation <= bMin || bMax + separation <= aMin) return false;
    }
  }
  return true;
}

export function firstObserverObstacle(candidate: SpatialObjectData, objects: Iterable<SpatialObjectData>, position: Position = candidate.position): SpatialObjectData | null {
  if (candidate.id !== "observer") return null;
  for (const object of objects) {
    if (object.id !== "observer" && object.id !== "floor" && boxesOverlap(candidate, object, position)) return object;
  }
  return null;
}

function supportFor(candidate: SpatialObjectData, objects: Iterable<SpatialObjectData>): SpatialObjectData | undefined {
  const id = candidate.position[1] > 0.5 && candidate.id !== "observer" ? "table" : "floor";
  for (const object of objects) if (object.id === id) return object;
  return undefined;
}

function supportCoordinates(candidate: SpatialObjectData, position: Position, support: SpatialObjectData) {
  const c = Math.cos(support.angle);
  const s = Math.sin(support.angle);
  const dx = -position[0] + support.position[0];
  const dz = position[2] - support.position[2];
  const localX = dx * c - dz * s;
  const localZ = dx * s + dz * c;
  const relative = candidate.angle - support.angle;
  const rc = Math.abs(Math.cos(relative));
  const rs = Math.abs(Math.sin(relative));
  const xExtent = (candidate.width * rc + candidate.depth * rs) / 2;
  const zExtent = (candidate.width * rs + candidate.depth * rc) / 2;
  return { c, s, localX, localZ, xExtent, zExtent };
}

export function clampToSupport(candidate: SpatialObjectData, position: Position, objects: Iterable<SpatialObjectData>): Position {
  const support = supportFor(candidate, objects);
  if (!support) return position;

  const { c, s, localX, localZ, xExtent, zExtent } = supportCoordinates(candidate, position, support);
  const xLimit = Math.max(0, support.width / 2 - xExtent - GAP);
  const zLimit = Math.max(0, support.depth / 2 - zExtent - GAP);
  const clampedX = Math.max(-xLimit, Math.min(xLimit, localX));
  const clampedZ = Math.max(-zLimit, Math.min(zLimit, localZ));
  const visualX = -support.position[0] + clampedX * c + clampedZ * s;
  const visualZ = support.position[2] - clampedX * s + clampedZ * c;
  return [
    -visualX,
    position[1],
    visualZ,
  ];
}

export function withinSupport(candidate: SpatialObjectData, objects: Iterable<SpatialObjectData>): boolean {
  const list = [...objects];
  const support = supportFor(candidate, list);
  if (support) {
    const { xExtent, zExtent } = supportCoordinates(candidate, candidate.position, support);
    if (xExtent + GAP > support.width / 2 + EPSILON || zExtent + GAP > support.depth / 2 + EPSILON) return false;
  }
  const clamped = clampToSupport(candidate, candidate.position, list);
  return Math.abs(clamped[0] - candidate.position[0]) < EPSILON && Math.abs(clamped[2] - candidate.position[2]) < EPSILON;
}

export function sweepMove(candidate: SpatialObjectData, goal: Position, objects: Iterable<SpatialObjectData>): Position {
  const list = [...objects];
  const target = clampToSupport(candidate, goal, list);
  const start = candidate.position;
  const distance = Math.hypot(target[0] - start[0], target[2] - start[2]);
  const steps = Math.max(1, Math.ceil(distance / 0.025));
  let last: Position = [...start];
  for (let step = 1; step <= steps; step++) {
    const ratio = step / steps;
    const point: Position = [start[0] + (target[0] - start[0]) * ratio, start[1], start[2] + (target[2] - start[2]) * ratio];
    if (firstObserverObstacle(candidate, list, point)) break;
    last = point;
  }
  return last;
}
