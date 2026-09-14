export type StageKind = "deduce" | "filter" | "pick" | "select" | "sort" | "slice" | "calc" | "map";

export interface PipelineStage {
  kind: StageKind;
  argument: string;
}

export const STAGE_DEFAULTS: Record<StageKind, string> = {
  deduce: "topology",
  filter: "immobile == False",
  pick: "near",
  select: "meeting",
  sort: "volume >",
  slice: "1",
  calc: "meanHeight = average(objects.height)",
  map: "volumeLitres = volume * 1000.0",
};

export function parsePipeline(pipeline: string): PipelineStage[] | null {
  const source = pipeline.trim();
  if (!source) return [];
  const parts = source.split("|").map((part) => part.trim());
  if (parts.length > 12 || parts.some((part) => !part)) return null;
  const stages: PipelineStage[] = [];
  for (const part of parts) {
    const match = /^([a-z]+)\((.*)\)$/.exec(part);
    if (!match || !(match[1] in STAGE_DEFAULTS)) return null;
    stages.push({ kind: match[1] as StageKind, argument: match[2] });
  }
  return stages;
}

export function serializePipeline(stages: PipelineStage[]): string {
  return stages.map(({ kind, argument }) => `${kind}(${argument.trim()})`).join(" | ");
}
