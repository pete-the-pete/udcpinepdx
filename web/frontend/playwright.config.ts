import { defineConfig, devices } from "@playwright/test";

/**
 * Boots Flask (:5001) and Vite (:5173) before the suite, tears them down
 * after. Tests drive Chromium against the Vite dev server, which proxies
 * /api to Flask exactly as in `make dev`.
 *
 * webServer commands run with this file's directory (web/frontend) as cwd.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // One worker: the backend Store is a single in-memory session; parallel
  // tests would fight over it. The suite is tiny, so this is not a cost.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "cd ../backend && uv run flask --app udcpine_backend.app:create_app run --port 5001",
      url: "http://127.0.0.1:5001/api/state",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { UDCPINE_BOOTSTRAP_TOKEN: "e2e-bootstrap-token" },
    },
    {
      command: "bun run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
