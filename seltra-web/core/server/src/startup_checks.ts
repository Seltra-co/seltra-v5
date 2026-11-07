import { lookup as dnsLookup } from "node:dns/promises";

type Lookup = typeof dnsLookup;

export async function assertCorePublicUrlResolvable(
  publicUrl: string | undefined,
  lookup: Lookup = dnsLookup,
): Promise<void> {
  if (!publicUrl) {
    throw new Error("CORE_PUBLIC_URL is required for sandbox callbacks.");
  }
  let hostname: string;
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== "https:") throw new Error("HTTPS is required");
    hostname = parsed.hostname;
  } catch {
    throw new Error("CORE_PUBLIC_URL must be a valid HTTPS callback URL.");
  }
  try {
    await lookup(hostname);
  } catch {
    throw new Error(
      "CORE_PUBLIC_URL does not resolve. Configure a stable named tunnel hostname before starting Core.",
    );
  }
}

export async function assertModelProviderReachable(input: {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.apiKey?.trim() || !input.model.trim()) {
    throw new Error("The model provider startup check requires a model and API key.");
  }
  let modelUrl: URL;
  try {
    modelUrl = new URL(input.baseUrl);
  } catch {
    throw new Error("MODEL_BASE_URL must point to the configured model provider.");
  }
  if (input.callbackUrl) {
    try {
      if (modelUrl.hostname === new URL(input.callbackUrl).hostname) {
        throw new Error(
          "MODEL_BASE_URL must use the provider endpoint; CORE_PUBLIC_URL is reserved for sandbox callbacks.",
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("MODEL_BASE_URL")) throw error;
    }
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new Error(
      `Model provider startup check failed for ${input.provider}; Core cannot reach the configured provider.`,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Model provider startup check failed for ${input.provider} (HTTP ${response.status}).`,
    );
  }
  const result = (await response.json().catch(() => null)) as
    | { choices?: unknown[] }
    | null;
  if (!Array.isArray(result?.choices) || result.choices.length === 0) {
    throw new Error(
      `Model provider startup check failed for ${input.provider}; no model response was returned.`,
    );
  }
}
