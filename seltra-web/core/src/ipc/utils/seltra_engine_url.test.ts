import { afterEach, describe, expect, it, vi } from "vitest";
import { getSeltraEngineBaseUrl } from "./seltra_engine_url";

const originalSeltraUrl = process.env.SELTRA_ENGINE_URL;
const originalLegacyUrl = process.env.DYAD_ENGINE_URL;

afterEach(() => {
  if (originalSeltraUrl === undefined) delete process.env.SELTRA_ENGINE_URL;
  else process.env.SELTRA_ENGINE_URL = originalSeltraUrl;
  if (originalLegacyUrl === undefined) delete process.env.DYAD_ENGINE_URL;
  else process.env.DYAD_ENGINE_URL = originalLegacyUrl;
  vi.restoreAllMocks();
});

describe("Seltra Engine URL resolution", () => {
  it("prefers SELTRA_ENGINE_URL and trims its trailing slash", () => {
    process.env.SELTRA_ENGINE_URL = "http://localhost:3001/v1/";
    process.env.DYAD_ENGINE_URL = "https://legacy.example/v1";
    expect(getSeltraEngineBaseUrl()).toBe("http://localhost:3001/v1");
  });

  it("uses the legacy URL only as an explicit fallback and warns once", () => {
    delete process.env.SELTRA_ENGINE_URL;
    process.env.DYAD_ENGINE_URL = "http://127.0.0.1:4321/v1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getSeltraEngineBaseUrl()).toBe("http://127.0.0.1:4321/v1");
    expect(warn).toHaveBeenCalledWith("[Seltra Engine] legacy engine settings in use; migrate to SELTRA_ENGINE_*");
  });

  it("never falls back to a hosted legacy default", () => {
    delete process.env.SELTRA_ENGINE_URL;
    delete process.env.DYAD_ENGINE_URL;
    expect(() => getSeltraEngineBaseUrl()).toThrow(/SELTRA_ENGINE_URL/);
  });
});
