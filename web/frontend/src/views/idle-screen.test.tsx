import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/preact";
import { IdleScreen } from "./idle-screen";

afterEach(cleanup);

describe("IdleScreen temperature readout", () => {
  test("renders the current reading in Fahrenheit", () => {
    render(
      <IdleScreen
        onStarted={() => {}}
        latestSample={{ t: "2026-06-10T00:00:00Z", temp_c: 232.2 }}
      />,
    );
    expect(screen.getByText("450°F")).toBeDefined();
  });

  test("shows an em-dash placeholder when there is no reading", () => {
    render(<IdleScreen onStarted={() => {}} latestSample={null} />);
    expect(screen.getByText("—")).toBeDefined();
  });
});
