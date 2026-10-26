import { describe, expect, it } from "vitest";
import { loadConfig } from "../../server/src/config";

const requiredEnv = {
  CORE_TOKEN_SECRET: "a".repeat(32),
  CORE_SERVICE_SECRET: "b".repeat(32),
  NEST_INTERNAL_URL: "http://127.0.0.1:3001",
};

describe("web model budgets", () => {
  it("defaults one run and one workspace to six million input tokens", () => {
    const config = loadConfig(requiredEnv);

    expect(config.MODEL_MAX_TOKENS_PER_RUN).toBe(6_000_000);
    expect(config.MODEL_MAX_TOKENS_PER_WORKSPACE).toBe(6_000_000);
  });

  it("keeps explicit deployment budget overrides", () => {
    const config = loadConfig({
      ...requiredEnv,
      MODEL_MAX_TOKENS_PER_RUN: "5000000",
      MODEL_MAX_TOKENS_PER_WORKSPACE: "5000000",
    });

    expect(config.MODEL_MAX_TOKENS_PER_RUN).toBe(5_000_000);
    expect(config.MODEL_MAX_TOKENS_PER_WORKSPACE).toBe(5_000_000);
  });
});
