import { test, expect } from "@playwright/test";

const BOOTSTRAP = "e2e-bootstrap-token";
const BACKEND = "http://127.0.0.1:5001";

/**
 * Verifies the SSE-reconnect overlay contract:
 *
 *   pair → idle live state → break the stream backend-side →
 *   <ReconnectingOverlay> appears → heal the stream → overlay disappears
 *
 * The break/heal hooks are gated on UDCPINE_TEST_HOOKS=1 (see
 * playwright.config.ts → webServer.env). The actual window.location.reload()
 * path is covered in unit tests — Playwright assertions across a page
 * reload are fragile and add nothing here.
 */
test("SSE outage shows the reconnecting overlay; heal removes it", async ({ page }) => {
  await page.goto(`/?t=${BOOTSTRAP}`);
  // Confirm we're past auth and on the idle screen (Live mounted).
  await expect(page.getByRole("button", { name: "START FIRING" })).toBeVisible();

  // Break the stream. The hook closes the current SSE response; the
  // browser auto-reconnects, gets 503, and after the 3s debounce the
  // hook flips connectionState to "reconnecting".
  const breakRes = await page.request.post(`${BACKEND}/api/_test/break-stream`);
  expect(breakRes.status()).toBe(200);

  await expect(page.getByText(/Reconnecting to oven/i)).toBeVisible({
    // Debounce is 3s + EventSource reconnect interval slack.
    timeout: 8000,
  });

  // Heal: clear the flag. The overlay's auto-reload would also recover,
  // but here we just want to assert the overlay-clears contract within
  // a few seconds without depending on page reload timing.
  const healRes = await page.request.post(`${BACKEND}/api/_test/heal-stream`);
  expect(healRes.status()).toBe(200);

  // After heal, the overlay's backoff fires window.location.reload() and
  // the freshly-mounted Live hook receives a healthy stream. Either way,
  // the overlay is gone shortly after heal.
  await expect(page.getByText(/Reconnecting to oven/i)).toBeHidden({
    timeout: 15000,
  });
  await expect(page.getByRole("button", { name: "START FIRING" })).toBeVisible();
});
