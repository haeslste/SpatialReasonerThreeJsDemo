import type { ReasonResponse, SpatialRelationData } from "../types";

export interface PipelineProof {
  relations: SpatialRelationData[];
  referenceIds: string[];
  operation: string | null;
}

function predicateKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function operationPredicates(argument: string): string[] {
  return argument
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => predicateKey(part.replace(/[()]/g, "")))
    .filter(Boolean);
}

export function pipelineProofRelations(response: Pick<ReasonResponse, "success" | "resultIds" | "trace" | "relations">): PipelineProof {
  const empty: PipelineProof = { relations: [], referenceIds: [], operation: null };
  if (!response.success) return empty;

  let stageIndex = -1;
  let kind = "";
  let argument = "";
  for (let index = 0; index < response.trace.length; index++) {
    const match = /^(pick|select)\((.*)\)$/.exec(response.trace[index].operation);
    if (match) {
      stageIndex = index;
      kind = match[1];
      argument = match[2];
    }
  }
  if (stageIndex < 0) return empty;

  const stage = response.trace[stageIndex];
  const predicateKeys = operationPredicates(argument);
  const stageOutputs = new Set(stage.outputIds);
  const results = response.resultIds.filter((id) => stageOutputs.has(id));
  const candidates = response.relations.filter((relation) => predicateKeys.includes(predicateKey(relation.predicate)));
  const operation = stage.operation;
  if (kind === "pick") {
    const sourceIds = stageIndex > 0 ? response.trace[stageIndex - 1].outputIds : stage.inputIds;
    if (sourceIds.length !== 1) return { relations: [], referenceIds: [], operation };
    const referenceId = sourceIds[0];
    const relations = results.flatMap((id) => {
      const proof = candidates
        .filter((relation) => relation.subjectId === id && relation.objectId === referenceId)
        .sort((a, b) => predicateKeys.indexOf(predicateKey(a.predicate)) - predicateKeys.indexOf(predicateKey(b.predicate)))[0];
      return proof ? [proof] : [];
    });
    return { relations, referenceIds: [referenceId], operation };
  }

  const inputIds = new Set(stage.inputIds);
  const resultIds = new Set(results);
  const represented = new Set<string>();
  const relations: SpatialRelationData[] = [];
  for (const id of results) {
    if (represented.has(id)) continue;
    const proof = candidates
      .filter((relation) => {
        const other = relation.subjectId === id ? relation.objectId : relation.objectId === id ? relation.subjectId : null;
        return other !== null && other !== id && inputIds.has(other);
      })
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.subjectId.localeCompare(b.subjectId) || a.objectId.localeCompare(b.objectId))[0];
    if (!proof) continue;
    relations.push(proof);
    represented.add(id);
    if (resultIds.has(proof.subjectId)) represented.add(proof.subjectId);
    if (resultIds.has(proof.objectId)) represented.add(proof.objectId);
  }
  return { relations, referenceIds: [], operation };
}
