import { describe, expect, it, vi } from "vitest";
import {
  assertCorePublicUrlResolvable,
  assertModelProviderReachable,
} from "../../server/src/startup_checks.js";
import { deterministicPromptIntent, resolvePromptIntent } from "../../server/src/prompt_intent.js";

describe("Core startup checks", () => {
  it("returns a bounded intent from the fast model and falls back deterministically", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: "Services Catalog", intent: "Planning a services catalog for a small business." }) } }] }), { status: 200 }));
    await expect(resolvePromptIntent({ prompt: "Build my service catalog", baseUrl: "https://provider.example.test/v1", model: "fast", apiKey: "test-key", fetchImpl }))
      .resolves.toEqual({ name: "Services Catalog", intent: "Planning a services catalog for a small business." });
    expect(fetchImpl).toHaveBeenCalledWith("https://provider.example.test/v1/chat/completions", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await expect(resolvePromptIntent({ prompt: "Build my service catalog", baseUrl: "", model: "", fetchImpl }))
      .resolves.toEqual(deterministicPromptIntent("Build my service catalog"));
    await expect(resolvePromptIntent({ prompt: "Build my service catalog", baseUrl: "https://provider.example.test/v1", model: "fast", apiKey: "test-key", fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) }))
      .resolves.toEqual(deterministicPromptIntent("Build my service catalog"));
  });

  it("requires a resolvable HTTPS callback URL", async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: "192.0.2.1", family: 4 }]);
    await expect(assertCorePublicUrlResolvable("https://core.example.test", lookup)).resolves.toBeUndefined();
    await expect(assertCorePublicUrlResolvable("http://core.example.test", lookup)).rejects.toThrow("valid HTTPS");
    await expect(assertCorePublicUrlResolvable("https://missing.example.test", vi.fn().mockRejectedValue(new Error("ENOTFOUND"))))
      .rejects.toThrow("stable named tunnel hostname");
  });

  it("uses the provider endpoint and refuses the callback hostname", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }));
    await assertModelProviderReachable({
      provider: "test-provider",
      baseUrl: "https://provider.example.test/v1",
      callbackUrl: "https://core.example.test",
      apiKey: "test-key-not-a-secret",
      model: "test-model",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://provider.example.test/v1/chat/completions", expect.any(Object));
    await expect(assertModelProviderReachable({
      provider: "test-provider",
      baseUrl: "https://core.example.test/v1",
      callbackUrl: "https://core.example.test",
      apiKey: "test-key-not-a-secret",
      model: "test-model",
      fetchImpl,
    })).rejects.toThrow("CORE_PUBLIC_URL is reserved for sandbox callbacks");
  });

  it("fails safely when the provider cannot be reached", async () => {
    await expect(assertModelProviderReachable({
      provider: "test-provider",
      baseUrl: "https://provider.example.test/v1",
      apiKey: "test-key-not-a-secret",
      model: "test-model",
      fetchImpl: vi.fn().mockRejectedValue(new Error("sensitive transport detail")),
    })).rejects.toThrow("Core cannot reach the configured provider.");
  });
});
