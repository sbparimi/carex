import { defineConfig } from "@playwright/test";

const PORT = 4173;
export default defineConfig({
  testDir: "apps/web/e2e",
  fullyParallel: false, workers: 1, retries: 0, timeout: 30_000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: { command: `PORT=${PORT} STATIC_DIR=apps/web/public node .e2e/server.mjs`, url: `http://127.0.0.1:${PORT}/t/northwind-health/api/config`, reuseExistingServer: false, timeout: 20_000 },
});
