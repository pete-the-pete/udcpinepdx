import { describe, it, expect } from "bun:test";
import { selectState, HYSTERESIS_C } from "./state-machine";
import { manifest } from "./manifest";

describe("selectState", () => {
  it("maps a temperature (°C) to the band it falls in", () => {
    expect(selectState(50, null, manifest)).toBe("frozen");
    expect(selectState(150, null, manifest)).toBe("thawing");
    expect(selectState(200, null, manifest)).toBe("active");
    expect(selectState(260, null, manifest)).toBe("hot");
    expect(selectState(350, null, manifest)).toBe("very_hot");
  });

  it("treats edges as [low, high) — an edge lands in the upper band", () => {
    expect(selectState(120, null, manifest)).toBe("thawing");
    expect(selectState(180, null, manifest)).toBe("active");
    expect(selectState(230, null, manifest)).toBe("hot");
    expect(selectState(290, null, manifest)).toBe("very_hot");
  });

  it("returns frozen for a null sample", () => {
    expect(selectState(null, null, manifest)).toBe("frozen");
    expect(selectState(null, "hot", manifest)).toBe("frozen");
  });

  it("clamps to the nearest present state when no band matches", () => {
    // Construct an incomplete manifest so we can exercise the clamp escape
    // hatch regardless of which states the art track has actually shipped.
    const partial = {
      frame_size: manifest.frame_size,
      states: {
        frozen: manifest.states.frozen,
        thawing: manifest.states.thawing,
        active: manifest.states.active,
      },
    } as typeof manifest;
    // 260 and 350 fall in the absent hot / very_hot bands → clamp to active.
    expect(selectState(260, null, partial)).toBe("active");
    expect(selectState(350, null, partial)).toBe("active");
  });

  it("holds prevState within the hysteresis dead-band", () => {
    // 182 is past the 180 edge but within HYSTERESIS_C — stay in thawing.
    expect(selectState(182, "thawing", manifest)).toBe("thawing");
  });

  it("switches once a temperature clears the edge by the full margin", () => {
    expect(selectState(180 + HYSTERESIS_C, "thawing", manifest)).toBe("active");
    expect(selectState(115, "thawing", manifest)).toBe("frozen");
  });
});
