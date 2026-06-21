import { describe, it, expect } from "bun:test";
import { selectState, HYSTERESIS_C } from "./state-machine";
import { manifest } from "./manifest";

describe("selectState", () => {
  it("maps a temperature (°C) to the band it falls in", () => {
    expect(selectState(50, null, manifest)).toBe("frozen");
    expect(selectState(80, null, manifest)).toBe("thawing");
    expect(selectState(110, null, manifest)).toBe("active");
    expect(selectState(160, null, manifest)).toBe("hot");
    expect(selectState(220, null, manifest)).toBe("very_hot");
  });

  it("treats edges as [low, high) — an edge lands in the upper band", () => {
    expect(selectState(66, null, manifest)).toBe("thawing");
    expect(selectState(93, null, manifest)).toBe("active");
    expect(selectState(135, null, manifest)).toBe("hot");
    expect(selectState(191, null, manifest)).toBe("very_hot");
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
    // 160 and 220 fall in the absent hot / very_hot bands → clamp to active.
    expect(selectState(160, null, partial)).toBe("active");
    expect(selectState(220, null, partial)).toBe("active");
  });

  it("holds prevState within the hysteresis dead-band", () => {
    // 95 is past the 93 edge but within HYSTERESIS_C — stay in thawing.
    expect(selectState(95, "thawing", manifest)).toBe("thawing");
  });

  it("switches once a temperature clears the edge by the full margin", () => {
    expect(selectState(93 + HYSTERESIS_C, "thawing", manifest)).toBe("active");
    expect(selectState(60, "thawing", manifest)).toBe("frozen");
  });
});
