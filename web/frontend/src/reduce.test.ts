import { describe, expect, test } from "bun:test";
import type { LiveState } from "@udcpine/shared";
import { applyEvent } from "./reduce";

const IDLE: LiveState = { firing: null, latest_sample: null, active_pizza: null };

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
