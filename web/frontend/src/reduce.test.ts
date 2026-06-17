import { describe, expect, test } from "bun:test";
import type { LiveState } from "@udcpine/shared";
import { applyEvent } from "./reduce";

const IDLE: LiveState = { firing: null, latest_sample: null, active_pizza: null, cooking_started_at: null };

describe("applyEvent — sample while idle", () => {
  test("folds a sample into latest_sample even when firing is null", () => {
    const next = applyEvent(IDLE, {
      type: "sample",
      t: "2026-06-10T00:00:00Z",
      temp_c: 22,
    });
    expect(next.latest_sample).toEqual({ t: "2026-06-10T00:00:00Z", temp_c: 22 });
    expect(next.firing).toBeNull();
  });
});

describe("applyEvent — cooking_started_at", () => {
  const IDLE_STATE: LiveState = {
    firing: null,
    latest_sample: null,
    active_pizza: null,
    cooking_started_at: null,
  };
  const FIRING = { id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active" as const };
  const pizza = (id: number, started_at: string) => ({
    id, firing_id: 1, seq: id, name: `p${id}`, started_at, ended_at: null,
  });

  test("first pizza_started sets cooking_started_at to its started_at", () => {
    const warming = applyEvent(IDLE_STATE, { type: "firing_started", firing: FIRING });
    expect(warming.cooking_started_at).toBeNull();
    const cooking = applyEvent(warming, {
      type: "pizza_started",
      pizza: pizza(1, "2026-06-16T00:05:00Z"),
    });
    expect(cooking.cooking_started_at).toBe("2026-06-16T00:05:00Z");
  });

  test("second pizza_started does not overwrite cooking_started_at", () => {
    const cooking: LiveState = { ...IDLE_STATE, firing: FIRING, cooking_started_at: "2026-06-16T00:05:00Z" };
    const next = applyEvent(cooking, {
      type: "pizza_started",
      pizza: pizza(2, "2026-06-16T00:20:00Z"),
    });
    expect(next.cooking_started_at).toBe("2026-06-16T00:05:00Z");
  });

  test("firing_started and firing_ended reset cooking_started_at to null", () => {
    const cooking: LiveState = { ...IDLE_STATE, firing: FIRING, cooking_started_at: "2026-06-16T00:05:00Z" };
    expect(applyEvent(cooking, { type: "firing_started", firing: FIRING }).cooking_started_at).toBeNull();
    expect(applyEvent(cooking, { type: "firing_ended", firing_id: 1 }).cooking_started_at).toBeNull();
  });
});
