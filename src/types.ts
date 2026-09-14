export interface SpatialObjectData {
  id: string;
  label: string;
  type: string;
  supertype: string;
  position: [number, number, number];
  center?: [number, number, number];
  width: number;
  height: number;
  depth: number;
  angle: number;
  yaw?: number;
  volume?: number;
  nearbyRadius?: number;
  immobile: boolean;
  existence?: string;
  cause?: string;
  shape?: string;
  look?: string;
  visible?: boolean;
  focused?: boolean;
  visualKind?: string;
  color?: string;
  [key: string]: unknown;
}

export interface ObjectGeometryInput {
  id: string;
  position: [number, number, number];
  width: number;
  height: number;
  depth: number;
  angle: number;
}

export interface Preset {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  pipeline: string;
  focusPredicate: string;
}

export interface SpatialRelationData {
  subjectId: string;
  predicate: string;
  objectId: string;
  description: string;
  delta: number;
  yaw: number;
}

export interface RelationWarningData {
  subjectId: string;
  referenceId: string;
  category: "similarity";
}

export interface TraceStage {
  operation: string;
  inputIds: string[];
  outputIds: string[];
  succeeded: boolean;
  error: string | null;
}

export interface ReasonResponse {
  success: boolean;
  resultIds: string[];
  objects: SpatialObjectData[];
  relations: SpatialRelationData[];
  relationScopeIds: string[];
  relationWarnings?: RelationWarningData[];
  trace: TraceStage[];
  timingMs: number;
  error: string | null;
}

export interface RelationsResponse {
  success: boolean;
  objectId: string;
  relations: SpatialRelationData[];
  relationWarnings?: RelationWarningData[];
  timingMs: number;
}

export interface SceneResponse {
  objects: SpatialObjectData[];
  presets: Preset[];
  defaultPresetId: string;
}

export interface ReasonSettings {
  nearbySchema: "fixed" | "circle" | "sphere" | "perimeter" | "area";
  nearbyFactor: number;
  nearbyLimit: number;
  sectorFactor: number;
  maxGap: number;
}
