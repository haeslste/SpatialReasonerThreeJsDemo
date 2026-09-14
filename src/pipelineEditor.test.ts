import { describe, expect, it } from "vitest";
import { parsePipeline, serializePipeline, STAGE_DEFAULTS } from "./pipelineEditor";

describe("pipeline stage editing", () => {
  it("round-trips a formal SRpy pipeline", () => {
    const pipeline = "deduce(topology) | filter(id == 'laptop') | pick(left)";
    expect(serializePipeline(parsePipeline(pipeline)!)).toBe(pipeline);
  });

  it("lets stages be added, reordered and removed without changing their arguments", () => {
    const stages = parsePipeline("filter(immobile == False) | sort(volume >)")!;
    stages.push({ kind: "slice", argument: STAGE_DEFAULTS.slice });
    [stages[0], stages[1]] = [stages[1], stages[0]];
    expect(serializePipeline(stages)).toBe("sort(volume >) | filter(immobile == False) | slice(1)");
    stages.splice(1, 1);
    expect(serializePipeline(stages)).toBe("sort(volume >) | slice(1)");
  });

  it("rejects malformed or overlong stage structures in the editor", () => {
    expect(parsePipeline("filter(id == 'x') | ")).toBeNull();
    expect(parsePipeline("unknown(x)")).toBeNull();
    expect(parsePipeline(Array(13).fill("slice(1)").join(" | "))).toBeNull();
  });
});
