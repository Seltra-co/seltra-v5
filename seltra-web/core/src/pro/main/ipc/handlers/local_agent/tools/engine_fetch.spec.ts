import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: { providerSettings: { auto: { apiKey: { value: "legacy-engine-key" } } }, seltraEngineApiKey: undefined as { value: string } | undefined } }));

vi.mock("@/main/settings", () => ({ readSettings: () => mocks.settings }));

import { engineFetch, isSeltraEngineConfigured } from "./engine_fetch";

const originalSeltraUrl = process.env.SELTRA_ENGINE_URL;
const originalSeltraKey = process.env.SELTRA_ENGINE_API_KEY;
const originalCreditIdentity = process.env.SELTRA_ENGINE_CREDIT_IDENTITY;
const originalLegacyUrl = process.env.DYAD_ENGINE_URL;

afterEach(() => {
  for (const [name, value] of [["SELTRA_ENGINE_URL", originalSeltraUrl], ["SELTRA_ENGINE_API_KEY", originalSeltraKey], ["SELTRA_ENGINE_CREDIT_IDENTITY", originalCreditIdentity], ["DYAD_ENGINE_URL", originalLegacyUrl]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  mocks.settings.seltraEngineApiKey = undefined;
  vi.restoreAllMocks();
});

describe("Seltra engine client", () => {
  it("uses the Seltra URL and key and sends the request id", async () => {
    process.env.SELTRA_ENGINE_URL = "http://localhost:3001/v1";
    process.env.SELTRA_ENGINE_API_KEY = "sk_seltra_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    process.env.SELTRA_ENGINE_CREDIT_IDENTITY = "signed-credit-identity";
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const response = await engineFetch({ dyadRequestId: "request-1", abortSignal: new AbortController().signal }, "/probe");
    await response.json();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3001/v1/probe", expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${process.env.SELTRA_ENGINE_API_KEY}`, "X-Request-ID": "request-1", "x-seltra-credit-identity": "signed-credit-identity" }) }));
    expect(isSeltraEngineConfigured()).toBe(true);
  });

  it("uses legacy key and URL only when Seltra settings are absent", async () => {
    delete process.env.SELTRA_ENGINE_URL;
    delete process.env.SELTRA_ENGINE_API_KEY;
    process.env.DYAD_ENGINE_URL = "http://127.0.0.1:4321/v1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const response = await engineFetch({ dyadRequestId: "legacy-1", abortSignal: new AbortController().signal }, "/probe");
    await response.json();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4321/v1/probe", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer legacy-engine-key" }) }));
    expect(warn).toHaveBeenCalled();
  });

  it("does not report configured without URL and key", () => {
    delete process.env.SELTRA_ENGINE_URL;
    delete process.env.SELTRA_ENGINE_API_KEY;
    delete process.env.DYAD_ENGINE_URL;
    mocks.settings.providerSettings.auto.apiKey.value = "";
    expect(isSeltraEngineConfigured()).toBe(false);
  });
});
