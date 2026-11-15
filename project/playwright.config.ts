import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for AURA Athletic Club ERP.
 *
 * Two suites:
 *   tests/smoke — UI rendering tests; the /api/* responses and camera layer are
 *                 mocked, so they never touch the database.
 *   tests/api   — integration tests against the real Next.js server and the real
 *                 PostgreSQL database (run `npm run db:seed` first).
 *
 * Run one suite at a time:
 *   npm run test:smoke
 *   npm run test:api
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3001);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  timeout: 30_000,
  retries: 0,
  workers: 1, // serial to avoid database races and port conflicts
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: `npx next dev --port ${PORT} --webpack`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://localhost:5432/aura_erp",
    },
  },

  projects: [
    {
      name: "smoke-desktop",
      testDir: "./tests/smoke",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "smoke-mobile",
      testDir: "./tests/smoke",
      // Chromium at phone dimensions: exercises the responsive layout without
      // requiring a separate WebKit download.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "api",
      testDir: "./tests/api",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
