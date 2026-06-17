import { describe, expect, mock, test } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import path from "node:path";

// Stub the Vite-only import.meta.glob module before ChefStage loads it.
const sheetUrlsAbs = path.resolve(import.meta.dir, "sheet-urls.ts");
mock.module(sheetUrlsAbs, () => ({ sheetUrls: {} }));

// Dynamic import so the mock is registered first.
const { ChefStage } = await import("./ChefStage");

describe("ChefStage", () => {
  test("renders a sprite stage for a cold reading (frozen)", () => {
    const { container } = render(
      <ChefStage latest_sample={{ t: "2026-06-16T00:00:00Z", temp_c: 18 }} />,
    );
    expect(container.querySelector(".chef__stage")).not.toBeNull();
    expect(container.querySelector(".chef__sprite")).not.toBeNull();
    cleanup();
  });

  test("renders a stage even with no sample (null → coldest state)", () => {
    const { container } = render(<ChefStage latest_sample={null} />);
    expect(container.querySelector(".chef__sprite")).not.toBeNull();
    cleanup();
  });
});
