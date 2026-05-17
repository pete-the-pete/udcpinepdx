import { test, expect } from "@playwright/test";

const BOOTSTRAP = "e2e-bootstrap-token";

/**
 * Full firing loop, now behind auth:
 *   pair (bootstrap token) → idle → START → live temp climbs → STOP → idle
 *
 * The test pairs by visiting `/?t=<bootstrap>`, exactly as a human opens
 * the link the server prints to its console. The bootstrap token is fixed
 * for tests via UDCPINE_BOOTSTRAP_TOKEN (see playwright.config.ts).
 */
test("pair → start → live temp climbs → stop → idle", async ({ page }) => {
  // --- pair via the bootstrap link ---------------------------------------
  await page.goto(`/?t=${BOOTSTRAP}`);

  // --- idle --------------------------------------------------------------
  const startButton = page.getByRole("button", { name: "START FIRING" });
  await expect(startButton).toBeVisible();

  // --- start -------------------------------------------------------------
  await startButton.click();
  await expect(page.getByText(/FIRING #\d+ · ACTIVE/)).toBeVisible();
  const stopButton = page.getByRole("button", { name: "stop firing" });
  await expect(stopButton).toBeVisible();

  // --- live temperature climbs ------------------------------------------
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

  // --- stop --------------------------------------------------------------
  await stopButton.click();
  await expect(page.getByRole("button", { name: "START FIRING" })).toBeVisible();
});

/**
 * An unpaired device (no ?t=, no cookie) gets the pair screen, not the
 * dashboard — proves the auth gate actually gates.
 */
test("unpaired device sees the pair screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("This device isn't paired")).toBeVisible();
  await expect(page.getByRole("button", { name: "START FIRING" })).toHaveCount(0);
});
