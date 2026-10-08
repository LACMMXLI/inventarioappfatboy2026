import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "node scripts/e2e-api.mjs",
      url: "http://127.0.0.1:3001/api/v1/health",
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @fatboy/web exec vite --host localhost --port 5174",
      url: "http://localhost:5174",
      env: { API_TARGET: "http://127.0.0.1:3001" },
      reuseExistingServer: false,
    },
  ],
});
