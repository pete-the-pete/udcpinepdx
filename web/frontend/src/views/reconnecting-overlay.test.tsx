import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { ReconnectingOverlay, RECONNECT_STEP_KEY } from "./reconnecting-overlay";

describe("ReconnectingOverlay", () => {
  let reloadMock: ReturnType<typeof mock>;
  let originalReload: Location["reload"];

  beforeEach(() => {
    sessionStorage.clear();
    originalReload = window.location.reload;
    reloadMock = mock(() => {});
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      writable: true,
      value: reloadMock,
    });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      writable: true,
      value: originalReload,
    });
  });

  test("renders overlay text and a Reload now button", () => {
    render(<ReconnectingOverlay />);
    expect(screen.getByText(/Reconnecting to oven/i)).toBeDefined();
    // "Auto-reload in" prefix; the trailing number changes every second.
    expect(screen.getByText(/Auto-reload in/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /reload now/i })).toBeDefined();
  });

  test("clicking 'Reload now' calls window.location.reload", () => {
    render(<ReconnectingOverlay />);
    const btn = screen.getByRole("button", { name: /reload now/i });
    fireEvent.click(btn);
    expect(reloadMock).toHaveBeenCalled();
  });

  test("auto-reloads after the backoff delay", async () => {
    // Hijack setTimeout to fire synchronously so we don't depend on a
    // fake-clock implementation. This is a behaviour test: the overlay
    // schedules a reload via setTimeout, and we just want to observe it.
    const originalSetTimeout = globalThis.setTimeout;
    let captured: (() => void) | null = null;
    globalThis.setTimeout = ((fn: () => void) => {
      captured = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    try {
      render(<ReconnectingOverlay />);
      expect(captured).not.toBeNull();
      captured!();
      expect(reloadMock).toHaveBeenCalled();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("initializing with a persisted step honors it (step=2 → 5s backoff, not 1s)", async () => {
    // Stash step=2 in sessionStorage before mounting, simulating two prior
    // reload cycles. The overlay should read it and schedule a 5s timeout
    // (backoff index 2 = 5000ms), not the 1s step-0 delay.
    sessionStorage.setItem(RECONNECT_STEP_KEY, "2");

    const originalSetTimeout = globalThis.setTimeout;
    let capturedDelay: number | undefined;
    let captured: (() => void) | null = null;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      capturedDelay = ms;
      captured = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    try {
      render(<ReconnectingOverlay />);
      expect(captured).not.toBeNull();
      // Step 2 → RELOAD_BACKOFF_MS[2] = 5000ms
      expect(capturedDelay).toBe(5000);
      // Firing the timeout should persist step 3 before reloading.
      captured!();
      expect(sessionStorage.getItem(RECONNECT_STEP_KEY)).toBe("3");
      expect(reloadMock).toHaveBeenCalled();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});
