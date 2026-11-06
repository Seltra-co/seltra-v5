import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlaywrightAvailable, verifyPlaywrightBrowser } from "./playwright_health";

describe("isolated web runtime browser tooling", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("skips Chromium startup and reports browser tooling unavailable", async () => {
    vi.stubEnv("DYAD_WEB_RUNTIME", "1");
    await verifyPlaywrightBrowser();
    expect(isPlaywrightAvailable()).toBe(false);
  });
});
