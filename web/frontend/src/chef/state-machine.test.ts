import { describe, it, expect } from "bun:test";
import { selectState, HYSTERESIS_F } from "./state-machine";
import { manifest } from "./manifest";

describe("selectState", () => {
  it("maps a temperature to the band it falls in", () => {
    expect(selectState(100, null, manifest)).toBe("frozen");
    expect(selectState(300, null, manifest)).toBe("thawing");
    expect(selectState(400, null, manifest)).toBe("active");
    expect(selectState(500, null, manifest)).toBe("hot");
    expect(selectState(700, null, manifest)).toBe("very_hot");
  });

  it("treats edges as [low, high) — an edge lands in the upper band", () => {
    expect(selectState(250, null, manifest)).toBe("thawing");
    expect(selectState(350, null, manifest)).toBe("active");
    expect(selectState(450, null, manifest)).toBe("hot");
    expect(selectState(550, null, manifest)).toBe("very_hot");
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
    // 500 and 700 fall in the absent hot / very_hot bands → clamp to active.
    expect(selectState(500, null, partial)).toBe("active");
    expect(selectState(700, null, partial)).toBe("active");
  });

  it("holds prevState within the hysteresis dead-band", () => {
    // 355 is past the 350 edge but within HYSTERESIS_F — stay in thawing.
    expect(selectState(355, "thawing", manifest)).toBe("thawing");
  });

  it("switches once a temperature clears the edge by the full margin", () => {
    expect(selectState(350 + HYSTERESIS_F, "thawing", manifest)).toBe("active");
    expect(selectState(241, "thawing", manifest)).toBe("frozen");
  });
});
