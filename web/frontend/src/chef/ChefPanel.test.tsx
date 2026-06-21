import { describe, expect, test, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import { ChefPanel } from "./ChefPanel";

afterEach(cleanup);

describe("ChefPanel", () => {
  test("renders the inline Chuck + ambient temperature, not expanded", () => {
    const { container } = render(
      <ChefPanel latest_sample={{ t: "2026-06-16T00:00:00Z", temp_c: 20 }} />,
    );
    expect(container.querySelector(".idle__chef")).not.toBeNull();
    expect(container.querySelector(".chef__sprite")).not.toBeNull();
    expect(screen.getByLabelText(/current hearth temperature/i)).toBeDefined();
    expect(container.querySelector(".chef--expanded")).toBeNull();
  });

  test("clicking expands Chuck to fullscreen; clicking again collapses", () => {
    const { container } = render(<ChefPanel latest_sample={null} />);
    fireEvent.click(screen.getByRole("button", { name: /click to expand/i }));
    expect(container.querySelector(".chef--expanded")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /click to collapse/i }));
    expect(container.querySelector(".chef--expanded")).toBeNull();
    expect(container.querySelector(".idle__chef")).not.toBeNull();
  });
});
