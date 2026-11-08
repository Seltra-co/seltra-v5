import { describe, expect, it } from "vitest";
import { seltraEngineModelBaseUrl } from "../../server/src/model_gateway_url.js";

describe("workspace Core model URL", () => {
  it("keeps the public Core /v1 route", () => {
    expect(seltraEngineModelBaseUrl("https://core.example.test/v1"))
      .toBe("https://core.example.test/v1");
  });

  it("preserves a configured local API origin for development", () => {
    expect(seltraEngineModelBaseUrl("http://127.0.0.1:3001/api/v5/"))
      .toBe("http://127.0.0.1:3001/v1");
  });
});
