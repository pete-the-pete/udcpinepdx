import { test, expect } from "@playwright/test";

/**
 * Full firing loop against real Flask + Vite servers:
 *   idle  →  START  →  live temperature climbs (SSE)  →  STOP  →  idle
 *
 * The climb assertion is the load-bearing one: it only passes if the SSE
 * stream delivered multiple `sample` events and the reducer folded them in.
 * A broken stream would leave the number stuck at "—" or a single ~70.
 */
test("idle → start → live temp climbs → stop → idle", async ({ page }) => {
  await page.goto("/");

  // --- idle ---------------------------------------------------------------
  const startButton = page.getByRole("button", { name: "START FIRING" });
  await expect(startButton).toBeVisible();

  // --- start --------------------------------------------------------------
  await startButton.click();

  // The active view shows the firing header and a STOP control.
  await expect(page.getByText(/FIRING #\d+ · ACTIVE/)).toBeVisible();
  const stopButton = page.getByRole("button", { name: "stop firing" });
  await expect(stopButton).toBeVisible();

  // --- live temperature climbs -------------------------------------------
  // Mock ramp starts at 70°F and climbs ~1.3°F/s. Reaching >80 proves the
  // SSE stream delivered several samples and the UI reduced them.
  await expect
    .poll(
      async () => {
        const text = (await page.locator(".hero__num").textContent()) ?? "";
        const n = Number(text.trim());
        return Number.isFinite(n) ? n : 0;
      },
      { timeout: 25_000, message: "hero temperature should climb past 80°F" },
    )
    .toBeGreaterThan(80);

  // --- stop ---------------------------------------------------------------
  await stopButton.click();
  await expect(page.getByRole("button", { name: "START FIRING" })).toBeVisible();
});
