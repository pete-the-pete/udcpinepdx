import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { ReconnectingOverlay } from "./reconnecting-overlay";

describe("ReconnectingOverlay", () => {
  let reloadMock: ReturnType<typeof mock>;
  let originalReload: Location["reload"];

  beforeEach(() => {
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
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      writable: true,
      value: originalReload,
    });
  });

  test("renders overlay text and a Reload now button", () => {
    render(<ReconnectingOverlay />);
    expect(screen.getByText(/Reconnecting to oven/i)).toBeDefined();
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
});
