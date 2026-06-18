import { describe, expect, test, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";

const nextPizza = mock(async () => ({
  id: 1, firing_id: 1, seq: 1, name: "margherita",
  started_at: "2026-06-16T00:05:00Z", ended_at: null,
}));
const endFiring = mock(async () => ({
  id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: "2026-06-16T00:01:00Z", status: "ended",
}));
mock.module("../api", () => ({ nextPizza, endFiring }));

import { WarmingUpScreen } from "./warming-up-screen";

const FIRING = { id: 1, started_at: "2026-06-16T00:00:00Z", ended_at: null, status: "active" as const };

afterEach(() => {
  cleanup();
  nextPizza.mockClear();
  endFiring.mockClear();
});

describe("WarmingUpScreen", () => {
  test("renders Chuck, temp, elapsed timer, and the first-pizza form", () => {
    render(<WarmingUpScreen firing={FIRING} latestSample={{ t: "2026-06-16T00:00:30Z", temp_c: 80 }} onAction={() => {}} />);
    expect(screen.getByText(/warming up/i)).toBeDefined();
    expect(screen.getByLabelText(/first pizza name/i)).toBeDefined();
    expect(document.querySelector(".chef__sprite")).not.toBeNull();
  });

  test("Start first pizza calls nextPizza(name) then onAction", async () => {
    const onAction = mock(() => {});
    render(<WarmingUpScreen firing={FIRING} latestSample={null} onAction={onAction} />);
    fireEvent.input(screen.getByLabelText(/first pizza name/i), { target: { value: "margherita" } });
    fireEvent.click(screen.getByRole("button", { name: /start first pizza/i }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(nextPizza).toHaveBeenCalledWith("margherita");
  });

  test("Cancel calls endFiring then onAction", async () => {
    const onAction = mock(() => {});
    render(<WarmingUpScreen firing={FIRING} latestSample={null} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel firing/i }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(endFiring).toHaveBeenCalledTimes(1);
  });
});
