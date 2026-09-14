import { describe, expect, it } from "vitest";
import { objectVisualPolicy } from "./visualState";

describe("scene visibility and shadows", () => {
  it("keeps non-result furniture visible without leaving an opaque shadow", () => {
    expect(objectVisualPolicy(1, true, false, false, false)).toEqual({
      opacity: 0.6, transparent: true, depthWrite: false, castShadow: false,
    });
  });

  it("restores the original material when an object becomes selected or a result", () => {
    expect(objectVisualPolicy(1, true, false, true, false).castShadow).toBe(true);
    expect(objectVisualPolicy(1, true, true, false, false).opacity).toBe(1);
    expect(objectVisualPolicy(1, false, false, false, false).opacity).toBe(1);
  });

  it("does not let intrinsically translucent geometry cast a solid shadow", () => {
    expect(objectVisualPolicy(0.45, true, false, true, true).castShadow).toBe(false);
  });
});
