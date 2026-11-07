import { describe, expect, it } from "vitest";
import { seltraEngineModelBaseUrl } from "../../server/src/model_gateway_url.js";

describe("Seltra Engine model URL", () => {
  it("uses the backend engine route instead of the Core callback hostname", () => {
    expect(seltraEngineModelBaseUrl("https://api.example.test/api/v1"))
      .toBe("https://api.example.test/v1");
  });

  it("preserves a configured local API origin for development", () => {
    expect(seltraEngineModelBaseUrl("http://127.0.0.1:3001/api/v5/"))
      .toBe("http://127.0.0.1:3001/v1");
  });
});
