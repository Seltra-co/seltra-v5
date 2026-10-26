import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.SELTRA_E2E_PORT || "8081";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "artifacts",
  use: {
    ...devices["Desktop Chrome"],
    channel: "msedge",
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer:
    process.env.SELTRA_E2E_SKIP_SERVER === "1"
      ? undefined
      : {
          command: "node start.mjs",
          url: `http://127.0.0.1:${e2ePort}/healthz`,
          reuseExistingServer: process.env.SELTRA_E2E_REUSE_SERVER === "1",
          timeout: 300_000,
        },
});
