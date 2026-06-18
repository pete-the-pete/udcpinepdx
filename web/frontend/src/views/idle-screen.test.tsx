import { describe, expect, test, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";

const startFiring = mock(async () => ({
  id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active",
}));
mock.module("../api", () => ({ startFiring }));

import { IdleScreen } from "./idle-screen";

afterEach(() => {
  cleanup();
  startFiring.mockClear();
});

describe("IdleScreen", () => {
  test("renders Chuck, ambient temp, and a Start fire button — no name input", () => {
    render(<IdleScreen onStarted={() => {}} latestSample={{ t: "2026-06-16T00:00:00Z", temp_c: 232.2 }} />);
    expect(screen.getByRole("button", { name: /start firing/i })).toBeDefined();
    expect(screen.getByLabelText(/current hearth temperature/i)).toBeDefined();
    expect(document.querySelector(".chef__sprite")).not.toBeNull();
    expect(screen.queryByLabelText(/pizza name/i)).toBeNull();
  });

  test("Start fire calls startFiring only, then onStarted", async () => {
    const onStarted = mock(() => {});
    render(<IdleScreen onStarted={onStarted} latestSample={null} />);
    fireEvent.click(screen.getByRole("button", { name: /start firing/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(startFiring).toHaveBeenCalledTimes(1);
  });
});
