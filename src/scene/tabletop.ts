import type { SpatialObjectData } from "../types";

export function carriedTabletopObjects(
  objects: SpatialObjectData[],
  previousTable: SpatialObjectData,
  nextTable: SpatialObjectData,
): SpatialObjectData[] {
  const deltaAngle = nextTable.angle - previousTable.angle;
  const c = Math.cos(deltaAngle);
  const s = Math.sin(deltaAngle);
  const deltaHeight = nextTable.position[1] + nextTable.height - previousTable.position[1] - previousTable.height;
  return objects
    .filter((object) => object.id !== "table" && object.id !== "observer" && object.position[1] > 0.5)
    .map((object) => {
      const relativeX = -object.position[0] + previousTable.position[0];
      const relativeZ = object.position[2] - previousTable.position[2];
      const rotatedX = relativeX * c + relativeZ * s;
      const rotatedZ = -relativeX * s + relativeZ * c;
      const position: [number, number, number] = [
        nextTable.position[0] - rotatedX,
        object.position[1] + deltaHeight,
        nextTable.position[2] + rotatedZ,
      ];
      const angle = Math.atan2(Math.sin(object.angle + deltaAngle), Math.cos(object.angle + deltaAngle));
      return {
        ...object,
        position,
        angle,
        yaw: angle * 180 / Math.PI,
        center: [position[0], position[1] + object.height / 2, position[2]] as [number, number, number],
      };
    });
}
