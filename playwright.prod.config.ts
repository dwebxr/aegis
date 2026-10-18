import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/prod-smoke",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/prod-smoke",
  reporter: [["github"], ["html", { open: "never", outputFolder: "playwright-report/prod-smoke" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3421",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- -p 3421",
    url: "http://localhost:3421",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
