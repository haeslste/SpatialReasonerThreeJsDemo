import type { SpatialObjectData, SpatialRelationData } from "./types";

export interface GraphEdge {
  relation: SpatialRelationData;
  peerId: string;
  relationCount: number;
  predicates: string[];
}

export interface GraphPoint {
  x: number;
  y: number;
}

const CONTACT = new Set(["inside", "containing", "touching", "overlapping", "meeting", "on", "in", "by"]);
const PROXIMITY = new Set(["near", "tangible"]);
const DIRECTION = new Set(["left", "right", "above", "below", "ahead", "behind", "seen left", "seen right", "in front", "at rear"]);

function relationPriority(predicate: string): number {
  if (CONTACT.has(predicate)) return 0;
  if (PROXIMITY.has(predicate)) return 1;
  if (DIRECTION.has(predicate)) return 2;
  return 3;
}

export function selectedObjectGraphEdges(relations: SpatialRelationData[], selectedId: string, predicateFilter = "all"): GraphEdge[] {
  const byPeer = new Map<string, SpatialRelationData[]>();
  for (const relation of relations) {
    const peerId = relation.subjectId === selectedId ? relation.objectId : relation.objectId === selectedId ? relation.subjectId : null;
    if (!peerId || peerId === selectedId) continue;
    const group = byPeer.get(peerId) ?? [];
    group.push(relation);
    byPeer.set(peerId, group);
  }
  return [...byPeer].flatMap(([peerId, group]) => {
    const matching = predicateFilter === "all" ? group : group.filter((relation) => relation.predicate === predicateFilter);
    if (!matching.length) return [];
    const relation = [...matching].sort((a, b) => relationPriority(a.predicate) - relationPriority(b.predicate) || Math.abs(a.delta) - Math.abs(b.delta) || a.predicate.localeCompare(b.predicate))[0];
    return [{ relation, peerId, relationCount: group.length, predicates: [...new Set(group.map((item) => item.predicate))].sort() }];
  }).sort((a, b) => a.peerId.localeCompare(b.peerId));
}

export function graphPredicateOptions(relations: SpatialRelationData[], selectedId: string): string[] {
  return [...new Set(relations.filter((relation) => relation.subjectId === selectedId || relation.objectId === selectedId).map((relation) => relation.predicate))].sort();
}

export function layoutGraphNodes(objects: SpatialObjectData[], ids: string[], width = 1000, height = 600): Map<string, GraphPoint> {
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const floor = objectById.get("floor");
  const floorWidth = floor?.width ?? 12.6;
  const floorDepth = floor?.depth ?? 9.2;
  const located = [...new Set(ids)].flatMap((id) => {
    const object = objectById.get(id);
    return object ? [{ id, visualX: -object.position[0], visualZ: object.position[2] }] : [];
  });
  const visualXs = located.map((item) => item.visualX);
  const visualZs = located.map((item) => item.visualZ);
  const localFit = located.length > 1 && located.length <= 12;
  const centerX = localFit ? (Math.min(...visualXs) + Math.max(...visualXs)) / 2 : 0;
  const centerZ = localFit ? (Math.min(...visualZs) + Math.max(...visualZs)) / 2 : 0;
  const spanX = localFit ? Math.max(2.9, (Math.max(...visualXs) - Math.min(...visualXs)) * 1.3) : floorWidth;
  const spanZ = localFit ? Math.max(1.8, (Math.max(...visualZs) - Math.min(...visualZs)) * 1.3) : floorDepth;
  const nodes = located.map(({ id, visualX, visualZ }) => {
    const targetX = Math.max(65, Math.min(width - 65, width / 2 + (visualX - centerX) * (width - 130) / spanX));
    const targetY = Math.max(35, Math.min(height - 35, height / 2 + (visualZ - centerZ) * (height - 70) / spanZ));
    return [{ id, x: targetX, y: targetY, targetX, targetY }];
  }).flat();

  for (let iteration = 0; iteration < 105; iteration++) {
    for (const node of nodes) {
      node.x += (node.targetX - node.x) * 0.025;
      node.y += (node.targetY - node.y) * 0.025;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = 111 - Math.abs(dx);
        const overlapY = 37 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX / 111 < overlapY / 37) {
          const shift = overlapX * 0.52 * (dx >= 0 ? 1 : -1);
          a.x -= shift;
          b.x += shift;
        } else {
          const shift = overlapY * 0.52 * (dy >= 0 ? 1 : -1);
          a.y -= shift;
          b.y += shift;
        }
      }
    }
    for (const node of nodes) {
      node.x = Math.max(58, Math.min(width - 58, node.x));
      node.y = Math.max(22, Math.min(height - 22, node.y));
    }
  }
  return new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}
